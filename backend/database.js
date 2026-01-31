const sqlite3 = require('sqlite3').verbose();
const config = require('./config');
const path = require('path');
const fs = require('fs');
const logger = require('./logger');

let db = null;

// Ensure data directory exists
const dataDir = path.dirname(config.databasePath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize database connection
function getDb() {
  if (!db) {
    // Log visual separator for new connection
    logger.info('');
    logger.info('');
    logger.info('==============================================');
    logger.info(`Database connection: ${config.databasePath}`);

    db = new sqlite3.Database(config.databasePath, (err) => {
      if (err) {
        console.error('Error opening database:', err);
      }
    });
  }
  return db;
}

// Log SQL query
function logSql(query, params = []) {
  let formattedQuery = query.replace(/\s+/g, ' ').trim();
  
  // Replace ? placeholders with actual parameter values
  if (params.length > 0) {
    let paramIndex = 0;
    formattedQuery = formattedQuery.replace(/\?/g, () => {
      if (paramIndex >= params.length) return '?';
      const value = params[paramIndex++];
      if (value === null || value === undefined) return 'NULL';
      if (typeof value === 'number') return value.toString();
      // Escape single quotes in strings and wrap in quotes
      return `'${String(value).replace(/'/g, "''")}'`;
    });
  }
  
  logger.debug(`[SQL] ${formattedQuery}`);
}

// Promisify database operations
function runQuery(query, params = []) {
  logSql(query, params);
  return new Promise((resolve, reject) => {
    getDb().run(query, params, function(err) {
      if (err) {
        logger.error(`[SQL Error] ${err.message}`, { query: query.substring(0, 100), params });
        reject(err);
      }
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function getQuery(query, params = []) {
  logSql(query, params);
  return new Promise((resolve, reject) => {
    getDb().get(query, params, (err, row) => {
      if (err) {
        logger.error(`[SQL Error] ${err.message}`, { query: query.substring(0, 100), params });
        reject(err);
      }
      else resolve(row);
    });
  });
}

function allQuery(query, params = []) {
  logSql(query, params);
  return new Promise((resolve, reject) => {
    getDb().all(query, params, (err, rows) => {
      if (err) {
        logger.error(`[SQL Error] ${err.message}`, { query: query.substring(0, 100), params });
        reject(err);
      }
      else resolve(rows);
    });
  });
}

// Initialize database schema
async function initialize() {
  const db = getDb();

  return new Promise((resolve, reject) => {
    db.serialize(async () => {
      try {
        // Create accounts table
        await runQuery(`
          CREATE TABLE IF NOT EXISTS accounts (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            institution_name TEXT,
            iban TEXT,
            currency TEXT DEFAULT 'BGN',
            balance REAL,
            last_synced DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);

        // Create categories table
        await runQuery(`
          CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            type TEXT CHECK(type IN ('income', 'expense', 'transfer')),
            color TEXT,
            icon TEXT,
            parent_id INTEGER,
            FOREIGN KEY (parent_id) REFERENCES categories(id)
          )
        `);

        // Create transactions table
        await runQuery(`
          CREATE TABLE IF NOT EXISTS transactions (
            id TEXT PRIMARY KEY,
            account_id TEXT NOT NULL,
            transaction_date DATE NOT NULL,
            booking_date DATE,
            amount REAL NOT NULL,
            currency TEXT DEFAULT 'BGN',
            description TEXT,
            counterparty_name TEXT,
            category_id INTEGER,
            notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (account_id) REFERENCES accounts(id),
            FOREIGN KEY (category_id) REFERENCES categories(id)
          )
        `);

        // Create categorization rules table
        await runQuery(`
          CREATE TABLE IF NOT EXISTS categorization_rules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pattern TEXT NOT NULL,
            category_id INTEGER NOT NULL,
            priority INTEGER DEFAULT 0,
            active BOOLEAN DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (category_id) REFERENCES categories(id)
          )
        `);

        // Create gocardless tokens table
        await runQuery(`
          CREATE TABLE IF NOT EXISTS gocardless_tokens (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            access_token TEXT,
            refresh_token TEXT,
            expires_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);

        // Migrations - add new columns if they don't exist
        try {
          await runQuery('ALTER TABLE accounts ADD COLUMN custom_name TEXT');
        } catch (e) { /* Column already exists */ }

        try {
          await runQuery('ALTER TABLE transactions ADD COLUMN raw_data TEXT');
        } catch (e) { /* Column already exists */ }

        try {
          await runQuery('ALTER TABLE transactions ADD COLUMN original_amount REAL');
        } catch (e) { /* Column already exists */ }

        try {
          await runQuery('ALTER TABLE transactions ADD COLUMN original_currency TEXT');
        } catch (e) { /* Column already exists */ }

        try {
          await runQuery('ALTER TABLE transactions ADD COLUMN country TEXT');
        } catch (e) { /* Column already exists */ }

        // Create special "Cash" account for manual transactions if it doesn't exist
        const cashAccount = await getQuery("SELECT id FROM accounts WHERE id = 'CASH'");
        if (!cashAccount) {
          await runQuery(`
            INSERT INTO accounts (id, name, custom_name, institution_name, currency, balance)
            VALUES ('CASH', 'Кеш', 'Кеш', 'Ръчни транзакции', 'EUR', 0)
          `);
          console.log('Created CASH account for manual transactions');
        }

        // Create counterparty aliases table
        await runQuery(`
          CREATE TABLE IF NOT EXISTS counterparty_aliases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            original_name TEXT NOT NULL UNIQUE,
            display_name TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);

        // Insert default categories if none exist
        const categoriesCount = await getQuery('SELECT COUNT(*) as count FROM categories');
        if (categoriesCount.count === 0) {
          await insertDefaultCategories();
        }

        resolve();
      } catch (err) {
        reject(err);
      }
    });
  });
}

// Insert default categories
async function insertDefaultCategories() {
  const defaultCategories = [
    // Expenses
    { name: 'Храна и напитки', type: 'expense', color: '#FF6384', icon: 'utensils' },
    { name: 'Транспорт', type: 'expense', color: '#36A2EB', icon: 'car' },
    { name: 'Комунални услуги', type: 'expense', color: '#FFCE56', icon: 'home' },
    { name: 'Здраве', type: 'expense', color: '#4BC0C0', icon: 'heartbeat' },
    { name: 'Забавления', type: 'expense', color: '#9966FF', icon: 'film' },
    { name: 'Облекло', type: 'expense', color: '#FF9F40', icon: 'tshirt' },
    { name: 'Образование', type: 'expense', color: '#FF6384', icon: 'graduation-cap' },
    { name: 'Домакинство', type: 'expense', color: '#36A2EB', icon: 'couch' },
    { name: 'Телекомуникации', type: 'expense', color: '#FFCE56', icon: 'mobile' },
    { name: 'Застраховки', type: 'expense', color: '#4BC0C0', icon: 'shield-alt' },
    { name: 'Други разходи', type: 'expense', color: '#C9CBCF', icon: 'ellipsis-h' },

    // Income
    { name: 'Заплата', type: 'income', color: '#4CAF50', icon: 'money-bill-wave' },
    { name: 'Фрийланс', type: 'income', color: '#8BC34A', icon: 'laptop' },
    { name: 'Инвестиции', type: 'income', color: '#CDDC39', icon: 'chart-line' },
    { name: 'Подарък', type: 'income', color: '#FFEB3B', icon: 'gift' },
    { name: 'Други приходи', type: 'income', color: '#FFC107', icon: 'plus-circle' },

    // Transfers
    { name: 'Между сметки', type: 'transfer', color: '#9E9E9E', icon: 'exchange-alt' },
    { name: 'Спестявания', type: 'transfer', color: '#607D8B', icon: 'piggy-bank' }
  ];

  for (const category of defaultCategories) {
    await runQuery(
      'INSERT INTO categories (name, type, color, icon) VALUES (?, ?, ?, ?)',
      [category.name, category.type, category.color, category.icon]
    );
  }

  // Insert default categorization rules
  const defaultRules = [
    { pattern: 'KAUFLAND|LIDL|BILLA|FANTASTICO', categoryName: 'Храна и напитки', priority: 10 },
    { pattern: 'ЧЕЗ|CEZ|ТОПЛОФИКАЦИЯ|SOFIYSKA VODA', categoryName: 'Комунални услуги', priority: 10 },
    { pattern: 'БОЛНИЦА|АПТЕКА|PHARMACY', categoryName: 'Здраве', priority: 10 },
    { pattern: 'VIVACOM|YETTEL|A1|TELENOR', categoryName: 'Телекомуникации', priority: 10 },
    { pattern: 'OMV|PETROL|LUKOIL|SHELL', categoryName: 'Транспорт', priority: 10 },
    { pattern: 'H&M|ZARA|RESERVED', categoryName: 'Облекло', priority: 10 }
  ];

  for (const rule of defaultRules) {
    const category = await getQuery('SELECT id FROM categories WHERE name = ?', [rule.categoryName]);
    if (category) {
      await runQuery(
        'INSERT INTO categorization_rules (pattern, category_id, priority) VALUES (?, ?, ?)',
        [rule.pattern, category.id, rule.priority]
      );
    }
  }
}

// Account operations
async function getAllAccounts() {
  return await allQuery('SELECT * FROM accounts ORDER BY created_at DESC');
}

async function getAccountById(id) {
  return await getQuery('SELECT * FROM accounts WHERE id = ?', [id]);
}

async function upsertAccount(account) {
  const existing = await getAccountById(account.id);

  if (existing) {
    return await runQuery(
      `UPDATE accounts SET name = ?, institution_name = ?, iban = ?,
       currency = ?, balance = ?, last_synced = ? WHERE id = ?`,
      [account.name, account.institutionName, account.iban,
       account.currency, account.balance, new Date().toISOString(), account.id]
    );
  } else {
    return await runQuery(
      `INSERT INTO accounts (id, name, institution_name, iban, currency, balance, last_synced)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [account.id, account.name, account.institutionName, account.iban,
       account.currency, account.balance, new Date().toISOString()]
    );
  }
}

async function updateAccountCustomName(id, customName) {
  return await runQuery('UPDATE accounts SET custom_name = ? WHERE id = ?', [customName, id]);
}

// Transaction operations
async function getTransactions(filters = {}) {
  let baseQuery = `FROM transactions t
    LEFT JOIN categories c ON t.category_id = c.id
    LEFT JOIN counterparty_aliases ca ON t.counterparty_name = ca.original_name
    WHERE 1=1`;
  const params = [];

  if (filters.accountId) {
    baseQuery += ' AND t.account_id = ?';
    params.push(filters.accountId);
  }

  if (filters.startDate) {
    baseQuery += ' AND t.transaction_date >= ?';
    params.push(filters.startDate);
  }

  if (filters.endDate) {
    baseQuery += ' AND t.transaction_date <= ?';
    params.push(filters.endDate);
  }

  if (filters.categoryId) {
    if (filters.categoryId === 'uncategorized') {
      baseQuery += ' AND t.category_id IS NULL';
    } else {
      baseQuery += ' AND t.category_id = ?';
      params.push(filters.categoryId);
    }
  }

  if (filters.type) {
    if (filters.type === 'income') {
      baseQuery += ' AND t.amount > 0';
    } else if (filters.type === 'expense') {
      baseQuery += ' AND t.amount < 0';
    }
  }

  if (filters.search) {
    baseQuery += ' AND (t.description LIKE ? OR t.counterparty_name LIKE ? OR ca.display_name LIKE ?)';
    params.push(`%${filters.search}%`, `%${filters.search}%`, `%${filters.search}%`);
  }

  if (filters.country) {
    if (filters.country === 'none') {
      baseQuery += ' AND (t.country IS NULL OR t.country = "")';
    } else {
      baseQuery += ' AND t.country = ?';
      params.push(filters.country);
    }
  }

  // Get total count and sum
  const statsResult = await getQuery(`SELECT COUNT(*) as total, SUM(t.amount) as totalAmount ${baseQuery}`, params);
  const total = statsResult?.total || 0;
  const totalAmount = statsResult?.totalAmount || 0;

  // Get transactions with pagination - include counterparty display name
  let query = `SELECT t.*, c.name as category_name, c.color as category_color, ca.display_name as counterparty_display_name ${baseQuery}`;
  query += ' ORDER BY t.transaction_date DESC, t.created_at DESC';

  const paginatedParams = [...params];
  if (filters.limit) {
    query += ' LIMIT ? OFFSET ?';
    paginatedParams.push(filters.limit, filters.offset || 0);
  }

  const transactions = await allQuery(query, paginatedParams);

  return { transactions, total, totalAmount };
}

async function upsertTransaction(transaction) {
  const existing = await getQuery('SELECT * FROM transactions WHERE id = ?', [transaction.id]);

  if (existing) {
    // Update all GoCardless-provided fields, but preserve locally-set fields (category_id, notes)
    await runQuery(
      `UPDATE transactions SET
        transaction_date = ?,
        booking_date = ?,
        amount = ?,
        currency = ?,
        description = ?,
        counterparty_name = ?,
        raw_data = ?,
        original_amount = ?,
        original_currency = ?,
        country = ?
       WHERE id = ?`,
      [
        transaction.transactionDate,
        transaction.bookingDate,
        transaction.amount,
        transaction.currency,
        transaction.description,
        transaction.counterpartyName,
        transaction.rawData || null,
        transaction.originalAmount || null,
        transaction.originalCurrency || null,
        transaction.country || null,
        transaction.id
      ]
    );
    return { isNew: false };
  } else {
    await runQuery(
      `INSERT INTO transactions (id, account_id, transaction_date, booking_date, amount,
       currency, description, counterparty_name, category_id, raw_data, original_amount, original_currency, country)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [transaction.id, transaction.accountId, transaction.transactionDate,
       transaction.bookingDate, transaction.amount, transaction.currency,
       transaction.description, transaction.counterpartyName, transaction.categoryId,
       transaction.rawData || null, transaction.originalAmount || null, transaction.originalCurrency || null,
       transaction.country || null]
    );
    return { isNew: true };
  }
}


async function createManualTransaction(transaction) {
  // Generate unique ID for manual transactions
  const id = `CASH_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  return await runQuery(
    `INSERT INTO transactions (id, account_id, transaction_date, booking_date, amount,
     currency, description, counterparty_name, category_id, raw_data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, 'CASH', transaction.transactionDate, transaction.transactionDate,
     transaction.amount, 'EUR', transaction.description || null,
     transaction.counterpartyName || null, transaction.categoryId || null,
     JSON.stringify({ type: 'manual', createdAt: new Date().toISOString() })]
  );
}

async function updateTransactionCategory(id, categoryId) {
  return await runQuery('UPDATE transactions SET category_id = ? WHERE id = ?', [categoryId, id]);
}

async function categorizeByCounterparty(counterpartyName, categoryId) {
  const result = await runQuery(
    'UPDATE transactions SET category_id = ? WHERE counterparty_name = ? AND category_id IS NULL',
    [categoryId, counterpartyName]
  );
  return result.changes || 0;
}

async function updateTransactionNotes(id, notes) {
  return await runQuery('UPDATE transactions SET notes = ? WHERE id = ?', [notes, id]);
}

async function updateTransactionCountry(id, country) {
  return await runQuery('UPDATE transactions SET country = ? WHERE id = ?', [country, id]);
}

async function getTransactionsWithoutCountry() {
  return await allQuery(`
    SELECT id, counterparty_name
    FROM transactions
    WHERE (country IS NULL OR country = '')
      AND counterparty_name IS NOT NULL
      AND counterparty_name != ''
  `);
}

async function getTransactionStats(startDate, endDate, types = null, categoryId = null) {
  let query = `
    SELECT
      SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as total_income,
      SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) as total_expenses,
      COUNT(*) as total_transactions
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE 1=1
  `;
  const params = [];

  if (startDate) {
    query += ' AND transaction_date >= ?';
    params.push(startDate);
  }

  if (endDate) {
    query += ' AND transaction_date <= ?';
    params.push(endDate);
  }

  // Filter by transaction types
  if (types && types.length > 0) {
    const typePlaceholders = types.map(() => '?').join(', ');
    query += ` AND (c.type IN (${typePlaceholders}) OR (c.type IS NULL AND 'expense' IN (${typePlaceholders})))`;
    params.push(...types, ...types);
  } else {
    // By default exclude transfers
    query += " AND (c.type IS NULL OR c.type <> 'transfer')";
  }

  // Filter by specific category
  if (categoryId) {
    query += ' AND t.category_id = ?';
    params.push(categoryId);
  }

  return await getQuery(query, params);
}

// Category operations
async function getAllCategories() {
  return await allQuery('SELECT * FROM categories ORDER BY type, name');
}

async function createCategory(category) {
  const result = await runQuery(
    'INSERT INTO categories (name, type, color, icon, parent_id) VALUES (?, ?, ?, ?, ?)',
    [category.name, category.type, category.color, category.icon, category.parentId]
  );
  return result.lastID;
}

async function updateCategory(id, category) {
  return await runQuery(
    'UPDATE categories SET name = ?, type = ?, color = ?, icon = ?, parent_id = ? WHERE id = ?',
    [category.name, category.type, category.color, category.icon, category.parentId, id]
  );
}

async function deleteCategory(id) {
  // First, set category_id to NULL for all transactions using this category
  await runQuery('UPDATE transactions SET category_id = NULL WHERE category_id = ?', [id]);
  // Delete categorization rules using this category
  await runQuery('DELETE FROM categorization_rules WHERE category_id = ?', [id]);
  // Delete the category
  return await runQuery('DELETE FROM categories WHERE id = ?', [id]);
}

// Categorization rules operations
async function getAllCategorizationRules() {
  return await allQuery(`
    SELECT cr.*, c.name as category_name, c.color as category_color
    FROM categorization_rules cr
    JOIN categories c ON cr.category_id = c.id
    ORDER BY cr.priority DESC, cr.created_at ASC
  `);
}

async function createCategorizationRule(rule) {
  const result = await runQuery(
    'INSERT INTO categorization_rules (pattern, category_id, priority) VALUES (?, ?, ?)',
    [rule.pattern, rule.categoryId, rule.priority || 0]
  );
  return result.lastID;
}

async function updateCategorizationRule(id, rule) {
  const updates = [];
  const params = [];

  if (rule.pattern !== undefined) {
    updates.push('pattern = ?');
    params.push(rule.pattern);
  }
  if (rule.categoryId !== undefined) {
    updates.push('category_id = ?');
    params.push(rule.categoryId);
  }
  if (rule.priority !== undefined) {
    updates.push('priority = ?');
    params.push(rule.priority);
  }
  if (rule.active !== undefined) {
    updates.push('active = ?');
    params.push(rule.active ? 1 : 0);
  }

  params.push(id);

  return await runQuery(
    `UPDATE categorization_rules SET ${updates.join(', ')} WHERE id = ?`,
    params
  );
}

async function deleteCategorizationRule(id) {
  return await runQuery('DELETE FROM categorization_rules WHERE id = ?', [id]);
}

// Reports
async function getMonthlyReport(year, month, types = null, categoryId = null) {
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDate = new Date(year, month, 0);
  const endDateStr = `${year}-${String(month).padStart(2, '0')}-${endDate.getDate()}`;

  const stats = await getTransactionStats(startDate, endDateStr, types, categoryId);
  const categoryBreakdown = await getCategoryBreakdown(startDate, endDateStr, types, categoryId);
  const counterpartyBreakdown = await getCounterpartyReport(startDate, endDateStr, types, categoryId);
  const accountBreakdown = await getAccountBreakdown(startDate, endDateStr, types, categoryId);

  return {
    period: { year, month, startDate, endDate: endDateStr },
    stats,
    categoryBreakdown,
    counterpartyBreakdown,
    accountBreakdown
  };
}


async function getLast12MonthsReport() {
  const months = [];
  const now = new Date();
  
  for (let i = 0; i < 12; i++) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endOfMonth = new Date(year, month, 0);
    const endDate = `${year}-${String(month).padStart(2, '0')}-${endOfMonth.getDate()}`;
    
    months.push({ year, month, startDate, endDate });
  }
  
  const results = [];
  for (const m of months) {
    const stats = await getTransactionStats(m.startDate, m.endDate);
    results.push({
      year: m.year,
      month: m.month,
      count: stats.total_transactions || 0,
      income: stats.total_income || 0,
      expenses: stats.total_expenses || 0,
      net: (stats.total_income || 0) - (stats.total_expenses || 0)
    });
  }
  
  return results;
}

async function getCategoryBreakdown(startDate, endDate, types = null, categoryId = null) {
  // Query for categorized transactions
  let query = `
    SELECT
      c.id, c.name, c.type, c.color,
      COUNT(*) as count,
      SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END) as income,
      SUM(CASE WHEN t.amount < 0 THEN ABS(t.amount) ELSE 0 END) as expenses,
      SUM(t.amount) as net
    FROM transactions t
    JOIN categories c ON t.category_id = c.id
    WHERE 1=1
  `;
  const params = [];

  if (startDate) {
    query += ' AND t.transaction_date >= ?';
    params.push(startDate);
  }

  if (endDate) {
    query += ' AND t.transaction_date <= ?';
    params.push(endDate);
  }

  // Filter by transaction types
  if (types && types.length > 0) {
    const typePlaceholders = types.map(() => '?').join(', ');
    query += ` AND c.type IN (${typePlaceholders})`;
    params.push(...types);
  } else {
    // By default exclude transfers
    query += " AND c.type != 'transfer'";
  }

  // Filter by specific category
  if (categoryId) {
    query += ' AND c.id = ?';
    params.push(categoryId);
  }

  query += ' GROUP BY c.id, c.name, c.type, c.color';

  const categorized = await allQuery(query, params);

  // Query for uncategorized transactions (only if no specific category filter and types include 'expense' or no type filter)
  let showUncategorized = !categoryId && (!types || types.includes('expense'));
  
  if (showUncategorized) {
    let uncatQuery = `
      SELECT
        COUNT(*) as count,
        SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as income,
        SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) as expenses,
        SUM(amount) as net
      FROM transactions
      WHERE category_id IS NULL
    `;
    const uncatParams = [];

    if (startDate) {
      uncatQuery += ' AND transaction_date >= ?';
      uncatParams.push(startDate);
    }

    if (endDate) {
      uncatQuery += ' AND transaction_date <= ?';
      uncatParams.push(endDate);
    }

    const uncategorized = await getQuery(uncatQuery, uncatParams);

    // Add uncategorized as a special category if there are any
    if (uncategorized && uncategorized.count > 0) {
      categorized.push({
        id: null,
        name: 'Без категория',
        type: 'uncategorized',
        color: '#999999',
        count: uncategorized.count,
        income: uncategorized.income || 0,
        expenses: uncategorized.expenses || 0,
        net: uncategorized.net || 0
      });
    }
  }

  // Sort by count descending
  categorized.sort((a, b) => b.count - a.count);

  return categorized;
}

// GoCardless token operations
async function getGoCardlessToken() {
  return await getQuery('SELECT * FROM gocardless_tokens WHERE id = 1');
}

async function saveGoCardlessToken(token) {
  const existing = await getGoCardlessToken();

  if (existing) {
    return await runQuery(
      `UPDATE gocardless_tokens SET access_token = ?, refresh_token = ?,
       expires_at = ?, updated_at = ? WHERE id = 1`,
      [token.accessToken, token.refreshToken, token.expiresAt, new Date().toISOString()]
    );
  } else {
    return await runQuery(
      `INSERT INTO gocardless_tokens (id, access_token, refresh_token, expires_at)
       VALUES (1, ?, ?, ?)`,
      [token.accessToken, token.refreshToken, token.expiresAt]
    );
  }
}

async function deleteGoCardlessToken() {
  return await runQuery('DELETE FROM gocardless_tokens WHERE id = 1');
}

// Counterparty report
async function getCounterpartyReport(startDate, endDate, types = null, categoryId = null) {
  let query = `
    SELECT
      t.counterparty_name,
      COUNT(*) as transaction_count,
      SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END) as total_income,
      SUM(CASE WHEN t.amount < 0 THEN ABS(t.amount) ELSE 0 END) as total_expenses,
      SUM(t.amount) as net_amount
    FROM transactions t
    LEFT JOIN categories c ON t.category_id = c.id
    WHERE t.counterparty_name IS NOT NULL AND t.counterparty_name != ''
  `;
  const params = [];

  if (startDate) {
    query += ' AND t.transaction_date >= ?';
    params.push(startDate);
  }

  if (endDate) {
    query += ' AND t.transaction_date <= ?';
    params.push(endDate);
  }

  // Filter by transaction types
  if (types && types.length > 0) {
    const typePlaceholders = types.map(() => '?').join(', ');
    query += ` AND (c.type IN (${typePlaceholders}) OR (c.type IS NULL AND 'expense' IN (${typePlaceholders})))`;
    params.push(...types, ...types);
  }

  // Filter by specific category
  if (categoryId) {
    query += ' AND t.category_id = ?';
    params.push(categoryId);
  }

  query += ' GROUP BY t.counterparty_name ORDER BY transaction_count DESC';

  const results = await allQuery(query, params);

  // Add display names from aliases
  const aliases = await getAllCounterpartyAliases();
  const aliasMap = {};
  aliases.forEach(a => { aliasMap[a.original_name] = a.display_name; });

  return results.map(row => ({
    ...row,
    display_name: aliasMap[row.counterparty_name] || null
  }));
}


async function getAccountBreakdown(startDate, endDate, types = null, categoryId = null) {
  let query = `
    SELECT
      a.id, a.custom_name, a.name, a.institution_name,
      COUNT(*) as count,
      SUM(CASE WHEN t.amount > 0 THEN t.amount ELSE 0 END) as income,
      SUM(CASE WHEN t.amount < 0 THEN ABS(t.amount) ELSE 0 END) as expenses,
      SUM(t.amount) as net
    FROM transactions t
    JOIN accounts a ON t.account_id = a.id
    LEFT JOIN categories c ON t.category_id = c.id
    WHERE 1=1
  `;
  const params = [];

  if (startDate) {
    query += ' AND t.transaction_date >= ?';
    params.push(startDate);
  }

  if (endDate) {
    query += ' AND t.transaction_date <= ?';
    params.push(endDate);
  }

  // Filter by transaction types
  if (types && types.length > 0) {
    const typePlaceholders = types.map(() => '?').join(', ');
    query += ` AND (c.type IN (${typePlaceholders}) OR (c.type IS NULL AND 'expense' IN (${typePlaceholders})))`;
    params.push(...types, ...types);
  }

  // Filter by specific category
  if (categoryId) {
    query += ' AND t.category_id = ?';
    params.push(categoryId);
  }

  query += ' GROUP BY a.id ORDER BY count DESC';

  return await allQuery(query, params);
}

// Counterparty aliases operations
async function getAllCounterpartyAliases() {
  return await allQuery('SELECT * FROM counterparty_aliases ORDER BY display_name');
}

async function getCounterpartyAlias(originalName) {
  return await getQuery('SELECT * FROM counterparty_aliases WHERE original_name = ?', [originalName]);
}

async function createCounterpartyAlias(originalName, displayName) {
  const result = await runQuery(
    'INSERT OR REPLACE INTO counterparty_aliases (original_name, display_name) VALUES (?, ?)',
    [originalName, displayName]
  );
  return result.lastID;
}

async function updateCounterpartyAlias(id, displayName) {
  return await runQuery(
    'UPDATE counterparty_aliases SET display_name = ? WHERE id = ?',
    [displayName, id]
  );
}

async function deleteCounterpartyAlias(id) {
  return await runQuery('DELETE FROM counterparty_aliases WHERE id = ?', [id]);
}

// Get category from previous transaction with same counterparty
async function getCategoryByCounterparty(counterpartyName) {
  if (!counterpartyName) return null;

  const result = await getQuery(
    `SELECT category_id FROM transactions
     WHERE counterparty_name = ? AND category_id IS NOT NULL
     ORDER BY transaction_date DESC LIMIT 1`,
    [counterpartyName]
  );

  return result ? result.category_id : null;
}

// Transaction management functions for batch operations
async function beginTransaction() {
  return runQuery('BEGIN TRANSACTION');
}

async function commitTransaction() {
  return runQuery('COMMIT');
}

async function rollbackTransaction() {
  return runQuery('ROLLBACK');
}

/**
 * Import multiple transactions in a batch with transaction support
 * @param {Array} transactions - Array of transaction objects
 * @returns {Object} Results with imported, skipped, and errors counts
 */
async function importTransactionsBatch(transactions) {
  await beginTransaction();
  try {
    const results = { imported: 0, skipped: 0, errors: [] };

    for (const tx of transactions) {
      try {
        const result = await upsertTransaction(tx);
        if (result.isNew) {
          results.imported++;
        } else {
          results.skipped++;
        }
      } catch (error) {
        results.errors.push({
          transaction: tx.id,
          error: error.message
        });
      }
    }

    await commitTransaction();
    return results;
  } catch (error) {
    await rollbackTransaction();
    throw error;
  }
}

/**
 * Get accounts by institution name pattern
 * @param {string} pattern - Pattern to search for in institution_name
 * @returns {Array} Matching accounts
 */
async function getAccountsByInstitution(pattern) {
  return allQuery(
    'SELECT * FROM accounts WHERE institution_name LIKE ?',
    [`%${pattern}%`]
  );
}

/**
 * Get distinct countries from transactions
 * @returns {Array} Array of country codes
 */
async function getDistinctCountries() {
  return allQuery(
    `SELECT DISTINCT country FROM transactions
     WHERE country IS NOT NULL AND country != ''
     ORDER BY country`
  );
}

/**
 * Get country report - amounts by country and year, filtered by transaction type
 * @param {Array} types - Array of category types to include: 'expense', 'income', 'transfer'
 * @returns {Object} Report data with years and countries
 */
async function getCountryReport(types = ['expense'], categoryId = null) {
  const currentYear = new Date().getFullYear();
  const years = [currentYear, currentYear - 1, currentYear - 2, currentYear - 3, currentYear - 4];

  // Build type filter
  const typePlaceholders = types.map(() => '?').join(', ');

  // Build category filter
  const categoryFilter = categoryId ? 'AND t.category_id = ?' : '';
  const params = [...types, ...types];
  if (categoryId) {
    params.push(categoryId);
  }

  const result = await allQuery(`
    SELECT
      t.country,
      strftime('%Y', t.transaction_date) as year,
      SUM(t.amount) as amount,
      COUNT(*) as count
    FROM transactions t
    LEFT JOIN categories c ON t.category_id = c.id
    WHERE t.country IS NOT NULL AND t.country != ''
      AND (c.type IN (${typePlaceholders}) OR (c.type IS NULL AND 'expense' IN (${typePlaceholders})))
      ${categoryFilter}
    GROUP BY t.country, strftime('%Y', t.transaction_date)
    ORDER BY t.country, year DESC
  `, params);

  // Reorganize data by country
  const countryData = {};
  result.forEach(row => {
    if (!countryData[row.country]) {
      countryData[row.country] = {
        code: row.country,
        years: {},
        yearCounts: {},
        total: 0,
        totalCount: 0
      };
    }
    countryData[row.country].years[row.year] = row.amount;
    countryData[row.country].yearCounts[row.year] = row.count;
    countryData[row.country].total += row.amount;
    countryData[row.country].totalCount += row.count;
  });

  // Convert to array and sort by total (absolute value for mixed types)
  const countries = Object.values(countryData).sort((a, b) => Math.abs(b.total) - Math.abs(a.total));

  return {
    years,
    countries
  };
}

module.exports = {
  initialize,
  getAllAccounts,
  getAccountById,
  upsertAccount,
  updateAccountCustomName,
  getTransactions,
  upsertTransaction,
  createManualTransaction,
  updateTransactionCategory,
  categorizeByCounterparty,
  updateTransactionNotes,
  updateTransactionCountry,
  getTransactionsWithoutCountry,
  getTransactionStats,
  getAllCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  getAllCategorizationRules,
  createCategorizationRule,
  updateCategorizationRule,
  deleteCategorizationRule,
  getMonthlyReport,
  getLast12MonthsReport,
  getCategoryBreakdown,
  getCounterpartyReport,
  getGoCardlessToken,
  saveGoCardlessToken,
  deleteGoCardlessToken,
  getAllCounterpartyAliases,
  getCounterpartyAlias,
  createCounterpartyAlias,
  updateCounterpartyAlias,
  deleteCounterpartyAlias,
  getCategoryByCounterparty,
  importTransactionsBatch,
  getAccountsByInstitution,
  getDistinctCountries,
  getCountryReport
};
