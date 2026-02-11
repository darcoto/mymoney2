const express = require('express');
const router = express.Router();
const database = require('../database');
const { apiError } = require('./helpers');

router.get('/', async (req, res) => {
  try {
    const accounts = await database.getAllAccounts();
    res.json(accounts);
  } catch (error) {
    apiError(res, error);
  }
});

router.get('/by-institution/:pattern', async (req, res) => {
  try {
    const accounts = await database.getAccountsByInstitution(req.params.pattern);
    res.json(accounts);
  } catch (error) {
    apiError(res, error);
  }
});

router.get('/:id', async (req, res) => {
  try {
    const account = await database.getAccountById(req.params.id);
    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }
    res.json(account);
  } catch (error) {
    apiError(res, error);
  }
});

router.put('/:id/name', async (req, res) => {
  try {
    const { customName } = req.body;
    await database.updateAccountCustomName(req.params.id, customName);
    res.json({ success: true });
  } catch (error) {
    apiError(res, error);
  }
});

module.exports = router;
