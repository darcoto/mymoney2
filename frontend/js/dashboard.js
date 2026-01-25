// Dashboard functionality

class Dashboard {
    constructor() {
        this.isLoaded = false;
    }

    async load() {
        if (this.isLoaded) return;

        try {
            showLoader();

            // Load summary data
            await this.loadSummary();

            // Load charts
            await this.loadCharts();

            // Load recent transactions
            await this.loadRecentTransactions();

            this.isLoaded = true;
        } catch (error) {
            console.error('Error loading dashboard:', error);
            showNotification('Грешка при зареждане на дашборда', 'error');
        } finally {
            hideLoader();
        }
    }

    async loadSummary() {
        try {
            // Get all accounts for total balance
            const accounts = await api.getAccounts();
            const totalBalance = accounts.reduce((sum, acc) => sum + (acc.balance || 0), 0);

            document.getElementById('totalBalance').textContent = formatCurrency(totalBalance);

            // Get current month stats
            const now = new Date();
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

            const stats = await api.getTransactionStats(
                formatDate(startOfMonth),
                formatDate(endOfMonth)
            );

            const income = stats.total_income || 0;
            const expenses = stats.total_expenses || 0;
            const savings = income - expenses;

            document.getElementById('monthlyIncome').textContent = formatCurrency(income);
            document.getElementById('monthlyExpenses').textContent = formatCurrency(expenses);
            document.getElementById('monthlySavings').textContent = formatCurrency(savings);

            // Update savings color
            const savingsEl = document.getElementById('monthlySavings');
            savingsEl.className = 'amount';
            if (savings > 0) {
                savingsEl.classList.add('positive');
            } else if (savings < 0) {
                savingsEl.classList.add('negative');
            }

        } catch (error) {
            console.error('Error loading summary:', error);
        }
    }

    async loadCharts() {
        try {
            // Income vs Expense chart for last 6 months
            const chartData = await this.getLast6MonthsData();
            charts.createIncomeExpenseChart('incomeExpenseChart', chartData);

            // Top 5 categories pie chart
            const now = new Date();
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

            const categoryData = await api.getCategoryBreakdown(
                formatDate(startOfMonth),
                formatDate(endOfMonth),
                'expense'
            );

            const top5 = categoryData.slice(0, 5);
            const pieData = {
                labels: top5.map(c => c.name),
                values: top5.map(c => c.total),
                colors: top5.map(c => c.color || '#999')
            };

            charts.createCategoryPieChart('categoryPieChart', pieData);

        } catch (error) {
            console.error('Error loading charts:', error);
        }
    }

    async getLast6MonthsData() {
        const labels = [];
        const income = [];
        const expenses = [];

        const now = new Date();

        for (let i = 5; i >= 0; i--) {
            const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const month = date.toLocaleDateString('bg-BG', { month: 'short', year: 'numeric' });
            labels.push(month);

            const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
            const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0);

            try {
                const stats = await api.getTransactionStats(
                    formatDate(startOfMonth),
                    formatDate(endOfMonth)
                );

                income.push(stats.total_income || 0);
                expenses.push(stats.total_expenses || 0);
            } catch (error) {
                income.push(0);
                expenses.push(0);
            }
        }

        return { labels, income, expenses };
    }

    async loadRecentTransactions() {
        try {
            const transactions = await api.getTransactions({ limit: 10, offset: 0 });

            const tbody = document.querySelector('#recentTransactionsTable tbody');
            tbody.innerHTML = '';

            if (transactions.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">Няма транзакции</td></tr>';
                return;
            }

            transactions.forEach(tx => {
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>${formatDate(new Date(tx.transaction_date))}</td>
                    <td>${escapeHtml(tx.description || '-')}</td>
                    <td>
                        ${tx.category_name
                            ? `<span class="category-badge" style="background-color: ${tx.category_color}">${escapeHtml(tx.category_name)}</span>`
                            : '<span class="badge badge-warning">Некатегоризирана</span>'
                        }
                    </td>
                    <td class="${tx.amount >= 0 ? 'positive' : 'negative'}" style="font-weight: 600;">
                        ${formatCurrency(tx.amount)}
                    </td>
                `;
                tbody.appendChild(row);
            });

        } catch (error) {
            console.error('Error loading recent transactions:', error);
        }
    }

    refresh() {
        this.isLoaded = false;
        this.load();
    }
}

// Create global instance
const dashboard = new Dashboard();
