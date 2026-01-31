/**
 * Revolut CSV Import Module
 * Parses CSV files exported from Revolut and converts them to transaction format
 */

const crypto = require('crypto');
const logger = require('./logger');
const { extractCountryFromCounterparty } = require('./country-codes');

// Currency conversion rates to EUR
const CURRENCY_RATES = {
    'BGN': 1.9558,  // Fixed rate
    'EUR': 1,
    'USD': 1.08,    // Approximate, should be updated
    'GBP': 0.85,    // Approximate, should be updated
    'RON': 4.97,    // Approximate
    'PLN': 4.32,    // Approximate
    'CHF': 0.94,    // Approximate
    'CZK': 25.0,    // Approximate
    'HUF': 395.0,   // Approximate
    'TRY': 35.0     // Approximate
};

/**
 * Parse CSV content into rows
 * Handles quoted fields and commas within quotes
 * @param {string} csvContent - Raw CSV content
 * @returns {Array} Array of rows, each row is an array of values
 */
function parseCSV(csvContent) {
    const rows = [];
    const lines = csvContent.split(/\r?\n/);

    for (const line of lines) {
        if (!line.trim()) continue;

        const row = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];

            if (char === '"') {
                if (inQuotes && line[i + 1] === '"') {
                    // Escaped quote
                    current += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (char === ',' && !inQuotes) {
                row.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        row.push(current.trim());
        rows.push(row);
    }

    return rows;
}

/**
 * Parse Revolut CSV format and extract transactions
 * Expected columns: Вид,Продукт,Начална дата,Дата на завършване,Описание,Сума,Такса,Валута,State,Баланс
 * @param {string} csvContent - Raw CSV content
 * @returns {Array} Array of parsed transactions
 */
function parseRevolutCsv(csvContent) {
    const rows = parseCSV(csvContent);

    logger.info(`[Revolut Import] Total rows in CSV: ${rows.length}`);

    if (rows.length < 2) {
        logger.warn('[Revolut Import] CSV file has no data rows');
        return [];
    }

    // Get header row and find column indices
    const header = rows[0].map(h => h.toLowerCase().trim());
    logger.info(`[Revolut Import] Header row: ${JSON.stringify(header)}`);

    // Helper function to find column by multiple possible names
    const findColumn = (...names) => {
        for (const name of names) {
            const idx = header.findIndex(h => h.includes(name.toLowerCase()));
            if (idx !== -1) return idx;
        }
        return -1;
    };

    // Map column names to indices (more flexible matching)
    const columnMap = {
        type: findColumn('вид', 'type'),
        product: findColumn('продукт', 'product'),
        startDate: findColumn('начална дата', 'started date', 'start date'),
        completedDate: findColumn('дата на завършване', 'completed date', 'completion date'),
        description: findColumn('описание', 'description'),
        amount: findColumn('сума', 'amount'),
        fee: findColumn('такса', 'fee'),
        currency: findColumn('валута', 'currency'),
        state: findColumn('state', 'състояние', 'status'),
        balance: findColumn('баланс', 'balance')
    };

    logger.info(`[Revolut Import] Column mapping: ${JSON.stringify(columnMap)}`);

    // Validate required columns exist
    if (columnMap.completedDate === -1 && columnMap.startDate === -1) {
        logger.error('[Revolut Import] No date column found');
        throw new Error('CSV файлът не съдържа колона с дата');
    }
    if (columnMap.amount === -1) {
        logger.error('[Revolut Import] No amount column found');
        throw new Error('CSV файлът не съдържа колона Сума/Amount');
    }

    const transactions = [];
    let skippedByState = 0;
    let skippedByEmpty = 0;
    let skippedByDate = 0;

    // Process data rows (skip header)
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];

        // Skip empty rows
        if (row.length < 3 || !row[columnMap.amount]) {
            skippedByEmpty++;
            continue;
        }

        // Skip pending/failed transactions if State column exists
        if (columnMap.state !== -1) {
            const state = (row[columnMap.state] || '').toLowerCase().trim();
            // Accept: completed, завършен, завършена, завършено
            const isCompleted = !state || state === 'completed' || state.startsWith('завършен');
            if (!isCompleted) {
                skippedByState++;
                continue;
            }
        }

        try {
            const transaction = parseRevolutRow(row, columnMap, i);
            if (transaction) {
                transactions.push(transaction);
            } else {
                skippedByDate++;
            }
        } catch (error) {
            logger.warn(`[Revolut Import] Error parsing row ${i}: ${error.message}`);
        }
    }

    logger.info(`[Revolut Import] Parsed ${transactions.length} transactions. Skipped: empty=${skippedByEmpty}, state=${skippedByState}, date=${skippedByDate}`);
    return transactions;
}

/**
 * Parse a single CSV row into a transaction object
 * @param {Array} row - CSV row values
 * @param {Object} columnMap - Column name to index mapping
 * @param {number} rowIndex - Row index for error reporting
 * @returns {Object} Transaction object
 */
function parseRevolutRow(row, columnMap, rowIndex) {
    // Get values
    const completedDateStr = columnMap.completedDate !== -1 ? row[columnMap.completedDate] : null;
    const startDateStr = columnMap.startDate !== -1 ? row[columnMap.startDate] : null;
    const description = columnMap.description !== -1 ? row[columnMap.description] : '';
    const amountStr = columnMap.amount !== -1 ? row[columnMap.amount] : '0';
    const currency = columnMap.currency !== -1 ? row[columnMap.currency] : 'EUR';

    // Log first few rows for debugging
    if (rowIndex <= 3) {
        logger.info(`[Revolut Import] Row ${rowIndex} raw: completedDate="${completedDateStr}", amount="${amountStr}", currency="${currency}", desc="${description}"`);
    }

    // Parse dates (format: YYYY-MM-DD HH:MM:SS or similar)
    const transactionDate = parseRevolutDate(completedDateStr);
    const bookingDate = parseRevolutDate(startDateStr) || transactionDate;

    if (!transactionDate) {
        logger.warn(`[Revolut Import] Row ${rowIndex}: Invalid date format: "${completedDateStr}"`);
        return null;
    }

    // Parse amount
    const amount = parseRevolutAmount(amountStr);

    if (amount === 0) {
        logger.debug(`[Revolut Import] Row ${rowIndex}: Skipping zero amount transaction`);
        return null;
    }

    // Store entire row as raw data (the original CSV row joined)
    const rawRowString = row.join(',');

    return {
        transactionDate,
        bookingDate,
        description: description.trim(),
        amount,
        currency: currency.toUpperCase(),
        counterpartyName: extractCounterpartyFromDescription(description),
        rawRow: row,           // Keep array for ID generation
        rawRowString           // String for storage
    };
}

/**
 * Parse Revolut date format
 * Supports: "2024-01-15 14:30:25", "2024-01-15", "15 Jan 2024"
 * @param {string} dateStr - Date string
 * @returns {string|null} Date in YYYY-MM-DD format or null
 */
function parseRevolutDate(dateStr) {
    if (!dateStr) return null;

    // Remove time part if present
    let datePart = dateStr.trim().split(' ')[0];

    // Check if already in YYYY-MM-DD format
    if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
        return datePart;
    }

    // Try parsing with Date object
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
        return date.toISOString().split('T')[0];
    }

    return null;
}

/**
 * Parse amount from Revolut format
 * Handles: "123.45", "-123.45", "123,45", "-123,45", "1 234.56"
 * @param {string} amountStr - Amount string
 * @returns {number} Parsed amount
 */
function parseRevolutAmount(amountStr) {
    if (!amountStr) return 0;

    // Remove spaces and handle both comma and dot as decimal separator
    let normalized = String(amountStr)
        .replace(/\s/g, '')        // Remove spaces
        .replace(/,/g, '.');       // Replace comma with dot

    // Handle case where there are multiple dots (thousand separator)
    const parts = normalized.split('.');
    if (parts.length > 2) {
        // Last part is decimal, rest are thousand separators
        const decimal = parts.pop();
        normalized = parts.join('') + '.' + decimal;
    }

    return parseFloat(normalized) || 0;
}

/**
 * Extract counterparty name from description
 * Revolut descriptions often contain the merchant/counterparty name
 * @param {string} description - Transaction description
 * @returns {string} Counterparty name
 */
function extractCounterpartyFromDescription(description) {
    if (!description) return '';

    // Common patterns to clean up
    const cleanPatterns = [
        /^Card payment to /i,
        /^Payment to /i,
        /^Transfer to /i,
        /^Transfer from /i,
        /^From /i,
        /^To /i,
        /^Плащане с карта към /i,
        /^Плащане към /i,
        /^Превод към /i,
        /^Превод от /i
    ];

    let counterparty = description.trim();

    for (const pattern of cleanPatterns) {
        counterparty = counterparty.replace(pattern, '');
    }

    return counterparty.trim();
}

/**
 * Generate a unique transaction ID based on the entire raw row
 * @param {Array} row - The entire CSV row
 * @returns {string} Unique ID in format REV_XXXXXXXXXXXXXXXX
 */
function generateTransactionId(row) {
    // Join entire row to create hash input
    const hashInput = row.join('|');
    const hash = crypto.createHash('md5').update(hashInput).digest('hex');
    return `REV_${hash.substring(0, 16).toUpperCase()}`;
}

/**
 * Process CSV content and prepare transactions for import
 * @param {string} csvContent - Raw CSV content
 * @param {string} accountId - Target account ID
 * @returns {Array} Array of transactions ready for database import
 */
function processCsvForImport(csvContent, accountId) {
    const transactions = parseRevolutCsv(csvContent);

    return transactions.map(tx => {
        // Convert currency to EUR if needed
        let amount = tx.amount;
        let originalAmount = null;
        let originalCurrency = null;

        if (tx.currency !== 'EUR') {
            const rate = CURRENCY_RATES[tx.currency];
            if (rate) {
                originalAmount = amount;
                originalCurrency = tx.currency;
                amount = parseFloat((amount / rate).toFixed(2));
            } else {
                logger.warn(`[Revolut Import] Unknown currency: ${tx.currency}, keeping original amount`);
            }
        }

        // Store raw row as string
        const rawData = tx.rawRowString;

        const transaction = {
            transactionDate: tx.transactionDate,
            bookingDate: tx.bookingDate,
            description: tx.description,
            amount,
            originalAmount,
            originalCurrency,
            currency: 'EUR',
            counterpartyName: tx.counterpartyName,
            accountId,
            rawData
        };

        // Generate unique ID from the entire row
        transaction.id = generateTransactionId(tx.rawRow);

        // Extract country from counterparty name if present
        transaction.country = extractCountryFromCounterparty(tx.counterpartyName);

        return transaction;
    });
}

module.exports = {
    parseRevolutCsv,
    generateTransactionId,
    processCsvForImport
};
