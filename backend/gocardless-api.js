const axios = require('axios');
const config = require('./config');
const database = require('./database');
const logger = require('./logger');

const BASE_URL = config.goCardless.apiUrl;

// Fixed exchange rate BGN to EUR (currency board rate)
const BGN_TO_EUR_RATE = 1.95583;

function log(message, data = null) {
  logger.debug(`[GoCardless] ${message}`, data);
}

// Convert amount to EUR if needed
function convertToEur(amount, currency) {
  if (currency === 'EUR') return amount;
  if (currency === 'BGN') return amount / BGN_TO_EUR_RATE;
  // For other currencies, log warning and return as-is
  logger.info(`[GoCardless] Unknown currency ${currency}, not converting`);
  return amount;
}

// Log API request details
function logApiRequest(method, url, body = null) {
  logger.info(`[GoCardless API] >>> ${method} ${url}`, body ? { body } : null);
}

// Log API response details
function logApiResponse(method, url, status, data) {
  logger.info(`[GoCardless API] <<< ${method} ${url} - Status: ${status}`, { response: data });
}

// Get or refresh access token
async function getAccessToken() {
  try {
    log('Getting access token...');
    // Check if we have a valid token in database
    const tokenData = await database.getGoCardlessToken();

    if (tokenData && tokenData.access_token) {
      const expiresAt = new Date(tokenData.expires_at);
      const now = new Date();
      log('Found existing token, expires at:', expiresAt);

      // If token is still valid (with 5 min buffer), use it
      if (expiresAt > new Date(now.getTime() + 5 * 60 * 1000)) {
        log('Using existing valid token');
        return tokenData.access_token;
      }

      // Try to refresh the token
      if (tokenData.refresh_token) {
        try {
          log('Token expired, refreshing...');
          const newToken = await refreshAccessToken(tokenData.refresh_token);
          return newToken;
        } catch (error) {
          log('Refresh failed, creating new token');
        }
      }
    }

    // Create new token
    log('Creating new token...');
    return await createNewToken();
  } catch (error) {
    console.error('[GoCardless] Error getting access token:', error.message);
    throw error;
  }
}

// Create new access token using secret credentials
async function createNewToken() {
  try {
    const response = await axios.post(`${BASE_URL}/api/v2/token/new/`, {
      secret_id: config.goCardless.secretId,
      secret_key: config.goCardless.secretKey
    });

    const { access, refresh, access_expires } = response.data;

    // Calculate expiration time (access_expires is in seconds)
    const expiresAt = new Date(Date.now() + access_expires * 1000);

    // Save to database
    await database.saveGoCardlessToken({
      accessToken: access,
      refreshToken: refresh,
      expiresAt: expiresAt.toISOString()
    });

    return access;
  } catch (error) {
    console.error('Error creating new token:', error.response?.data || error.message);
    throw new Error('Failed to create GoCardless access token. Check your credentials.');
  }
}

// Refresh access token
async function refreshAccessToken(refreshToken) {
  try {
    const response = await axios.post(`${BASE_URL}/api/v2/token/refresh/`, {
      refresh: refreshToken
    });

    const { access, access_expires } = response.data;
    const expiresAt = new Date(Date.now() + access_expires * 1000);

    // Update in database
    await database.saveGoCardlessToken({
      accessToken: access,
      refreshToken: refreshToken,
      expiresAt: expiresAt.toISOString()
    });

    return access;
  } catch (error) {
    console.error('Error refreshing token:', error.response?.data || error.message);
    throw error;
  }
}

// Get authenticated axios client with request/response logging
async function getAuthenticatedClient() {
  const accessToken = await getAccessToken();

  const client = axios.create({
    baseURL: BASE_URL,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  });

  // Add request interceptor for logging
  client.interceptors.request.use(
    (config) => {
      const fullUrl = `${config.baseURL}${config.url}`;
      logApiRequest(config.method.toUpperCase(), fullUrl, config.data);
      return config;
    },
    (error) => {
      logger.error('[GoCardless API] Request error:', error.message);
      return Promise.reject(error);
    }
  );

  // Add response interceptor for logging
  client.interceptors.response.use(
    (response) => {
      const fullUrl = `${response.config.baseURL}${response.config.url}`;
      logApiResponse(response.config.method.toUpperCase(), fullUrl, response.status, response.data);
      return response;
    },
    (error) => {
      const fullUrl = error.config ? `${error.config.baseURL}${error.config.url}` : 'unknown';
      logger.error(`[GoCardless API] Response error: ${fullUrl}`, {
        status: error.response?.status,
        data: error.response?.data
      });
      return Promise.reject(error);
    }
  );

  return client;
}

// Create requisition (end-user agreement to access bank account)
async function createRequisition(institutionId, redirect = null, reference = null) {
  try {
    log('Creating requisition for institution:', institutionId);
    const client = await getAuthenticatedClient();

    const payload = {
      institution_id: institutionId,
      redirect: redirect || `http://localhost:${config.port}/#settings`,
      reference: reference || `ref-${Date.now()}`
    };

    log('Requisition payload:', payload);
    const response = await client.post('/api/v2/requisitions/', payload);
    log('Requisition created:', response.data);

    return {
      id: response.data.id,
      link: response.data.link,
      status: response.data.status,
      accounts: response.data.accounts
    };
  } catch (error) {
    console.error('[GoCardless] Error creating requisition:', error.response?.data || error.message);
    throw new Error('Failed to create bank requisition');
  }
}

// Get requisition details
async function getRequisition(requisitionId) {
  try {
    const client = await getAuthenticatedClient();
    const response = await client.get(`/api/v2/requisitions/${requisitionId}/`);

    return {
      id: response.data.id,
      status: response.data.status,
      accounts: response.data.accounts,
      institutionId: response.data.institution_id
    };
  } catch (error) {
    console.error('Error getting requisition:', error.response?.data || error.message);
    throw error;
  }
}

// List all requisitions
async function listRequisitions() {
  try {
    log('Listing all requisitions...');
    const client = await getAuthenticatedClient();
    const response = await client.get('/api/v2/requisitions/');
    const requisitions = response.data.results || [];
    log(`Found ${requisitions.length} requisitions`);

    if (requisitions.length > 0) {
      requisitions.forEach((req, idx) => {
        log(`Requisition ${idx + 1}:`, {
          id: req.id,
          status: req.status,
          institution: req.institution_id,
          accounts: req.accounts?.length || 0,
          created: req.created
        });
      });
    }

    return requisitions;
  } catch (error) {
    console.error('[GoCardless] Error listing requisitions:', error.response?.data || error.message);
    return [];
  }
}

// Delete requisition
async function deleteRequisition(requisitionId) {
  try {
    log(`Deleting requisition ${requisitionId}...`);
    const client = await getAuthenticatedClient();
    await client.delete(`/api/v2/requisitions/${requisitionId}/`);
    log(`✓ Requisition ${requisitionId} deleted`);
    return true;
  } catch (error) {
    console.error('[GoCardless] Error deleting requisition:', error.response?.data || error.message);
    throw error;
  }
}

// Get account details
async function getAccountDetails(accountId) {
  try {
    const client = await getAuthenticatedClient();
    const response = await client.get(`/api/v2/accounts/${accountId}/details/`);
    return response.data.account;
  } catch (error) {
    console.error('Error getting account details:', error.response?.data || error.message);
    throw error;
  }
}

// Get account balances
async function getAccountBalances(accountId) {
  try {
    const client = await getAuthenticatedClient();
    const response = await client.get(`/api/v2/accounts/${accountId}/balances/`);
    return response.data.balances;
  } catch (error) {
    console.error('Error getting account balances:', error.response?.data || error.message);
    throw error;
  }
}

// Get transactions
async function getTransactions(accountId, dateFrom = null, dateTo = null) {
  try {
    const client = await getAuthenticatedClient();
    const params = {};
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;

    const response = await client.get(`/api/v2/accounts/${accountId}/transactions/`, { params });
    return response.data.transactions;
  } catch (error) {
    console.error('Error getting transactions:', error.response?.data || error.message);
    throw error;
  }
}

// Get list of supported institutions/banks
async function getInstitutions(country = 'BG') {
  try {
    const client = await getAuthenticatedClient();
    const response = await client.get(`/api/v2/institutions/?country=${country}`);
    return response.data;
  } catch (error) {
    console.error('Error getting institutions:', error.response?.data || error.message);
    return [];
  }
}

// Sync all accounts from all requisitions
async function syncAllAccounts() {
  try {
    log('=== Starting account sync ===');
    const requisitions = await listRequisitions();
    const syncedAccounts = [];

    log(`Processing ${requisitions.length} requisitions...`);

    for (const req of requisitions) {
      log(`Requisition ${req.id}: status=${req.status}, accounts=${req.accounts?.length || 0}`);

      if (req.status === 'LN' && req.accounts && req.accounts.length > 0) {
        log(`✓ Requisition ${req.id} is linked with ${req.accounts.length} accounts`);

        for (const accountId of req.accounts) {
          try {
            log(`  Fetching details for account ${accountId}...`);
            const details = await getAccountDetails(accountId);
            log(`  Details:`, details);

            log(`  Fetching balances for account ${accountId}...`);
            const balances = await getAccountBalances(accountId);
            log(`  Balances:`, balances);

            // balances is already the array from response.data.balances
            const balanceData = balances?.[0] || {};
            const originalBalance = balanceData.balanceAmount
              ? parseFloat(balanceData.balanceAmount.amount)
              : 0;
            const originalCurrency = details.currency || balanceData.balanceAmount?.currency || 'BGN';

            // Convert balance to EUR
            const balanceInEur = convertToEur(originalBalance, originalCurrency);

            const account = {
              id: accountId,
              name: details.name || details.iban || 'Unknown Account',
              institutionName: details.institution || req.institution_id || '',
              iban: details.iban,
              currency: 'EUR', // Always store in EUR
              balance: balanceInEur
            };

            log(`  Saving account:`, account);
            await database.upsertAccount(account);
            syncedAccounts.push(account);
            log(`  ✓ Account ${accountId} synced successfully`);
          } catch (error) {
            console.error(`[GoCardless] Error syncing account ${accountId}:`, error.response?.data || error.message);
            log(`  ✗ Failed to sync account ${accountId}`);
          }
        }
      } else {
        log(`✗ Requisition ${req.id} not ready: status=${req.status}`);
      }
    }

    log(`=== Sync complete: ${syncedAccounts.length} accounts synced ===`);
    return syncedAccounts;
  } catch (error) {
    console.error('[GoCardless] Error syncing all accounts:', error.message);
    throw error;
  }
}

// Sync transactions for an account
async function syncAccountTransactions(accountId, daysBack = 90) {
  try {
    const dateFrom = new Date();
    dateFrom.setDate(dateFrom.getDate() - daysBack);
    const dateFromStr = dateFrom.toISOString().split('T')[0];

    const transactionsData = await getTransactions(accountId, dateFromStr);
    const categorization = require('./categorization');

    let syncedCount = 0;
    const transactions = transactionsData.booked || [];

    for (const tx of transactions) {
      try {
        const originalAmount = parseFloat(tx.transactionAmount.amount);
        const originalCurrency = tx.transactionAmount.currency;

        // Convert to EUR (all amounts stored in EUR)
        const amountInEur = convertToEur(originalAmount, originalCurrency);

        const transaction = {
          id: tx.transactionId || tx.internalTransactionId || `${accountId}-${tx.bookingDate}-${tx.transactionAmount.amount}`,
          accountId: accountId,
          transactionDate: tx.valueDate || tx.bookingDate,
          bookingDate: tx.bookingDate,
          amount: amountInEur,
          currency: 'EUR', // Always store in EUR
          originalAmount: originalCurrency !== 'EUR' ? originalAmount : null,
          originalCurrency: originalCurrency !== 'EUR' ? originalCurrency : null,
          description: tx.remittanceInformationUnstructured || tx.additionalInformation || '',
          counterpartyName: tx.creditorName || '',
          categoryId: null,
          rawData: JSON.stringify(tx)
        };

        // Try to auto-categorize
        const categoryId = await categorization.categorizeTransaction(transaction);
        transaction.categoryId = categoryId;

        await database.upsertTransaction(transaction);
        syncedCount++;
      } catch (error) {
        console.error('Error syncing transaction:', error.message);
      }
    }

    return syncedCount;
  } catch (error) {
    console.error(`Error syncing transactions for account ${accountId}:`, error.message);
    throw error;
  }
}

module.exports = {
  getAccessToken,
  createRequisition,
  getRequisition,
  listRequisitions,
  deleteRequisition,
  getInstitutions,
  getAccountDetails,
  getAccountBalances,
  getTransactions,
  syncAllAccounts,
  syncAccountTransactions
};
