/**
 * Импорт на извлечения от Банка ДСК — експортът „Excel“ (.xls) от онлайн банкирането.
 * Всъщност е HTML таблица; съдържа номер и валута на сметката, вид на трансакцията,
 * референция, валутен курс и сума във валутата на превода.
 * ID-тата (DSK_ + хеш) са същите като при стария XML импорт — вече импортираните
 * транзакции се разпознават и не се дублират.
 */

const crypto = require('crypto');
const logger = require('./logger');

// Официален фиксиран курс BGN → EUR
const BGN_TO_EUR_RATE = 1.95583;
// От тази дата сметките в ДСК са в евро; по-старите извлечения са в лева
const EURO_ADOPTION_DATE = '2026-01-01';

/**
 * Parse DSK „Excel“ export (HTML table)
 * @param {string} htmlContent - Raw file content
 * @returns {{ account: { number, name, currency }, transactions: Array, totals: { debit, credit } | null }}
 */
function parseDskBankHtml(htmlContent) {
    const rows = [...htmlContent.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
        .map(m => [...m[1].matchAll(/<td\b[^>]*?(?:\/>|>([\s\S]*?)<\/td>)/gi)]
            .map(c => c[1] || ''));

    const headerIndex = rows.findIndex(cells => {
        const texts = cells.map(cellText);
        return texts.includes('Дата') && texts.includes('Основание');
    });
    if (headerIndex === -1) {
        throw new Error('Файлът не прилича на извлечение от ДСК (липсва заглавен ред Дата/Основание)');
    }

    const header = rows[headerIndex].map(cellText);
    const col = (prefix) => header.findIndex(h => h.toLowerCase().startsWith(prefix.toLowerCase()));
    const columns = {
        date: col('Дата'),
        reason: col('Основание'),
        counterparty: col('Наредител'),
        counterpartyAccount: col('Номер сметка'),
        type: col('Вид на трансакцията'),
        reference: col('Свързваща референция'),
        rate: col('Валутен курс'),
        foreignAmount: col('Сума във валутата'),
        debit: col('Дебит'),
        credit: col('Кредит')
    };
    if (columns.debit === -1 || columns.credit === -1) {
        throw new Error('Липсват колоните Дебит/Кредит в извлечението от ДСК');
    }

    // Валутата е в заглавието на колоната: „Дебит EUR“
    const currencyMatch = header[columns.debit].match(/\b([A-Z]{3})\b/);

    // Първият ред съдържа името и номера на сметката: „РАЗПЛАЩАТЕЛНА СМЕТКА - EUR 24841525 (EUR)“
    const title = rows.slice(0, headerIndex).map(cells => cells.map(cellText).join(' ')).find(t => /\d{6,}/.test(t)) || '';
    const numberMatch = title.match(/(\d{6,})/);
    const titleCurrency = title.match(/\(([A-Z]{3})\)/);
    const account = {
        number: numberMatch ? numberMatch[1] : null,
        name: title.replace(/\(([A-Z]{3})\)/, '').replace(/\d{6,}/, '').trim() || null,
        currency: (titleCurrency && titleCurrency[1]) || (currencyMatch && currencyMatch[1]) || null
    };

    const transactions = [];
    let totals = null;

    for (const cells of rows.slice(headerIndex + 1)) {
        const texts = cells.map(cellText);
        const date = texts[columns.date] || '';

        if (!/^\d{2}\.\d{2}\.\d{4}$/.test(date)) {
            // Ред „Общо“ — за проверка, че сме прочели всичко
            const totalIdx = texts.findIndex(t => t === 'Общо');
            if (totalIdx !== -1) {
                const numbers = texts.slice(totalIdx + 1).map(parseAmount);
                totals = { debit: numbers[0] || 0, credit: numbers[1] || 0 };
            }
            continue;
        }

        const debit = parseAmount(texts[columns.debit]);
        const credit = parseAmount(texts[columns.credit]);
        const isDebit = debit !== 0;
        const amount = isDebit ? -Math.abs(debit) : Math.abs(credit);
        const get = (idx) => (idx === -1 ? '' : texts[idx] || '');

        // Ключовете са като в стария XML формат, за да изглеждат еднакво в детайлите
        const raw = {
            ValueDate: date,
            Reason: decodeEntities(cells[columns.reason] || '').trim(),
            OppositeSideName: get(columns.counterparty),
            OppositeSideAccount: get(columns.counterpartyAccount),
            MovementType: isDebit ? 'Debit' : 'Credit',
            Amount: texts[isDebit ? columns.debit : columns.credit],
            TransactionType: get(columns.type),
            Reference: get(columns.reference),
            ExchangeRate: get(columns.rate),
            ForeignAmount: get(columns.foreignAmount),
            Currency: account.currency
        };
        Object.keys(raw).forEach(key => { if (raw[key] === '' || raw[key] == null) delete raw[key]; });

        const description = cleanDescription(cells[columns.reason] || '');
        transactions.push({
            transactionDate: convertDate(date),
            bookingDate: convertDate(date),
            description,
            amount,
            // Само trim (без сливане на интервалите) — както в стария XML импорт, за еднакви ID-та
            counterpartyName: decodeEntities((columns.counterparty === -1 ? '' : cells[columns.counterparty]) || '').replace(/<[^>]+>/g, '').trim(),
            raw,
            // Неосчетоводено картово плащане (блокирана сума): без вид на трансакцията,
            // описание „<карта> ПОС <дата> ...“. Осчетоводеното идва по-късно с друга дата и текст.
            pending: !raw.TransactionType && /^\d{6}x{6}\d{4}\s/i.test(description)
        });
    }

    logger.info(`[DSK Import] Found ${transactions.length} movements in XLS for account ${account.number} (${account.currency})`);

    if (totals) {
        const sumDebit = transactions.filter(t => t.amount < 0).reduce((s, t) => s - t.amount, 0);
        const sumCredit = transactions.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
        if (Math.abs(sumDebit - totals.debit) > 0.005 || Math.abs(sumCredit - totals.credit) > 0.005) {
            logger.warn(`[DSK Import] Totals mismatch: file debit ${totals.debit} / credit ${totals.credit}, parsed ${sumDebit.toFixed(2)} / ${sumCredit.toFixed(2)}`);
            throw new Error(`Сборовете не съвпадат с реда „Общо“ във файла (дебит ${totals.debit}, кредит ${totals.credit}) — файлът вероятно е непълен или с променен формат`);
        }
    }

    return { account, transactions, totals };
}

function cellText(html) {
    return cleanDescription(html);
}

function decodeEntities(text) {
    return String(text)
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
        .replace(/&amp;/g, '&');
}

/**
 * Convert date from DD.MM.YYYY to YYYY-MM-DD format
 * @param {string} dateStr - Date in DD.MM.YYYY format
 * @returns {string} Date in YYYY-MM-DD format
 */
function convertDate(dateStr) {
    if (!dateStr) return null;

    const parts = dateStr.split('.');
    if (parts.length !== 3) {
        logger.warn(`[DSK Import] Invalid date format: ${dateStr}`);
        return dateStr;
    }

    const [day, month, year] = parts;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

/**
 * Clean description text - remove HTML tags and decode entities
 * @param {string} text - Raw description text (HTML)
 * @returns {string} Cleaned description
 */
function cleanDescription(text) {
    if (!text) return '';

    return decodeEntities(
        String(text)
            .replace(/<br\s*\/?>/gi, ' ') // Replace <br/> with space
            .replace(/&lt;br\s*\/?&gt;/gi, ' ')
            .replace(/<[^>]+>/g, '') // Remove other HTML tags
    )
        .replace(/\s+/g, ' ') // Normalize whitespace
        .trim();
}

/**
 * Parse amount from Bulgarian/European format ("1 234,56") to number
 * @param {string} amountStr
 * @returns {number}
 */
function parseAmount(amountStr) {
    if (!amountStr) return 0;

    const normalized = String(amountStr)
        .replace(/[\s ]/g, '') // Remove spaces (incl. nbsp — разделител за хилядите)
        .replace(/,/g, '.');

    return parseFloat(normalized) || 0;
}

/**
 * Generate a unique transaction ID based on transaction data
 * Uses MD5 hash of key fields to create deterministic ID
 * @param {Object} transaction - Transaction object
 * @returns {string} Unique ID in format DSK_XXXXXXXXXXXXXXXX
 */
function generateTransactionId(transaction) {
    const hashInput = [
        transaction.transactionDate,
        transaction.description,
        transaction.amount.toFixed(2),
        transaction.counterpartyName
    ].join('|');

    const hash = crypto.createHash('md5').update(hashInput).digest('hex');
    return `DSK_${hash.substring(0, 16).toUpperCase()}`;
}

/**
 * Валута на транзакцията: изрична (BGN/EUR) или 'auto' — по датата
 * (преди въвеждането на еврото извлеченията са в лева)
 */
function resolveCurrency(currency, transactionDate) {
    if (currency === 'BGN' || currency === 'EUR') return currency;
    return transactionDate < EURO_ADOPTION_DATE ? 'BGN' : 'EUR';
}

/**
 * Нормализирани транзакции → обекти за запис в базата (EUR + оригинал, ID, raw_data)
 */
function toImportTransactions(movements, accountId, currency) {
    // Две напълно еднакви движения в един ден (напр. две такси по 0,30) иначе биха
    // получили едно и също ID — второто получава суфикс, за да не се „слее“ с първото
    const seen = new Map();

    return movements.map(movement => {
        const movementCurrency = resolveCurrency(currency, movement.transactionDate);
        let amount = movement.amount;
        let originalAmount = null;
        let originalCurrency = null;

        if (movementCurrency === 'BGN') {
            originalAmount = amount;
            originalCurrency = 'BGN';
            amount = parseFloat((amount / BGN_TO_EUR_RATE).toFixed(2));
        }

        // ID от оригиналната сума (за съвместимост с по-ранни импорти)
        let id = generateTransactionId(movement);
        const count = seen.get(id) || 0;
        seen.set(id, count + 1);
        if (count > 0) id = `${id}_${count + 1}`;

        return {
            id,
            transactionDate: movement.transactionDate,
            bookingDate: movement.bookingDate,
            description: movement.description,
            amount,
            originalAmount,
            originalCurrency,
            currency: 'EUR',
            counterpartyName: movement.counterpartyName,
            accountId,
            rawData: JSON.stringify(movement.raw)
        };
    });
}

/**
 * XLS (HTML) → { account, transactions, pending } — валутата се взима от файла;
 * неосчетоводените картови плащания се пропускат (pending — брой)
 */
function processHtmlForImport(htmlContent, accountId = null) {
    const { account, transactions } = parseDskBankHtml(htmlContent);
    const currency = account.currency || 'auto';
    const booked = transactions.filter(t => !t.pending);
    return {
        account,
        transactions: toImportTransactions(booked, accountId, currency),
        pending: transactions.length - booked.length
    };
}

function isDskHtml(content) {
    const head = content.slice(0, 5000);
    return /<html/i.test(head) && /DAIS\.eBank/.test(head);
}

module.exports = {
    BGN_TO_EUR_RATE,
    parseDskBankHtml,
    generateTransactionId,
    processHtmlForImport,
    isDskHtml
};
