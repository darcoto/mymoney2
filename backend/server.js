const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const database = require('./database');
const logger = require('./logger');

const categorization = require('./categorization');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from frontend
app.use(express.static(path.join(__dirname, '../frontend')));

// Initialize database
database.initialize()
  .then(() => {
    console.log('Database initialized successfully');
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Auth routes
app.get('/api/auth/status', async (req, res) => {
  try {
    const token = await database.getGoCardlessToken();
    res.json({
      connected: !!token && !!token.access_token,
      expiresAt: token?.expires_at
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GoCardless routes
const goCardlessApi = require('./gocardless-api');

app.get('/api/gocardless/institutions', async (req, res) => {
  try {
    const country = req.query.country || 'BG';
    const institutions = await goCardlessApi.getInstitutions(country);
    res.json(institutions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/gocardless/requisition', async (req, res) => {
  try {
    const { institutionId } = req.body;
    const requisition = await goCardlessApi.createRequisition(institutionId);
    res.json(requisition);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/gocardless/requisitions', async (req, res) => {
  try {
    const requisitions = await goCardlessApi.listRequisitions();
    res.json(requisitions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/gocardless/requisitions/:id', async (req, res) => {
  try {
    const requisition = await goCardlessApi.getRequisition(req.params.id);
    res.json(requisition);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/gocardless/requisitions/:id', async (req, res) => {
  try {
    await goCardlessApi.deleteRequisition(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/sync/accounts', async (req, res) => {
  try {
    const accounts = await goCardlessApi.syncAllAccounts();
    res.json({ success: true, accounts, count: accounts.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/sync/transactions', async (req, res) => {
  try {
    const accounts = await database.getAllAccounts();
    let totalSynced = 0;

    for (const account of accounts) {
      try {
        const count = await goCardlessApi.syncAccountTransactions(account.id);
        totalSynced += count;
      } catch (error) {
        console.error(`Error syncing account ${account.id}:`, error.message);
      }
    }

    res.json({ success: true, transactionsSynced: totalSynced });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Account routes
app.get('/api/accounts', async (req, res) => {
  try {
    const accounts = await database.getAllAccounts();
    res.json(accounts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/accounts/:id', async (req, res) => {
  try {
    const account = await database.getAccountById(req.params.id);
    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }
    res.json(account);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/accounts/:id/name', async (req, res) => {
  try {
    const { customName } = req.body;
    await database.updateAccountCustomName(req.params.id, customName);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Transaction routes
app.get('/api/transactions', async (req, res) => {
  try {
    const filters = {
      accountId: req.query.account_id,
      startDate: req.query.start_date,
      endDate: req.query.end_date,
      categoryId: req.query.category_id,
      type: req.query.type,
      search: req.query.search,
      limit: parseInt(req.query.limit) || 50,
      offset: parseInt(req.query.offset) || 0
    };
    const result = await database.getTransactions(filters);
    // Return object with transactions array and total count
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/transactions', async (req, res) => {
  try {
    const { transactionDate, amount, counterpartyName, description, categoryId } = req.body;

    if (!transactionDate || amount === undefined) {
      return res.status(400).json({ error: 'Дата и сума са задължителни' });
    }

    const result = await database.createManualTransaction({
      transactionDate,
      amount: parseFloat(amount),
      counterpartyName: counterpartyName || null,
      description: description || null,
      categoryId: categoryId ? parseInt(categoryId) : null
    });

    res.status(201).json({ success: true, id: result.lastID });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/transactions/:id/category', async (req, res) => {
  try {
    const { categoryId } = req.body;
    await database.updateTransactionCategory(req.params.id, categoryId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/transactions/categorize-by-counterparty', async (req, res) => {
  try {
    const { counterpartyName, categoryId } = req.body;
    const count = await database.categorizeByCounterparty(counterpartyName, categoryId);
    res.json({ success: true, updatedCount: count });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/transactions/:id/notes', async (req, res) => {
  try {
    const { notes } = req.body;
    await database.updateTransactionNotes(req.params.id, notes);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/transactions/stats', async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    const stats = await database.getTransactionStats(start_date, end_date);
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Category routes
app.get('/api/categories', async (req, res) => {
  try {
    const categories = await database.getAllCategories();
    res.json(categories);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/categories', async (req, res) => {
  try {
    const { name, type, color, icon, parentId } = req.body;
    const id = await database.createCategory({ name, type, color, icon, parentId });
    res.status(201).json({ id, success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/categories/:id', async (req, res) => {
  try {
    const { name, type, color, icon, parentId } = req.body;
    await database.updateCategory(req.params.id, { name, type, color, icon, parentId });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/categories/:id', async (req, res) => {
  try {
    await database.deleteCategory(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Categorization rules routes
app.get('/api/categorization-rules', async (req, res) => {
  try {
    const rules = await database.getAllCategorizationRules();
    res.json(rules);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/categorization-rules', async (req, res) => {
  try {
    const { pattern, categoryId, priority } = req.body;
    const id = await database.createCategorizationRule({ pattern, categoryId, priority });
    res.status(201).json({ id, success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/categorization-rules/:id', async (req, res) => {
  try {
    const { pattern, categoryId, priority, active } = req.body;
    await database.updateCategorizationRule(req.params.id, { pattern, categoryId, priority, active });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/categorization-rules/:id', async (req, res) => {
  try {
    await database.deleteCategorizationRule(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/categorization-rules/apply', async (req, res) => {
  try {
    const categorizedCount = await categorization.applyRulesToUncategorized();
    res.json({ success: true, categorizedCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Reports routes
app.get('/api/reports/monthly', async (req, res) => {
  try {
    const { year, month } = req.query;
    const report = await database.getMonthlyReport(year, month);
    res.json(report);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/reports/last-12-months', async (req, res) => {
  try {
    const report = await database.getLast12MonthsReport();
    res.json(report);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/reports/category-breakdown', async (req, res) => {
  try {
    const { start_date, end_date, type } = req.query;
    const breakdown = await database.getCategoryBreakdown(start_date, end_date, type);
    res.json(breakdown);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/reports/counterparty', async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    const report = await database.getCounterpartyReport(start_date, end_date);
    res.json(report);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Counterparty aliases routes
app.get('/api/counterparty-aliases', async (req, res) => {
  try {
    const aliases = await database.getAllCounterpartyAliases();
    res.json(aliases);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/counterparty-aliases', async (req, res) => {
  try {
    const { originalName, displayName } = req.body;
    const id = await database.createCounterpartyAlias(originalName, displayName);
    res.status(201).json({ id, success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/counterparty-aliases/:id', async (req, res) => {
  try {
    const { displayName } = req.body;
    await database.updateCounterpartyAlias(req.params.id, displayName);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/counterparty-aliases/:id', async (req, res) => {
  try {
    await database.deleteCounterpartyAlias(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Logs route
app.get('/api/logs', async (req, res) => {
  try {
    const lines = parseInt(req.query.lines) || 100;
    const logs = logger.getRecentLogs(lines);
    res.json({ logs });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Backup route
app.post('/api/backup', async (req, res) => {
  try {
    const dbPath = config.databasePath || './data/finance.db';
    const today = new Date().toISOString().split('T')[0];
    const backupPath = dbPath.replace('.db', `_backup_${today}.db`);

    // Check if source exists
    if (!fs.existsSync(dbPath)) {
      return res.status(404).json({ error: 'Database file not found' });
    }

    // Copy the database file
    fs.copyFileSync(dbPath, backupPath);

    res.json({
      success: true,
      backupPath: backupPath,
      message: `Backup created: ${path.basename(backupPath)}`
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Catch-all route - serve index.html for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(config.port, () => {
  console.log(`MyMoney2 server running on http://localhost:${config.port}`);
  console.log(`Environment: ${config.nodeEnv}`);
});
