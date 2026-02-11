const express = require('express');
const database = require('../database');
const categorization = require('../categorization');
const countryUtils = require('../country-codes');
const { apiError } = require('./helpers');

// Category CRUD router (mounted at /api/categories)
const categoryRouter = express.Router();

categoryRouter.get('/', async (req, res) => {
  try {
    const categories = await database.getAllCategories();
    res.json(categories);
  } catch (error) {
    apiError(res, error);
  }
});

categoryRouter.post('/', async (req, res) => {
  try {
    const { name, type, color, icon, parentId } = req.body;
    const id = await database.createCategory({ name, type, color, icon, parentId });
    res.status(201).json({ id, success: true });
  } catch (error) {
    apiError(res, error);
  }
});

categoryRouter.put('/:id', async (req, res) => {
  try {
    const { name, type, color, icon, parentId } = req.body;
    await database.updateCategory(req.params.id, { name, type, color, icon, parentId });
    res.json({ success: true });
  } catch (error) {
    apiError(res, error);
  }
});

categoryRouter.delete('/:id', async (req, res) => {
  try {
    await database.deleteCategory(req.params.id);
    res.json({ success: true });
  } catch (error) {
    apiError(res, error);
  }
});

// Categorization rules router (mounted at /api/categorization-rules)
const rulesRouter = express.Router();

rulesRouter.get('/', async (req, res) => {
  try {
    const rules = await database.getAllCategorizationRules();
    res.json(rules);
  } catch (error) {
    apiError(res, error);
  }
});

rulesRouter.post('/', async (req, res) => {
  try {
    const { pattern, categoryId, priority } = req.body;
    const id = await database.createCategorizationRule({ pattern, categoryId, priority });
    res.status(201).json({ id, success: true });
  } catch (error) {
    apiError(res, error);
  }
});

rulesRouter.put('/:id', async (req, res) => {
  try {
    const { pattern, categoryId, priority, active } = req.body;
    await database.updateCategorizationRule(req.params.id, { pattern, categoryId, priority, active });
    res.json({ success: true });
  } catch (error) {
    apiError(res, error);
  }
});

rulesRouter.delete('/:id', async (req, res) => {
  try {
    await database.deleteCategorizationRule(req.params.id);
    res.json({ success: true });
  } catch (error) {
    apiError(res, error);
  }
});

rulesRouter.post('/apply', async (req, res) => {
  try {
    const result = await categorization.applyRulesToUncategorized();

    const transactionsWithoutCountry = await database.getTransactionsWithoutCountry();
    let countriesExtracted = 0;

    for (const tx of transactionsWithoutCountry) {
      const country = countryUtils.extractCountryFromCounterparty(tx.counterparty_name);
      if (country) {
        await database.updateTransactionCountry(tx.id, country);
        countriesExtracted++;
      }
    }

    res.json({
      success: true,
      ...result,
      countriesExtracted,
      totalWithoutCountry: transactionsWithoutCountry.length
    });
  } catch (error) {
    apiError(res, error);
  }
});

module.exports = { categoryRouter, rulesRouter };
