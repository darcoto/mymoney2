// Снимки за README: пуска собствен сървър с демо базата (data/demo.db) на отделен порт —
// никога не снима реалните данни. Демо базата: npm run seed-demo.
//
//   node screenshots.js
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { fork } = require('child_process');

const SCREENSHOT_DIR = './screenshots';
const PORT = 3498;
const BASE_URL = `http://localhost:${PORT}`;

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function waitForServer() {
  for (let i = 0; i < 40; i++) {
    try {
      await fetch(`${BASE_URL}/api/version`);
      return;
    } catch {
      await delay(250);
    }
  }
  throw new Error('Демо сървърът не стартира');
}

// Отваря таб в „Отчети“ и (по избор) разгъва първата група категории
async function openReport(page, report, { expandGroup = false } = {}) {
  await page.click(`.report-tab[data-report="${report}"]`);
  await delay(2000);
  if (report === 'monthly') {
    // Предишният месец (текущият може да е едва започнал)
    await page.evaluate(async () => {
      const d = new Date();
      d.setMonth(d.getMonth() - 1);
      document.getElementById('reportYear').value = String(d.getFullYear());
      document.getElementById('reportMonth').value = String(d.getMonth() + 1);
      await generateReport();
    });
    await delay(1000);
  }
  if (expandGroup) {
    await page.evaluate(id => document.querySelector(`#${id}ReportSection .group-toggle`)?.click(), report);
    await delay(300);
  }
}

async function takeScreenshots() {
  if (!fs.existsSync('./data/demo.db')) {
    console.error('Няма data/demo.db — пуснете първо: npm run seed-demo');
    process.exit(1);
  }
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

  const server = fork(path.join(__dirname, 'backend', 'server.js'), [], {
    env: { ...process.env, PORT: String(PORT), DATABASE_NAME: 'demo.db', NODE_ENV: 'production' },
    stdio: 'ignore'
  });

  try {
    await waitForServer();
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900 });

    const pages = [
      { name: 'dashboard',    hash: '#dashboard',    wait: 2500 },
      { name: 'transactions', hash: '#transactions', wait: 2000 },
      { name: 'categories',   hash: '#categories',   wait: 1500 },
      { name: 'reports',      hash: '#reports',      wait: 2500, action: p => openReport(p, 'monthly', { expandGroup: true }) },
      { name: 'cashflow',     hash: '#reports',      wait: 1500, action: p => openReport(p, 'cashflow') },
      { name: 'compare',      hash: '#reports',      wait: 1500, action: p => openReport(p, 'compare', { expandGroup: true }) },
      { name: 'settings',     hash: '#settings',     wait: 2000 },
      { name: 'add-bank',     hash: '#settings',     wait: 1000, action: async p => { await p.click('#addBankBtn').catch(() => {}); await delay(1500); } }
    ];

    for (const p of pages) {
      try {
        console.log(`Снимка: ${p.name}...`);
        await page.goto(`${BASE_URL}/${p.hash}`, { waitUntil: 'networkidle0' });
        await delay(p.wait);
        if (p.action) await p.action(page);
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${p.name}.png`), fullPage: false });
      } catch (err) {
        console.error(`  Грешка при ${p.name}:`, err.message);
      }
    }

    await browser.close();
    console.log('\nГотово:', SCREENSHOT_DIR);
  } finally {
    server.kill();
  }
}

takeScreenshots().catch(err => { console.error(err); process.exit(1); });
