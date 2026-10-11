/**
 * BaseProvider - Abstract base class for bank data providers
 * All provider implementations must extend this class.
 */
class BaseProvider {
  constructor(providerRecord) {
    if (new.target === BaseProvider) {
      throw new Error('BaseProvider is abstract and cannot be instantiated directly');
    }
    this.id = providerRecord.id;
    this.type = providerRecord.type;
    this.name = providerRecord.name;
    this.credentials = JSON.parse(providerRecord.credentials || '{}');
    this.isConfigured = !!providerRecord.is_configured;
  }

  /** Validate that credentials are correct (e.g. try to get a token) */
  async validateCredentials() {
    throw new Error('validateCredentials() must be implemented');
  }

  /** Get list of supported institutions/banks */
  async getInstitutions(country) {
    throw new Error('getInstitutions() must be implemented');
  }

  /** Create a new authorization (requisition in GoCardless, auth session in EnableBanking) */
  async createAuthorization(institutionId, redirectUrl) {
    throw new Error('createAuthorization() must be implemented');
  }

  /** Get authorization status */
  async getAuthorization(authId) {
    throw new Error('getAuthorization() must be implemented');
  }

  /** List all authorizations */
  async listAuthorizations() {
    throw new Error('listAuthorizations() must be implemented');
  }

  /** Delete an authorization */
  async deleteAuthorization(authId) {
    throw new Error('deleteAuthorization() must be implemented');
  }

  /** Get account details */
  async getAccountDetails(accountId) {
    throw new Error('getAccountDetails() must be implemented');
  }

  /** Get account balance */
  async getAccountBalance(accountId) {
    throw new Error('getAccountBalance() must be implemented');
  }

  /** Get transactions for an account */
  async getTransactions(accountId, dateFrom, dateTo) {
    throw new Error('getTransactions() must be implemented');
  }

  /** Sync all accounts from all authorizations */
  async syncAllAccounts() {
    throw new Error('syncAllAccounts() must be implemented');
  }

  /** Sync transactions for a specific account */
  async syncAccountTransactions(accountId, daysBack) {
    throw new Error('syncAccountTransactions() must be implemented');
  }

  /**
   * Return credential field definitions for the UI form.
   * Must be a static method on each subclass.
   * @returns {Array<{key: string, label: string, type: string, placeholder?: string, required?: boolean}>}
   */
  static getCredentialFields() {
    throw new Error('getCredentialFields() must be implemented');
  }
}

module.exports = BaseProvider;
