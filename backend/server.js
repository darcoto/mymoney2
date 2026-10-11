const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const database = require('./database');
const logger = require('./logger');

const countryUtils = require('./country-codes');
const providerRegistry = require('./providers/provider-registry');
const GoCardlessProvider = require('./providers/gocardless-provider');
const EnableBankingProvider = require('./providers/enablebanking-provider');

// Route modules
const providersRouter = require('./routes/providers');
const syncRouter = require('./routes/sync');
const accountsRouter = require('./routes/accounts');
const transactionsRouter = require('./routes/transactions');
const { categoryRouter, rulesRouter } = require('./routes/categories');
const reportsRouter = require('./routes/reports');
const { scheduleRouter, telegramRouter, debugRouter } = require('./routes/automation');
const apiDebug = require('./api-debug');
const backup = require('./backup');
const scheduler = require('./scheduler');
const telegram = require('./telegram');
const syncService = require('./sync-service');
const { apiError } = require('./routes/helpers');
const auth = require('./auth');

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Парола за уеб достъпа (ако е зададена) — преди статичните файлове и API-то
app.use(auth.middleware);
app.use('/api', auth.router);

// Serve static files from frontend
app.use(express.static(path.join(__dirname, '../frontend')));

// Register provider classes
providerRegistry.registerProvider('gocardless', GoCardlessProvider);
providerRegistry.registerProvider('enablebanking', EnableBankingProvider);

// Initialize database
database.initialize()
  .then(() => {
    console.log('Database initialized successfully');
    // След всяка синхронизация — известия за новите транзакции
    syncService.onAfterSync(() => telegram.notifyNewTransactions());
    apiDebug.load().catch(err => logger.error('[API debug] Load failed:', err.message));
    scheduler.start();
    telegram.start().catch(err => logger.error('[Telegram] Start failed:', err.message));
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Auth status (checks if any provider is configured)
app.get('/api/auth/status', async (req, res) => {
  try {
    const providers = await database.getAllProviders();
    const configured = providers.filter(p => p.is_configured);
    res.json({
      connected: configured.length > 0,
      configuredProviders: configured.length
    });
  } catch (error) {
    apiError(res, error);
  }
});

// Mount route modules
app.use('/api/providers', providersRouter);
app.use('/api/sync', syncRouter);
app.use('/api/accounts', accountsRouter);
app.use('/api/transactions', transactionsRouter);
app.use('/api/categories', categoryRouter);
app.use('/api/categorization-rules', rulesRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/schedule', scheduleRouter);
app.use('/api/telegram', telegramRouter);
app.use('/api/debug', debugRouter);

// Countries
app.get('/api/countries', async (req, res) => {
  try {
    const countries = await database.getDistinctCountries();
    const enrichedCountries = countries.map(row => ({
      code: row.country,
      ...countryUtils.getCountryInfo(row.country)
    }));
    res.json(enrichedCountries);
  } catch (error) {
    apiError(res, error);
  }
});

app.get('/api/countries/:code', async (req, res) => {
  try {
    const info = countryUtils.getCountryInfo(req.params.code);
    if (!info) {
      return res.status(404).json({ error: 'Държавата не е намерена' });
    }
    res.json({ code: req.params.code, ...info });
  } catch (error) {
    apiError(res, error);
  }
});

// Counterparty aliases
app.get('/api/counterparty-aliases', async (req, res) => {
  try {
    const aliases = await database.getAllCounterpartyAliases();
    res.json(aliases);
  } catch (error) {
    apiError(res, error);
  }
});

app.post('/api/counterparty-aliases', async (req, res) => {
  try {
    const { originalName, displayName } = req.body;
    const id = await database.createCounterpartyAlias(originalName, displayName);
    res.status(201).json({ id, success: true });
  } catch (error) {
    apiError(res, error);
  }
});

app.put('/api/counterparty-aliases/:id', async (req, res) => {
  try {
    const { displayName } = req.body;
    await database.updateCounterpartyAlias(req.params.id, displayName);
    res.json({ success: true });
  } catch (error) {
    apiError(res, error);
  }
});

app.delete('/api/counterparty-aliases/:id', async (req, res) => {
  try {
    await database.deleteCounterpartyAlias(req.params.id);
    res.json({ success: true });
  } catch (error) {
    apiError(res, error);
  }
});

// Logs
app.get('/api/logs', async (req, res) => {
  try {
    const lines = parseInt(req.query.lines) || 100;
    const logs = logger.getRecentLogs(lines);
    res.json({ logs });
  } catch (error) {
    apiError(res, error);
  }
});

// Backup
app.post('/api/backup', async (req, res) => {
  try {
    // VACUUM INTO — последователно копие, дори докато приложението пише в базата
    const result = await backup.createBackup('manual');
    res.json({
      success: true,
      backupPath: path.relative(process.cwd(), result.path),
      message: `Backup created: ${result.file}`
    });
  } catch (error) {
    apiError(res, error);
  }
});

// Version
app.get('/api/version', (req, res) => {
  const versionFile = path.join(__dirname, '..', 'VERSION');
  try {
    const version = fs.readFileSync(versionFile, 'utf8').trim();
    res.json({ version });
  } catch (err) {
    res.json({ version: 'неизвестна' });
  }
});

// Catch-all route - serve index.html for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Error handler
app.use((err, req, res, next) => {
  logger.error('Server error:', err);

  if (err.type === 'entity.too.large') {
    const limitMB = Math.round(err.limit / 1024 / 1024);
    const sizeMB = (err.length / 1024 / 1024).toFixed(2);
    return res.status(413).json({
      error: `Файлът е твърде голям (${sizeMB} MB). Максималният разрешен размер е ${limitMB} MB.`
    });
  }

  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: 'Невалиден формат на данните. Моля, проверете файла.'
    });
  }

  if (err.code === 'ENOENT') {
    return res.status(404).json({
      error: 'Файлът не е намерен.'
    });
  }

  res.status(500).json({ error: 'Възникна грешка на сървъра. Моля, опитайте отново.' });
});

// Start server
app.listen(config.port, () => {
  console.log(`MyMoney2 server running on http://localhost:${config.port} (all network interfaces)`);
  console.log(`Database: ${config.databaseName} (${config.databasePath})`);
  console.log(`Environment: ${config.nodeEnv}`);
});
