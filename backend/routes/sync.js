const express = require('express');
const router = express.Router();
const database = require('../database');
const logger = require('../logger');
const providerRegistry = require('../providers/provider-registry');
const { apiError } = require('./helpers');

router.post('/accounts', async (req, res) => {
  try {
    const configuredProviders = await providerRegistry.getConfiguredProviders();
    const allSyncedAccounts = [];

    for (const provider of configuredProviders) {
      try {
        const accounts = await provider.syncAllAccounts();
        allSyncedAccounts.push(...accounts);
      } catch (error) {
        logger.error(`Error syncing accounts for provider ${provider.name}:`, error.message);
      }
    }

    res.json({ success: true, accounts: allSyncedAccounts, count: allSyncedAccounts.length });
  } catch (error) {
    apiError(res, error);
  }
});

router.post('/transactions', async (req, res) => {
  try {
    const accounts = await database.getAllAccounts();
    const configuredProviders = await providerRegistry.getConfiguredProviders();
    const providerMap = {};
    for (const p of configuredProviders) {
      providerMap[p.id] = p;
    }

    let totalSynced = 0;
    const byAccount = [];

    for (const account of accounts) {
      if (account.id === 'CASH') continue;

      const provider = providerMap[account.provider_id];
      if (!provider) {
        const gcProvider = configuredProviders.find(p => p.type === 'gocardless');
        if (!gcProvider) continue;
        try {
          const count = await gcProvider.syncAccountTransactions(account.id);
          totalSynced += count;
          byAccount.push({
            accountId: account.id,
            accountName: account.custom_name || account.name,
            institutionName: account.institution_name,
            count: count
          });
        } catch (error) {
          logger.error(`Error syncing account ${account.id}:`, error.message);
          byAccount.push({
            accountId: account.id,
            accountName: account.custom_name || account.name,
            institutionName: account.institution_name,
            count: 0,
            error: error.message
          });
        }
        continue;
      }

      try {
        const count = await provider.syncAccountTransactions(account.id);
        totalSynced += count;
        byAccount.push({
          accountId: account.id,
          accountName: account.custom_name || account.name,
          institutionName: account.institution_name,
          count: count
        });
      } catch (error) {
        logger.error(`Error syncing account ${account.id}:`, error.message);
        byAccount.push({
          accountId: account.id,
          accountName: account.custom_name || account.name,
          institutionName: account.institution_name,
          count: 0,
          error: error.message
        });
      }
    }

    res.json({ success: true, transactionsSynced: totalSynced, byAccount });
  } catch (error) {
    apiError(res, error);
  }
});

module.exports = router;
