const express = require('express');
const router = express.Router();
const database = require('../database');
const countryUtils = require('../country-codes');
const insights = require('../insights');
const { apiError } = require('./helpers');

router.get('/monthly', async (req, res) => {
  try {
    const { year, month, category_id } = req.query;

    let types = req.query.types;
    if (!types) {
      types = null;
    } else if (!Array.isArray(types)) {
      types = [types];
    }

    const report = await database.getMonthlyReport(year, month, types, category_id);
    res.json(report);
  } catch (error) {
    apiError(res, error);
  }
});

// Транзакциите зад ред от справка (по контрагент или по сметка) — същите филтри като /monthly
router.get('/transactions', async (req, res) => {
  try {
    const { year, month, category_id, counterparty, account_id, country } = req.query;

    let types = req.query.types;
    if (!types) {
      types = null;
    } else if (!Array.isArray(types)) {
      types = [types];
    }

    const transactions = await database.getReportTransactions(year, month, types, category_id, {
      counterparty,
      accountId: account_id,
      country
    });
    res.json(transactions);
  } catch (error) {
    apiError(res, error);
  }
});

router.get('/last-12-months', async (req, res) => {
  try {
    const report = await database.getLast12MonthsReport();
    res.json(report);
  } catch (error) {
    apiError(res, error);
  }
});

router.get('/category-breakdown', async (req, res) => {
  try {
    const { start_date, end_date, type } = req.query;
    const types = type ? [type] : null;
    const breakdown = await database.getCategoryBreakdown(start_date, end_date, types);
    res.json(breakdown);
  } catch (error) {
    apiError(res, error);
  }
});

router.get('/counterparty', async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    const report = await database.getCounterpartyReport(start_date, end_date);
    res.json(report);
  } catch (error) {
    apiError(res, error);
  }
});

router.get('/country', async (req, res) => {
  try {
    let types = req.query.types;
    if (!types) {
      types = ['expense'];
    } else if (!Array.isArray(types)) {
      types = [types];
    }

    const categoryId = req.query.category_id || null;

    const report = await database.getCountryReport(types, categoryId);
    const enrichedCountries = report.countries.map(country => {
      const info = countryUtils.getCountryInfo(country.code);
      return {
        ...country,
        name: info?.name || country.code,
        flag: info?.flag || ''
      };
    });
    res.json({
      years: report.years,
      countries: enrichedCountries
    });
  } catch (error) {
    apiError(res, error);
  }
});

// ─── Аналитични справки (backend/insights.js) ────────────────────────────────

router.get('/cash-flow', async (req, res) => {
  try {
    const months = Math.min(Math.max(parseInt(req.query.months, 10) || 24, 3), 60);
    res.json(await insights.getCashFlow(months));
  } catch (error) {
    apiError(res, error);
  }
});

router.get('/recurring', async (req, res) => {
  try {
    res.json(await insights.getRecurringPayments());
  } catch (error) {
    apiError(res, error);
  }
});

router.get('/year-comparison', async (req, res) => {
  try {
    const now = new Date();
    const year = parseInt(req.query.year, 10) || now.getFullYear();
    const month = Math.min(Math.max(parseInt(req.query.month, 10) || now.getMonth() + 1, 1), 12);
    const mode = req.query.mode === 'ytd' ? 'ytd' : 'month';
    res.json(await insights.getYearComparison(year, month, mode));
  } catch (error) {
    apiError(res, error);
  }
});

router.get('/bank-costs', async (req, res) => {
  try {
    res.json(await insights.getBankCosts());
  } catch (error) {
    apiError(res, error);
  }
});

router.get('/trips', async (req, res) => {
  try {
    res.json(await insights.getTrips());
  } catch (error) {
    apiError(res, error);
  }
});

router.get('/category-monthly', async (req, res) => {
  try {
    let types = req.query.types;
    if (!types) {
      types = ['expense'];
    } else if (!Array.isArray(types)) {
      types = [types];
    }

    const report = await database.getCategoryMonthlyReport(types);
    res.json(report);
  } catch (error) {
    apiError(res, error);
  }
});

module.exports = router;
