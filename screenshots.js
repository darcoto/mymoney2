const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const SCREENSHOT_DIR = './screenshots';
const BASE_URL = 'http://localhost:3000';

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function takeScreenshots() {
  // Ensure screenshots directory exists
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });

  const pages = [
    { name: 'dashboard', hash: '#dashboard', wait: 2000 },
    { name: 'transactions', hash: '#transactions', wait: 1500 },
    { name: 'reports', hash: '#reports', wait: 1500 },
    { name: 'categories', hash: '#categories', wait: 1000 },
    { name: 'settings', hash: '#settings', wait: 1000 }
  ];

  for (const p of pages) {
    try {
      console.log(`Taking screenshot: ${p.name}...`);
      await page.goto(`${BASE_URL}/${p.hash}`, { waitUntil: 'networkidle0' });
      await delay(p.wait); // Extra wait for data to load
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `${p.name}.png`),
        fullPage: false
      });
      console.log(`  Saved: ${p.name}.png`);
    } catch (err) {
      console.error(`  Error on ${p.name}:`, err.message);
    }
  }

  await browser.close();
  console.log('\nDone! Screenshots saved to:', SCREENSHOT_DIR);
}

takeScreenshots().catch(console.error);
