/**
 * XML Import Module for DSK Bank transactions
 * Parses XML files exported from DSK Bank and converts them to transaction format
 */

const { XMLParser } = require('fast-xml-parser');
const crypto = require('crypto');
const logger = require('./logger');
const { extractCountryFromCounterparty } = require('./country-codes');

/**
 * Parse DSK Bank XML format and extract transactions
 * @param {string} xmlContent - Raw XML content
 * @returns {Array} Array of parsed transactions
 */
function parseDskBankXml(xmlContent) {
    const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
        textNodeName: '#text',
        parseTagValue: false,
        trimValues: true,
        stopNodes: ['*.Reason'] // Don't parse inner content of Reason element
    });

    const parsed = parser.parse(xmlContent);

    // Handle root element - could be AccountMovements or directly contain AccountMovement
    let movements = [];

    if (parsed.AccountMovements) {
        movements = parsed.AccountMovements.AccountMovement;
    } else if (parsed.AccountMovement) {
        movements = parsed.AccountMovement;
    }

    // Ensure movements is always an array
    if (!Array.isArray(movements)) {
        movements = movements ? [movements] : [];
    }

    logger.info(`[XML Import] Found ${movements.length} movements in XML`);

    return movements.map(movement => parseMovement(movement));
}

/**
 * Parse a single AccountMovement element
 * @param {Object} movement - Parsed XML movement object
 * @returns {Object} Normalized transaction object
 */
function parseMovement(movement) {
    // Convert date from DD.MM.YYYY to YYYY-MM-DD
    const transactionDate = convertDate(movement.ValueDate);

    // Clean description - remove <br/> tags and decode HTML entities
    const description = cleanDescription(movement.Reason || '');

    // Parse amount - convert from "28,98" format to number
    const rawAmount = parseAmount(movement.Amount);

    // Determine sign based on MovementType (Debit = negative, Credit = positive)
    const isDebit = movement.MovementType === 'Debit';
    const amount = isDebit ? -Math.abs(rawAmount) : Math.abs(rawAmount);

    // Get counterparty name
    const counterpartyName = (movement.OppositeSideName || '').trim();

    return {
        transactionDate,
        bookingDate: transactionDate, // Use same date for booking
        description,
        amount,
        counterpartyName,
        rawMovement: movement // Keep original for debugging
    };
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
        logger.warn(`[XML Import] Invalid date format: ${dateStr}`);
        return dateStr;
    }

    const [day, month, year] = parts;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

/**
 * Clean description text - remove HTML tags and decode entities
 * @param {string|object} text - Raw description text (may be object from XML parser)
 * @returns {string} Cleaned description
 */
function cleanDescription(text) {
    if (!text) return '';

    // Handle case where XML parser returns an object
    let textStr = text;
    if (typeof text === 'object') {
        textStr = text['#text'] || JSON.stringify(text);
    }
    textStr = String(textStr);

    return textStr
        .replace(/<br\s*\/?>/gi, ' ') // Replace <br/> with space
        .replace(/<[^>]+>/g, '') // Remove other HTML tags
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ') // Normalize whitespace
        .trim();
}

/**
 * Parse amount from Bulgarian/European format (28,98) to number
 * @param {string} amountStr - Amount in "28,98" format
 * @returns {number} Parsed amount
 */
function parseAmount(amountStr) {
    if (!amountStr) return 0;

    // Handle string with comma as decimal separator
    const normalized = String(amountStr)
        .replace(/\s/g, '') // Remove spaces
        .replace(/,/g, '.'); // Replace comma with dot

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
 * Process XML content and prepare transactions for import
 * @param {string} xmlContent - Raw XML content
 * @param {string} accountId - Target account ID
 * @param {string} currency - Currency (BGN or EUR)
 * @returns {Array} Array of transactions ready for database import
 */
function processXmlForImport(xmlContent, accountId, currency = 'BGN') {
    const movements = parseDskBankXml(xmlContent);

    // Currency conversion rate BGN -> EUR (official fixed rate)
    const BGN_TO_EUR_RATE = 1.9558;

    return movements.map(movement => {
        // Convert currency if needed
        let amount = movement.amount;
        let originalAmount = null;
        let originalCurrency = null;

        if (currency === 'BGN') {
            originalAmount = amount;
            originalCurrency = 'BGN';
            amount = parseFloat((amount / BGN_TO_EUR_RATE).toFixed(2));
        }

        // Store raw XML data as JSON string
        const rawData = JSON.stringify(movement.rawMovement);

        const transaction = {
            ...movement,
            amount,
            originalAmount,
            originalCurrency,
            currency: 'EUR',
            accountId,
            rawData
        };

        // Remove rawMovement as it's now stored in rawData
        delete transaction.rawMovement;

        // Generate unique ID
        transaction.id = generateTransactionId({
            transactionDate: movement.transactionDate,
            description: movement.description,
            amount: movement.amount, // Use original amount for ID consistency
            counterpartyName: movement.counterpartyName
        });

        // Extract country from counterparty name if present
        transaction.country = extractCountryFromCounterparty(movement.counterpartyName);

        return transaction;
    });
}

module.exports = {
    parseDskBankXml,
    generateTransactionId,
    processXmlForImport
};
