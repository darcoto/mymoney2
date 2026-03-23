/**
 * EnableBankingProvider - Enable Banking API integration
 * Uses JWT with RSA private key for authentication.
 */
const axios = require('axios');
const jwt = require('jsonwebtoken');
const BaseProvider = require('./base-provider');
const database = require('../database');
const logger = require('../logger');
const config = require('../config');
const { processTransactionBatch } = require('../transaction-processor');

const BASE_URL = 'https://api.enablebanking.com';
const BGN_TO_EUR_RATE = 1.95583;

function log(message, data = null) {
  logger.debug(`[EnableBanking] ${message}`, data);
}

function convertToEur(amount, currency) {
  if (currency === 'EUR') return amount;
  if (currency === 'BGN') return amount / BGN_TO_EUR_RATE;
  logger.info(`[EnableBanking] Unknown currency ${currency}, not converting`);
  return amount;
}

class EnableBankingProvider extends BaseProvider {
  constructor(providerRecord) {
    super(providerRecord);
  }

  static getCredentialFields() {
    return [
      { key: 'application_id', label: 'Application ID', type: 'text', placeholder: 'Въведете Application ID от Enable Banking', required: true },
      { key: 'private_key', label: 'RSA Private Key (PEM)', type: 'textarea', placeholder: '-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----', required: true }
    ];
  }

  _generateJWT() {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: 'enablebanking.com',
      aud: 'api.enablebanking.com',
      iat: now,
      exp: now + 3600
    };

    return jwt.sign(payload, this.credentials.private_key, {
      algorithm: 'PS256',
      header: {
        kid: this.credentials.application_id
      }
    });
  }

  _getClient() {
    const token = this._generateJWT();

    const client = axios.create({
      baseURL: BASE_URL,
      timeout: 30000,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    client.interceptors.request.use(
      (cfg) => {
        logger.info(`[EnableBanking API] >>> ${cfg.method.toUpperCase()} ${cfg.baseURL}${cfg.url}`);
        return cfg;
      },
      (error) => {
        logger.error('[EnableBanking API] Request error:', error.message);
        return Promise.reject(error);
      }
    );

    client.interceptors.response.use(
      (response) => {
        logger.info(`[EnableBanking API] <<< ${response.config.method.toUpperCase()} ${response.config.baseURL}${response.config.url} - Status: ${response.status}`);
        return response;
      },
      (error) => {
        logger.error(`[EnableBanking API] Response error`, {
          status: error.response?.status,
          data: error.response?.data
        });
        return Promise.reject(error);
      }
    );

    return client;
  }

  async validateCredentials() {
    try {
      if (!this.credentials.application_id || !this.credentials.private_key) {
        return { valid: false, error: 'Application ID и Private Key са задължителни' };
      }
      // Try to generate a JWT and make a basic request
      const client = this._getClient();
      await client.get('/aspsps?country=BG');
      return { valid: true };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }

  async getInstitutions(country = 'BG') {
    try {
      const client = this._getClient();
      const response = await client.get(`/aspsps?country=${country}`);
      // Normalize to common format
      const aspsps = response.data.aspsps || response.data || [];
      return aspsps.map(aspsp => ({
        id: aspsp.name, // Enable Banking uses name as identifier
        name: aspsp.name,
        logo: aspsp.logo || null,
        countries: aspsp.countries || [country],
        // Enable Banking may not have these fields
        transaction_total_days: aspsp.transaction_total_days || null,
        max_access_valid_for_days: aspsp.max_access_valid_for_days || null
      }));
    } catch (error) {
      const apiMsg = error.response?.data?.message || error.response?.data?.error || error.message;
      throw new Error(`Enable Banking: ${apiMsg}`);
    }
  }

  async createAuthorization(institutionId, redirectUrl = null) {
    try {
      log('Creating authorization for institution:', institutionId);
      const client = this._getClient();

      const payload = {
        aspsp: { name: institutionId },
        redirect_url: redirectUrl || `http://localhost:${config.port}/#settings`,
        psu_type: 'personal'
      };

      const response = await client.post('/auth', payload);
      log('Authorization created:', response.data);

      // Save the authorization info locally since Enable Banking doesn't have a list endpoint
      const authData = response.data;
      await database.saveProviderSession(
        this.id,
        `auth_${authData.auth_id || Date.now()}`,
        JSON.stringify({
          id: authData.auth_id,
          institution_id: institutionId,
          status: 'CR',
          created: new Date().toISOString(),
          accounts: []
        }),
        null,
        null
      );

      return {
        id: authData.auth_id,
        link: authData.url,
        status: 'CR',
        accounts: []
      };
    } catch (error) {
      logger.error('[EnableBanking] Error creating authorization:', error.response?.data || error.message);
      throw new Error('Failed to create bank authorization');
    }
  }

  async getAuthorization(authId) {
    try {
      // Check local session for this auth
      const session = await database.getProviderSession(this.id, `auth_${authId}`);
      if (session) {
        return JSON.parse(session.session_value);
      }
      return { id: authId, status: 'UNKNOWN', accounts: [] };
    } catch (error) {
      logger.error('[EnableBanking] Error getting authorization:', error.message);
      throw error;
    }
  }

  async listAuthorizations() {
    // Enable Banking doesn't have a list-authorizations API endpoint.
    // Return accounts linked to this provider as a proxy.
    const accounts = await database.getAccountsByProvider(this.id);
    return accounts.map(a => ({
      id: a.id,
      status: 'LN',
      accounts: [a.id],
      institution_id: a.institution_name
    }));
  }

  async deleteAuthorization(authId) {
    try {
      // Just remove from local sessions
      // Enable Banking doesn't have a delete endpoint for authorizations
      log(`Removing local authorization record ${authId}`);
      return true;
    } catch (error) {
      logger.error('[EnableBanking] Error deleting authorization:', error.message);
      throw error;
    }
  }

  async getAccountDetails(accountId) {
    try {
      const client = this._getClient();
      const response = await client.get(`/accounts/${accountId}`);
      return response.data;
    } catch (error) {
      logger.error('[EnableBanking] Error getting account details:', error.response?.data || error.message);
      throw error;
    }
  }

  async getAccountBalance(accountId) {
    try {
      const client = this._getClient();
      const response = await client.get(`/accounts/${accountId}/balances`);
      return response.data.balances || [];
    } catch (error) {
      logger.error('[EnableBanking] Error getting account balances:', error.response?.data || error.message);
      throw error;
    }
  }

  async getTransactions(accountId, dateFrom = null, dateTo = null) {
    try {
      const client = this._getClient();
      const params = {};
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;

      const response = await client.get(`/accounts/${accountId}/transactions`, { params });
      return response.data;
    } catch (error) {
      logger.error('[EnableBanking] Error getting transactions:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Complete the authorization flow after user returns from bank.
   * Called with the authorization code from the redirect.
   */
  async completeAuthorization(code) {
    try {
      const client = this._getClient();
      const response = await client.post('/sessions', { code });

      const sessionData = response.data;
      log('Session created:', sessionData);

      // Save session
      await database.saveProviderSession(
        this.id, 'eb_session',
        JSON.stringify(sessionData),
        sessionData.valid_until || null,
        null
      );

      return sessionData;
    } catch (error) {
      logger.error('[EnableBanking] Error completing authorization:', error.response?.data || error.message);
      throw error;
    }
  }

  async syncAllAccounts() {
    try {
      log('=== Starting Enable Banking account sync ===');
      // Get the stored session
      const sessionRecord = await database.getProviderSession(this.id, 'eb_session');
      if (!sessionRecord) {
        log('No Enable Banking session found. Please authorize a bank first.');
        return [];
      }

      const sessionData = JSON.parse(sessionRecord.session_value);
      const accounts = sessionData.accounts || [];
      const syncedAccounts = [];

      for (const accountId of accounts) {
        try {
          log(`  Fetching details for account ${accountId}...`);
          const details = await this.getAccountDetails(accountId);

          log(`  Fetching balances for account ${accountId}...`);
          const balances = await this.getAccountBalance(accountId);

          const balanceData = balances?.[0] || {};
          const originalBalance = balanceData.balance_amount
            ? parseFloat(balanceData.balance_amount.amount)
            : 0;
          const originalCurrency = details.currency || balanceData.balance_amount?.currency || 'EUR';
          const balanceInEur = convertToEur(originalBalance, originalCurrency);

          const account = {
            id: accountId,
            name: details.account_name || details.iban || 'Unknown Account',
            institutionName: details.institution_name || '',
            iban: details.iban,
            currency: 'EUR',
            balance: balanceInEur,
            providerId: this.id,
            authorizationId: String(sessionData.session_id || sessionRecord.id || '')
          };

          await database.upsertAccount(account);
          syncedAccounts.push(account);
          log(`  Account ${accountId} synced successfully`);
        } catch (error) {
          logger.error(`[EnableBanking] Error syncing account ${accountId}:`, error.message);
        }
      }

      log(`=== Sync complete: ${syncedAccounts.length} accounts synced ===`);
      return syncedAccounts;
    } catch (error) {
      logger.error('[EnableBanking] Error syncing accounts:', error.message);
      throw error;
    }
  }

  async syncAccountTransactions(accountId, daysBack = 90) {
    try {
      const dateFrom = new Date();
      dateFrom.setDate(dateFrom.getDate() - daysBack);
      const dateFromStr = dateFrom.toISOString().split('T')[0];

      const transactionsData = await this.getTransactions(accountId, dateFromStr);
      const rawTransactions = transactionsData.transactions || transactionsData.booked || [];

      const transactions = rawTransactions.map(tx => {
        const originalAmount = parseFloat(tx.transaction_amount?.amount || tx.transactionAmount?.amount || 0);
        const originalCurrency = tx.transaction_amount?.currency || tx.transactionAmount?.currency || 'EUR';
        const amountInEur = convertToEur(originalAmount, originalCurrency);

        return {
          id: tx.transaction_id || tx.entry_reference || `EB-${accountId}-${tx.booking_date || tx.bookingDate}-${originalAmount}`,
          accountId: accountId,
          transactionDate: tx.value_date || tx.valueDate || tx.booking_date || tx.bookingDate,
          bookingDate: tx.booking_date || tx.bookingDate,
          amount: amountInEur,
          currency: 'EUR',
          originalAmount: originalCurrency !== 'EUR' ? originalAmount : null,
          originalCurrency: originalCurrency !== 'EUR' ? originalCurrency : null,
          description: tx.remittance_information || tx.remittanceInformationUnstructured || '',
          counterpartyName: tx.creditor_name || tx.creditorName || tx.debtor_name || tx.debtorName || '',
          rawData: JSON.stringify(tx)
        };
      });

      const { newCount } = await processTransactionBatch(transactions);
      return newCount;
    } catch (error) {
      logger.error(`[EnableBanking] Error syncing transactions for account ${accountId}:`, error.message);
      throw error;
    }
  }
}

module.exports = EnableBankingProvider;
