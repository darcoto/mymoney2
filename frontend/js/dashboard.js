// Dashboard functionality

class Dashboard {
    constructor() {
        this.loadingPromise = null;
    }

    // Винаги опреснява данните; при вече течащо зареждане преизползва същия promise
    load() {
        if (this.loadingPromise) return this.loadingPromise;

        this.loadingPromise = (async () => {
            try {
                showLoader();

                // Независимите заявки вървят паралелно (всяка метод обработва грешките си)
                await Promise.all([
                    this.loadSummary(),
                    this.loadCharts(),
                    this.loadRecentTransactions()
                ]);
            } catch (error) {
                console.error('Error loading dashboard:', error);
                showNotification('Грешка при зареждане на дашборда', 'error');
            } finally {
                hideLoader();
                this.loadingPromise = null;
            }
        })();

        return this.loadingPromise;
    }

    async loadSummary() {
        try {
            const now = new Date();
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

            // Сметки (общ баланс) и статистика за текущия месец — паралелно
            const [accounts, stats] = await Promise.all([
                api.getAccounts(),
                api.getTransactionStats(formatDate(startOfMonth), formatDate(endOfMonth))
            ]);

            const totalBalance = accounts.reduce((sum, acc) => sum + (acc.balance || 0), 0);
            document.getElementById('totalBalance').innerHTML = formatCurrency(totalBalance);

            const income = stats.total_income || 0;
            const expenses = stats.total_expenses || 0;
            const savings = income - expenses;

            document.getElementById('monthlyIncome').innerHTML = formatCurrency(income);
            document.getElementById('monthlyExpenses').innerHTML = formatCurrency(expenses);
            document.getElementById('monthlySavings').innerHTML = formatCurrency(savings);

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
            const now = new Date();
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

            // Данни за 6-месечната графика и топ категориите — паралелно
            const [chartData, categoryData] = await Promise.all([
                this.getLast6MonthsData(),
                api.getCategoryBreakdown(formatDate(startOfMonth), formatDate(endOfMonth), 'expense')
            ]);

            // Income vs Expense chart for last 6 months
            charts.createIncomeExpenseChart('incomeExpenseChart', chartData);

            // Top 5 categories pie chart

            const top5 = categoryData.slice(0, 5);
            const pieData = {
                labels: top5.map(c => c.name),
                values: top5.map(c => c.expenses || 0),
                colors: top5.map(c => c.color || '#999')
            };

            if (pieData.values.some(v => v > 0)) {
                charts.createCategoryPieChart('categoryPieChart', pieData);
            } else {
                // Няма данни — махаме старата графика, за да не остане остаряла
                charts.destroyChart('categoryPieChart');
            }

        } catch (error) {
            console.error('Error loading charts:', error);
        }
    }

    async getLast6MonthsData() {
        const now = new Date();
        const months = [];
        for (let i = 5; i >= 0; i--) {
            months.push(new Date(now.getFullYear(), now.getMonth() - i, 1));
        }

        // Шестте заявки вървят паралелно; редът на резултатите следва реда на месеците
        const statsList = await Promise.all(months.map(async (date) => {
            const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
            const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0);
            try {
                return await api.getTransactionStats(formatDate(startOfMonth), formatDate(endOfMonth));
            } catch (error) {
                return null;
            }
        }));

        const labels = months.map(date => date.toLocaleDateString('bg-BG', { month: 'short', year: 'numeric' }));
        const income = statsList.map(stats => stats?.total_income || 0);
        const expenses = statsList.map(stats => stats?.total_expenses || 0);

        return { labels, income, expenses };
    }

    async loadRecentTransactions() {
        try {
            const result = await api.getTransactions({ limit: 10, offset: 0 });
            const transactions = result.transactions || result;

            const tbody = document.querySelector('#recentTransactionsTable tbody');
            tbody.innerHTML = '';

            if (!transactions || transactions.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">Няма транзакции</td></tr>';
                return;
            }

            transactions.forEach(tx => {
                const counterparty = tx.counterparty_display_name || tx.counterparty_name;
                const title = counterparty || tx.description || '-';
                // Описанието като втори ред само ако има и контрагент
                const subtitle = counterparty && tx.description ? tx.description : '';

                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>${formatDate(tx.transaction_date)}</td>
                    <td>
                        ${escapeHtml(title)}
                        ${subtitle ? `<div style="font-size: 12px; color: var(--text-secondary); margin-top: 2px;">${escapeHtml(subtitle)}</div>` : ''}
                    </td>
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
        return this.load();
    }
}

// Create global instance
const dashboard = new Dashboard();
