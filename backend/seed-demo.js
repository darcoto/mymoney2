/**
 * Seed script for demo database
 * Creates sample data: 2 banks, 3 accounts, 50 transactions
 *
 * Usage: node backend/seed-demo.js
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DEMO_DB_PATH = './data/demo.db';

// Ensure data directory exists
const dataDir = path.dirname(DEMO_DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Delete existing demo database
if (fs.existsSync(DEMO_DB_PATH)) {
  fs.unlinkSync(DEMO_DB_PATH);
  console.log('Deleted existing demo database');
}

const db = new sqlite3.Database(DEMO_DB_PATH);

// Helper to run queries as promises
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

// Sample data
const banks = [
  { id: 'BANK_UNICREDIT', name: 'УниКредит Булбанк', logo: 'unicredit.png' },
  { id: 'BANK_DSK', name: 'Банка ДСК', logo: 'dsk.png' }
];

const accounts = [
  { id: 'ACC_UNI_BGN', bankId: 'BANK_UNICREDIT', name: 'Разплащателна сметка BGN', customName: 'Основна сметка', iban: 'BG80UNCR12345678901234', currency: 'BGN', balance: 5420.50 },
  { id: 'ACC_UNI_EUR', bankId: 'BANK_UNICREDIT', name: 'Разплащателна сметка EUR', customName: 'Евро сметка', iban: 'BG90UNCR12345678905678', currency: 'EUR', balance: 1250.00 },
  { id: 'ACC_DSK_BGN', bankId: 'BANK_DSK', name: 'Спестовна сметка', customName: 'Спестявания', iban: 'BG70STSA12345678909012', currency: 'BGN', balance: 12350.75 }
];

const categories = [
  { name: 'Храна и напитки', type: 'expense', color: '#FF6384', icon: 'utensils' },
  { name: 'Транспорт', type: 'expense', color: '#36A2EB', icon: 'car' },
  { name: 'Комунални услуги', type: 'expense', color: '#FFCE56', icon: 'home' },
  { name: 'Здраве', type: 'expense', color: '#4BC0C0', icon: 'heartbeat' },
  { name: 'Забавления', type: 'expense', color: '#9966FF', icon: 'film' },
  { name: 'Пазаруване', type: 'expense', color: '#FF9F40', icon: 'shopping-bag' },
  { name: 'Заплата', type: 'income', color: '#4CAF50', icon: 'briefcase' },
  { name: 'Други приходи', type: 'income', color: '#8BC34A', icon: 'plus-circle' },
  { name: 'Вътрешен превод', type: 'transfer', color: '#9E9E9E', icon: 'exchange-alt' }
];

const counterparties = {
  expense: [
    'ЛИДЛ БЪЛГАРИЯ', 'БИЛЛА', 'КАУФЛАНД', 'ФАНТАСТИКО',
    'SHELL БЪЛГАРИЯ', 'ОМВ', 'ЛУКОЙЛ',
    'СОФИЙСКА ВОДА', 'ЧЕЗ ЕЛЕКТРО', 'ТОПЛОФИКАЦИЯ',
    'АПТЕКИ МАРЕШКИ', 'СОФИЯМЕД',
    'КИНО АРЕНА', 'NETFLIX', 'SPOTIFY',
    'ЗАРА', 'H&M', 'ДЕКАТЛОН', 'ТЕХНОМАРКЕТ', 'ЕМАГ'
  ],
  income: [
    'РАБОТОДАТЕЛ ООД', 'КЛИЕНТ ЕООД', 'ФРИЙЛАНС ПРОЕКТ'
  ]
};

// Generate random date in the last 6 months
function randomDate() {
  const now = new Date();
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 6, 1);
  const diff = now.getTime() - sixMonthsAgo.getTime();
  const randomTime = sixMonthsAgo.getTime() + Math.random() * diff;
  return new Date(randomTime).toISOString().split('T')[0];
}

// Generate transactions
function generateTransactions(count) {
  const transactions = [];

  for (let i = 0; i < count; i++) {
    const isIncome = Math.random() < 0.2; // 20% income, 80% expense
    const account = accounts[Math.floor(Math.random() * accounts.length)];
    const date = randomDate();

    let amount, counterparty, categoryIndex;

    if (isIncome) {
      amount = Math.round((Math.random() * 3000 + 500) * 100) / 100; // 500-3500
      counterparty = counterparties.income[Math.floor(Math.random() * counterparties.income.length)];
      categoryIndex = 6 + Math.floor(Math.random() * 2); // Income categories (index 6-7)
    } else {
      amount = -Math.round((Math.random() * 200 + 5) * 100) / 100; // -5 to -205
      counterparty = counterparties.expense[Math.floor(Math.random() * counterparties.expense.length)];
      categoryIndex = Math.floor(Math.random() * 6); // Expense categories (index 0-5)
    }

    transactions.push({
      id: `TX_${Date.now()}_${i}_${Math.random().toString(36).substr(2, 6)}`,
      accountId: account.id,
      date: date,
      amount: amount,
      currency: account.currency,
      counterparty: counterparty,
      description: `Транзакция ${counterparty}`,
      categoryId: categoryIndex + 1 // 1-based
    });
  }

  // Sort by date descending
  transactions.sort((a, b) => new Date(b.date) - new Date(a.date));

  return transactions;
}

async function seed() {
  console.log('Creating demo database...\n');

  try {
    // Create tables
    await run(`
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        name TEXT,
        custom_name TEXT,
        institution_id TEXT,
        institution_name TEXT,
        iban TEXT,
        currency TEXT DEFAULT 'BGN',
        balance REAL,
        last_synced DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await run(`
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

    await run(`
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
        raw_data TEXT,
        original_amount REAL,
        original_currency TEXT,
        FOREIGN KEY (account_id) REFERENCES accounts(id),
        FOREIGN KEY (category_id) REFERENCES categories(id)
      )
    `);

    await run(`
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

    await run(`
      CREATE TABLE IF NOT EXISTS gocardless_tokens (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        access_token TEXT,
        refresh_token TEXT,
        expires_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS counterparty_aliases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        original_name TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Insert CASH account
    await run(`
      INSERT INTO accounts (id, name, custom_name, institution_name, currency, balance)
      VALUES ('CASH', 'Кеш', 'Кеш', 'Ръчни транзакции', 'EUR', 0)
    `);
    console.log('Created CASH account');

    // Insert accounts (2 banks, 3 accounts)
    for (const acc of accounts) {
      const bank = banks.find(b => b.id === acc.bankId);
      await run(
        `INSERT INTO accounts (id, name, custom_name, institution_id, institution_name, iban, currency, balance, last_synced)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [acc.id, acc.name, acc.customName, acc.bankId, bank.name, acc.iban, acc.currency, acc.balance]
      );
    }
    console.log(`Created ${accounts.length} accounts from ${banks.length} banks`);

    // Insert categories
    for (const cat of categories) {
      await run(
        'INSERT INTO categories (name, type, color, icon) VALUES (?, ?, ?, ?)',
        [cat.name, cat.type, cat.color, cat.icon]
      );
    }
    console.log(`Created ${categories.length} categories`);

    // Insert transactions
    const transactions = generateTransactions(50);
    for (const tx of transactions) {
      await run(
        `INSERT INTO transactions (id, account_id, transaction_date, booking_date, amount, currency, description, counterparty_name, category_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [tx.id, tx.accountId, tx.date, tx.date, tx.amount, tx.currency, tx.description, tx.counterparty, tx.categoryId]
      );
    }
    console.log(`Created ${transactions.length} transactions`);

    // Insert some categorization rules
    const rules = [
      { pattern: 'ЛИДЛ|БИЛЛА|КАУФЛАНД|ФАНТАСТИКО', categoryId: 1, priority: 10 },
      { pattern: 'SHELL|ОМВ|ЛУКОЙЛ', categoryId: 2, priority: 10 },
      { pattern: 'СОФИЙСКА ВОДА|ЧЕЗ|ТОПЛОФИКАЦИЯ', categoryId: 3, priority: 10 },
      { pattern: 'РАБОТОДАТЕЛ|ЗАПЛАТА', categoryId: 7, priority: 10 }
    ];

    for (const rule of rules) {
      await run(
        'INSERT INTO categorization_rules (pattern, category_id, priority) VALUES (?, ?, ?)',
        [rule.pattern, rule.categoryId, rule.priority]
      );
    }
    console.log(`Created ${rules.length} categorization rules`);

    console.log('\nDemo database created successfully!');
    console.log(`Path: ${DEMO_DB_PATH}`);
    console.log('\nTo use it, set USE_DEMO_DB=true in your .env file');

  } catch (err) {
    console.error('Error creating demo database:', err);
  } finally {
    db.close();
  }
}

seed();
