// Страница „Отчети“ + списък транзакции от справка и детайли (overlay)

// Състояние на справките, нужно на обработчиците на кликове (вместо window.* глобали)
const reportState = {
    // Период на справката „По категории“ — за клик върху категория
    period: null,
    // Редовете на справките по контрагенти / сметки / месеци и филтрите им — за клик върху „Брой“
    rows: {},
    // Филтрите на справката „По държави“ — за клик върху държава
    country: { types: ['expense'], categoryId: null, categoryName: null },
    // Транзакциите в отворения списък (openTransactionsListModal) — за детайлите (overlay)
    listTransactions: [],
    // Избраният таб в детайлите (overlay) — запазва се при Предишна/Следваща
    overlayTab: 'details',
    // Сметки и държави за детайлите, ако страница Транзакции не ги е заредила
    lookupCache: null
};

// Секциите на справките: таб → id на секцията и генератор, който се пуска при отваряне (ако има)
const REPORT_SECTIONS = {
    monthly: { sectionId: 'monthlyReportSection' },
    counterparty: { sectionId: 'counterpartyReportSection' },
    account: { sectionId: 'accountReportSection' },
    yearly: { sectionId: 'yearlyReportSection', generate: () => generateYearlyReport() },
    country: { sectionId: 'countryReportSection', generate: () => generateCountryReport() },
    category: { sectionId: 'categoryReportSection', generate: () => generateCategoryReport() }
};

const MONTH_NAMES = ['', 'Януари', 'Февруари', 'Март', 'Април', 'Май', 'Юни',
    'Юли', 'Август', 'Септември', 'Октомври', 'Ноември', 'Декември'];

let reportControlsBound = false;

async function loadReportsPage() {
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;

    populateReportPeriod('reportYear', 'reportMonth', currentYear, currentMonth);
    populateReportPeriod('counterpartyReportYear', 'counterpartyReportMonth', currentYear, currentMonth);
    populateReportPeriod('accountReportYear', 'accountReportMonth', currentYear, currentMonth);

    // Бутоните и табовете се вързват само веднъж
    if (reportControlsBound) return;
    reportControlsBound = true;

    document.getElementById('generateReport').addEventListener('click', generateReport);
    document.getElementById('generateCounterpartyReport').addEventListener('click', generateCounterpartyReport);
    document.getElementById('generateAccountReport').addEventListener('click', generateAccountReport);
    document.getElementById('applyCountryFilter')?.addEventListener('click', generateCountryReport);
    document.getElementById('applyCategoryReportFilter')?.addEventListener('click', generateCategoryReport);

    document.querySelectorAll('.report-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.report-tab').forEach(t => {
                const isActive = t === tab;
                t.classList.toggle('active', isActive);
                t.classList.toggle('btn-primary', isActive);
                t.classList.toggle('btn-secondary', !isActive);
            });

            const selected = REPORT_SECTIONS[tab.dataset.report];
            Object.values(REPORT_SECTIONS).forEach(({ sectionId }) => {
                document.getElementById(sectionId).style.display = 'none';
            });
            if (!selected) return;
            document.getElementById(selected.sectionId).style.display = 'block';
            if (selected.generate) selected.generate();
        });
    });
}

// ─── Общи помощници за справките ──────────────────────────────────────────────

// Попълва падащото меню с категории при първо използване; връща select-а
async function ensureCategoryOptions(selectId) {
    const select = document.getElementById(selectId);
    if (select && select.options.length <= 1) {
        const categories = await api.getCategories();
        select.insertAdjacentHTML('beforeend', categoryFilterOptionsHtml(categories));
    }
    return select;
}

// Избраната категория от select-а: { categoryId, categoryName } (null, ако е „Всички“)
function readSelectedCategory(select) {
    const categoryId = select?.value || null;
    const categoryName = categoryId ? select.options[select.selectedIndex].text.replace(' (всички)', '').trim() : null;
    return { categoryId, categoryName };
}

// Отметнатите типове от чекбоксовете `${prefix}Expense|Income|Transfer`.
// Ако няма отметнат — отмята defaults и връща тях.
function readTypeFilters(prefix, defaults) {
    const checkboxId = type => `${prefix}${type.charAt(0).toUpperCase()}${type.slice(1)}`;
    const types = ['expense', 'income', 'transfer']
        .filter(type => document.getElementById(checkboxId(type))?.checked);
    if (types.length > 0) return types;

    defaults.forEach(type => {
        const checkbox = document.getElementById(checkboxId(type));
        if (checkbox) checkbox.checked = true;
    });
    return [...defaults];
}

// Клас за знака на сума: положителна / отрицателна / нула (без клас)
function amountSignClass(amount) {
    return amount > 0 ? 'positive' : (amount < 0 ? 'negative' : '');
}

// Клетките Приходи / Разходи / Нето на ред от справка
function reportAmountCells(income, expenses, net) {
    return `
                        <td class="num positive">${income > 0 ? formatCurrency(income) : '-'}</td>
                        <td class="num negative">${expenses > 0 ? formatCurrency(expenses) : '-'}</td>
                        <td class="num ${net >= 0 ? 'positive' : 'negative'}">${formatCurrency(net)}</td>`;
}

// Сумира брой / приходи / разходи / нето; keys — имената на полетата в редовете
function sumReportTotals(rows, keys = { count: 'count', income: 'income', expenses: 'expenses', net: 'net' }) {
    const totals = { count: 0, income: 0, expenses: 0, net: 0 };
    rows.forEach(row => {
        Object.keys(totals).forEach(key => { totals[key] += row[keys[key]] || 0; });
    });
    return totals;
}

// Ред „Тотал:“ във футъра; emptyCellsAfterCount — празни клетки между „Брой“ и сумите
function renderTotalsRow({ count, income, expenses, net }, { emptyCellsAfterCount = 0 } = {}) {
    return `
                <tr>
                    <td class="num">Тотал:</td>
                    <td class="num">${count}</td>${'\n                    <td></td>'.repeat(emptyCellsAfterCount)}
                    <td class="num positive">${formatCurrency(income)}</td>
                    <td class="num negative">${formatCurrency(expenses)}</td>
                    <td class="num ${net >= 0 ? 'positive' : 'negative'}">${formatCurrency(net)}</td>
                </tr>
            `;
}

// Клетка „Брой транзакции“, която отваря списъка (showReportRowTransactions)
function reportCountCell(reportKey, index, count) {
    return `<td class="num">
        <a href="javascript:void(0)" class="link-dotted" data-action="report-row-tx" data-report-key="${reportKey}" data-index="${index}"
           title="Покажи транзакциите">${count}</a>
    </td>`;
}

// ─── Справки по месец: категории / контрагенти / сметки ──────────────────────

async function generateReport() {
    const year = document.getElementById('reportYear').value;
    const month = document.getElementById('reportMonth').value;

    // Store for category click handler
    reportState.period = { year, month };

    try {
        showLoader();

        const categorySelect = await ensureCategoryOptions('reportFilterCategory');
        const types = readTypeFilters('reportFilter', ['expense', 'income']);
        const { categoryId } = readSelectedCategory(categorySelect);

        const report = await api.getMonthlyReport(year, month, types, categoryId);

        // Show results
        document.getElementById('reportResults').style.display = 'block';

        const categoryBreakdown = report.categoryBreakdown || [];
        const categoryTbody = document.querySelector('#reportCategoryTable tbody');
        const categoryTfoot = document.querySelector('#reportCategoryTable tfoot');

        if (categoryBreakdown.length === 0) {
            categoryTbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">Няма данни</td></tr>';
            categoryTfoot.innerHTML = '';
        } else {
            categoryTbody.innerHTML = renderGroupedRows(categoryBreakdown, (row, trAttrs) => `
                    <tr ${trAttrs}>
                        <td>${categoryGroupToggle(row)}
                            <span class="category-badge clickable" style="background-color: ${row.color};"
                                  data-action="category-tx" data-category-id="${row.id}" data-category-name="${escapeHtml(row.name)}">
                                ${escapeHtml(row.name)}
                            </span>
                        </td>
                        <td class="num">
                            <a href="javascript:void(0)" class="link-dotted" data-action="category-tx" data-category-id="${row.id}" data-category-name="${escapeHtml(row.name)}"
                               title="Покажи транзакциите">${row.count}</a>
                        </td>${reportAmountCells(row.income, row.expenses, row.net)}
                    </tr>
                `);

            categoryTfoot.innerHTML = renderTotalsRow(sumReportTotals(categoryBreakdown));
        }

        makeTableSortable('reportCategoryTable');

    } catch (error) {
        console.error('Error generating report:', error);
        showNotification('Грешка при генериране на отчет', 'error');
    } finally {
        hideLoader();
    }
}

async function generateCounterpartyReport() {
    const year = document.getElementById('counterpartyReportYear').value;
    const month = document.getElementById('counterpartyReportMonth').value;

    try {
        showLoader();

        const categorySelect = await ensureCategoryOptions('counterpartyFilterCategory');
        const types = readTypeFilters('counterpartyFilter', ['expense', 'income']);
        const { categoryId } = readSelectedCategory(categorySelect);

        const report = await api.getMonthlyReport(year, month, types, categoryId);

        document.getElementById('counterpartyReportResults').style.display = 'block';

        const counterpartyBreakdown = report.counterpartyBreakdown || [];
        const counterpartyTbody = document.querySelector('#reportCounterpartyTable tbody');
        const counterpartyTfoot = document.querySelector('#reportCounterpartyTable tfoot');

        reportState.rows.counterparty = { rows: counterpartyBreakdown, filters: { year, month, types, categoryId } };

        if (counterpartyBreakdown.length === 0) {
            counterpartyTbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">Няма данни</td></tr>';
            counterpartyTfoot.innerHTML = '';
        } else {
            counterpartyTbody.innerHTML = counterpartyBreakdown.map((row, index) => {
                const displayName = row.display_name || row.counterparty_name;

                // В колко категории е контрагентът; >1 подсказва непоследователно категоризиране
                const categoryNames = (row.category_names || '').split(',').filter(Boolean);
                const categoryTitle = [
                    ...categoryNames,
                    row.uncategorized_count > 0 ? `Некатегоризирани: ${row.uncategorized_count}` : null
                ].filter(Boolean).join('\n');
                const categoryColor = row.category_count > 1 ? 'var(--warning-color, #f57c00)'
                    : row.category_count === 0 ? 'var(--danger-color)' : 'inherit';

                return `
                    <tr>
                        <td>
                            <a href="https://www.google.com/search?q=${encodeURIComponent(row.counterparty_name)}" target="_blank" rel="noopener" class="link-dotted-inherit" title="Търси в Google">
                                ${escapeHtml(displayName)}
                            </a>
                        </td>
                        ${reportCountCell('counterparty', index, row.transaction_count)}
                        <td class="num" style="color: ${categoryColor}; ${row.category_count !== 1 ? 'font-weight: 600;' : ''}" title="${escapeHtml(categoryTitle)}">${row.category_count}${row.uncategorized_count > 0 && row.category_count > 0 ? ' <span class="negative" title="Има некатегоризирани">*</span>' : ''}</td>${reportAmountCells(row.total_income, row.total_expenses, row.net_amount)}
                    </tr>
                `;
            }).join('');

            const totals = sumReportTotals(counterpartyBreakdown, {
                count: 'transaction_count', income: 'total_income', expenses: 'total_expenses', net: 'net_amount'
            });
            counterpartyTfoot.innerHTML = renderTotalsRow(totals, { emptyCellsAfterCount: 1 });
        }

        makeTableSortable('reportCounterpartyTable');

    } catch (error) {
        console.error('Error generating counterparty report:', error);
        showNotification('Грешка при генериране на отчет по контрагенти', 'error');
    } finally {
        hideLoader();
    }
}

async function generateAccountReport() {
    const year = document.getElementById('accountReportYear').value;
    const month = document.getElementById('accountReportMonth').value;

    try {
        showLoader();

        const categorySelect = await ensureCategoryOptions('accountFilterCategory');
        const types = readTypeFilters('accountFilter', ['expense', 'income']);
        const { categoryId } = readSelectedCategory(categorySelect);

        const report = await api.getMonthlyReport(year, month, types, categoryId);

        document.getElementById('accountReportResults').style.display = 'block';

        const accountBreakdown = report.accountBreakdown || [];
        const accountTbody = document.querySelector('#reportAccountTable tbody');
        const accountTfoot = document.querySelector('#reportAccountTable tfoot');

        reportState.rows.account = { rows: accountBreakdown, filters: { year, month, types, categoryId } };

        if (accountBreakdown.length === 0) {
            accountTbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">Няма данни</td></tr>';
            accountTfoot.innerHTML = '';
        } else {
            accountTbody.innerHTML = accountBreakdown.map((row, index) => {
                const accountName = row.custom_name || row.name || 'Неизвестна';
                const bankName = row.institution_name || '';

                return `
                    <tr>
                        <td>${escapeHtml(accountName)}${bankName ? ` <span style="color: var(--text-muted);">(${escapeHtml(bankName)})</span>` : ''}</td>
                        ${reportCountCell('account', index, row.count)}${reportAmountCells(row.income, row.expenses, row.net)}
                    </tr>
                `;
            }).join('');

            accountTfoot.innerHTML = renderTotalsRow(sumReportTotals(accountBreakdown));
        }

        makeTableSortable('reportAccountTable');

    } catch (error) {
        console.error('Error generating account report:', error);
        showNotification('Грешка при генериране на отчет по сметки', 'error');
    } finally {
        hideLoader();
    }
}

// ─── Справка „По месеци“ (последни 12 месеца) ─────────────────────────────────

async function generateYearlyReport() {
    try {
        showLoader();

        const report = await api.getLast12MonthsReport();

        const tbody = document.querySelector('#yearlyReportTable tbody');
        const tfoot = document.querySelector('#yearlyReportTable tfoot');

        if (!report || report.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">Няма данни</td></tr>';
            tfoot.innerHTML = '';
            return;
        }

        reportState.rows.yearly = { rows: report, filters: {} };

        tbody.innerHTML = report.map((row, index) => `
                <tr>
                    <td>${MONTH_NAMES[row.month]} ${row.year}</td>
                    ${reportCountCell('yearly', index, row.count)}${reportAmountCells(row.income, row.expenses, row.net)}
                </tr>
            `).join('');

        tfoot.innerHTML = renderTotalsRow(sumReportTotals(report));

        makeTableSortable('yearlyReportTable');

    } catch (error) {
        console.error('Error generating yearly report:', error);
        showNotification('Грешка при генериране на отчет', 'error');
    } finally {
        hideLoader();
    }
}

// ─── Справка „По държави“ ─────────────────────────────────────────────────────

async function generateCountryReport() {
    try {
        showLoader();

        const categorySelect = await ensureCategoryOptions('countryFilterCategory');
        const types = readTypeFilters('countryFilter', ['expense']);
        const { categoryId, categoryName } = readSelectedCategory(categorySelect);

        const report = await api.getCountryReport(types, categoryId);

        const tbody = document.querySelector('#countryReportTable tbody');
        const tfoot = document.querySelector('#countryReportTable tfoot');

        if (!report || !report.countries || report.countries.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">Няма данни</td></tr>';
            tfoot.innerHTML = '';
            return;
        }

        // Update year headers
        const years = report.years || [];
        for (let i = 0; i < 5; i++) {
            const yearEl = document.getElementById(`countryYear${5 - i}`);
            if (yearEl) {
                yearEl.textContent = years[i] || '';
            }
        }

        // Calculate totals per year
        const yearTotals = {};
        years.forEach(y => yearTotals[y] = 0);
        let grandTotal = 0;
        let grandTotalCount = 0;

        // Филтрите за клик върху държава
        reportState.country = { types, categoryId, categoryName };

        tbody.innerHTML = report.countries.map(row => {
            let rowTotal = 0;
            const yearCells = years.map(year => {
                const amount = row.years[year] || 0;
                rowTotal += amount;
                yearTotals[year] += amount;
                return `<td class="num ${amountSignClass(amount)}">${amount !== 0 ? formatCurrency(amount) : '-'}</td>`;
            }).join('');

            grandTotal += rowTotal;
            grandTotalCount += row.totalCount || 0;

            const countryDisplay = `${row.flag || ''} ${row.name || row.code}`.trim();

            return `
                <tr>
                    <td>
                        <span class="link-dotted-inherit"
                              data-action="country-tx" data-country-code="${escapeHtml(row.code)}" data-country-name="${escapeHtml(countryDisplay)}">
                            ${escapeHtml(countryDisplay)}
                        </span>
                    </td>
                    ${yearCells}
                    <td class="num ${amountSignClass(rowTotal)}">${formatCurrency(rowTotal)}</td>
                    <td class="num">
                        <a href="javascript:void(0)" class="link-dotted" data-action="country-tx" data-country-code="${escapeHtml(row.code)}" data-country-name="${escapeHtml(countryDisplay)}"
                           title="Покажи транзакциите">${row.totalCount || 0}</a>
                    </td>
                </tr>
            `;
        }).join('');

        // Footer with totals
        const footerYearCells = years.map(year => {
            const amount = yearTotals[year];
            return `<td class="num ${amountSignClass(amount)}">${formatCurrency(amount)}</td>`;
        }).join('');

        tfoot.innerHTML = `
            <tr>
                <td class="num">Тотал:</td>
                ${footerYearCells}
                <td class="num ${amountSignClass(grandTotal)}">${formatCurrency(grandTotal)}</td>
                <td class="num">${grandTotalCount}</td>
            </tr>
        `;

        makeTableSortable('countryReportTable');

    } catch (error) {
        console.error('Error generating country report:', error);
        showNotification('Грешка при генериране на отчет по държави', 'error');
    } finally {
        hideLoader();
    }
}

// ─── Справка „12 месеца“ по категории ─────────────────────────────────────────

async function generateCategoryReport() {
    try {
        showLoader();

        const types = readTypeFilters('categoryReportFilter', ['expense']);

        const report = await api.getCategoryMonthlyReport(types);

        const tbody = document.querySelector('#categoryReportTable tbody');
        const tfoot = document.querySelector('#categoryReportTable tfoot');

        if (!report || !report.categories || report.categories.length === 0) {
            tbody.innerHTML = '<tr><td colspan="14" class="text-center text-muted">Няма данни</td></tr>';
            tfoot.innerHTML = '';
            return;
        }

        // Update month headers
        const months = report.months || [];
        for (let i = 0; i < 12; i++) {
            const monthEl = document.getElementById(`catMonth${12 - i}`);
            if (monthEl && months[i]) {
                monthEl.textContent = months[i].label;
            }
        }

        // Calculate totals per month
        const monthTotals = {};
        months.forEach(m => monthTotals[m.key] = 0);
        let grandTotal = 0;

        // Тоталите — само от горното ниво (групите вече съдържат подкатегориите си)
        report.categories.forEach(row => {
            months.forEach(month => {
                const data = row.months[month.key];
                const amount = data ? data.amount : 0;
                monthTotals[month.key] += amount;
                grandTotal += amount;
            });
        });

        tbody.innerHTML = renderGroupedRows(report.categories, (row, trAttrs) => {
            let rowTotal = 0;
            const monthCells = months.map(month => {
                const data = row.months[month.key];
                const amount = data ? data.amount : 0;
                rowTotal += amount;
                const amountClass = amountSignClass(amount);
                if (amount !== 0) {
                    // month.key is "YYYY-MM", parse to year/month for the period
                    const [y, m] = month.key.split('-');
                    return `<td class="num clickable ${amountClass}" data-action="category-tx" data-category-id="${row.id}" data-category-name="${escapeHtml(row.name)}" data-year="${y}" data-month="${parseInt(m)}" title="${escapeHtml(row.name)} - ${month.label}">${formatCurrency(amount)}</td>`;
                }
                return `<td class="num ${amountClass}">-</td>`;
            }).join('');

            return `
                <tr ${trAttrs}>
                    <td>${categoryGroupToggle(row)}
                        <span class="category-badge" style="background-color: ${row.color};">
                            ${escapeHtml(row.name)}
                        </span>
                    </td>
                    ${monthCells}
                    <td class="num ${amountSignClass(rowTotal)}">${formatCurrency(rowTotal)}</td>
                </tr>
            `;
        });

        // Footer with totals
        const footerMonthCells = months.map(month => {
            const amount = monthTotals[month.key];
            return `<td class="num ${amountSignClass(amount)}">${formatCurrency(amount)}</td>`;
        }).join('');

        tfoot.innerHTML = `
            <tr>
                <td class="num">Тотал:</td>
                ${footerMonthCells}
                <td class="num ${amountSignClass(grandTotal)}">${formatCurrency(grandTotal)}</td>
            </tr>
        `;

        makeTableSortable('categoryReportTable');

    } catch (error) {
        console.error('Error generating category report:', error);
        showNotification('Грешка при генериране на справка по категории', 'error');
    } finally {
        hideLoader();
    }
}

// ─── Списъци с транзакции зад редовете на справките ──────────────────────────

// Транзакциите в категория за месец (по подразбиране — периодът на справката „По категории“)
async function showCategoryTransactions(categoryId, categoryName, periodOverride) {
    const period = periodOverride || reportState.period;
    if (!period) return;

    const startDate = `${period.year}-${String(period.month).padStart(2, '0')}-01`;
    const endOfMonth = new Date(period.year, period.month, 0);
    const endDate = `${period.year}-${String(period.month).padStart(2, '0')}-${endOfMonth.getDate()}`;

    try {
        showLoader();

        const params = {
            start_date: startDate,
            end_date: endDate,
            category_id: categoryId === null ? 'uncategorized' : categoryId,
            limit: 500
        };

        const result = await api.getTransactions(params);
        const transactions = result.transactions || result;
        const total = Number(result.total) || transactions.length;
        const note = total > transactions.length
            ? `Показани са първите ${transactions.length} от ${total} транзакции.`
            : '';

        openTransactionsListModal(`Транзакции: ${categoryName}`, transactions, { note });

    } catch (error) {
        console.error('Error loading category transactions:', error);
        showNotification('Грешка при зареждане на транзакции', 'error');
    } finally {
        hideLoader();
    }
}

// Транзакциите зад ред от справка по контрагенти / по сметки / по месеци (същите филтри като справката)
async function showReportRowTransactions(reportKey, index) {
    const report = reportState.rows[reportKey];
    const row = report?.rows[index];
    if (!row) return;

    let { year, month, types, categoryId } = report.filters;
    let title, rowFilter;
    if (reportKey === 'counterparty') {
        title = `Транзакции: ${row.display_name || row.counterparty_name}`;
        rowFilter = { counterparty: row.counterparty_name };
    } else if (reportKey === 'account') {
        title = `Транзакции: ${row.custom_name || row.name || 'Неизвестна'}`;
        rowFilter = { accountId: row.id };
    } else {
        // По месеци: всеки ред е отделен месец, без трансферите
        ({ year, month } = row);
        title = `Транзакции: ${String(month).padStart(2, '0')}/${year}`;
        rowFilter = {};
    }

    try {
        showLoader();
        const transactions = await api.getReportTransactions(year, month, types, categoryId, rowFilter);
        openTransactionsListModal(title, transactions, { showCategory: true });
    } catch (error) {
        console.error('Error loading report transactions:', error);
        showNotification('Грешка при зареждане на транзакции', 'error');
    } finally {
        hideLoader();
    }
}

// Транзакциите за държава — със същите филтри като справката „По държави“
async function showCountryTransactions(countryCode, countryName) {
    const { types, categoryId, categoryName } = reportState.country;

    try {
        showLoader();

        // Същите филтри като справката (типове, категория, всички години), за да съвпада „Брой“
        const transactions = await api.getReportTransactions(null, null, types, categoryId, { country: countryCode });

        const typeLabels = {
            'expense': '💸 Разходи',
            'income': '💰 Приходи',
            'transfer': '🔄 Трансфери'
        };
        const typeLabel = types.map(t => typeLabels[t] || t).join(', ');
        const categoryLabel = categoryName ? ` | ${categoryName}` : '';

        openTransactionsListModal(`Транзакции: ${countryName} (${typeLabel}${categoryLabel})`, transactions, { showCategory: true });

    } catch (error) {
        console.error('Error loading country transactions:', error);
        showNotification('Грешка при зареждане на транзакции', 'error');
    } finally {
        hideLoader();
    }
}

// Модал със списък транзакции; клик на ред отваря детайлите им (showTransactionOverlay)
// note — по избор: текст над таблицата (напр. при съкратен списък)
function openTransactionsListModal(title, transactions, { showCategory = false, note = '' } = {}) {
    let body;
    if (!transactions || transactions.length === 0) {
        reportState.listTransactions = [];
        body = '<p class="text-muted text-center">Няма транзакции за този период</p>';
    } else {
        // Store transactions for overlay detail view
        reportState.listTransactions = transactions;

        let totalAmount = 0;
        const rows = transactions.map((tx, idx) => {
            totalAmount += tx.amount;
            const amountColor = tx.amount >= 0 ? 'var(--primary-color)' : 'var(--danger-color)';
            const categoryCell = !showCategory ? '' : `<td>${tx.category_name
                ? `<span class="category-badge" style="background-color: ${tx.category_color}">${escapeHtml(tx.category_name)}</span>`
                : '<span style="color: var(--danger-color); font-weight: 600;">Некатегоризирана</span>'}</td>`;
            return `
                <tr class="clickable" data-action="tx-overlay" data-index="${idx}" title="Натисни за детайли">
                    <td style="white-space: nowrap;">${formatDate(new Date(tx.transaction_date))}</td>
                    <td>${escapeHtml(tx.counterparty_name || tx.description || '-')}</td>
                    ${categoryCell}
                    <td class="num" style="font-weight: 600; color: ${amountColor};">
                        ${formatCurrency(tx.amount)}
                    </td>
                </tr>
            `;
        }).join('');

        const totalColor = totalAmount >= 0 ? 'var(--primary-color)' : 'var(--danger-color)';
        body = `
            ${note ? `<div class="list-note" role="note">⚠️ ${escapeHtml(note)}</div>` : ''}
            <div class="table-responsive" style="max-height: 400px; overflow-y: auto;">
                <table class="table">
                    <thead>
                        <tr>
                            <th style="width: 100px;">Дата</th>
                            <th>Контрагент</th>
                            ${showCategory ? '<th style="width: 180px;">Категория</th>' : ''}
                            <th class="num" style="width: 120px;">Сума</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                    <tfoot class="table-totals">
                        <tr>
                            <td colspan="${showCategory ? 3 : 2}" class="num">Тотал (${transactions.length} транзакции):</td>
                            <td class="num" style="color: ${totalColor};">${formatCurrency(totalAmount)}</td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        `;
    }

    openModal({
        title,
        body,
        showSave: false,
        cancelText: 'Затвори',
        maxWidth: showCategory ? '950px' : '800px',
        key: 'tx-list',
        // Детайлите (overlay) принадлежат на списъка — затварят се заедно с него
        onClose: () => closeOverlay()
    });
}

// Сметки и държави за изгледа с детайли (взимат се от страница Транзакции, ако вече са заредени)
async function getDetailsLookupData() {
    const page = typeof transactionsPage !== 'undefined' ? transactionsPage : null;
    if (page && page.accounts.length > 0 && page.countries.length > 0) {
        return { accounts: page.accounts, countries: page.countries };
    }
    if (!reportState.lookupCache) {
        try {
            const [accounts, countries] = await Promise.all([api.getAccounts(), api.getCountries()]);
            reportState.lookupCache = { accounts: accounts || [], countries: countries || [] };
        } catch (error) {
            console.error('Error loading accounts/countries for details:', error);
            return { accounts: [], countries: [] };
        }
    }
    return reportState.lookupCache;
}

// Детайли на транзакция от списък в справка (само за четене) — същият изглед като в страница Транзакции
async function showTransactionOverlay(index) {
    const transactions = reportState.listTransactions;
    if (!transactions || !transactions[index]) return;
    const tx = transactions[index];

    const { accounts, countries } = await getDetailsLookupData();
    // Докато са се зареждали данните, списъкът може да е затворен
    if (!isModalOpen('tx-list') || reportState.listTransactions !== transactions) return;

    const account = accounts.find(a => a.id === tx.account_id) || null;
    const hasPrev = index > 0;
    const hasNext = index < transactions.length - 1;
    const navStyle = enabled => enabled ? '' : 'opacity: 0.5; cursor: not-allowed;';

    openOverlay({
        key: 'tx-overlay',
        title: `Детайли на транзакция (${index + 1}/${transactions.length})`,
        body: renderTransactionDetails(tx, { account, countries, activeTab: reportState.overlayTab }),
        footer: `
            <button type="button" id="overlayPrevTx" class="btn btn-secondary" ${hasPrev ? '' : 'disabled'} style="${navStyle(hasPrev)}">← Предишна</button>
            <button type="button" id="overlayNextTx" class="btn btn-secondary" ${hasNext ? '' : 'disabled'} style="${navStyle(hasNext)}">Следваща →</button>
            <button type="button" class="btn btn-secondary" data-modal-close>Затвори</button>
        `,
        footerAlign: 'space-between',
        maxWidth: '800px',
        className: 'modal-compact',
        autofocus: false
    });

    bindTransactionDetails(document.getElementById('overlayModalBody'), tx, {
        onTabChange: tab => { reportState.overlayTab = tab; }
    });
    document.getElementById('overlayPrevTx')?.addEventListener('click', () => {
        if (hasPrev) showTransactionOverlay(index - 1);
    });
    document.getElementById('overlayNextTx')?.addEventListener('click', () => {
        if (hasNext) showTransactionOverlay(index + 1);
    });
}
