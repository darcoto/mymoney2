// API Client for MyMoney2

const API_BASE = '/api';

class APIClient {
    async request(endpoint, options = {}) {
        const url = `${API_BASE}${endpoint}`;

        try {
            const response = await fetch(url, {
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers
                },
                ...options
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Request failed');
            }

            return await response.json();
        } catch (error) {
            console.error('API request failed:', error);
            throw error;
        }
    }

    // Auth
    async getAuthStatus() {
        return this.request('/auth/status');
    }

    // Accounts
    async getAccounts() {
        return this.request('/accounts');
    }

    async getAccount(id) {
        return this.request(`/accounts/${id}`);
    }

    async updateAccountName(id, customName) {
        return this.request(`/accounts/${id}/name`, {
            method: 'PUT',
            body: JSON.stringify({ customName })
        });
    }

    // Transactions
    async getTransactions(filters = {}) {
        const params = new URLSearchParams();
        Object.keys(filters).forEach(key => {
            if (filters[key] !== null && filters[key] !== undefined && filters[key] !== '') {
                params.append(key, filters[key]);
            }
        });

        const queryString = params.toString();
        const endpoint = queryString ? `/transactions?${queryString}` : '/transactions';
        return this.request(endpoint);
    }

    async createTransaction(transaction) {
        return this.request('/transactions', {
            method: 'POST',
            body: JSON.stringify(transaction)
        });
    }

    async updateTransactionCategory(id, categoryId) {
        return this.request(`/transactions/${id}/category`, {
            method: 'PUT',
            body: JSON.stringify({ categoryId })
        });
    }

    async categorizeByCounterparty(counterpartyName, categoryId) {
        return this.request('/transactions/categorize-by-counterparty', {
            method: 'POST',
            body: JSON.stringify({ counterpartyName, categoryId })
        });
    }

    async updateTransactionNotes(id, notes) {
        return this.request(`/transactions/${id}/notes`, {
            method: 'PUT',
            body: JSON.stringify({ notes })
        });
    }

    async getTransactionStats(startDate, endDate) {
        const params = new URLSearchParams();
        if (startDate) params.append('start_date', startDate);
        if (endDate) params.append('end_date', endDate);

        const queryString = params.toString();
        const endpoint = queryString ? `/transactions/stats?${queryString}` : '/transactions/stats';
        return this.request(endpoint);
    }

    // Categories
    async getCategories() {
        return this.request('/categories');
    }

    async createCategory(category) {
        return this.request('/categories', {
            method: 'POST',
            body: JSON.stringify(category)
        });
    }

    async updateCategory(id, category) {
        return this.request(`/categories/${id}`, {
            method: 'PUT',
            body: JSON.stringify(category)
        });
    }

    async deleteCategory(id) {
        return this.request(`/categories/${id}`, {
            method: 'DELETE'
        });
    }

    // Categorization Rules
    async getCategorizationRules() {
        return this.request('/categorization-rules');
    }

    async createCategorizationRule(rule) {
        return this.request('/categorization-rules', {
            method: 'POST',
            body: JSON.stringify(rule)
        });
    }

    async updateCategorizationRule(id, rule) {
        return this.request(`/categorization-rules/${id}`, {
            method: 'PUT',
            body: JSON.stringify(rule)
        });
    }

    async deleteCategorizationRule(id) {
        return this.request(`/categorization-rules/${id}`, {
            method: 'DELETE'
        });
    }

    async applyCategorizationRules() {
        return this.request('/categorization-rules/apply', {
            method: 'POST'
        });
    }

    // Reports
    async getMonthlyReport(year, month) {
        return this.request(`/reports/monthly?year=${year}&month=${month}`);
    }

    async getLast12MonthsReport() {
        return this.request('/reports/last-12-months');
    }

    async getCategoryBreakdown(startDate, endDate, type = null) {
        const params = new URLSearchParams();
        if (startDate) params.append('start_date', startDate);
        if (endDate) params.append('end_date', endDate);
        if (type) params.append('type', type);

        const queryString = params.toString();
        return this.request(`/reports/category-breakdown?${queryString}`);
    }

    async getCounterpartyReport(startDate, endDate) {
        const params = new URLSearchParams();
        if (startDate) params.append('start_date', startDate);
        if (endDate) params.append('end_date', endDate);

        const queryString = params.toString();
        return this.request(`/reports/counterparty?${queryString}`);
    }

    // GoCardless Integration
    async getInstitutions(country = 'BG') {
        return this.request(`/gocardless/institutions?country=${country}`);
    }

    async createRequisition(institutionId) {
        return this.request('/gocardless/requisition', {
            method: 'POST',
            body: JSON.stringify({ institutionId })
        });
    }

    async getRequisitions() {
        return this.request('/gocardless/requisitions');
    }

    async deleteRequisition(id) {
        return this.request(`/gocardless/requisitions/${id}`, {
            method: 'DELETE'
        });
    }

    async syncAccounts() {
        return this.request('/sync/accounts', {
            method: 'POST'
        });
    }

    async syncTransactions() {
        return this.request('/sync/transactions', {
            method: 'POST'
        });
    }

    async createBackup() {
        return this.request('/backup', {
            method: 'POST'
        });
    }

    // Counterparty aliases
    async getCounterpartyAliases() {
        return this.request('/counterparty-aliases');
    }

    async createCounterpartyAlias(originalName, displayName) {
        return this.request('/counterparty-aliases', {
            method: 'POST',
            body: JSON.stringify({ originalName, displayName })
        });
    }

    async updateCounterpartyAlias(id, displayName) {
        return this.request(`/counterparty-aliases/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ displayName })
        });
    }

    async deleteCounterpartyAlias(id) {
        return this.request(`/counterparty-aliases/${id}`, {
            method: 'DELETE'
        });
    }
}

// Create global instance
const api = new APIClient();
