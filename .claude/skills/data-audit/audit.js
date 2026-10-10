#!/usr/bin/env node
/**
 * Одит на данните — САМО ЗА ЧЕТЕНЕ (базата се отваря с OPEN_READONLY).
 *
 *   node .claude/skills/data-audit/audit.js [--db data/finance.db] [--files import] [--year 2026]
 *
 * --db     база (по подразбиране data/finance.db)
 * --files  папка с извлечения (.xls от ДСК, .csv от Revolut) за сверка ред по ред; празно = без сверка
 * --year   от коя година да се гледат пропуските по месеци (по подразбиране — от първата транзакция)
 */

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');

const ROOT = path.resolve(__dirname, '../../..');
const backend = (name) => require(path.join(ROOT, 'backend', name));
const dsk = backend('dsk-import');
const rev = backend('revolut-import');
const m = backend('transaction-matching');
const gc = backend('providers/gocardless-provider');

const args = process.argv.slice(2);
const arg = (name, def) => { const i = args.indexOf(name); return i === -1 ? def : args[i + 1]; };
const DB_PATH = path.resolve(ROOT, arg('--db', 'data/finance.db'));
const FILES = arg('--files', 'import');
const FROM_YEAR = arg('--year', null);

const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY);
const q = (sql, p = []) => new Promise((res, rej) => db.all(sql, p, (e, rows) => e ? rej(e) : res(rows)));
const r2 = n => Math.round(n * 100) / 100;
const parse = (t) => { try { return JSON.parse(t); } catch (e) { return null; } };

let problems = 0;
const problem = (text) => { problems++; console.log('  ❌ ' + text); };
const note = (text) => console.log('  ℹ️  ' + text);
const ok = (text) => console.log('  ✅ ' + text);
const section = (title) => console.log(`\n=== ${title}`);

// Мултимножество „дата|сума“ → редове без двойка от двете страни
function diffByDateAmount(fileRows, dbRows) {
    const key = (d, a) => `${d}|${Number(a).toFixed(2)}`;
    const left = new Map();
    fileRows.forEach(t => { const k = key(t.date, t.amount); left.set(k, (left.get(k) || 0) + 1); });
    const extra = [];
    dbRows.forEach(r => { const k = key(r.transaction_date, r.amount); if (left.get(k)) left.set(k, left.get(k) - 1); else extra.push(r); });
    // Втори опит: същата сума с ±1 ден (вальор срещу дата на завършване)
    const shift = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
    const stillExtra = extra.filter(r => {
        for (const n of [-1, 1]) {
            const k = key(shift(r.transaction_date, n), r.amount);
            if (left.get(k)) { left.set(k, left.get(k) - 1); return false; }
        }
        return true;
    });
    const missing = [...left.entries()].filter(([, v]) => v > 0);
    return { extra: stillExtra, missing };
}

async function main() {
    console.log(`База: ${DB_PATH}`);
    const accounts = await q('SELECT * FROM accounts');
    const label = (id) => m.accountLabel(accounts.find(a => a.id === id));
    const all = await q('SELECT * FROM transactions');
    const cats = await q('SELECT * FROM categories');
    const catById = new Map(cats.map(c => [c.id, c]));
    const isBank = (r) => m.rowFeatures(r).isBank;

    // ------------------------------------------------------------------
    section('1. Сметки: брой, период, месеци без транзакции');
    for (const a of accounts) {
        const rows = all.filter(t => t.account_id === a.id);
        if (!rows.length) { note(`${m.accountLabel(a)}: няма транзакции`); continue; }
        const dates = rows.map(r => r.transaction_date).sort();
        const months = new Set(rows.map(r => r.transaction_date.slice(0, 7)));
        const gaps = [];
        let [y, mo] = dates[0].slice(0, 7).split('-').map(Number);
        const end = dates[dates.length - 1].slice(0, 7);
        for (;;) {
            const k = `${y}-${String(mo).padStart(2, '0')}`;
            if (k > end) break;
            if (!months.has(k) && (!FROM_YEAR || k >= FROM_YEAR)) gaps.push(k);
            mo++; if (mo > 12) { mo = 1; y++; }
        }
        const bank = rows.filter(isBank).length;
        console.log(`  ${m.accountLabel(a)}: ${rows.length} (банка ${bank}, файл ${rows.filter(r => /^(DSK|REV)_/.test(r.id)).length}), ${dates[0]} … ${dates[dates.length - 1]}`
            + (gaps.length ? ` — месеци без транзакции: ${gaps.join(', ')}` : ''));
    }

    // ------------------------------------------------------------------
    if (FILES && fs.existsSync(path.resolve(ROOT, FILES))) {
        section(`2. Файлове от „${FILES}“ ↔ база (ред по ред по дата+сума, в периода на файла)`);
        const dir = path.resolve(ROOT, FILES);
        for (const name of fs.readdirSync(dir).sort()) {
            const content = fs.readFileSync(path.join(dir, name), 'utf8').replace(/^﻿/, '');
            let groups = [];
            try {
                if (dsk.isDskHtml(content)) {
                    const parsed = dsk.processHtmlForImport(content);
                    const acc = accounts.find(a => m.isDskAccount(a) && (a.iban || '').replace(/\s/g, '').endsWith(parsed.account.number));
                    if (!acc) { problem(`${name}: няма сметка №${parsed.account.number}`); continue; }
                    groups = [{ acc, rows: parsed.transactions.map(t => ({ date: t.transactionDate, amount: t.amount })), pending: parsed.pending }];
                } else if (rev.isRevolutCsv(content)) {
                    const txs = rev.processCsvForImport(content);
                    const byKey = new Map();
                    txs.forEach(t => { const k = `${t.productKind}|${t.fileCurrency}`; if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(t); });
                    for (const [k, list] of byKey) {
                        const [kind, cur] = k.split('|');
                        const acc = accounts.filter(m.isRevolutAccount).find(a => (a.original_currency || 'EUR') === cur && (kind === 'savings' ? !a.iban : !!a.iban));
                        if (!acc) { problem(`${name}: няма Revolut сметка за ${k}`); continue; }
                        groups.push({ acc, rows: list.map(t => ({ date: t.transactionDate, amount: t.amount })) });
                    }
                } else {
                    note(`${name}: неподдържан формат — пропуснат`);
                    continue;
                }
            } catch (e) {
                problem(`${name}: ${e.message}`);
                continue;
            }
            for (const { acc, rows, pending } of groups) {
                const dates = rows.map(r => r.date).sort();
                const dbRows = all.filter(t => t.account_id === acc.id && t.transaction_date >= dates[0] && t.transaction_date <= dates[dates.length - 1]);
                const { extra, missing } = diffByDateAmount(rows, dbRows);
                const sumF = rows.reduce((s, r) => s + r.amount, 0), sumB = dbRows.reduce((s, r) => s + r.amount, 0);
                const head = `${name} → ${m.accountLabel(acc)} (${dates[0]} … ${dates[dates.length - 1]}): файл ${rows.length}${pending ? ` (+${pending} неосчетоводени)` : ''} / ${r2(sumF)}, база ${dbRows.length} / ${r2(sumB)}`;
                if (!extra.length && !missing.length) ok(head);
                else {
                    // Нулеви суми и разлика от 1 ден в датата (вальор) не са проблем
                    const realExtra = extra.filter(r => r.amount !== 0);
                    (realExtra.length || missing.length ? problem : note)(`${head}; в базата без двойка ${extra.length} (ненулеви ${realExtra.length}), липсват от файла ${missing.length}`);
                    realExtra.slice(0, 8).forEach(r => console.log(`      излишен: ${r.transaction_date} ${r.amount} ${r.id.slice(0, 16)} ${(r.description || r.counterparty_name || '').slice(0, 60)}`));
                    missing.slice(0, 8).forEach(([k, v]) => console.log(`      липсва: ${k} ×${v}`));
                }
            }
        }
    } else {
        section('2. Сверка с файлове — пропусната (няма папка)');
    }

    // ------------------------------------------------------------------
    section('3. Revolut: верига на наличността (баланс след транзакция)');
    for (const acc of accounts.filter(m.isRevolutAccount)) {
        const rows = all.filter(t => t.account_id === acc.id).map(r => ({ r, f: m.rowFeatures(r) }));
        const ordered = rows.map(x => ({ ...x, t: x.f.times.length ? Math.max(...x.f.times) : Date.parse(x.r.transaction_date + 'T12:00:00Z') }))
            .sort((a, b) => a.t - b.t);
        let prev = null, run = 0, checked = 0;
        const breaks = [];
        for (const x of ordered) {
            run += x.f.origCurrency ? x.f.origAmount : x.r.amount;
            if (x.f.balance === null || x.f.balance === undefined) continue;
            if (prev !== null) {
                checked++;
                if (Math.abs(prev + run - x.f.balance) > 0.011) breaks.push(`${x.r.transaction_date} ${x.r.amount} „${(x.r.description || '').slice(0, 35)}“ очаквано ${r2(prev + run)}, има ${x.f.balance}`);
            }
            prev = x.f.balance; run = 0;
        }
        const head = `${m.accountLabel(acc)}: ${checked} проверки, прекъсвания ${breaks.length}; последна наличност ${prev}, в сметката ${acc.balance}`;
        if (!breaks.length && (prev === null || Math.abs(prev - acc.balance) < 0.005)) ok(head);
        else {
            (prev !== null && Math.abs(prev - acc.balance) >= 0.005 ? problem : note)(head
                + (breaks.length ? ' (прекъсвания в периоди с два портфейла в различни валути — напр. BGN/EUR в края на 2025 г. — са очаквани)' : ''));
            breaks.slice(0, 8).forEach(b => console.log('      ' + b));
        }
    }

    // ------------------------------------------------------------------
    section('4. Банкови записи: съответствие с raw_data и известни капани');
    const bankRows = all.filter(isBank);
    const textMismatch = bankRows.filter(r => {
        const raw = parse(r.raw_data);
        if (!raw || !raw.transactionAmount) return false;
        return (r.description || '') !== gc.transactionDescription(raw) || (r.counterparty_name || '') !== (gc.transactionCounterparty(raw) || '');
    });
    textMismatch.length ? problem(`описание/контрагент различни от raw_data (стара логика на синхронизацията): ${textMismatch.length}`) : ok('описание и контрагент съответстват на raw_data');
    textMismatch.slice(0, 5).forEach(r => console.log(`      ${label(r.account_id)} ${r.transaction_date} ${r.amount} „${r.description}“ / „${r.counterparty_name}“`));

    const holds = bankRows.filter(r => accounts.find(a => a.id === r.account_id && m.isDskAccount(a)) && m.isDskCardHold(parse(r.raw_data)));
    holds.length ? problem(`блокирани суми по карти на ДСК (с плюс): ${holds.length} → Настройки → „Провери за дубликати“`) : ok('няма блокирани суми по карти');

    const currencyMismatch = bankRows.filter(r => {
        const raw = parse(r.raw_data) || {};
        const acc = accounts.find(a => a.id === r.account_id);
        const cur = raw.transactionAmount && raw.transactionAmount.currency;
        return acc && acc.original_currency && cur && cur !== acc.original_currency;
    });
    currencyMismatch.length ? problem(`записи във валута, различна от тази на сметката: ${currencyMismatch.length}`) : ok('валутата на записите съвпада със сметката');
    currencyMismatch.slice(0, 5).forEach(r => console.log(`      ${label(r.account_id)} ${r.transaction_date} ${r.amount} ${r.original_currency} ${r.id}`));

    const feeMismatch = all.filter(r => r.id.startsWith('REV_')).filter(r => {
        // raw_data: JSON (нов импорт) или CSV ред (стар импорт — последните 5 полета са фиксирани)
        const raw = parse(r.raw_data);
        const text = (raw && typeof raw === 'object' ? raw : null) || (() => { const p = String(r.raw_data || '').split(','); return p.length >= 10 ? { 'Сума': p[p.length - 5], 'Такса': p[p.length - 4], 'Валута': p[p.length - 3] } : null; })();
        if (!text) return false;
        const sum = parseFloat(text['Сума']), fee = parseFloat(text['Такса']) || 0, cur = text['Валута'];
        if (!fee || isNaN(sum) || !['EUR', 'BGN'].includes(cur)) return false;
        const net = Math.round((sum - fee) * 100) / 100;
        const expected = cur === 'BGN' ? parseFloat((net / dsk.BGN_TO_EUR_RATE).toFixed(2)) : net;
        return Math.abs(r.amount - expected) >= 0.005;
    });
    feeMismatch.length ? problem(`Revolut импорти без приспадната такса: ${feeMismatch.length} → „Провери за дубликати“`) : ok('Revolut импортите са с приспадната такса');

    // ------------------------------------------------------------------
    section('5. Дубликати и странни записи');
    const groups = new Map();
    for (const r of all) {
        const k = [r.account_id, r.transaction_date, r.amount.toFixed(2), r.description || '', r.counterparty_name || ''].join('|');
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(r);
    }
    let suspicious = 0;
    for (const rows of groups.values()) {
        if (rows.length < 2) continue;
        // Различен баланс след транзакцията или различен час → отделни транзакции
        const feats = rows.map(r => m.rowFeatures(r));
        const balances = feats.map(f => f.balance).filter(b => b !== null && b !== undefined);
        const times = feats.map(f => f.times[0]).filter(Boolean);
        if (balances.length === rows.length && new Set(balances.map(String)).size === rows.length) continue;
        if (times.length === rows.length && new Set(times).size === rows.length) continue;
        suspicious++;
        if (suspicious <= 10) console.log(`      ${label(rows[0].account_id)} ${rows[0].transaction_date} ${rows[0].amount} ×${rows.length} „${(rows[0].description || '').slice(0, 40)}“ ${rows.map(r => r.id.slice(0, 12)).join(', ')}`);
    }
    suspicious ? problem(`групи от еднакви записи без различаващ баланс/час: ${suspicious} (проверете ръчно — две еднакви такси в един ден са нормални)`) : ok('няма неразличими повторения');

    // Файл ↔ банка дубликати, които обединяването би хванало — през API (dry run)
    try {
        const res = await fetch('http://localhost:' + (process.env.PORT || 3456) + '/api/transactions/reconcile-imports', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dryRun: true })
        });
        const r = await res.json();
        const total = r.pocketTransfersMoved + r.importedMoved + r.duplicatesMerged + (r.cardHoldsRemoved || 0) + (r.feesFixed || 0);
        total ? problem(`обединяването (dry run) би променило: ${JSON.stringify({ ...r, samples: undefined, success: undefined, dryRun: undefined })}`) : ok('„Провери за дубликати“ (dry run): няма какво да се поправя');
    } catch (e) {
        note('сървърът не отговаря — проверката „Провери за дубликати“ (dry run) е пропусната');
    }

    const zero = all.filter(r => r.amount === 0);
    zero.length && note(`записи с нулева сума: ${zero.length} (обикновено проверка на карта — безвредни)`);
    const today = new Date(); const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const future = all.filter(r => r.transaction_date > todayStr);
    future.length ? problem(`с бъдеща дата: ${future.length}`) : ok('няма бъдещи дати');
    const posCard = all.filter(r => r.amount > 0 && /ПЛАЩАНЕ НА ПОС|ТЕГЛЕНЕ/.test(r.description || ''));
    posCard.length && note(`картови плащания/тегления с плюс: ${posCard.length} (възстановени суми? провери MovementType в raw_data)`);

    // ------------------------------------------------------------------
    section('6. Категории');
    const real = all.filter(r => r.account_id !== 'CASH');
    const unc = {};
    real.filter(r => !r.category_id).forEach(r => { const y = r.transaction_date.slice(0, 4); unc[y] = (unc[y] || 0) + 1; });
    note(`без категория (броят се като разход в отчетите): ${JSON.stringify(unc)} от ${real.length}`);

    const ourIbans = accounts.map(a => a.iban).filter(Boolean);
    // Сметката на другата страна: банка — creditorAccount при плащане / debtorAccount при постъпление; ДСК файл — OppositeSideAccount
    const counterAccount = (r) => {
        const raw = parse(r.raw_data) || {};
        const side = raw.transactionAmount ? (r.amount < 0 ? raw.creditorAccount : raw.debtorAccount) : null;
        return (side && side.iban) || raw.OppositeSideAccount || null;
    };
    const own = real.filter(r => {
        const acc = accounts.find(a => a.id === r.account_id);
        const other = counterAccount(r);
        return (other && other !== acc.iban && ourIbans.includes(other)) || /МЕЖДУ МОИ СМЕТКИ|ПОГАСЯВАНЕ НА ЗАДЪЛЖЕНИЕ|РЕВОЛВИРАНЕ НА КРЕДИТНА/i.test(r.description || '');
    });
    const ownWrong = own.filter(r => (catById.get(r.category_id) || {}).type !== 'transfer');
    ownWrong.length ? problem(`преводи между собствени сметки без категория тип „transfer“: ${ownWrong.length} от ${own.length}`) : ok(`преводите между собствени сметки (${own.length}) са с категория за преводи`);
    ownWrong.slice(0, 8).forEach(r => console.log(`      ${label(r.account_id)} ${r.transaction_date} ${r.amount} „${(r.description || '').slice(0, 50)}“ → ${(catById.get(r.category_id) || {}).name || 'без категория'}`));

    // Преводи от/към собственото име (имената от „МЕЖДУ МОИ СМЕТКИ“/„ПОГАСЯВАНЕ“ + латиница),
    // които не са с категория за преводи — напр. „Payment from <собствено име>“ в Revolut
    const translit = s => s.replace(/[А-Я]/g, ch => ({ А: 'A', Б: 'B', В: 'V', Г: 'G', Д: 'D', Е: 'E', Ж: 'ZH', З: 'Z', И: 'I', Й: 'Y', К: 'K', Л: 'L', М: 'M', Н: 'N', О: 'O', П: 'P', Р: 'R', С: 'S', Т: 'T', У: 'U', Ф: 'F', Х: 'H', Ц: 'TS', Ч: 'CH', Ш: 'SH', Щ: 'SHT', Ъ: 'A', Ь: 'Y', Ю: 'YU', Я: 'YA' })[ch] || ch);
    const ownerNames = new Set();
    real.filter(r => /МЕЖДУ МОИ СМЕТКИ|ПОГАСЯВАНЕ НА ЗАДЪЛЖЕНИЕ/i.test(r.description || '') && r.counterparty_name)
        .forEach(r => { const n = r.counterparty_name.toUpperCase().replace(/\s+/g, ' ').trim(); ownerNames.add(n); ownerNames.add(translit(n)); });
    const ownNamed = real.filter(r => {
        const text = `${r.counterparty_name || ''} ${r.description || ''}`.toUpperCase().replace(/\s+/g, ' ');
        return [...ownerNames].some(n => text.includes(n))
            && !/ТАКСА|ЛИХВ|ТОЧКИ/i.test(r.description || '')
            && (catById.get(r.category_id) || {}).type !== 'transfer';
    });
    ownNamed.length ? problem(`преводи от/към собственото име без категория за преводи: ${ownNamed.length}`) : ok('преводите от/към собственото име са с категория за преводи');
    ownNamed.slice(0, 8).forEach(r => console.log(`      ${label(r.account_id)} ${r.transaction_date} ${r.amount} „${(r.description || '').slice(0, 50)}“ → ${(catById.get(r.category_id) || {}).name || 'без категория'}`));

    const incomeOnExpense = real.filter(r => r.amount < 0 && (catById.get(r.category_id) || {}).type === 'income');
    if (incomeOnExpense.length) {
        const g = {};
        incomeOnExpense.forEach(r => { const k = `${catById.get(r.category_id).name} ← ${r.counterparty_name || r.description}`; g[k] = g[k] || { n: 0, s: 0 }; g[k].n++; g[k].s += r.amount; });
        note(`разходи с приходна категория (намаляват приходите в отчетите): ${incomeOnExpense.length}`);
        Object.entries(g).sort((a, b) => a[1].s - b[1].s).slice(0, 8).forEach(([k, v]) => console.log(`      ${v.n} бр. / ${r2(v.s)} €: ${k}`));
    }
    const expenseOnIncome = real.filter(r => r.amount > 0 && (catById.get(r.category_id) || {}).type === 'expense');
    if (expenseOnIncome.length) {
        const g = {};
        expenseOnIncome.forEach(r => { const k = catById.get(r.category_id).name; g[k] = (g[k] || 0) + 1; });
        note(`постъпления с разходна категория (възстановявания/поделени сметки): ${JSON.stringify(g)}`);
    }

    // Правила и имена: повреден текст (кирилица, изпратена в грешна кодировка → „???“) и твърде общи шаблони
    const rules = await q('SELECT r.*, c.name AS category FROM categorization_rules r LEFT JOIN categories c ON c.id = r.category_id');
    const broken = [...cats.filter(c => /\?{2,}/.test(`${c.name}${c.icon || ''}`)).map(c => `категория #${c.id} „${c.name}“`),
        ...rules.filter(r => /\?{2,}/.test(r.pattern)).map(r => `правило #${r.id} „${r.pattern}“`)];
    broken.length ? problem(`повреден текст („??“): ${broken.join(', ')}`) : ok('имената на категориите и правилата са четими');
    // Шаблонът е подниз без граници на думи — къс шаблон хваща кодове за авторизация, номера на магистрали и т.н.
    const texts = all.map(t => `${t.description || ''} ${t.counterparty_name || ''}`.toUpperCase());
    const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const accidental = [];
    for (const r of rules.filter(x => x.active)) {
        for (const p of r.pattern.toUpperCase().split('|').map(s => s.trim()).filter(s => s && s.length <= 4)) {
            const word = new RegExp(`(^|[^A-ZА-Я0-9])${escape(p)}([^A-ZА-Я0-9]|$)`);
            const n = texts.filter(t => t.includes(p) && !word.test(t)).length;
            if (n) accidental.push(`„${p}“ (правило #${r.id} → ${r.category}): ${n} случайни съвпадения`);
        }
    }
    accidental.length ? problem(`къси шаблони хващат части от думи/кодове: ${accidental.join('; ')}`) : ok('шаблоните на правилата не хващат случайни текстове');

    console.log(`\nОбщо проблеми: ${problems}`);
    db.close();
}

main().catch(e => { console.error(e); process.exit(1); });
