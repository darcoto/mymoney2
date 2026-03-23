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

router.post('/run', async (req, res) => {
  const { mode } = req.body; // 'accounts' | 'transactions' | 'both'

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (msg) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(msg)}\n\n`);
  };

  try {
    const configuredProviders = await providerRegistry.getConfiguredProviders();

    if (configuredProviders.length === 0) {
      send({ type: 'error', text: 'Няма конфигурирани провайдери' });
      res.end();
      return;
    }

    let totalAccountsSynced = 0;
    let totalTxSynced = 0;

    // --- Sync accounts ---
    if (mode === 'accounts' || mode === 'both') {
      for (const provider of configuredProviders) {
        send({ type: 'step', icon: '🔄', text: `${provider.name}: зарежда сметки...` });
        try {
          const accounts = await provider.syncAllAccounts();
          totalAccountsSynced += accounts.length;
          send({ type: 'step', icon: '✅', text: `${provider.name}: ${accounts.length} сметки синхронизирани` });
        } catch (error) {
          send({ type: 'step', icon: '❌', text: `${provider.name}: ${error.message}` });
        }
      }
    }

    // --- Sync transactions ---
    if (mode === 'transactions' || mode === 'both') {
      const accounts = await database.getAllAccounts();
      const providerMap = {};
      for (const p of configuredProviders) { providerMap[p.id] = p; }

      const syncableAccounts = accounts.filter(a => a.id !== 'CASH');

      if (syncableAccounts.length === 0) {
        send({ type: 'step', icon: '⚠️', text: 'Няма сметки за синхронизация на транзакции' });
      }

      for (const account of syncableAccounts) {
        const provider = providerMap[account.provider_id]
          || configuredProviders.find(p => p.type === 'gocardless');
        if (!provider) continue;

        const name = account.custom_name || account.name;
        send({ type: 'step', icon: '🔄', text: `${name}...` });

        try {
          const count = await provider.syncAccountTransactions(account.id);
          totalTxSynced += count;
          const icon = count > 0 ? '✅' : '➖';
          send({ type: 'step', icon, text: `${name}: ${count} нови транзакции` });
        } catch (error) {
          send({ type: 'step', icon: '❌', text: `${name}: ${error.message}` });
        }
      }
    }

    send({ type: 'done', accountsSynced: totalAccountsSynced, transactionsSynced: totalTxSynced, mode });

  } catch (error) {
    logger.error('Sync /run error:', error.message);
    send({ type: 'error', text: error.message });
  }

  res.end();
});

module.exports = router;
