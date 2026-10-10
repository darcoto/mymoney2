/**
 * Съпоставяне на транзакции от различни източници (файлов импорт ↔ банков API)
 *
 * - Дубликати: транзакция от файл, която вече е влязла през синхронизацията с банката
 *   (или от друг файл с различен формат), се разпознава и не се импортира повторно.
 *   Revolut: сума + баланс след транзакцията / точен час; ДСК: дата + сума + контрагент.
 * - Revolut: двете страни на превод между собствени сметки (основна ↔ джоб, USD ↔ EUR) имат
 *   един и същ transactionId — ключът е internalTransactionId (виж GoCardless провайдъра).
 * - reconcileImportedTransactions(): почистване на вече натрупани дубликати.
 */

const database = require('./database');
const logger = require('./logger');
const { productKind } = require('./revolut-import');
const { BGN_TO_EUR_RATE } = require('./dsk-import');

const DAY_MS = 24 * 60 * 60 * 1000;
const TIME_TOLERANCE_MS = 3000;
const LOCAL_TIME_ZONE = 'Europe/Sofia';

// Колоните на старите Revolut импорти (raw_data беше CSV ред, съединен със запетаи)
const LEGACY_REVOLUT_COLUMNS = ['Вид', 'Продукт', 'Начална дата', 'Дата на завършване', 'Описание', 'Сума', 'Такса', 'Валута', 'State', 'Баланс'];

// ---------------------------------------------------------------------------
// Помощни функции
// ---------------------------------------------------------------------------

function parseJson(text) {
    try {
        return JSON.parse(text);
    } catch (e) {
        return null;
    }
}

function isBankRow(row) {
    return typeof row.raw_data === 'string' && row.raw_data.includes('"transactionAmount"');
}

function isRevolutAccount(account) {
    return (account.institution_name || '').toUpperCase().includes('REVOLUT');
}

function isDskAccount(account) {
    return (account.institution_name || '').toUpperCase().includes('DSK');
}

function accountCurrency(account) {
    return account.original_currency || account.currency || 'EUR';
}

function accountLabel(account) {
    if (!account) return '?';
    const name = account.custom_name || account.name || account.iban || account.id;
    // Сметки с еднакви имена (напр. две „КРЕДИТНА КАРТА - EUR“) — с последните цифри от IBAN
    return account.iban && name !== account.iban ? `${name} …${account.iban.slice(-4)}` : name;
}

function normalizeName(text) {
    return String(text || '').toUpperCase().replace(/\s+/g, ' ').trim();
}

function addDays(dateStr, days) {
    const date = new Date(`${dateStr}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10); // UTC дата от UTC полунощ — без изместване
}

function dayDiff(a, b) {
    return Math.abs(new Date(`${a}T00:00:00Z`) - new Date(`${b}T00:00:00Z`)) / DAY_MS;
}

/**
 * Местно време „YYYY-MM-DD HH:MM:SS“ (часовата зона на потребителя) → UTC милисекунди
 */
function localToUtcMs(text, timeZone = LOCAL_TIME_ZONE) {
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(text || '').trim());
    if (!m) return null;
    const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
    // Отместване на зоната в този момент (взема предвид лятното часово време)
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).formatToParts(new Date(asUtc)).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
    const zoned = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    return asUtc - (zoned - asUtc);
}

function parseNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = parseFloat(String(value).replace(/\s/g, '').replace(',', '.'));
    return isNaN(n) ? null : n;
}

// ---------------------------------------------------------------------------
// Признаци за съпоставяне
// ---------------------------------------------------------------------------

/**
 * Признаци на ред от базата: { date, amount, origAmount, origCurrency, counterparty, balance, times, isBank }
 */
function rowFeatures(row) {
    const base = {
        id: row.id,
        accountId: row.account_id,
        date: row.transaction_date,
        amount: row.amount,
        origAmount: row.original_amount,
        origCurrency: row.original_currency,
        counterparty: normalizeName(row.counterparty_name),
        balance: null,
        times: [],
        isBank: isBankRow(row)
    };

    if (base.isBank) {
        const raw = parseJson(row.raw_data) || {};
        const balance = raw.balanceAfterTransaction && raw.balanceAfterTransaction.balanceAmount;
        if (balance) base.balance = parseNumber(balance.amount);
        base.times = [raw.bookingDateTime, raw.valueDateTime]
            .filter(Boolean)
            .map(t => Date.parse(t))
            .filter(t => !isNaN(t));
        if (raw.transactionAmount) {
            base.bankAmount = parseNumber(raw.transactionAmount.amount);
            base.bankCurrency = raw.transactionAmount.currency;
        }
        return base;
    }

    if (row.id.startsWith('REV_')) {
        const raw = revolutRawFields(row.raw_data);
        if (raw) {
            base.balance = parseNumber(raw['Баланс'] || raw['Balance']);
            base.times = [raw['Начална дата'] || raw['Started Date'], raw['Дата на завършване'] || raw['Completed Date']]
                .map(t => localToUtcMs(t))
                .filter(t => t !== null);
            base.product = raw['Продукт'] || raw['Product'] || null;
            base.fileCurrency = raw['Валута'] || raw['Currency'] || null;
        }
    }
    return base;
}

/**
 * Полетата на Revolut ред от raw_data: JSON (нов формат) или CSV низ (стари импорти)
 */
function revolutRawFields(rawData) {
    if (!rawData) return null;
    const json = parseJson(rawData);
    if (json && typeof json === 'object') return json;

    // Стар формат: ред, съединен със запетаи. Описанието може да съдържа запетаи —
    // първите 4 и последните 5 полета са фиксирани, останалото е описанието.
    const parts = String(rawData).split(',');
    if (parts.length < LEGACY_REVOLUT_COLUMNS.length) return null;
    const head = parts.slice(0, 4);
    const tail = parts.slice(parts.length - 5);
    const description = parts.slice(4, parts.length - 5).join(',');
    const values = [...head, description, ...tail];
    const fields = {};
    LEGACY_REVOLUT_COLUMNS.forEach((name, i) => { fields[name] = values[i]; });
    return fields;
}

/**
 * Признаци на транзакция за импорт (обект от парсерите)
 */
function importFeatures(tx) {
    return {
        id: tx.id,
        accountId: tx.accountId,
        date: tx.transactionDate,
        amount: tx.amount,
        origAmount: tx.originalAmount,
        origCurrency: tx.originalCurrency,
        counterparty: normalizeName(tx.counterpartyName),
        balance: tx.balance !== undefined ? tx.balance : null,
        times: [tx.startedAt, tx.completedAt].map(t => localToUtcMs(t)).filter(t => t !== null),
        isBank: false
    };
}

function amountsEqual(a, b) {
    // Сравнение в оригиналната валута, ако е налична и от двете страни (напр. BGN преди 2026)
    const aOrig = a.origCurrency ? { amount: a.origAmount, currency: a.origCurrency } : null;
    const bOrig = b.origCurrency
        ? { amount: b.origAmount, currency: b.origCurrency }
        : (b.bankCurrency && b.bankCurrency !== 'EUR' ? { amount: b.bankAmount, currency: b.bankCurrency } : null);
    if (aOrig && bOrig && aOrig.currency === bOrig.currency) {
        return Math.abs(aOrig.amount - bOrig.amount) < 0.005;
    }
    // Конвертирани суми може да се разминават с 1 цент заради закръгляне
    const tolerance = (aOrig || bOrig) ? 0.011 : 0.005;
    return Math.abs(a.amount - b.amount) < tolerance;
}

/**
 * Силно съвпадение (сигурно е същата транзакция) или слабо (същата дата и сума)
 * @returns {'strong'|'weak'|null}
 */
function compare(file, existing) {
    if (!amountsEqual(file, existing)) return null;
    const days = dayDiff(file.date, existing.date);
    if (days > 1) return null;

    // Revolut: балансът след транзакцията е почти уникален
    if (file.balance !== null && existing.balance !== null) {
        return Math.abs(file.balance - existing.balance) < 0.005 ? 'strong' : null;
    }
    // Точен час (до 3 секунди)
    if (file.times.length && existing.times.length) {
        const close = file.times.some(t1 => existing.times.some(t2 => Math.abs(t1 - t2) <= TIME_TOLERANCE_MS));
        if (close) return 'strong';
    }

    if (days !== 0) return null;
    if (file.counterparty && file.counterparty === existing.counterparty) return 'strong';
    return 'weak';
}

/**
 * Съпоставя транзакции от файл със съществуващи редове 1:1
 * @param {Array} fileItems - признаци (importFeatures / rowFeatures)
 * @param {Array} existingItems - признаци на кандидатите
 * @returns {Map<string, Object>} file id → existing features
 */
function matchTransactions(fileItems, existingItems) {
    const matches = new Map();
    const used = new Set();

    // По дата за бързо търсене (±1 ден)
    const byDate = new Map();
    for (const item of existingItems) {
        if (!byDate.has(item.date)) byDate.set(item.date, []);
        byDate.get(item.date).push(item);
    }
    const candidatesFor = (file) => [addDays(file.date, -1), file.date, addDays(file.date, 1)]
        .flatMap(d => byDate.get(d) || []);

    // 1) силни съвпадения; банковите редове са с предимство пред други файлови
    for (const file of fileItems) {
        const strong = candidatesFor(file)
            .filter(e => !used.has(e.id) && e.id !== file.id && compare(file, e) === 'strong')
            .sort((a, b) => Number(b.isBank) - Number(a.isBank));
        if (strong.length) {
            matches.set(file.id, strong[0]);
            used.add(strong[0].id);
        }
    }

    // 2) слаби (същата дата и сума, различен/липсващ контрагент) — само когато групата
    //    от файла и групата от кандидатите са с еднакъв размер (напр. две еднакви такси
    //    в един ден и от двете страни — неразличими са, свързват се по двойки)
    const remaining = fileItems.filter(f => !matches.has(f.id));
    const weakSets = new Map(remaining.map(file => [
        file.id,
        candidatesFor(file).filter(e => !used.has(e.id) && e.id !== file.id && compare(file, e) === 'weak')
    ]));
    const groups = new Map();
    for (const file of remaining) {
        const candidates = weakSets.get(file.id);
        if (!candidates.length) continue;
        const key = candidates.map(c => c.id).sort().join('|');
        if (!groups.has(key)) groups.set(key, { files: [], candidates });
        groups.get(key).files.push(file);
    }
    for (const { files, candidates } of groups.values()) {
        if (files.length !== candidates.length) continue;
        // Никой друг файлов ред не бива да претендира за същите кандидати
        const contested = remaining.some(f => !files.includes(f)
            && weakSets.get(f.id).some(c => candidates.includes(c)));
        if (contested) continue;
        files.forEach((file, i) => {
            matches.set(file.id, candidates[i]);
            used.add(candidates[i].id);
        });
    }

    return matches;
}

// ---------------------------------------------------------------------------
// Revolut: разпознаване на сметката и джобове
// ---------------------------------------------------------------------------

/**
 * Определя сметката за всяка група редове (продукт + валута) от Revolut CSV
 * @returns {Promise<Map<string, Object>>} ключ `${productKind}|${currency}` → account
 */
async function resolveRevolutAccounts(transactions, accounts) {
    const revolut = accounts.filter(isRevolutAccount);
    const groups = new Map();
    for (const tx of transactions) {
        const key = `${tx.productKind || ''}|${tx.fileCurrency}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(tx);
    }

    const result = new Map();
    for (const [key, rows] of groups) {
        const [kind, currency] = key.split('|');
        let candidates = revolut.filter(a => accountCurrency(a) === currency);
        if (kind === 'current') candidates = candidates.filter(a => a.iban);
        if (kind === 'savings') candidates = candidates.filter(a => !a.iban);

        const product = rows[0].product || '?';
        if (candidates.length === 0) {
            throw new Error(`Не е намерена Revolut сметка за „${product}“ във валута ${currency}. Синхронизирайте сметките или изберете сметка ръчно.`);
        }

        let account = candidates.length === 1 ? candidates[0] : null;

        if (!account) {
            // Последният ред от групата трябва да съвпада с текущата наличност на сметката
            const last = [...rows].sort((a, b) => String(a.completedAt).localeCompare(String(b.completedAt))).pop();
            const byBalance = candidates.filter(a => last.balance !== null && Math.abs(a.balance - last.balance) < 0.005);
            if (byBalance.length === 1) account = byBalance[0];
        }

        if (!account) {
            // Гласуване: в коя сметка има банкови транзакции със същата сума и баланс
            const dates = rows.map(r => r.transactionDate).sort();
            const existing = (await database.getTransactionsForMatching(candidates.map(a => a.id), dates[0], dates[dates.length - 1]))
                .filter(isBankRow).map(rowFeatures);
            const votes = new Map();
            for (const row of rows) {
                const hit = existing.find(e => e.balance !== null && row.balance !== null
                    && Math.abs(e.balance - row.balance) < 0.005 && Math.abs(e.amount - row.amount) < 0.005);
                if (hit) votes.set(hit.accountId, (votes.get(hit.accountId) || 0) + 1);
            }
            const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]);
            if (ranked.length && (ranked.length === 1 || ranked[0][1] > ranked[1][1])) {
                account = candidates.find(a => a.id === ranked[0][0]);
            }
        }

        if (!account) {
            throw new Error(`Не може да се определи автоматично сметката за „${product}“ (${currency}) — има ${candidates.length} възможни. Изберете сметка ръчно.`);
        }
        result.set(key, account);
    }
    return result;
}

// ---------------------------------------------------------------------------
// ДСК: неосчетоводени картови операции („блокирани суми“)
// ---------------------------------------------------------------------------

// API-то на ДСК е връщало авторизациите по карта като отделни транзакции: без entryReference,
// с положителна сума и описание само „<маскирана карта> <12-цифрен код>“. Осчетоводеното
// плащане идва по-късно като отделен ред (с минус), чието описание започва със същия код.
const DSK_CARD_HOLD_PATTERN = /^\d{6}x{6}\d{4} (\d{12})$/i;
const CARD_HOLD_SETTLE_DAYS = 10;

/**
 * Транзакция от GoCardless (суров обект) — блокирана сума по карта?
 */
function isDskCardHold(tx) {
    if (!tx || tx.entryReference) return false;
    const text = String(tx.remittanceInformationUnstructured || '').trim();
    const amount = parseFloat(tx.transactionAmount && tx.transactionAmount.amount);
    return DSK_CARD_HOLD_PATTERN.test(text) && amount > 0;
}

/**
 * Дата на картовата операция от описанието: „ПОС 24.01.2026 15:51“ (файл) или „24012026 15:51“ (API)
 */
function cardOperationDate(description) {
    const m = /(\d{2})\.?(\d{2})\.?(20\d{2}) \d{2}:\d{2}/.exec(String(description || ''));
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/**
 * Записаните в базата блокирани суми по карти се обединяват с осчетоводеното плащане
 * (категорията и бележките се пренасят). Двойникът: същата сметка, обратна сума,
 * до 10 дни след блокировката; с предимство е редът със същия код или дата в описанието.
 */
async function removeDskCardHolds({ dryRun = true } = {}, samples = [], labelOf = id => id) {
    const accounts = (await database.getAllAccounts()).filter(isDskAccount);
    let removed = 0;
    let unmatched = 0;

    for (const account of accounts) {
        const rows = await database.getTransactionsForMatching([account.id], '0000-01-01', '9999-12-31');
        const holds = rows.filter(r => isBankRow(r) && isDskCardHold(parseJson(r.raw_data)));
        if (!holds.length) continue;
        const holdIds = new Set(holds.map(h => h.id));
        const settled = rows.filter(r => !holdIds.has(r.id) && r.amount < 0);
        const used = new Set();

        // Една и съща блокировка понякога е записана два пъти (различни ID, същият код)
        const groups = new Map();
        for (const hold of holds) {
            const code = DSK_CARD_HOLD_PATTERN.exec(String(parseJson(hold.raw_data).remittanceInformationUnstructured).trim())[1];
            const key = `${code}|${hold.amount}`;
            if (!groups.has(key)) groups.set(key, { code, items: [] });
            groups.get(key).items.push(hold);
        }

        const ordered = [...groups.values()].sort((a, b) => a.items[0].transaction_date.localeCompare(b.items[0].transaction_date));
        for (const { code, items } of ordered) {
            const hold = items[0];
            // Датата на покупката от описанието трябва да е датата на блокировката
            const score = (row) => (String(row.description || '').includes(code) ? 4 : 0)
                + (cardOperationDate(row.description) === hold.transaction_date ? 2 : 0);

            const twin = settled
                .filter(r => !used.has(r.id)
                    && [null, hold.transaction_date].includes(cardOperationDate(r.description))
                    && Math.abs(r.amount + hold.amount) < 0.005
                    && r.transaction_date >= addDays(hold.transaction_date, -1)
                    && r.transaction_date <= addDays(hold.transaction_date, CARD_HOLD_SETTLE_DAYS))
                .sort((a, b) => score(b) - score(a)
                    || dayDiff(a.transaction_date, hold.transaction_date) - dayDiff(b.transaction_date, hold.transaction_date))[0];

            if (!twin) {
                unmatched += items.length;
                continue;
            }
            used.add(twin.id);
            for (const item of items) {
                removed++;
                if (samples.length < 20) {
                    samples.push({
                        account: labelOf(account.id),
                        date: item.transaction_date,
                        amount: item.amount,
                        description: `Блокирана сума → ${twin.description || twin.counterparty_name || ''}`,
                        fileId: item.id,
                        bankId: twin.id
                    });
                }
                logger.info(`[DSK holds] ${dryRun ? '(dry run) ' : ''}Merge hold ${item.id} (${item.transaction_date} +${item.amount}) into ${twin.id} (${twin.transaction_date} ${twin.amount})`);
                if (!dryRun) await database.mergeDuplicateTransaction(item.id, twin.id);
            }
        }
    }

    if (removed || unmatched) logger.info(`[DSK holds] ${dryRun ? 'Would remove' : 'Removed'} ${removed} card holds, ${unmatched} without a settled payment`);
    return { removed, unmatched };
}

// ---------------------------------------------------------------------------
// Импорт
// ---------------------------------------------------------------------------

/**
 * Отделя от транзакциите за импорт тези, които вече съществуват под друго ID
 * (от банката или от друг файл). При Revolut съвпадение в друга сметка премества
 * съществуващия ред в сметката от файла (файлът знае точния продукт).
 * @param {Array} transactions - с попълнен accountId
 * @param {Object} options - { crossAccountIds: [...] } сметки, в които да се търси освен целевите
 * @returns {Promise<{ toImport: Array, duplicates: number, moved: number }>}
 */
async function filterDuplicates(transactions, { crossAccountIds = [], moveMatches = false } = {}) {
    if (!transactions.length) return { toImport: [], duplicates: 0, moved: 0 };

    const dates = transactions.map(t => t.transactionDate).sort();
    const accountIds = [...new Set([...transactions.map(t => t.accountId), ...crossAccountIds])];
    const ownIds = new Set(transactions.map(t => t.id));

    const existing = (await database.getTransactionsForMatching(accountIds, addDays(dates[0], -1), addDays(dates[dates.length - 1], 1)))
        .filter(row => !ownIds.has(row.id)) // същото ID → upsert го обработва
        .map(rowFeatures);

    // Без кръстосано търсене кандидатите са само от същата сметка
    const fileItems = transactions.map(importFeatures);
    const matches = new Map();
    if (crossAccountIds.length) {
        for (const [k, v] of matchTransactions(fileItems, existing)) matches.set(k, v);
    } else {
        for (const accountId of new Set(transactions.map(t => t.accountId))) {
            const part = matchTransactions(fileItems.filter(f => f.accountId === accountId), existing.filter(e => e.accountId === accountId));
            for (const [k, v] of part) matches.set(k, v);
        }
    }

    let moved = 0;
    const toImport = [];
    for (const tx of transactions) {
        const match = matches.get(tx.id);
        if (!match) {
            toImport.push(tx);
            continue;
        }
        if (moveMatches && match.accountId !== tx.accountId) {
            logger.info(`[Import matching] Move ${match.id} (${match.date} ${match.amount}) ${match.accountId} → ${tx.accountId} (as in file row ${tx.id})`);
            await database.moveTransactionToAccount(match.id, tx.accountId);
            moved++;
        }
    }

    logger.info(`[Import matching] ${transactions.length} from file: ${matches.size} already exist under another ID, ${moved} moved to the correct account`);
    return { toImport, duplicates: matches.size, moved };
}

/**
 * Транзакции със същото ID, но в друга сметка (напр. стари Revolut импорти на „Спестявания“
 * в основната сметка) — местят се в сметката, определена от файла
 */
async function moveSameIdToAccounts(transactions) {
    const current = await database.getTransactionAccounts(transactions.map(t => t.id));
    let moved = 0;
    for (const tx of transactions) {
        const accountId = current.get(tx.id);
        if (accountId && accountId !== tx.accountId) {
            await database.moveTransactionToAccount(tx.id, tx.accountId);
            moved++;
        }
    }
    return moved;
}

/**
 * Старият Revolut импорт не приспадаше колоната „Такса“ (напр. такса за обмяна при плащане
 * в USD) — сумата се поправя на Сума − Такса, както прави новият парсер и банката (EUR/BGN)
 */
async function fixRevolutImportFees({ dryRun = true } = {}) {
    const revolutAccounts = (await database.getAllAccounts()).filter(isRevolutAccount);
    const rows = await database.getFileImportedTransactions(revolutAccounts.map(a => a.id));
    let fixed = 0;
    for (const row of rows.filter(r => r.id.startsWith('REV_'))) {
        const raw = revolutRawFields(row.raw_data);
        if (!raw) continue;
        const sum = parseNumber(raw['Сума'] ?? raw['Amount']);
        const fee = parseNumber(raw['Такса'] ?? raw['Fee']) || 0;
        const currency = String(raw['Валута'] || raw['Currency'] || '').toUpperCase();
        if (sum === null || !fee || !['EUR', 'BGN'].includes(currency)) continue;

        const net = Math.round((sum - fee) * 100) / 100;
        const amount = currency === 'BGN' ? parseFloat((net / BGN_TO_EUR_RATE).toFixed(2)) : net;
        const originalAmount = currency === 'BGN' ? net : null;
        if (Math.abs(row.amount - amount) < 0.005) continue;

        fixed++;
        logger.info(`[Revolut fees] ${dryRun ? '(dry run) ' : ''}${row.id} ${row.transaction_date}: ${row.amount} → ${amount} (fee ${fee} ${currency})`);
        if (!dryRun) await database.updateTransactionAmount(row.id, amount, originalAmount);
    }
    return fixed;
}

// ---------------------------------------------------------------------------
// Почистване на натрупани дубликати
// ---------------------------------------------------------------------------

/**
 * Обединява вече импортирани от файл транзакции с банковите им двойници:
 * 1) Revolut джобове — преместване на грешно разпределените банкови записи;
 * 2) стари Revolut импорти на „Спестявания“ — в сметката на джоба;
 * 3) стари Revolut импорти без приспадната такса → сумата се поправя (преди търсенето
 *    на дубликати — едва с таксата сумата съвпада с банковата);
 * 4) файлов ред + банков ред за същата транзакция → остава банковият, категорията и
 *    бележките се пренасят (ако банковият ги няма);
 * 5) ДСК: блокирани суми по карти → обединяват се с осчетоводеното плащане.
 * @param {{ dryRun: boolean }} options
 */
async function reconcileImportedTransactions({ dryRun = true } = {}) {
    const accounts = await database.getAllAccounts();
    const byId = new Map(accounts.map(a => [a.id, a]));
    const result = { importedMoved: 0, duplicatesMerged: 0, cardHoldsRemoved: 0, cardHoldsUnmatched: 0, feesFixed: 0, samples: [] };

    // 2) Revolut редове от файл в сметка, която не отговаря на продукта от файла
    const revolutAccounts = accounts.filter(isRevolutAccount);
    const revolutRows = await database.getFileImportedTransactions(revolutAccounts.map(a => a.id));
    const moves = new Map(); // id → нова сметка (за dry run)
    for (const row of revolutRows.filter(r => r.id.startsWith('REV_'))) {
        const raw = revolutRawFields(row.raw_data);
        if (!raw) continue;
        const kind = productKind(raw['Продукт'] || raw['Product']);
        const currency = (raw['Валута'] || raw['Currency'] || '').toUpperCase();
        if (!kind || kind === 'other' || !currency) continue;

        const account = byId.get(row.account_id);
        const fits = kind === 'savings' ? !account.iban : !!account.iban;
        if (fits && accountCurrency(account) === currency) continue;

        let candidates = revolutAccounts.filter(a => accountCurrency(a) === currency && (kind === 'savings' ? !a.iban : !!a.iban));
        if (candidates.length !== 1) continue;
        moves.set(row.id, candidates[0].id);
        result.importedMoved++;
        if (!dryRun) await database.moveTransactionToAccount(row.id, candidates[0].id);
    }

    // 3) суми без таксата от стари Revolut импорти
    result.feesFixed = await fixRevolutImportFees({ dryRun });

    // 4) дубликати файл ↔ банка (в рамките на една сметка, след преместванията)
    const fileRows = await database.getFileImportedTransactions(accounts.map(a => a.id));
    const fileByAccount = new Map();
    for (const row of fileRows) {
        const accountId = moves.get(row.id) || row.account_id;
        if (!fileByAccount.has(accountId)) fileByAccount.set(accountId, []);
        fileByAccount.get(accountId).push({ ...row, account_id: accountId });
    }

    for (const [accountId, rows] of fileByAccount) {
        const dates = rows.map(r => r.transaction_date).sort();
        const bank = (await database.getTransactionsForMatching([accountId], addDays(dates[0], -1), addDays(dates[dates.length - 1], 1)))
            .filter(isBankRow)
            .map(rowFeatures);
        if (!bank.length) continue;

        const matches = matchTransactions(rows.map(rowFeatures), bank);
        for (const [fileId, bankItem] of matches) {
            result.duplicatesMerged++;
            if (result.samples.length < 20) {
                const row = rows.find(r => r.id === fileId);
                result.samples.push({
                    account: accountLabel(byId.get(accountId)),
                    date: row.transaction_date,
                    amount: row.amount,
                    description: row.description || row.counterparty_name || '',
                    fileId,
                    bankId: bankItem.id
                });
            }
            if (!dryRun) await database.mergeDuplicateTransaction(fileId, bankItem.id);
        }
    }

    // 5) блокирани суми по карти (след обединяването — двойникът може да е и от файл)
    const holds = await removeDskCardHolds({ dryRun }, result.samples, id => accountLabel(byId.get(id)));
    result.cardHoldsRemoved = holds.removed;
    result.cardHoldsUnmatched = holds.unmatched;

    logger.info(`[Reconcile] ${dryRun ? '(dry run) ' : ''}imported moved ${result.importedMoved}, duplicates merged ${result.duplicatesMerged}, card holds removed ${result.cardHoldsRemoved}, fees fixed ${result.feesFixed}`);
    return result;
}

module.exports = {
    localToUtcMs,
    matchTransactions,
    rowFeatures,
    importFeatures,
    resolveRevolutAccounts,
    filterDuplicates,
    moveSameIdToAccounts,
    reconcileImportedTransactions,
    isDskCardHold,
    removeDskCardHolds,
    isRevolutAccount,
    isDskAccount,
    accountLabel
};
