const express = require('express');
const router = express.Router();
const database = require('../database');
const logger = require('../logger');
const categorization = require('../categorization');
const xmlImport = require('../xml-import');
const revolutImport = require('../revolut-import');
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

    let categorizedCount = 0;
    for (const tx of transactions) {
      let categoryId = await categorization.categorizeTransaction({
        description: tx.description,
        counterpartyName: tx.counterpartyName
      });

      if (!categoryId && tx.counterpartyName) {
        categoryId = await database.getCategoryByCounterparty(tx.counterpartyName);
      }

      if (categoryId) {
        tx.categoryId = categoryId;
        categorizedCount++;
      }
    }

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
