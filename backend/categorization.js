const database = require('./database');
const logger = require('./logger');

/**
 * Automatically categorize a transaction based on rules
 * @param {Object} transaction - Transaction object with description and counterpartyName
 * @returns {Number|null} - Category ID or null if no match
 */
async function categorizeTransaction(transaction) {
  try {
    // Get all active categorization rules
    const rules = await database.getAllCategorizationRules();

    // Filter only active rules
    const activeRules = rules.filter(rule => rule.active);

    // Sort by priority (highest first)
    activeRules.sort((a, b) => b.priority - a.priority);

    // Build search text from description and counterparty
    const searchText = [
      transaction.description || '',
      transaction.counterpartyName || ''
    ].join(' ').toUpperCase();

    // Try to match each rule
    for (const rule of activeRules) {
      const pattern = rule.pattern.toUpperCase();
      const patterns = pattern.split('|'); // Support OR patterns

      for (const p of patterns) {
        const trimmedPattern = p.trim();
        if (trimmedPattern && searchText.includes(trimmedPattern)) {
          return rule.category_id;
        }
      }
    }

    // No match found
    return null;
  } catch (error) {
    console.error('Error categorizing transaction:', error.message);
    return null;
  }
}

/**
 * Apply categorization rules to all uncategorized transactions
 * @returns {Object} - { totalUncategorized, categorizedCount }
 */
async function applyRulesToUncategorized() {
  try {
    // Get all uncategorized transactions (no pagination limit)
    const result = await database.getTransactions({ categoryId: 'uncategorized', limit: 10000 });
    const transactions = result.transactions || result;

    const totalUncategorized = transactions.length;
    let categorizedCount = 0;

    for (const transaction of transactions) {
      // First try categorization rules
      let categoryId = await categorizeTransaction(transaction);

      // If no rule matched, try to get category from previous transaction with same counterparty
      if (!categoryId && transaction.counterparty_name) {
        categoryId = await database.getCategoryByCounterparty(transaction.counterparty_name);
      }

      if (categoryId) {
        await database.updateTransactionCategory(transaction.id, categoryId);
        categorizedCount++;
      }
    }

    return { totalUncategorized, categorizedCount };
  } catch (error) {
    console.error('Error applying rules to uncategorized transactions:', error.message);
    throw error;
  }
}

/**
 * Get categorization suggestions for a transaction
 * @param {Object} transaction - Transaction object
 * @returns {Array} - Array of suggested categories with confidence scores
 */
async function getSuggestions(transaction) {
  try {
    const rules = await database.getAllCategorizationRules();
    const activeRules = rules.filter(rule => rule.active);

    const searchText = [
      transaction.description || '',
      transaction.counterpartyName || ''
    ].join(' ').toUpperCase();

    const suggestions = [];

    for (const rule of activeRules) {
      const pattern = rule.pattern.toUpperCase();
      const patterns = pattern.split('|');

      for (const p of patterns) {
        const trimmedPattern = p.trim();
        if (trimmedPattern && searchText.includes(trimmedPattern)) {
          suggestions.push({
            categoryId: rule.category_id,
            categoryName: rule.category_name,
            color: rule.category_color,
            confidence: rule.priority / 10.0, // Normalize priority to 0-1 range
            matchedPattern: trimmedPattern
          });
        }
      }
    }

    // Sort by confidence (priority)
    suggestions.sort((a, b) => b.confidence - a.confidence);

    return suggestions;
  } catch (error) {
    console.error('Error getting categorization suggestions:', error.message);
    return [];
  }
}

module.exports = {
  categorizeTransaction,
  applyRulesToUncategorized,
  getSuggestions
};
