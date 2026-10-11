/**
 * Common transaction processing — categorization + country extraction.
 * Called before saving, shared by all providers and import routes.
 */
const database = require('./database');
const { categorizeTransaction, loadRules, clearRulesCache } = require('./categorization');
const { extractCountryFromCounterparty } = require('./country-codes');
const logger = require('./logger');

/**
 * Enrich a single transaction with category and country.
 * Expects rules to be pre-loaded via loadRules().
 */
async function enrichTransaction(transaction) {
  // Extract country from counterparty name
  if (!transaction.country) {
    transaction.country = extractCountryFromCounterparty(transaction.counterpartyName);
  }

  // Auto-categorize (rules, then counterparty history)
  if (!transaction.categoryId) {
    let categoryId = await categorizeTransaction(transaction);
    if (!categoryId && transaction.counterpartyName) {
      categoryId = await database.getCategoryByCounterparty(transaction.counterpartyName);
    }
    transaction.categoryId = categoryId;
  }

  return transaction;
}

/**
 * Process and save a batch of transactions.
 * Handles: load rules → enrich each tx → upsert → clear cache.
 * Returns { newCount, total }.
 */
async function processTransactionBatch(transactions) {
  await loadRules();
  let newCount = 0;

  for (const tx of transactions) {
    try {
      await enrichTransaction(tx);
      const result = await database.upsertTransaction(tx);
      if (result.isNew) newCount++;
    } catch (error) {
      logger.error(`Error processing transaction ${tx.id}:`, error.message);
    }
  }

  clearRulesCache();
  return { newCount, total: transactions.length };
}

module.exports = { enrichTransaction, processTransactionBatch, loadRules, clearRulesCache };
