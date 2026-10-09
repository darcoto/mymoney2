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
const DEFAULT_HISTORY_DAYS = 90;
// Застъпване при инкрементална синхронизация — банките понякога осчетоводяват със закъснение
const SYNC_OVERLAP_DAYS = 7;

function log(message, data = null) {
  logger.debug(`[GoCardless] ${message}`, data);
}

function convertToEur(amount, currency) {
  if (currency === 'EUR') return amount;
  if (currency === 'BGN') return amount / BGN_TO_EUR_RATE;
  logger.info(`[GoCardless] Unknown currency ${currency}, not converting`);
  return amount;
}

// Превръща грешка от GoCardless API в разбираемо съобщение за UI
function describeApiError(error) {
  const status = error.response?.status;
  const data = error.response?.data || {};
  const apiText = [data.summary, data.detail].filter(Boolean).join(' — ');

  if (status === 401 && /EUA|agreement/i.test(apiText)) {
    const expiredAt = (data.detail || '').match(/expired at (\d{4}-\d{2}-\d{2})/)?.[1];
    return `Достъпът до банката е изтекъл${expiredAt ? ` на ${expiredAt}` : ''}. ` +
      'Натиснете „Поднови“ при връзката в Настройки.';
  }
  if (status === 429) {
    return `Достигнат лимит на заявки към банката (GoCardless). ${data.detail || 'Опитайте по-късно.'}`;
  }
  if (status) {
    return `GoCardless (${status}): ${apiText || error.message}`;
  }
  return error.message;
}

// Ключ за разпознаване на една и съща банкова транзакция, ако ID-то ѝ се е сменило
function transactionMatchKey(raw) {
  const text = raw.remittanceInformationUnstructured
    || (raw.remittanceInformationUnstructuredArray || []).join(' ')
    || raw.additionalInformation || '';
  return [
    raw.bookingDate, raw.transactionAmount?.amount, raw.transactionAmount?.currency,
    raw.entryReference || '', text, raw.creditorName || raw.debtorName || ''
  ].join('|');
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
        error.message = describeApiError(error);
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
        // GoCardless добавя ?ref=... към адреса — фронтендът го разпознава и стартира синхронизация
        redirect: redirectUrl || `http://localhost:${config.port}/`,
        reference: `ref-${Date.now()}`
      };

      const agreementId = await this._createMaxAgreement(client, institutionId);
      if (agreementId) payload.agreement = agreementId;

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
      // Префиксът „GoCardless:“ позволява на apiError да покаже съобщението в UI
      throw new Error(`GoCardless: неуспешно създаване на връзка с банката — ${error.message}`);
    }
  }

  /**
   * Създава End User Agreement с максималните срокове, които банката позволява.
   * Без него GoCardless ползва 90 дни достъп / 90 дни история.
   * При неуспех връща null и връзката се създава с подразбиращите се срокове.
   */
  async _createMaxAgreement(client, institutionId) {
    try {
      const { data: institution } = await client.get(`/api/v2/institutions/${institutionId}/`);
      const agreement = {
        institution_id: institutionId,
        max_historical_days: parseInt(institution.transaction_total_days, 10) || 90,
        access_valid_for_days: parseInt(institution.max_access_valid_for_days, 10) || 90,
        access_scope: ['balances', 'details', 'transactions']
      };
      log('Creating agreement:', agreement);
      const { data } = await client.post('/api/v2/agreements/enduser/', agreement);
      return data.id;
    } catch (error) {
      logger.warn(`[GoCardless] Could not create extended agreement, using defaults: ${error.message}`);
      return null;
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

      // GoCardless оставя статус LN и след изтичане на EUA — изчисляваме реалната валидност
      await Promise.all(requisitions.map(async (req) => {
        if (req.status !== 'LN' || !req.agreement) return;
        try {
          const { data: eua } = await client.get(`/api/v2/agreements/enduser/${req.agreement}/`);
          if (!eua.accepted) return;
          const expiresAt = new Date(eua.accepted);
          expiresAt.setDate(expiresAt.getDate() + eua.access_valid_for_days);
          req.expiresAt = expiresAt.toISOString();
          req.expired = expiresAt < new Date();
          req.maxHistoricalDays = eua.max_historical_days;
        } catch (error) {
          log(`Could not load agreement ${req.agreement}: ${error.message}`);
        }
      }));

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
      const accountErrors = [];
      const seenAccountIds = new Set();
      const reportedInstitutions = new Set();

      // Най-новите връзки първи — при повторно свързване новата връзка има приоритет
      const linked = requisitions
        .filter(req => req.status === 'LN' && req.accounts && req.accounts.length > 0)
        .sort((a, b) => new Date(b.created) - new Date(a.created));
      const active = linked.filter(req => !req.expired);
      // Сметки, които все още са достъпни през валидна връзка — не се прехвърлят
      const activeAccountIds = new Set(active.flatMap(req => req.accounts));

      for (const req of linked) {
        if (req.maxHistoricalDays) this._historyDaysCache().set(req.id, req.maxHistoricalDays);
      }

      log(`Processing ${linked.length} linked requisitions (${active.length} active)...`);

      for (const req of linked) {
        if (req.expired) {
          // Изтекла връзка, заменена от по-нова към същата банка — пропускаме тихо
          if (active.some(a => a.institution_id === req.institution_id)) continue;
          // По едно съобщение на банка (за най-новата ѝ връзка)
          if (reportedInstitutions.has(req.institution_id)) continue;
          reportedInstitutions.add(req.institution_id);
          const expiredOn = req.expiresAt ? ` на ${req.expiresAt.split('T')[0]}` : '';
          accountErrors.push(`Достъпът до ${req.institution_id} е изтекъл${expiredOn}. ` +
            'Натиснете „Поднови“ при връзката в Настройки.');
          continue;
        }

        for (const accountId of req.accounts) {
          if (seenAccountIds.has(accountId)) continue;
          seenAccountIds.add(accountId);

          try {
            const details = await this.getAccountDetails(accountId);
            log(`  Details:`, details);
            const balances = await this.getAccountBalance(accountId);
            log(`  Balances:`, balances);

            const balanceData = balances?.[0] || {};
            const originalBalance = balanceData.balanceAmount
              ? parseFloat(balanceData.balanceAmount.amount)
              : 0;
            const originalCurrency = details.currency || balanceData.balanceAmount?.currency || 'BGN';
            const balanceInEur = convertToEur(originalBalance, originalCurrency);

            await this._continueExistingAccount(accountId, details.iban, originalCurrency, activeAccountIds);

            const account = {
              id: accountId,
              name: details.name || details.iban || 'Unknown Account',
              institutionName: details.institution || req.institution_id || '',
              iban: details.iban,
              currency: 'EUR',
              originalCurrency,
              balance: balanceInEur,
              providerId: this.id,
              authorizationId: req.id
            };

            log(`  Saving account:`, account);
            await database.upsertAccount(account);
            syncedAccounts.push(account);
          } catch (error) {
            logger.error(`[GoCardless] Error syncing account ${accountId}:`, error.response?.data || error.message);
            accountErrors.push(error.message);
          }
        }
      }

      log(`=== Sync complete: ${syncedAccounts.length} accounts synced ===`);
      // Ако нито една сметка не е минала, показваме причината вместо "0 сметки"
      if (syncedAccounts.length === 0 && accountErrors.length > 0) {
        throw new Error([...new Set(accountErrors)].join(' '));
      }
      return syncedAccounts;
    } catch (error) {
      logger.error('[GoCardless] Error syncing all accounts:', error.message);
      throw error;
    }
  }

  /**
   * При повторно свързване GoCardless може да върне ново ID за същата банкова сметка.
   * Ако такава сметка вече съществува (IBAN + валута), прехвърляме я към новото ID,
   * за да продължи историята — транзакции, категории, бележки и потребителско име.
   */
  async _continueExistingAccount(accountId, iban, originalCurrency, activeAccountIds) {
    if (await database.getAccountById(accountId)) return;

    const previous = await database.findAccountForReconnect(
      this.id, iban, originalCurrency, [...activeAccountIds]
    );
    if (!previous) return;

    const moved = await database.migrateAccountId(previous.id, accountId);
    logger.info(`[GoCardless] Reconnected account ${previous.id} -> ${accountId} (${iban} ${originalCurrency}), ${moved} transactions moved`);
  }

  _historyDaysCache() {
    if (!this._historyDays) this._historyDays = new Map();
    return this._historyDays;
  }

  /**
   * Колко дни назад позволява текущото споразумение на сметката (max_historical_days).
   */
  async _getHistoryDays(accountId) {
    const account = await database.getAccountById(accountId);
    const authId = account?.authorization_id;
    if (!authId) return DEFAULT_HISTORY_DAYS;

    const cache = this._historyDaysCache();
    if (!cache.has(authId)) {
      try {
        const client = await this._getClient();
        const { data: req } = await client.get(`/api/v2/requisitions/${authId}/`);
        const { data: eua } = await client.get(`/api/v2/agreements/enduser/${req.agreement}/`);
        cache.set(authId, eua.max_historical_days || DEFAULT_HISTORY_DAYS);
      } catch (error) {
        log(`Could not determine history days for ${accountId}: ${error.message}`);
        cache.set(authId, DEFAULT_HISTORY_DAYS);
      }
    }
    return cache.get(authId);
  }

  /**
   * Начална дата за изтегляне: от последната синхронизирана транзакция (минус застъпване),
   * за да се запълнят пропуски след изтекъл достъп, но не по-рано от позволеното от банката.
   * Нова сметка без история — цялата налична история.
   */
  async _getSyncStartDate(accountId) {
    const historyDays = await this._getHistoryDays(accountId);
    const earliest = new Date();
    earliest.setDate(earliest.getDate() - historyDays + 1);

    const lastDate = await database.getLastProviderTransactionDate(accountId);
    if (!lastDate) return earliest;

    const from = new Date(lastDate);
    from.setDate(from.getDate() - SYNC_OVERLAP_DAYS);
    return from > earliest ? from : earliest;
  }

  /**
   * Ако банката е сменила ID на вече записана транзакция (напр. след повторно свързване),
   * връщаме старото ID, за да не се дублира и да запази категорията и бележките си.
   * Съвпадение 1:1 по дата, сума, валута, референция, описание и контрагент.
   */
  async _keepExistingTransactionIds(accountId, transactions) {
    if (transactions.length === 0) return 0;

    const minDate = transactions.reduce((min, t) => {
      const d = [t.transactionDate, t.bookingDate].filter(Boolean).sort()[0];
      return d && d < min ? d : min;
    }, '9999-12-31');
    const existing = await database.getProviderTransactions(accountId, minDate);
    const existingIds = new Set(existing.map(r => r.id));
    const batchIds = new Set(transactions.map(t => t.id));

    // Записани транзакции, които банката вече не връща със същото ID
    const unclaimed = new Map();
    for (const row of existing) {
      if (batchIds.has(row.id)) continue;
      let raw;
      try { raw = JSON.parse(row.raw_data); } catch (e) { continue; }
      const key = transactionMatchKey(raw);
      if (!unclaimed.has(key)) unclaimed.set(key, []);
      unclaimed.get(key).push(row.id);
    }
    if (unclaimed.size === 0) return 0;

    let remapped = 0;
    for (const tx of transactions) {
      if (existingIds.has(tx.id)) continue;
      const candidates = unclaimed.get(transactionMatchKey(JSON.parse(tx.rawData)));
      if (candidates && candidates.length > 0) {
        const oldId = candidates.shift();
        log(`  Transaction id changed ${oldId} -> ${tx.id}, keeping ${oldId}`);
        tx.id = oldId;
        remapped++;
      }
    }
    if (remapped > 0) logger.info(`[GoCardless] ${remapped} transactions matched to existing records for account ${accountId}`);
    return remapped;
  }

  async syncAccountTransactions(accountId, daysBack = null) {
    try {
      let dateFrom;
      if (daysBack) {
        dateFrom = new Date();
        dateFrom.setDate(dateFrom.getDate() - daysBack);
      } else {
        dateFrom = await this._getSyncStartDate(accountId);
      }
      const dateFromStr = dateFrom.toISOString().split('T')[0];
      logger.debug('[GoCardless] syncAccountTransactions', { accountId, dateFrom: dateFromStr });

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
          counterpartyName: (originalAmount < 0 ? tx.creditorName : tx.debtorName) || (tx.remittanceInformationUnstructuredArray || []).join(' '),
          rawData: JSON.stringify(tx)
        };
      });

      await this._keepExistingTransactionIds(accountId, transactions);

      const { newCount } = await processTransactionBatch(transactions);
      return newCount;
    } catch (error) {
      logger.error(`[GoCardless] Error syncing transactions for account ${accountId}:`, error.message);
      throw error;
    }
  }
}

module.exports = GoCardlessProvider;
