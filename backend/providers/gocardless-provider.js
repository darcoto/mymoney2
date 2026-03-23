/**
 * GoCardlessProvider - GoCardless Bank Account Data API integration
 */
const axios = require('axios');
const BaseProvider = require('./base-provider');
const database = require('../database');
const logger = require('../logger');
const config = require('../config');
const { processTransactionBatch } = require('../transaction-processor');

const BASE_URL = 'https://bankaccountdata.gocardless.com';
const BGN_TO_EUR_RATE = 1.95583;

function log(message, data = null) {
  logger.debug(`[GoCardless] ${message}`, data);
}

function convertToEur(amount, currency) {
  if (currency === 'EUR') return amount;
  if (currency === 'BGN') return amount / BGN_TO_EUR_RATE;
  logger.info(`[GoCardless] Unknown currency ${currency}, not converting`);
  return amount;
}

function logApiRequest(method, url, body = null) {
  logger.info(`[GoCardless API] >>> ${method} ${url}`, body ? { body } : null);
}

function logApiResponse(method, url, status, data) {
  logger.info(`[GoCardless API] <<< ${method} ${url} - Status: ${status}`, { response: data });
  if (config.nodeEnv === 'development' && data) {
    try {
      console.log(`[GoCardless API] Response data:\n${JSON.stringify(data, null, 2)}`);
    } catch (e) { /* ignore */ }
  }
}

class GoCardlessProvider extends BaseProvider {
  constructor(providerRecord) {
    super(providerRecord);
  }

  static getCredentialFields() {
    return [
      { key: 'secret_id', label: 'Secret ID', type: 'text', placeholder: 'Въведете Secret ID от GoCardless', required: true },
      { key: 'secret_key', label: 'Secret Key', type: 'password', placeholder: 'Въведете Secret Key от GoCardless', required: true }
    ];
  }

  async validateCredentials() {
    try {
      if (!this.credentials.secret_id || !this.credentials.secret_key) {
        return { valid: false, error: 'Secret ID и Secret Key са задължителни' };
      }
      // Try to create a token to validate
      await this._createNewToken();
      return { valid: true };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }

  // Token management using provider_sessions
  async _getAccessToken() {
    try {
      log('Getting access token...');
      const session = await database.getProviderSession(this.id, 'access_token');

      if (session && session.session_value) {
        const expiresAt = new Date(session.expires_at);
        const now = new Date();
        log('Found existing token, expires at:', expiresAt);

        if (expiresAt > new Date(now.getTime() + 5 * 60 * 1000)) {
          log('Using existing valid token');
          return session.session_value;
        }

        // Try to refresh
        const metadata = JSON.parse(session.metadata || '{}');
        if (metadata.refresh_token) {
          try {
            log('Token expired, refreshing...');
            return await this._refreshToken(metadata.refresh_token);
          } catch (error) {
            log('Refresh failed, creating new token');
          }
        }
      }

      log('Creating new token...');
      return await this._createNewToken();
    } catch (error) {
      logger.error('[GoCardless] Error getting access token:', error.message);
      throw error;
    }
  }

  async _createNewToken() {
    try {
      const response = await axios.post(`${BASE_URL}/api/v2/token/new/`, {
        secret_id: this.credentials.secret_id,
        secret_key: this.credentials.secret_key
      });

      const { access, refresh, access_expires } = response.data;
      const expiresAt = new Date(Date.now() + access_expires * 1000);

      await database.saveProviderSession(
        this.id, 'access_token', access, expiresAt.toISOString(),
        JSON.stringify({ refresh_token: refresh })
      );

      return access;
    } catch (error) {
      logger.error('[GoCardless] Error creating new token:', error.response?.data || error.message);
      throw new Error('Failed to create GoCardless access token. Check your credentials.');
    }
  }

  async _refreshToken(refreshToken) {
    try {
      const response = await axios.post(`${BASE_URL}/api/v2/token/refresh/`, {
        refresh: refreshToken
      });

      const { access, access_expires } = response.data;
      const expiresAt = new Date(Date.now() + access_expires * 1000);

      await database.saveProviderSession(
        this.id, 'access_token', access, expiresAt.toISOString(),
        JSON.stringify({ refresh_token: refreshToken })
      );

      return access;
    } catch (error) {
      logger.error('[GoCardless] Error refreshing token:', error.response?.data || error.message);
      throw error;
    }
  }

  async _getClient() {
    const accessToken = await this._getAccessToken();

    const client = axios.create({
      baseURL: BASE_URL,
      timeout: 30000,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    client.interceptors.request.use(
      (cfg) => {
        const fullUrl = `${cfg.baseURL}${cfg.url}`;
        logApiRequest(cfg.method.toUpperCase(), fullUrl, cfg.data);
        return cfg;
      },
      (error) => {
        logger.error('[GoCardless API] Request error:', error.message);
        return Promise.reject(error);
      }
    );

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

  async getInstitutions(country = 'BG') {
    try {
      const client = await this._getClient();
      const response = await client.get(`/api/v2/institutions/?country=${country}`);
      return response.data;
    } catch (error) {
      const apiMsg = error.response?.data?.detail || error.response?.data?.summary || error.message;
      throw new Error(`GoCardless: ${apiMsg}`);
    }
  }

  async createAuthorization(institutionId, redirectUrl = null) {
    try {
      log('Creating requisition for institution:', institutionId);
      const client = await this._getClient();

      const payload = {
        institution_id: institutionId,
        redirect: redirectUrl || `http://localhost:${config.port}/#settings`,
        reference: `ref-${Date.now()}`
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
      logger.error('[GoCardless] Error creating requisition:', error.response?.data || error.message);
      throw new Error('Failed to create bank requisition');
    }
  }

  async getAuthorization(authId) {
    try {
      const client = await this._getClient();
      const response = await client.get(`/api/v2/requisitions/${authId}/`);
      return {
        id: response.data.id,
        status: response.data.status,
        accounts: response.data.accounts,
        institutionId: response.data.institution_id
      };
    } catch (error) {
      logger.error('[GoCardless] Error getting requisition:', error.response?.data || error.message);
      throw error;
    }
  }

  async listAuthorizations() {
    try {
      log('Listing all requisitions...');
      const client = await this._getClient();
      const response = await client.get('/api/v2/requisitions/');
      const requisitions = response.data.results || [];
      log(`Found ${requisitions.length} requisitions`);
      return requisitions;
    } catch (error) {
      const apiMsg = error.response?.data?.detail || error.response?.data?.summary || error.message;
      throw new Error(`GoCardless: ${apiMsg}`);
    }
  }

  async deleteAuthorization(authId) {
    try {
      log(`Deleting requisition ${authId}...`);
      const client = await this._getClient();
      await client.delete(`/api/v2/requisitions/${authId}/`);
      log(`Requisition ${authId} deleted`);
      return true;
    } catch (error) {
      logger.error('[GoCardless] Error deleting requisition:', error.response?.data || error.message);
      throw error;
    }
  }

  async getAccountDetails(accountId) {
    try {
      const client = await this._getClient();
      const response = await client.get(`/api/v2/accounts/${accountId}/details/`);
      return response.data.account;
    } catch (error) {
      logger.error('[GoCardless] Error getting account details:', error.response?.data || error.message);
      throw error;
    }
  }

  async getAccountBalance(accountId) {
    try {
      const client = await this._getClient();
      const response = await client.get(`/api/v2/accounts/${accountId}/balances/`);
      return response.data.balances;
    } catch (error) {
      logger.error('[GoCardless] Error getting account balances:', error.response?.data || error.message);
      throw error;
    }
  }

  async getTransactions(accountId, dateFrom = null, dateTo = null) {
    try {
      const client = await this._getClient();
      const params = {};
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;

      const response = await client.get(`/api/v2/accounts/${accountId}/transactions/`, { params });
      return response.data.transactions;
    } catch (error) {
      logger.error('[GoCardless] Error getting transactions:', error.response?.data || error.message);
      throw error;
    }
  }

  async syncAllAccounts() {
    try {
      log('=== Starting account sync ===');
      const requisitions = await this.listAuthorizations();
      const syncedAccounts = [];

      log(`Processing ${requisitions.length} requisitions...`);

      for (const req of requisitions) {
        log(`Requisition ${req.id}: status=${req.status}, accounts=${req.accounts?.length || 0}`);

        if (req.status === 'LN' && req.accounts && req.accounts.length > 0) {
          log(`Requisition ${req.id} is linked with ${req.accounts.length} accounts`);

          for (const accountId of req.accounts) {
            try {
              log(`  Fetching details for account ${accountId}...`);
              const details = await this.getAccountDetails(accountId);
              log(`  Details:`, details);

              log(`  Fetching balances for account ${accountId}...`);
              const balances = await this.getAccountBalance(accountId);
              log(`  Balances:`, balances);

              const balanceData = balances?.[0] || {};
              const originalBalance = balanceData.balanceAmount
                ? parseFloat(balanceData.balanceAmount.amount)
                : 0;
              const originalCurrency = details.currency || balanceData.balanceAmount?.currency || 'BGN';
              const balanceInEur = convertToEur(originalBalance, originalCurrency);

              const account = {
                id: accountId,
                name: details.name || details.iban || 'Unknown Account',
                institutionName: details.institution || req.institution_id || '',
                iban: details.iban,
                currency: 'EUR',
                balance: balanceInEur,
                providerId: this.id,
                authorizationId: req.id
              };

              log(`  Saving account:`, account);
              await database.upsertAccount(account);
              syncedAccounts.push(account);
              log(`  Account ${accountId} synced successfully`);
            } catch (error) {
              logger.error(`[GoCardless] Error syncing account ${accountId}:`, error.response?.data || error.message);
              log(`  Failed to sync account ${accountId}`);
            }
          }
        } else {
          log(`Requisition ${req.id} not ready: status=${req.status}`);
        }
      }

      log(`=== Sync complete: ${syncedAccounts.length} accounts synced ===`);
      return syncedAccounts;
    } catch (error) {
      logger.error('[GoCardless] Error syncing all accounts:', error.message);
      throw error;
    }
  }

  async syncAccountTransactions(accountId, daysBack = 90) {
    try {
      const dateFrom = new Date();
      dateFrom.setDate(dateFrom.getDate() - daysBack);
      const dateFromStr = dateFrom.toISOString().split('T')[0];

      const transactionsData = await this.getTransactions(accountId, dateFromStr);
      const rawTransactions = transactionsData.booked || [];

      const transactions = rawTransactions.map(tx => {
        const originalAmount = parseFloat(tx.transactionAmount.amount);
        const originalCurrency = tx.transactionAmount.currency;
        const amountInEur = convertToEur(originalAmount, originalCurrency);

        return {
          id: tx.transactionId || tx.internalTransactionId || `${accountId}-${tx.bookingDate}-${tx.transactionAmount.amount}`,
          accountId: accountId,
          transactionDate: tx.valueDate || tx.bookingDate,
          bookingDate: tx.bookingDate,
          amount: amountInEur,
          currency: 'EUR',
          originalAmount: originalCurrency !== 'EUR' ? originalAmount : null,
          originalCurrency: originalCurrency !== 'EUR' ? originalCurrency : null,
          description: tx.remittanceInformationUnstructured || tx.additionalInformation || '',
          counterpartyName: originalAmount < 0 ? tx.creditorName : tx.debtorName || '',
          rawData: JSON.stringify(tx)
        };
      });

      const { newCount } = await processTransactionBatch(transactions);
      return newCount;
    } catch (error) {
      logger.error(`[GoCardless] Error syncing transactions for account ${accountId}:`, error.message);
      throw error;
    }
  }
}

module.exports = GoCardlessProvider;
