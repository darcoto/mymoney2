const express = require('express');
const router = express.Router();
const database = require('../database');
const logger = require('../logger');
const xmlImport = require('../xml-import');
const revolutImport = require('../revolut-import');
const { enrichTransaction, loadRules, clearRulesCache } = require('../transaction-processor');
const { apiError } = require('./helpers');

router.get('/', async (req, res) => {
  try {
    const filters = {
      accountId: req.query.account_id,
      startDate: req.query.start_date,
      endDate: req.query.end_date,
      categoryId: req.query.category_id,
      type: req.query.type,
      search: req.query.search,
      country: req.query.country,
      limit: parseInt(req.query.limit) || 50,
      offset: parseInt(req.query.offset) || 0
    };
    const result = await database.getTransactions(filters);
    res.json(result);
  } catch (error) {
    apiError(res, error);
  }
});

router.get('/stats', async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    const stats = await database.getTransactionStats(start_date, end_date);
    res.json(stats);
  } catch (error) {
    apiError(res, error);
  }
});

router.post('/', async (req, res) => {
  try {
    const { transactionDate, amount, counterpartyName, description, categoryId } = req.body;

    if (!transactionDate || amount === undefined) {
      return res.status(400).json({ error: 'Дата и сума са задължителни' });
    }

    const result = await database.createManualTransaction({
      transactionDate,
      amount: parseFloat(amount),
      counterpartyName: counterpartyName || null,
      description: description || null,
      categoryId: categoryId ? parseInt(categoryId) : null
    });

    res.status(201).json({ success: true, id: result.lastID });
  } catch (error) {
    apiError(res, error);
  }
});

router.put('/:id/category', async (req, res) => {
  try {
    const { categoryId } = req.body;
    await database.updateTransactionCategory(req.params.id, categoryId);
    res.json({ success: true });
  } catch (error) {
    apiError(res, error);
  }
});

router.post('/categorize-by-counterparty', async (req, res) => {
  try {
    const { counterpartyName, categoryId } = req.body;
    const count = await database.categorizeByCounterparty(counterpartyName, categoryId);
    res.json({ success: true, updatedCount: count });
  } catch (error) {
    apiError(res, error);
  }
});

router.put('/:id/notes', async (req, res) => {
  try {
    const { notes } = req.body;
    await database.updateTransactionNotes(req.params.id, notes);
    res.json({ success: true });
  } catch (error) {
    apiError(res, error);
  }
});

router.put('/:id/country', async (req, res) => {
  try {
    const { country } = req.body;
    await database.updateTransactionCountry(req.params.id, country || null);
    res.json({ success: true });
  } catch (error) {
    apiError(res, error);
  }
});

// Re-process a single transaction: re-parse raw_data and re-run enrichment rules
// preview=true (default): returns current vs new values without saving
// preview=false (apply=true): saves changes to DB
const { extractCountryFromCounterparty } = require('../country-codes');
const { categorizeTransaction, loadRules: loadCatRules, clearRulesCache: clearCatRulesCache } = require('../categorization');

const BGN_TO_EUR_RATE = 1.95583;
function convertToEur(amount, currency) {
  if (currency === 'EUR') return amount;
  if (currency === 'BGN') return amount / BGN_TO_EUR_RATE;
  return amount;
}

function parseRawDataToFields(rawData) {
  const tx = JSON.parse(rawData);

  const originalAmount = parseFloat(
    tx.transactionAmount?.amount || tx.transaction_amount?.amount || 0
  );
  const originalCurrency =
    tx.transactionAmount?.currency || tx.transaction_amount?.currency || 'EUR';
  const amountInEur = convertToEur(originalAmount, originalCurrency);

  // Counterparty: GoCardless uses creditorName/debtorName, Enable Banking uses creditor_name/debtor_name
  const counterpartyName =
    originalAmount > 0
      ? (tx.creditorName || tx.creditor_name || '')
      : (tx.debtorName || tx.debtor_name || tx.creditorName || tx.creditor_name || '');

  const description =
    tx.remittanceInformationUnstructured || tx.remittance_information || tx.additionalInformation || '';

  const transactionDate = tx.valueDate || tx.value_date || tx.bookingDate || tx.booking_date;
  const bookingDate = tx.bookingDate || tx.booking_date;

  return {
    transactionDate,
    bookingDate,
    amount: amountInEur,
    currency: 'EUR',
    originalAmount: originalCurrency !== 'EUR' ? originalAmount : null,
    originalCurrency: originalCurrency !== 'EUR' ? originalCurrency : null,
    description,
    counterpartyName
  };
}

router.post('/:id/reprocess', async (req, res) => {
  try {
    const apply = req.body.apply === true;
    const existing = await database.getQuery('SELECT t.*, c.name as category_name, c.color as category_color FROM transactions t LEFT JOIN categories c ON t.category_id = c.id WHERE t.id = ?', [req.params.id]);

    if (!existing) {
      return res.status(404).json({ error: 'Транзакцията не е намерена' });
    }

    if (!existing.raw_data) {
      return res.status(400).json({ error: 'Няма raw данни за тази транзакция' });
    }

    // Re-parse raw_data
    const parsed = parseRawDataToFields(existing.raw_data);

    // Re-run enrichment (country + category)
    const newCountry = extractCountryFromCounterparty(parsed.counterpartyName) || null;

    await loadCatRules();
    const newCategoryId = await categorizeTransaction({
      description: parsed.description,
      counterpartyName: parsed.counterpartyName
    });
    clearCatRulesCache();

    // Get new category info
    let newCategoryName = null, newCategoryColor = null;
    if (newCategoryId) {
      const cat = await database.getQuery('SELECT name, color FROM categories WHERE id = ?', [newCategoryId]);
      if (cat) {
        newCategoryName = cat.name;
        newCategoryColor = cat.color;
      }
    }

    const changes = {
      counterparty_name: { current: existing.counterparty_name, new: parsed.counterpartyName },
      description: { current: existing.description, new: parsed.description },
      amount: { current: existing.amount, new: parsed.amount },
      original_amount: { current: existing.original_amount, new: parsed.originalAmount },
      original_currency: { current: existing.original_currency, new: parsed.originalCurrency },
      transaction_date: { current: existing.transaction_date, new: parsed.transactionDate },
      booking_date: { current: existing.booking_date, new: parsed.bookingDate },
      country: { current: existing.country, new: newCountry },
      category_id: {
        current: existing.category_id,
        currentName: existing.category_name,
        currentColor: existing.category_color,
        new: newCategoryId,
        newName: newCategoryName,
        newColor: newCategoryColor
      }
    };

    if (apply) {
      // Apply all parsed + enriched fields
      await database.runQuery(
        `UPDATE transactions SET
          transaction_date = ?, booking_date = ?, amount = ?, currency = ?,
          description = ?, counterparty_name = ?,
          original_amount = ?, original_currency = ?,
          country = ?, category_id = ?
         WHERE id = ?`,
        [
          parsed.transactionDate, parsed.bookingDate, parsed.amount, parsed.currency,
          parsed.description, parsed.counterpartyName,
          parsed.originalAmount, parsed.originalCurrency,
          newCountry, newCategoryId,
          req.params.id
        ]
      );
      res.json({ success: true, changes });
    } else {
      res.json({ success: true, preview: true, changes });
    }
  } catch (error) {
    apiError(res, error);
  }
});

// Import transactions from file (auto-detect parser based on account institution)
router.post('/import-file', async (req, res) => {
  try {
    const { fileContent, accountId, currency } = req.body;

    if (!fileContent) {
      return res.status(400).json({ error: 'Съдържанието на файла е задължително' });
    }
    if (!accountId) {
      return res.status(400).json({ error: 'Сметката е задължителна' });
    }

    const account = await database.getAccountById(accountId);
    if (!account) {
      return res.status(404).json({ error: 'Сметката не е намерена' });
    }

    const institutionName = (account.institution_name || '').toUpperCase();
    let transactions = [];
    let parserName = '';

    if (institutionName.includes('DSK')) {
      parserName = 'DSK Bank (XML)';
      transactions = xmlImport.processXmlForImport(fileContent, accountId, currency || 'BGN');
    } else if (institutionName.includes('REVOLUT')) {
      parserName = 'Revolut (CSV)';
      transactions = revolutImport.processCsvForImport(fileContent, accountId);
    } else {
      return res.status(400).json({
        error: `Не се поддържа импорт за банка "${account.institution_name}". Поддържани банки: DSK Bank, Revolut`
      });
    }

    logger.info(`[File Import] Using parser: ${parserName} for account ${accountId}`);

    if (transactions.length === 0) {
      return res.json({
        success: true,
        imported: 0,
        skipped: 0,
        categorized: 0,
        errors: [],
        total: 0,
        parser: parserName,
        message: 'Няма намерени транзакции във файла'
      });
    }

    await loadRules();
    let categorizedCount = 0;
    for (const tx of transactions) {
      await enrichTransaction(tx);
      if (tx.categoryId) categorizedCount++;
    }
    clearRulesCache();

    const results = await database.importTransactionsBatch(transactions);

    logger.info(`[File Import] ${parserName}: Imported ${results.imported}, skipped ${results.skipped}, categorized ${categorizedCount}, errors: ${results.errors.length}`);

    res.json({
      success: true,
      imported: results.imported,
      skipped: results.skipped,
      categorized: categorizedCount,
      errors: results.errors,
      total: transactions.length,
      parser: parserName
    });
  } catch (error) {
    logger.error(`[File Import] Error: ${error.message}`);
    apiError(res, error);
  }
});

module.exports = router;
