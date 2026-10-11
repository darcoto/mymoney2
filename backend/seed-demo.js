/**
 * Seed script for demo database
 * Creates sample data: 3 banks, 5 accounts, ~14 months of transactions (for the year-over-year
 * report), category groups, rules, providers
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

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

// ── Data ──────────────────────────────────────────────

const banks = [
  { id: 'BANK_UNICREDIT', name: 'УниКредит Булбанк' },
  { id: 'BANK_DSK',       name: 'Банка ДСК' },
  { id: 'BANK_REVOLUT',   name: 'Revolut' }
];

const accounts = [
  { id: 'ACC_UNI_BGN', bankIdx: 0, name: 'Разплащателна BGN',  customName: 'Основна сметка',  iban: 'BG80UNCR76101012345678', currency: 'EUR', balance: 2734.18 },
  { id: 'ACC_UNI_EUR', bankIdx: 0, name: 'Разплащателна EUR',  customName: 'Евро сметка',      iban: 'BG90UNCR76101098765432', currency: 'EUR', balance: 1580.00 },
  { id: 'ACC_DSK_BGN', bankIdx: 1, name: 'Спестовна сметка',   customName: 'Спестявания ДСК',  iban: 'BG70STSA93001234567890', currency: 'EUR', balance: 8920.45 },
  { id: 'ACC_DSK_SAV', bankIdx: 1, name: 'Депозит 12м',        customName: 'Депозит',           iban: 'BG71STSA93009876543210', currency: 'EUR', balance: 15000.00 },
  { id: 'ACC_REV_EUR', bankIdx: 2, name: 'Revolut EUR',        customName: 'Revolut',           iban: 'LT60REVOLT1234567890', currency: 'EUR', balance: 423.67 }
];

const categories = [
  // Expenses (id 1-11)
  { name: 'Храна и напитки',    type: 'expense',  color: '#FF6384', icon: 'utensils' },
  { name: 'Транспорт',          type: 'expense',  color: '#36A2EB', icon: 'car' },
  { name: 'Комунални услуги',   type: 'expense',  color: '#FFCE56', icon: 'home' },
  { name: 'Здраве',             type: 'expense',  color: '#4BC0C0', icon: 'heartbeat' },
  { name: 'Забавления',         type: 'expense',  color: '#9966FF', icon: 'film' },
  { name: 'Облекло',            type: 'expense',  color: '#FF9F40', icon: 'tshirt' },
  { name: 'Образование',        type: 'expense',  color: '#E74C3C', icon: 'graduation-cap' },
  { name: 'Домакинство',        type: 'expense',  color: '#3498DB', icon: 'couch' },
  { name: 'Телекомуникации',    type: 'expense',  color: '#F39C12', icon: 'mobile' },
  { name: 'Застраховки',        type: 'expense',  color: '#1ABC9C', icon: 'shield-alt' },
  { name: 'Други разходи',      type: 'expense',  color: '#C9CBCF', icon: 'ellipsis-h' },
  // Income (id 12-16)
  { name: 'Заплата',            type: 'income',   color: '#4CAF50', icon: 'money-bill-wave' },
  { name: 'Фрийланс',          type: 'income',   color: '#8BC34A', icon: 'laptop' },
  { name: 'Инвестиции',         type: 'income',   color: '#CDDC39', icon: 'chart-line' },
  { name: 'Подарък',            type: 'income',   color: '#FFEB3B', icon: 'gift' },
  { name: 'Други приходи',      type: 'income',   color: '#FFC107', icon: 'plus-circle' },
  // Transfers (id 17-18)
  { name: 'Между сметки',       type: 'transfer', color: '#9E9E9E', icon: 'exchange-alt' },
  { name: 'Спестявания',        type: 'transfer', color: '#607D8B', icon: 'piggy-bank' }
];

// Counterparties mapped to category indices (0-based → +1 for DB id)
const merchants = [
  // Храна и напитки (cat 1)
  { name: 'ЛИДЛ БЪЛГАРИЯ ЕООД',    catIdx: 0, min: -8,   max: -120 },
  { name: 'КАУФЛАНД БЪЛГАРИЯ',     catIdx: 0, min: -15,  max: -180 },
  { name: 'БИЛЛА БЪЛГАРИЯ',        catIdx: 0, min: -5,   max: -85 },
  { name: 'ФАНТАСТИКО ООД',        catIdx: 0, min: -10,  max: -95 },
  { name: 'WOLT BG',               catIdx: 0, min: -12,  max: -45 },
  { name: 'HAPPY BAR & GRILL',     catIdx: 0, min: -20,  max: -75 },
  // Транспорт (cat 2)
  { name: 'SHELL БЪЛГАРИЯ',        catIdx: 1, min: -40,  max: -130 },
  { name: 'ОМВ БЪЛГАРИЯ ООД',      catIdx: 1, min: -35,  max: -120 },
  { name: 'ЦЕНТЪР ЗА ГРАДСКА МОБИЛНОСТ', catIdx: 1, min: -1.60, max: -50 },
  // Комунални (cat 3)
  { name: 'СОФИЙСКА ВОДА АД',      catIdx: 2, min: -15,  max: -45 },
  { name: 'ЧЕЗ ЕЛЕКТРО БЪЛГАРИЯ',  catIdx: 2, min: -40,  max: -130 },
  { name: 'ТОПЛОФИКАЦИЯ СОФИЯ',    catIdx: 2, min: -50,  max: -250 },
  // Здраве (cat 4)
  { name: 'АПТЕКИ МАРЕШКИ',        catIdx: 3, min: -5,   max: -60 },
  { name: 'МЦ СОФИЯМЕД',           catIdx: 3, min: -30,  max: -120 },
  // Забавления (cat 5)
  { name: 'КИНО АРЕНА ООД',        catIdx: 4, min: -12,  max: -35 },
  { name: 'NETFLIX.COM',           catIdx: 4, min: -18,  max: -18 },
  { name: 'SPOTIFY AB',            catIdx: 4, min: -15,  max: -15 },
  // Облекло (cat 6)
  { name: 'ЗАРА БЪЛГАРИЯ',         catIdx: 5, min: -25,  max: -150 },
  { name: 'H&M HENNES & MAURITZ',  catIdx: 5, min: -20,  max: -100 },
  // Домакинство (cat 8)
  { name: 'ИКЕА БЪЛГАРИЯ',         catIdx: 7, min: -30,  max: -300 },
  { name: 'MR. BRICOLAGE',         catIdx: 7, min: -10,  max: -80 },
  // Телеком (cat 9)
  { name: 'A1 БЪЛГАРИЯ ЕАД',       catIdx: 8, min: -25,  max: -55 },
  { name: 'YETTEL БЪЛГАРИЯ',       catIdx: 8, min: -20,  max: -45 },
  // Други разходи (cat 11)
  { name: 'ЕМАГ.БГ',               catIdx: 10, min: -15, max: -250 },
  { name: 'ТЕХНОМАРКЕТ БЪЛГАРИЯ',   catIdx: 10, min: -20, max: -400 },
  { name: 'ДЕКАТЛОН БЪЛГАРИЯ',      catIdx: 10, min: -15, max: -120 }
];

// Групи (parent_id) — добавят се след категориите, за да не се местят id-тата им
const categoryGroups = [
  { name: 'Храна',          color: '#e67e22', icon: '🍽️', children: [1] },
  { name: 'Придвижване',    color: '#2980b9', icon: '🧭', children: [2] },
  { name: 'Дом',            color: '#8e44ad', icon: '🏡', children: [3, 8, 9] },
  { name: 'Семейство',      color: '#e84393', icon: '👨‍👩‍👧', children: [4, 7] },
  { name: 'Свободно време', color: '#16a085', icon: '🎉', children: [5] },
  { name: 'Покупки',        color: '#d35400', icon: '🛍️', children: [6] },
  { name: 'Финанси',        color: '#34495e', icon: '💳', children: [10] }
];

// Месечни плащания (за справката „Повтарящи се“): ден от месеца, сума, категория (index)
const monthlyBills = [
  { name: 'NETFLIX.COM',          catIdx: 4, day: 5,  amount: -13.99 },
  { name: 'SPOTIFY AB',           catIdx: 4, day: 12, amount: -10.99 },
  { name: 'A1 БЪЛГАРИЯ ЕАД',      catIdx: 8, day: 18, amount: -32.90 },
  { name: 'СОФИЙСКА ВОДА АД',     catIdx: 2, day: 22, amount: -24.50 },
  { name: 'ДЗИ ОБЩО ЗАСТРАХОВАНЕ', catIdx: 9, day: 3, amount: -41.20 }
];

const MONTHS = 14;

const incomeCounterparties = [
  { name: 'ДИГИТАЛ СОЛЮШЪНС ООД',  catIdx: 11, min: 2800, max: 3500, desc: 'Заплата м.' },
  { name: 'УЕБКРАФТ ЕООД',         catIdx: 12, min: 500,  max: 2000, desc: 'Фрийланс проект' },
  { name: 'МАРИЯ ИВАНОВА',          catIdx: 14, min: 50,   max: 200,  desc: 'Подарък рожден ден' }
];

// Deterministic random for reproducibility
let rngState = 42;
function rand() {
  rngState = (rngState * 1103515245 + 12345) & 0x7fffffff;
  return rngState / 0x7fffffff;
}

function randRange(min, max) {
  return min + rand() * (max - min);
}

function randInt(min, max) {
  return Math.floor(randRange(min, max + 1));
}

function pick(arr) {
  return arr[randInt(0, arr.length - 1)];
}

function roundAmount(v) {
  return Math.round(v * 100) / 100;
}

function dateInMonth(monthsBack, day) {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - monthsBack, day);
  if (d > now) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function generateTransactions() {
  const txs = [];
  const push = (id, accountId, date, amount, counterparty, description, catIdx) => {
    if (date) txs.push({ id, accountId, date, amount: roundAmount(amount), counterparty, description, categoryId: catIdx + 1 });
  };

  for (let m = 0; m < MONTHS; m++) {
    // Заплата на 25-о; понякога фрийланс
    const salary = incomeCounterparties[0];
    push(`TX_SAL_${m}`, accounts[0].id, dateInMonth(m, 25), randRange(salary.min, salary.max), salary.name, `${salary.desc} ${m}`, salary.catIdx);
    if (rand() < 0.35) {
      const free = incomeCounterparties[1];
      push(`TX_FRL_${m}`, accounts[1].id, dateInMonth(m, randInt(1, 28)), randRange(free.min, free.max), free.name, free.desc, free.catIdx);
    }

    // Месечни сметки
    monthlyBills.forEach((bill, i) => {
      push(`TX_BILL_${m}_${i}`, accounts[0].id, dateInMonth(m, bill.day), bill.amount, bill.name, `Плащане ${bill.name}`, bill.catIdx);
    });

    // ~25 покупки на месец
    const count = randInt(20, 30);
    for (let i = 0; i < count; i++) {
      const merchant = pick(merchants);
      push(`TX_EXP_${m}_${i}`, pick(accounts.slice(0, 3)).id, dateInMonth(m, randInt(1, 28)),
        randRange(merchant.min, merchant.max), merchant.name, `Плащане ${merchant.name}`, merchant.catIdx);
    }
  }

  // Подарък веднъж
  const gift = incomeCounterparties[2];
  push('TX_GIFT', accounts[0].id, dateInMonth(3, 14), randRange(gift.min, gift.max), gift.name, gift.desc, gift.catIdx);

  txs.sort((a, b) => b.date.localeCompare(a.date));
  return txs;
}

// ── Main ──────────────────────────────────────────────

async function seed() {
  console.log('Creating demo database...\n');

  try {
    // ── Tables ──

    await run(`CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      custom_name TEXT,
      institution_name TEXT,
      iban TEXT,
      currency TEXT DEFAULT 'BGN',
      balance REAL,
      provider_id INTEGER,
      last_synced DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    await run(`CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      type TEXT CHECK(type IN ('income', 'expense', 'transfer')),
      color TEXT,
      icon TEXT,
      parent_id INTEGER,
      FOREIGN KEY (parent_id) REFERENCES categories(id)
    )`);

    await run(`CREATE TABLE IF NOT EXISTS transactions (
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
      country TEXT,
      FOREIGN KEY (account_id) REFERENCES accounts(id),
      FOREIGN KEY (category_id) REFERENCES categories(id)
    )`);

    await run(`CREATE TABLE IF NOT EXISTS categorization_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern TEXT NOT NULL,
      category_id INTEGER NOT NULL,
      priority INTEGER DEFAULT 0,
      active BOOLEAN DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (category_id) REFERENCES categories(id)
    )`);

    await run(`CREATE TABLE IF NOT EXISTS providers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT,
      website_url TEXT,
      setup_instructions TEXT,
      credentials TEXT DEFAULT '{}',
      is_configured BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    await run(`CREATE TABLE IF NOT EXISTS provider_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider_id INTEGER NOT NULL,
      session_type TEXT NOT NULL,
      session_value TEXT NOT NULL,
      expires_at DATETIME,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (provider_id) REFERENCES providers(id)
    )`);

    await run(`CREATE TABLE IF NOT EXISTS counterparty_aliases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      original_name TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    console.log('Tables created');

    // ── Providers (without credentials) ──

    await run(`INSERT INTO providers (type, name, description, website_url, setup_instructions)
      VALUES (?, ?, ?, ?, ?)`, [
      'gocardless', 'GoCardless',
      'Достъп до банкови сметки чрез GoCardless Bank Account Data API (бивш Nordigen). Поддържа над 2000 банки в Европа.',
      'https://gocardless.com/bank-account-data/',
      '<p>1. Регистрирайте се на <a href="https://bankaccountdata.gocardless.com" target="_blank">GoCardless</a></p><p>2. Създайте Secret</p><p>3. Копирайте Secret ID и Secret Key</p>'
    ]);

    await run(`INSERT INTO providers (type, name, description, website_url, setup_instructions)
      VALUES (?, ?, ?, ?, ?)`, [
      'enablebanking', 'Enable Banking',
      'Достъп до банкови сметки чрез Enable Banking API. Поддържа банки в Европа с PSD2 интеграция.',
      'https://enablebanking.com/',
      '<p>1. Регистрирайте се на <a href="https://enablebanking.com" target="_blank">Enable Banking</a></p><p>2. Създайте Application и генерирайте RSA ключ</p><p>3. Копирайте Application ID и Private Key</p>'
    ]);

    console.log('Providers seeded (GoCardless + Enable Banking, without credentials)');

    // ── CASH account ──

    await run(`INSERT INTO accounts (id, name, custom_name, institution_name, currency, balance)
      VALUES ('CASH', 'Кеш', 'Кеш', 'Ръчни транзакции', 'EUR', 0)`);

    // ── Bank accounts ──

    for (const acc of accounts) {
      const bank = banks[acc.bankIdx];
      await run(
        `INSERT INTO accounts (id, name, custom_name, institution_name, iban, currency, balance, last_synced)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [acc.id, acc.name, acc.customName, bank.name, acc.iban, acc.currency, acc.balance]
      );
    }
    console.log(`Created ${accounts.length} accounts from ${banks.length} banks + CASH`);

    // ── Categories ──

    for (const cat of categories) {
      await run('INSERT INTO categories (name, type, color, icon) VALUES (?, ?, ?, ?)',
        [cat.name, cat.type, cat.color, cat.icon]);
    }
    console.log(`Created ${categories.length} categories`);

    for (const group of categoryGroups) {
      const result = await run("INSERT INTO categories (name, type, color, icon) VALUES (?, 'expense', ?, ?)",
        [group.name, group.color, group.icon]);
      for (const childId of group.children) {
        await run('UPDATE categories SET parent_id = ? WHERE id = ?', [result.lastID, childId]);
      }
    }
    console.log(`Created ${categoryGroups.length} category groups`);

    // ── Transactions ──

    const transactions = generateTransactions();
    for (const tx of transactions) {
      await run(
        `INSERT INTO transactions (id, account_id, transaction_date, booking_date, amount, currency, description, counterparty_name, category_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [tx.id, tx.accountId, tx.date, tx.date, tx.amount, 'EUR', tx.description, tx.counterparty, tx.categoryId]
      );
    }
    console.log(`Created ${transactions.length} transactions`);

    // ── Categorization rules ──

    const rules = [
      { pattern: 'ЛИДЛ|БИЛЛА|КАУФЛАНД|ФАНТАСТИКО|WOLT|HAPPY BAR', categoryId: 1, priority: 10 },
      { pattern: 'SHELL|ОМВ|ГРАДСКА МОБИЛНОСТ',                    categoryId: 2, priority: 10 },
      { pattern: 'СОФИЙСКА ВОДА|ЧЕЗ|ТОПЛОФИКАЦИЯ',                 categoryId: 3, priority: 10 },
      { pattern: 'АПТЕКИ|СОФИЯМЕД',                                 categoryId: 4, priority: 10 },
      { pattern: 'КИНО АРЕНА|NETFLIX|SPOTIFY',                      categoryId: 5, priority: 10 },
      { pattern: 'ЗАРА|H&M',                                        categoryId: 6, priority: 10 },
      { pattern: 'ИКЕА|BRICOLAGE',                                  categoryId: 8, priority: 10 },
      { pattern: 'A1 БЪЛГАРИЯ|YETTEL',                               categoryId: 9, priority: 10 },
      { pattern: 'ЗАСТРАХОВАНЕ',                                    categoryId: 10, priority: 10 },
      { pattern: 'ДИГИТАЛ СОЛЮШЪНС|ЗАПЛАТА',                        categoryId: 12, priority: 10 }
    ];

    for (const rule of rules) {
      await run('INSERT INTO categorization_rules (pattern, category_id, priority) VALUES (?, ?, ?)',
        [rule.pattern, rule.categoryId, rule.priority]);
    }
    console.log(`Created ${rules.length} categorization rules`);

    // ── Counterparty aliases ──

    const aliases = [
      { original: 'ЛИДЛ БЪЛГАРИЯ ЕООД',    display: 'Лидл' },
      { original: 'КАУФЛАНД БЪЛГАРИЯ',      display: 'Кауфланд' },
      { original: 'БИЛЛА БЪЛГАРИЯ',          display: 'Билла' },
      { original: 'ЧЕЗ ЕЛЕКТРО БЪЛГАРИЯ',   display: 'ЧЕЗ' },
      { original: 'ДИГИТАЛ СОЛЮШЪНС ООД',   display: 'Заплата' }
    ];

    for (const a of aliases) {
      await run('INSERT INTO counterparty_aliases (original_name, display_name) VALUES (?, ?)',
        [a.original, a.display]);
    }
    console.log(`Created ${aliases.length} counterparty aliases`);

    // ── Done ──

    console.log('\nDemo database created successfully!');
    console.log(`Path: ${DEMO_DB_PATH}`);
    console.log('\nTo use: set DATABASE_NAME=demo.db in .env and restart,');
    console.log('or run: npm run demo');

  } catch (err) {
    console.error('Error creating demo database:', err);
  } finally {
    db.close();
  }
}

seed();
