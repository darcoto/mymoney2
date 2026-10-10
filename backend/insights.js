/**
 * Аналитични справки: паричен поток, повтарящи се плащания, сравнение с миналата година,
 * банкови разходи, пътувания.
 *
 * Типът на транзакцията идва от категорията: income / expense / transfer; некатегоризираните
 * се броят за разход (както в останалите справки). Преводите между собствени сметки не влизат.
 * Сумите по тип са нето — възстановяване в разходна категория намалява разхода.
 */

const database = require('./database');
const countryUtils = require('./country-codes');

const TYPE_SQL = "COALESCE(c.type, 'expense')";

// Пълните редове — за списъка с транзакции и детайлите им във frontend
const TX_COLUMNS = `t.*, c.name AS category_name, c.color AS category_color, c.type AS category_type`;

function pad(n) {
    return String(n).padStart(2, '0');
}

function monthKey(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

function lastDayOfMonth(year, month) {
    return new Date(year, month, 0).getDate();
}

function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dayNumber(dateStr) {
    return Date.parse(`${dateStr}T00:00:00Z`) / 86400000;
}

function median(values) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function round2(n) {
    return Math.round(n * 100) / 100;
}

// Дата на картовата операция от описанието („ПОС 24.01.2026 15:51“ или „24012026 15:51“);
// банката осчетоводява 1–5 дни по-късно, а за пътуванията е важен денят на покупката
function purchaseDate(tx) {
    const m = /(\d{2})\.?(\d{2})\.?(20\d{2}) \d{2}:\d{2}/.exec(tx.description || '');
    return m ? `${m[3]}-${m[2]}-${m[1]}` : tx.transaction_date;
}

// ---------------------------------------------------------------------------
// 1. Паричен поток и норма на спестяване
// ---------------------------------------------------------------------------

async function getCashFlow(months = 24) {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
    const startDate = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-01`;

    const rows = await database.allQuery(`
        SELECT substr(t.transaction_date, 1, 7) AS month,
               -- Минус в приходна категория (напр. превод към брокер в „Инвестиции“) е вложени пари
               CASE WHEN ${TYPE_SQL} = 'income' AND t.amount < 0 THEN 'invested' ELSE ${TYPE_SQL} END AS kind,
               SUM(t.amount) AS total, COUNT(*) AS count
        FROM transactions t
        LEFT JOIN categories c ON c.id = t.category_id
        WHERE t.transaction_date >= ?
        GROUP BY month, kind
    `, [startDate]);

    const result = [];
    for (let i = 0; i < months; i++) {
        const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
        const key = monthKey(d);
        const get = type => rows.find(r => r.month === key && r.kind === type) || { total: 0, count: 0 };
        const income = round2(get('income').total);
        const expenses = round2(-get('expense').total);
        // Вложеното в инвестиции е част от спестеното — показва се отделно, без да намалява прихода
        const invested = round2(-get('invested').total) || 0;
        const savings = round2(income - expenses);
        result.push({
            month: key,
            year: d.getFullYear(),
            monthNumber: d.getMonth() + 1,
            income,
            expenses,
            savings,
            savingsRate: income > 0 ? round2((savings / income) * 100) : null,
            invested,
            transfers: round2(get('transfer').total),
            count: get('income').count + get('expense').count + get('invested').count
        });
    }
    // Месеците преди първите данни не се показват
    while (result.length && result[0].count === 0) result.shift();

    // Обобщение: последните 12 месеца и от началото на годината (без текущия, ако е непълен)
    const sum = list => list.reduce((acc, m) => ({
        income: acc.income + m.income, expenses: acc.expenses + m.expenses, invested: acc.invested + m.invested
    }), { income: 0, expenses: 0, invested: 0 });
    const summarize = list => {
        const s = sum(list);
        const savings = s.income - s.expenses;
        return {
            months: list.length,
            income: round2(s.income),
            expenses: round2(s.expenses),
            savings: round2(savings),
            savingsRate: s.income > 0 ? round2((savings / s.income) * 100) : null,
            invested: round2(s.invested),
            avgIncome: list.length ? round2(s.income / list.length) : 0,
            avgExpenses: list.length ? round2(s.expenses / list.length) : 0
        };
    };
    const currentYear = String(now.getFullYear());

    return {
        months: result,
        last12: summarize(result.slice(-12)),
        yearToDate: summarize(result.filter(m => m.month.startsWith(currentYear)))
    };
}

// ---------------------------------------------------------------------------
// 2. Повтарящи се плащания и абонаменти
// ---------------------------------------------------------------------------

// Ключ за групиране: контрагентът без цифри (номера на обекти, дати), иначе описанието
function recurringKey(tx) {
    const base = (tx.counterparty_name || '').trim() || (tx.description || '').trim();
    return base.toUpperCase().replace(/\d+/g, '').replace(/\s+/g, ' ').trim();
}

async function getRecurringPayments() {
    const from = new Date();
    from.setMonth(from.getMonth() - 25);
    const fromDate = `${from.getFullYear()}-${pad(from.getMonth() + 1)}-01`;

    const rows = await database.allQuery(`
        SELECT ${TX_COLUMNS}
        FROM transactions t
        LEFT JOIN categories c ON c.id = t.category_id
        WHERE t.amount < 0 AND ${TYPE_SQL} <> 'transfer' AND t.transaction_date >= ?
          AND t.account_id <> 'CASH'
        ORDER BY t.transaction_date
    `, [fromDate]);

    const groups = new Map();
    for (const tx of rows) {
        const key = recurringKey(tx);
        if (!key) continue;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(tx);
    }

    const today = todayStr();
    const items = [];
    for (const [key, txs] of groups) {
        if (txs.length < 2) continue;
        const amounts = txs.map(t => -t.amount);
        const dates = txs.map(t => t.transaction_date);
        const intervals = dates.slice(1).map((d, i) => dayNumber(d) - dayNumber(dates[i]));
        const interval = median(intervals);
        const monthsActive = new Set(dates.map(d => d.slice(0, 7))).size;
        const spanMonths = Math.max(1, Math.round((dayNumber(dates[dates.length - 1]) - dayNumber(dates[0])) / 30.44) + 1);
        const typical = median(amounts);
        const spread = median(amounts.map(a => Math.abs(a - typical))) / (typical || 1);

        let frequency = null;
        if (interval >= 25 && interval <= 35 && txs.length >= 3) {
            // Месечно: поне 3 плащания, в повечето месеци от периода, до ~1.5 плащания на месец
            if (monthsActive / spanMonths >= 0.6 && txs.length / monthsActive <= 1.5) frequency = 'monthly';
        } else if (interval >= 350 && interval <= 380 && spread <= 0.03) {
            frequency = 'yearly';
        } else if (interval >= 80 && interval <= 100 && txs.length >= 3 && spread <= 0.05) {
            frequency = 'quarterly';
        }
        if (!frequency) continue;
        // Месечните с много различни суми (напр. магазин) не са абонамент
        const stable = spread <= 0.15;
        if (frequency === 'monthly' && spread > 0.6) continue;

        const perYear = { monthly: 12, quarterly: 4, yearly: 1 }[frequency];
        const last = txs[txs.length - 1];
        const previous = txs.slice(-4, -1).map(t => -t.amount);
        const previousTypical = previous.length ? median(previous) : null;
        const lastAmount = -last.amount;
        const change = stable && previousTypical && Math.abs(lastAmount - previousTypical) / previousTypical > 0.05
            ? round2(lastAmount - previousTypical) : 0;

        const expectedDays = { monthly: 31, quarterly: 92, yearly: 366 }[frequency];
        const nextDate = new Date(Date.parse(`${last.transaction_date}T00:00:00Z`) + Math.round(interval) * 86400000)
            .toISOString().slice(0, 10);
        const overdueDays = dayNumber(today) - dayNumber(last.transaction_date);
        const active = overdueDays <= expectedDays * 1.6;

        // Категорията — най-честата сред плащанията
        const catCount = {};
        txs.forEach(t => { const k = t.category_name || '—'; catCount[k] = (catCount[k] || 0) + 1; });
        const category = Object.entries(catCount).sort((a, b) => b[1] - a[1])[0][0];
        const catTx = txs.find(t => (t.category_name || '—') === category);

        items.push({
            key,
            name: (last.counterparty_name || last.description || key).trim(),
            category,
            categoryColor: catTx ? catTx.category_color : null,
            frequency,
            stable,
            count: txs.length,
            typicalAmount: round2(typical),
            lastAmount: round2(lastAmount),
            change,
            lastDate: last.transaction_date,
            nextDate: active ? nextDate : null,
            active,
            monthlyCost: round2(typical * perYear / 12),
            yearlyCost: round2(typical * perYear),
            transactions: [...txs].reverse()
        });
    }

    items.sort((a, b) => (b.active - a.active) || (b.monthlyCost - a.monthlyCost));
    const activeItems = items.filter(i => i.active);
    return {
        items,
        totals: {
            active: activeItems.length,
            monthly: round2(activeItems.reduce((s, i) => s + i.monthlyCost, 0)),
            yearly: round2(activeItems.reduce((s, i) => s + i.yearlyCost, 0))
        }
    };
}

// ---------------------------------------------------------------------------
// 3. Сравнение с миналата година (по категории)
// ---------------------------------------------------------------------------

/**
 * @param {number} year
 * @param {number} month 1–12
 * @param {'month'|'ytd'} mode — само месеца или от началото на годината до месеца включително
 */
async function getYearComparison(year, month, mode = 'month') {
    const range = (y) => {
        const fromMonth = mode === 'ytd' ? 1 : month;
        return {
            start: `${y}-${pad(fromMonth)}-01`,
            end: `${y}-${pad(month)}-${pad(lastDayOfMonth(y, month))}`
        };
    };
    const current = range(year);
    const previous = range(year - 1);

    const query = `
        SELECT c.id, COALESCE(c.name, 'Некатегоризирани') AS name, c.color, ${TYPE_SQL} AS type,
               SUM(t.amount) AS total, COUNT(*) AS count
        FROM transactions t
        LEFT JOIN categories c ON c.id = t.category_id
        WHERE t.transaction_date BETWEEN ? AND ? AND ${TYPE_SQL} <> 'transfer'
        GROUP BY c.id
    `;
    const [cur, prev] = await Promise.all([
        database.allQuery(query, [current.start, current.end]),
        database.allQuery(query, [previous.start, previous.end])
    ]);

    const byId = new Map();
    const add = (list, field) => list.forEach(r => {
        const id = r.id === null ? 'none' : r.id;
        if (!byId.has(id)) byId.set(id, { id: r.id, name: r.name, color: r.color || '#9e9e9e', type: r.type, current: 0, previous: 0, currentCount: 0, previousCount: 0 });
        const item = byId.get(id);
        // Разходите — като положителни суми, за да се сравняват по-лесно
        item[field] = round2(r.type === 'expense' ? -r.total : r.total);
        item[`${field}Count`] = r.count;
    });
    add(cur, 'current');
    add(prev, 'previous');

    const rows = [...byId.values()].map(r => ({
        ...r,
        diff: round2(r.current - r.previous),
        pct: r.previous ? round2(((r.current - r.previous) / Math.abs(r.previous)) * 100) : null
    }));
    const totals = type => {
        const list = rows.filter(r => r.type === type);
        const c = round2(list.reduce((s, r) => s + r.current, 0));
        const p = round2(list.reduce((s, r) => s + r.previous, 0));
        return { current: c, previous: p, diff: round2(c - p), pct: p ? round2(((c - p) / Math.abs(p)) * 100) : null };
    };

    return {
        current,
        previous,
        expenses: rows.filter(r => r.type === 'expense').sort((a, b) => b.current - a.current || b.previous - a.previous),
        income: rows.filter(r => r.type === 'income').sort((a, b) => b.current - a.current || b.previous - a.previous),
        totals: { expense: totals('expense'), income: totals('income') }
    };
}

// ---------------------------------------------------------------------------
// 4. Банкови разходи
// ---------------------------------------------------------------------------

const BANK_COST_KINDS = [
    { key: 'interest', label: 'Лихви (кредитна карта, овърдрафт)', re: /ЛИХВ/i },
    { key: 'transfer', label: 'Такси за преводи', re: /ТАКСА ЗА ИЗХОДЯЩ ПРЕВОД/i },
    { key: 'atm', label: 'Такси за теглене от банкомат', re: /ТЕГЛЕНЕ НА АТМ|НА АТМ ДР\. БАНКИ/i },
    { key: 'service', label: 'Обслужване и пакети', re: /ОБСЛУЖВАНЕ|ПАКЕТНО|МЕС\. ТАКСА|ДЪЛЖИМА ТАКСА/i },
    { key: 'cashback', label: 'Кешбек и върнати такси', re: /ТОЧКИ|REFUND|CASHBACK|КЕШБЕК/i },
    { key: 'other', label: 'Други такси', re: /./ }
];

function bankName(institution) {
    const name = String(institution || '');
    if (/DSK/i.test(name)) return 'Банка ДСК';
    if (/REVOLUT/i.test(name)) return 'Revolut';
    return name || 'Друга';
}

async function getBankCosts() {
    const rows = await database.allQuery(`
        SELECT ${TX_COLUMNS}, a.institution_name
        FROM transactions t
        JOIN categories c ON c.id = t.category_id
        LEFT JOIN accounts a ON a.id = t.account_id
        WHERE c.name = 'Банкови'
        ORDER BY t.transaction_date DESC
    `);

    const years = [...new Set(rows.map(r => r.transaction_date.slice(0, 4)))].sort();
    const kinds = BANK_COST_KINDS.map(k => ({ key: k.key, label: k.label, years: {}, total: 0, transactions: [] }));
    const banks = new Map();

    for (const tx of rows) {
        const year = tx.transaction_date.slice(0, 4);
        const kind = kinds[BANK_COST_KINDS.findIndex(k => k.re.test(tx.description || ''))];
        kind.years[year] = round2((kind.years[year] || 0) + tx.amount);
        kind.total = round2(kind.total + tx.amount);
        kind.transactions.push(tx);

        const bank = bankName(tx.institution_name);
        if (!banks.has(bank)) banks.set(bank, { label: bank, years: {}, total: 0, transactions: [] });
        const b = banks.get(bank);
        b.years[year] = round2((b.years[year] || 0) + tx.amount);
        b.total = round2(b.total + tx.amount);
        b.transactions.push(tx);
    }

    const yearTotals = {};
    years.forEach(y => { yearTotals[y] = round2(rows.filter(r => r.transaction_date.startsWith(y)).reduce((s, r) => s + r.amount, 0)); });

    return {
        years,
        kinds: kinds.filter(k => k.transactions.length),
        banks: [...banks.values()],
        yearTotals,
        total: round2(rows.reduce((s, r) => s + r.amount, 0))
    };
}

// ---------------------------------------------------------------------------
// 5. Пътувания (плащания в чужбина, групирани по периоди)
// ---------------------------------------------------------------------------

// Онлайн услуги с чуждестранна регистрация — не са пътуване
const ONLINE_MERCHANTS = /PAYPAL|GOOGLE|APPLE|AMAZON|AMZN|NETFLIX|SPOTIFY|DROPBOX|OPENAI|PATREON|ALIEXPRESS|TEMU|STEAM|MICROSOFT|ADOBE|BOOKING|AIRBNB|REVOLUT|TIDAL|DEEZER|HELPPAY|CLAUDE|ANTHROPIC|EBAY|ETSY|35314369001|4029357733/i;
const TRIP_GAP_DAYS = 3;

async function getTrips() {
    const rows = await database.allQuery(`
        SELECT ${TX_COLUMNS}
        FROM transactions t
        LEFT JOIN categories c ON c.id = t.category_id
        WHERE t.amount < 0 AND ${TYPE_SQL} <> 'transfer'
          AND t.country IS NOT NULL AND t.country <> '' AND t.country <> 'BGR'
    `);

    const physical = rows
        .filter(tx => !ONLINE_MERCHANTS.test(`${tx.counterparty_name || ''} ${tx.description || ''}`))
        .map(tx => ({ ...tx, purchase_date: purchaseDate(tx) }))
        .sort((a, b) => a.purchase_date.localeCompare(b.purchase_date));

    // Последователни плащания в чужбина с разлика до 3 дни → едно пътуване
    const clusters = [];
    for (const tx of physical) {
        const current = clusters[clusters.length - 1];
        if (current && dayNumber(tx.purchase_date) - dayNumber(current.end) <= TRIP_GAP_DAYS) {
            current.items.push(tx);
            current.end = tx.purchase_date;
        } else {
            clusters.push({ start: tx.purchase_date, end: tx.purchase_date, items: [tx] });
        }
    }

    const trips = clusters
        .filter(c => c.items.length >= 3 && c.items.reduce((s, t) => s - t.amount, 0) >= 30)
        .map(c => {
            const total = round2(c.items.reduce((s, t) => s - t.amount, 0));
            const countries = new Map();
            const categories = new Map();
            c.items.forEach(t => {
                countries.set(t.country, (countries.get(t.country) || 0) - t.amount);
                const cat = t.category_name || 'Некатегоризирани';
                if (!categories.has(cat)) categories.set(cat, { name: cat, color: t.category_color || '#9e9e9e', amount: 0, count: 0 });
                const entry = categories.get(cat);
                entry.amount = round2(entry.amount - t.amount);
                entry.count++;
            });
            const countryList = [...countries.entries()].sort((a, b) => b[1] - a[1]).map(([code, amount]) => {
                const info = countryUtils.getCountryInfo(code);
                return { code, name: (info && info.name) || code, flag: (info && info.flag) || '', amount: round2(amount) };
            });
            return {
                start: c.start,
                end: c.end,
                days: dayNumber(c.end) - dayNumber(c.start) + 1,
                total,
                count: c.items.length,
                countries: countryList,
                categories: [...categories.values()].sort((a, b) => b.amount - a.amount),
                transactions: [...c.items].sort((a, b) => b.purchase_date.localeCompare(a.purchase_date))
            };
        })
        .sort((a, b) => b.start.localeCompare(a.start));

    const byYear = {};
    trips.forEach(t => {
        const y = t.start.slice(0, 4);
        byYear[y] = byYear[y] || { trips: 0, days: 0, total: 0 };
        byYear[y].trips++;
        byYear[y].days += t.days;
        byYear[y].total = round2(byYear[y].total + t.total);
    });

    return { trips, byYear };
}

module.exports = {
    getCashFlow,
    getRecurringPayments,
    getYearComparison,
    getBankCosts,
    getTrips,
    purchaseDate
};
