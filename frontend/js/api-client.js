// API Client for MyMoney2

const API_BASE = '/api';

// Кодира сегмент от пътя (ID може да съдържа специални символи)
const seg = (value) => encodeURIComponent(value);

// Изтекла сесия / няма вход (зададена е парола) — към страницата за вход и обратно тук
function redirectToLogin() {
    window.location.href = `/login.html?next=${encodeURIComponent(location.pathname + location.search + location.hash)}`;
}

class APIClient {
    async request(endpoint, options = {}) {
        const url = `${API_BASE}${endpoint}`;
        const { headers, ...rest } = options;

        try {
            const response = await fetch(url, {
                ...rest,
                headers: {
                    'Content-Type': 'application/json',
                    ...headers
                }
            });

            if (response.status === 401) {
                redirectToLogin();
                throw new Error('Нужен е вход');
            }

            if (!response.ok) {
                // Тялото може да не е JSON (502, HTML 404 и т.н.)
                const text = await response.text().catch(() => '');
                let message = '';
                try {
                    const data = JSON.parse(text);
                    message = data && data.error ? data.error : '';
                } catch (e) {
                    message = '';
                }
                const error = new Error(message || `HTTP ${response.status}`);
                error.status = response.status;
                throw error;
            }

            if (response.status === 204) {
                return null;
            }
            const body = await response.text();
            return body ? JSON.parse(body) : null;
        } catch (error) {
            console.error('API request failed:', error);
            throw error;
        }
    }

    // Достъп с парола
    async getSession() {
        return this.request('/session');
    }

    async logout() {
        return this.request('/logout', { method: 'POST' });
    }

    async changePassword(current, password) {
        return this.request('/password', { method: 'PUT', body: JSON.stringify({ current, password }) });
    }

    // График (синхронизация, архив) и Telegram
    async getSchedule() {
        return this.request('/schedule');
    }

    async updateSchedule(changes) {
        return this.request('/schedule', { method: 'PUT', body: JSON.stringify(changes) });
    }

    async getTelegramStatus() {
        return this.request('/telegram');
    }

    async updateTelegram(changes) {
        return this.request('/telegram', { method: 'PUT', body: JSON.stringify(changes) });
    }

    async removeTelegram() {
        return this.request('/telegram', { method: 'DELETE' });
    }

    async createTelegramPairCode() {
        return this.request('/telegram/pair', { method: 'POST' });
    }

    async unlinkTelegramChat() {
        return this.request('/telegram/chat', { method: 'DELETE' });
    }

    async sendTelegramTest() {
        return this.request('/telegram/test', { method: 'POST' });
    }

    async getDebugStatus() {
        return this.request('/debug');
    }

    async setDebugApiResponses(enabled) {
        return this.request('/debug', { method: 'PUT', body: JSON.stringify({ apiResponses: enabled }) });
    }

    async clearDebugApiResponses() {
        return this.request('/debug/api-responses', { method: 'DELETE' });
    }

    async sendTelegramPending() {
        return this.request('/telegram/pending', { method: 'POST' });
    }

    // Version
    async getVersion() {
        return this.request('/version');
    }

    async getLogs(lines = 200) {
        return this.request(`/logs?lines=${encodeURIComponent(lines)}`);
    }

    // Accounts
    async getAccounts() {
        return this.request('/accounts');
    }

    async updateAccountName(id, customName) {
        return this.request(`/accounts/${seg(id)}/name`, {
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
        return this.request(`/transactions/${seg(id)}/category`, {
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
        return this.request(`/transactions/${seg(id)}/notes`, {
            method: 'PUT',
            body: JSON.stringify({ notes })
        });
    }

    async updateTransactionCountry(id, country) {
        return this.request(`/transactions/${seg(id)}/country`, {
            method: 'PUT',
            body: JSON.stringify({ country })
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
        return this.request(`/categories/${seg(id)}`, {
            method: 'PUT',
            body: JSON.stringify(category)
        });
    }

    async deleteCategory(id) {
        return this.request(`/categories/${seg(id)}`, {
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
        return this.request(`/categorization-rules/${seg(id)}`, {
            method: 'PUT',
            body: JSON.stringify(rule)
        });
    }

    async deleteCategorizationRule(id) {
        return this.request(`/categorization-rules/${seg(id)}`, {
            method: 'DELETE'
        });
    }

    async applyCategorizationRules() {
        return this.request('/categorization-rules/apply', {
            method: 'POST'
        });
    }

    async reprocessTransaction(id, apply = false) {
        return this.request(`/transactions/${seg(id)}/reprocess`, {
            method: 'POST',
            body: JSON.stringify({ apply })
        });
    }

    // Reports
    async getMonthlyReport(year, month, types = null, categoryId = null) {
        const params = new URLSearchParams();
        params.append('year', year);
        params.append('month', month);
        if (types && types.length > 0) {
            types.forEach(type => params.append('types', type));
        }
        if (categoryId) {
            params.append('category_id', categoryId);
        }
        return this.request(`/reports/monthly?${params.toString()}`);
    }

    async getReportTransactions(year, month, types = null, categoryId = null, { counterparty, accountId, country } = {}) {
        const params = new URLSearchParams();
        if (year) params.append('year', year);
        if (month) params.append('month', month);
        if (country) params.append('country', country);
        if (types && types.length > 0) {
            types.forEach(type => params.append('types', type));
        }
        if (categoryId) params.append('category_id', categoryId);
        if (counterparty) params.append('counterparty', counterparty);
        if (accountId) params.append('account_id', accountId);
        return this.request(`/reports/transactions?${params.toString()}`);
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

    // Provider management
    async getProviders() {
        return this.request('/providers');
    }

    async getProvider(id) {
        return this.request(`/providers/${seg(id)}`);
    }

    async updateProviderCredentials(id, credentials) {
        return this.request(`/providers/${seg(id)}/credentials`, {
            method: 'PUT',
            body: JSON.stringify({ credentials })
        });
    }

    async clearProviderCredentials(id) {
        return this.request(`/providers/${seg(id)}/credentials`, {
            method: 'DELETE'
        });
    }

    async getProviderStatus(id) {
        return this.request(`/providers/${seg(id)}/status`);
    }

    async getProviderCredentialFields(id) {
        return this.request(`/providers/${seg(id)}/credential-fields`);
    }

    // Provider banking operations
    async getInstitutions(providerId, country = 'BG') {
        const params = new URLSearchParams({ country });
        return this.request(`/providers/${seg(providerId)}/institutions?${params.toString()}`);
    }

    async createAuthorization(providerId, institutionId) {
        return this.request(`/providers/${seg(providerId)}/authorizations`, {
            method: 'POST',
            body: JSON.stringify({ institutionId })
        });
    }

    async getAuthorizations(providerId) {
        return this.request(`/providers/${seg(providerId)}/authorizations`);
    }

    async deleteAuthorization(providerId, authId) {
        return this.request(`/providers/${seg(providerId)}/authorizations/${seg(authId)}`, {
            method: 'DELETE'
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
        return this.request(`/counterparty-aliases/${seg(id)}`, {
            method: 'PUT',
            body: JSON.stringify({ displayName })
        });
    }

    async deleteCounterpartyAlias(id) {
        return this.request(`/counterparty-aliases/${seg(id)}`, {
            method: 'DELETE'
        });
    }

    // File Import (форматът и сметката се разпознават по съдържанието; accountId е по избор)
    async importFileTransactions(fileContent, accountId) {
        return this.request('/transactions/import-file', {
            method: 'POST',
            body: JSON.stringify({ fileContent, accountId })
        });
    }

    // Обединяване на дубликати импорт ↔ банка (dryRun — само преглед)
    async reconcileImports(dryRun = true) {
        return this.request('/transactions/reconcile-imports', {
            method: 'POST',
            body: JSON.stringify({ dryRun })
        });
    }

    async getAccountsByInstitution(pattern) {
        return this.request(`/accounts/by-institution/${seg(pattern)}`);
    }

    // Countries
    async getCountries() {
        return this.request('/countries');
    }

    async getCountryReport(types = ['expense'], categoryId = null) {
        const params = new URLSearchParams();
        types.forEach(type => params.append('types', type));
        if (categoryId) {
            params.append('category_id', categoryId);
        }
        return this.request(`/reports/country?${params.toString()}`);
    }

    // Аналитични справки
    async getCashFlowReport(months = 24) {
        return this.request(`/reports/cash-flow?months=${months}`);
    }

    async getRecurringReport() {
        return this.request('/reports/recurring');
    }

    async getYearComparisonReport(year, month, mode = 'month') {
        return this.request(`/reports/year-comparison?year=${year}&month=${month}&mode=${mode}`);
    }

    async getBankCostsReport() {
        return this.request('/reports/bank-costs');
    }

    async getTripsReport() {
        return this.request('/reports/trips');
    }

    async getCategoryMonthlyReport(types = ['expense']) {
        const params = new URLSearchParams();
        types.forEach(type => params.append('types', type));
        return this.request(`/reports/category-monthly?${params.toString()}`);
    }
}

// Create global instance
const api = new APIClient();
