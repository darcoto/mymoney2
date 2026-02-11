const database = require('./database');
const logger = require('./logger');

// Cached rules (call loadRules() to populate, cleared after use)
let cachedRules = null;

/**
 * Load and cache active categorization rules sorted by priority.
 * Call once before a batch of categorizeTransaction() calls, then clearRulesCache().
 */
async function loadRules() {
  const rules = await database.getAllCategorizationRules();
  cachedRules = rules.filter(rule => rule.active).sort((a, b) => b.priority - a.priority);
  return cachedRules;
}

function clearRulesCache() {
  cachedRules = null;
}

/**
 * Match a transaction against a set of rules (pure logic, no DB call).
 */
function matchRules(transaction, rules) {
  const searchText = [
    transaction.description || '',
    transaction.counterpartyName || transaction.counterparty_name || ''
  ].join(' ').toUpperCase();

  for (const rule of rules) {
    const patterns = rule.pattern.toUpperCase().split('|');
    for (const p of patterns) {
      const trimmed = p.trim();
      if (trimmed && searchText.includes(trimmed)) {
        return rule.category_id;
      }
    }
  }
  return null;
}

/**
 * Automatically categorize a transaction based on rules.
 * Uses cached rules if available, otherwise loads from DB.
 */
async function categorizeTransaction(transaction) {
  try {
    const rules = cachedRules || await loadRules();
    return matchRules(transaction, rules);
  } catch (error) {
    logger.error('Error categorizing transaction:', error.message);
    return null;
  }
}

/**
 * Apply categorization rules to all uncategorized transactions
 */
async function applyRulesToUncategorized() {
  try {
    const rules = await loadRules();
    const result = await database.getTransactions({ categoryId: 'uncategorized', limit: 10000 });
    const transactions = result.transactions || result;

    const totalUncategorized = transactions.length;
    let categorizedCount = 0;

    for (const transaction of transactions) {
      let categoryId = matchRules(transaction, rules);

      if (!categoryId && (transaction.counterparty_name || transaction.counterpartyName)) {
        categoryId = await database.getCategoryByCounterparty(
          transaction.counterparty_name || transaction.counterpartyName
        );
      }

      if (categoryId) {
        await database.updateTransactionCategory(transaction.id, categoryId);
        categorizedCount++;
      }
    }

    clearRulesCache();
    return { totalUncategorized, categorizedCount };
  } catch (error) {
    clearRulesCache();
    logger.error('Error applying rules to uncategorized transactions:', error.message);
    throw error;
  }
}

/**
 * Get categorization suggestions for a transaction
 */
async function getSuggestions(transaction) {
  try {
    const rules = cachedRules || await loadRules();

    const searchText = [
      transaction.description || '',
      transaction.counterpartyName || ''
    ].join(' ').toUpperCase();

    const suggestions = [];

    for (const rule of rules) {
      const patterns = rule.pattern.toUpperCase().split('|');
      for (const p of patterns) {
        const trimmed = p.trim();
        if (trimmed && searchText.includes(trimmed)) {
          suggestions.push({
            categoryId: rule.category_id,
            categoryName: rule.category_name,
            color: rule.category_color,
            confidence: rule.priority / 10.0,
            matchedPattern: trimmed
          });
        }
      }
    }

    suggestions.sort((a, b) => b.confidence - a.confidence);
    return suggestions;
  } catch (error) {
    logger.error('Error getting categorization suggestions:', error.message);
    return [];
  }
}

module.exports = {
  categorizeTransaction,
  applyRulesToUncategorized,
  getSuggestions,
  loadRules,
  clearRulesCache
};
