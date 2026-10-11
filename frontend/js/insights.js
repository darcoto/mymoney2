// Аналитични справки в „Отчети“: паричен поток, повтарящи се плащания, сравнение с миналата
// година, банкови разходи, пътувания. Изчисленията са в backend/insights.js.

const insightState = {
    // Списъците с транзакции зад редовете — за клик (data-action="insight-tx")
    lists: {},
    cashflowChart: null,
    compareBound: false
};

// Табовете се добавят към справките от reports.js
Object.assign(REPORT_SECTIONS, {
    cashflow: { sectionId: 'cashflowReportSection', generate: () => generateCashFlowReport() },
    recurring: { sectionId: 'recurringReportSection', generate: () => generateRecurringReport() },
    compare: { sectionId: 'compareReportSection', generate: () => generateCompareReport() },
    bankcosts: { sectionId: 'bankcostsReportSection', generate: () => generateBankCostsReport() },
    trips: { sectionId: 'tripsReportSection', generate: () => generateTripsReport() }
});

const MONTH_SHORT = ['', 'яну', 'фев', 'мар', 'апр', 'май', 'юни', 'юли', 'авг', 'сеп', 'окт', 'ное', 'дек'];

function insightCard(label, value, sub = '', valueClass = '') {
    return `
        <div class="insight-card">
            <div class="insight-label">${escapeHtml(label)}</div>
            <div class="insight-value ${valueClass}">${value}</div>
            ${sub ? `<div class="insight-sub">${sub}</div>` : ''}
        </div>`;
}

function formatPercent(value, { sign = false } = {}) {
    if (value === null || value === undefined || !isFinite(value)) return '—';
    const rounded = Math.round(value);
    return `${sign && rounded > 0 ? '+' : ''}${rounded}%`;
}

function monthLabel(key) {
    const [y, m] = key.split('-');
    return `${MONTH_NAMES[Number(m)]} ${y}`;
}

// Клетка „брой“, която отваря списъка с транзакции (insightState.lists[key][index])
function insightCountLink(key, index, count) {
    return `<a href="javascript:void(0)" class="link-dotted" data-action="insight-tx" data-insight-key="${key}" data-index="${index}" title="Покажи транзакциите">${count}</a>`;
}

function showInsightTransactions(key, index) {
    const entry = (insightState.lists[key] || [])[index];
    if (!entry) return;
    openTransactionsListModal(entry.title, entry.transactions, { showCategory: true });
}

async function runInsight(name, fn) {
    try {
        showLoader();
        await fn();
    } catch (error) {
        console.error(`Error generating ${name} report:`, error);
        showNotification('Грешка при генериране на справката', 'error');
    } finally {
        hideLoader();
    }
}

// ─── 1. Паричен поток и норма на спестяване ──────────────────────────────────

async function generateCashFlowReport() {
    await runInsight('cash flow', async () => {
        const report = await api.getCashFlowReport(24);
        const { last12, yearToDate } = report;
        const rateClass = rate => rate === null ? '' : (rate >= 0 ? 'positive' : 'negative');

        document.getElementById('cashflowSummary').innerHTML = [
            insightCard('Норма на спестяване (12 месеца)', formatPercent(last12.savingsRate), `спестени ${formatCurrency(last12.savings)}`, rateClass(last12.savingsRate)),
            insightCard('Норма от началото на годината', formatPercent(yearToDate.savingsRate), `спестени ${formatCurrency(yearToDate.savings)}`, rateClass(yearToDate.savingsRate)),
            insightCard('Среден приход на месец', formatCurrency(last12.avgIncome), 'последните 12 месеца', 'positive'),
            insightCard('Среден разход на месец', formatCurrency(last12.avgExpenses), 'последните 12 месеца', 'negative'),
            last12.invested ? insightCard('Вложено в инвестиции', formatCurrency(last12.invested), 'последните 12 месеца (част от спестеното)') : ''
        ].join('');
        const hasInvested = report.months.some(m => m.invested);
        document.getElementById('cashflowInvestedHeader').style.display = hasInvested ? '' : 'none';

        const months = report.months;
        const ctx = document.getElementById('cashflowChart');
        if (insightState.cashflowChart) insightState.cashflowChart.destroy();
        insightState.cashflowChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: months.map(m => `${MONTH_SHORT[m.monthNumber]} ${String(m.year).slice(2)}`),
                datasets: [
                    { type: 'bar', label: 'Приходи', data: months.map(m => m.income), backgroundColor: 'rgba(76, 175, 80, 0.6)', yAxisID: 'y' },
                    { type: 'bar', label: 'Разходи', data: months.map(m => m.expenses), backgroundColor: 'rgba(244, 67, 54, 0.6)', yAxisID: 'y' },
                    { type: 'line', label: 'Спестено', data: months.map(m => m.savings), borderColor: '#2196F3', backgroundColor: '#2196F3', tension: 0.3, yAxisID: 'y' }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: c => `${c.dataset.label}: ${Math.round(c.parsed.y).toLocaleString('bg-BG')} €`,
                            footer: items => {
                                const m = months[items[0].dataIndex];
                                return m.savingsRate === null ? '' : `Норма на спестяване: ${Math.round(m.savingsRate)}%`;
                            }
                        }
                    }
                },
                scales: { y: { ticks: { callback: v => `${Math.round(v).toLocaleString('bg-BG')} €` } } }
            }
        });

        // Таблицата — най-новите отгоре
        document.querySelector('#cashflowTable tbody').innerHTML = [...months].reverse().map(m => `
            <tr>
                <td>${monthLabel(m.month)}</td>
                <td class="num positive">${formatCurrency(m.income)}</td>
                <td class="num negative">${formatCurrency(m.expenses)}</td>
                <td class="num ${m.savings >= 0 ? 'positive' : 'negative'}">${formatCurrency(m.savings)}</td>
                ${hasInvested ? `<td class="num">${m.invested ? formatCurrency(m.invested) : '-'}</td>` : ''}
                <td class="num ${rateClass(m.savingsRate)}">${formatPercent(m.savingsRate)}</td>
            </tr>`).join('');
    });
}

// ─── 2. Повтарящи се плащания ────────────────────────────────────────────────

const FREQUENCY_LABELS = { monthly: 'месечно', quarterly: 'на 3 месеца', yearly: 'годишно' };

async function generateRecurringReport() {
    await runInsight('recurring', async () => {
        const report = await api.getRecurringReport();
        const { items, totals } = report;
        const stopped = items.filter(i => !i.active);

        document.getElementById('recurringSummary').innerHTML = [
            insightCard('Активни повтарящи се плащания', String(totals.active)),
            insightCard('Общо на месец', formatCurrency(totals.monthly), '', 'negative'),
            insightCard('Общо на година', formatCurrency(totals.yearly), '', 'negative'),
            insightCard('Спрени', String(stopped.length), 'без плащане в очаквания срок')
        ].join('');

        insightState.lists.recurring = items.map(i => ({ title: `Плащания: ${i.name}`, transactions: i.transactions }));

        const tbody = document.querySelector('#recurringTable tbody');
        if (!items.length) {
            tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted">Няма открити повтарящи се плащания</td></tr>';
            return;
        }
        tbody.innerHTML = items.map((item, index) => {
            const change = item.change
                ? ` <span class="insight-tag warn" title="Спрямо предишните плащания">${item.change > 0 ? '↑' : '↓'} ${formatCurrencyExact(Math.abs(item.change))}</span>`
                : '';
            const amount = item.stable
                ? formatCurrencyExact(item.lastAmount)
                : `<span title="Сумата се променя — показана е типичната">~${formatCurrency(item.typicalAmount)}</span>`;
            return `
                <tr class="${item.active ? '' : 'insight-muted-row'}">
                    <td>${escapeHtml(item.name)}</td>
                    <td>${item.category !== '—' ? `<span class="category-badge" style="background-color: ${item.categoryColor || '#9e9e9e'};">${escapeHtml(item.category)}</span>` : '<span class="text-muted">—</span>'}</td>
                    <td>${FREQUENCY_LABELS[item.frequency]}${item.active ? '' : ' <span class="insight-tag">спрян</span>'}</td>
                    <td class="num">${amount}${change}</td>
                    <td class="num">${item.active ? formatCurrency(item.monthlyCost) : '—'}</td>
                    <td class="num">${item.active ? formatCurrency(item.yearlyCost) : '—'}</td>
                    <td>${formatDisplayDate(item.lastDate)}</td>
                    <td>${item.nextDate ? formatDisplayDate(item.nextDate) : '—'}</td>
                    <td class="num">${insightCountLink('recurring', index, item.count)}</td>
                </tr>`;
        }).join('');
    });
}

// ─── 3. Сравнение с миналата година ──────────────────────────────────────────

function initCompareFilters() {
    if (insightState.compareBound) return;
    insightState.compareBound = true;

    const now = new Date();
    const yearSelect = document.getElementById('compareYear');
    const monthSelect = document.getElementById('compareMonth');
    for (let y = now.getFullYear(); y >= now.getFullYear() - 4; y--) {
        yearSelect.insertAdjacentHTML('beforeend', `<option value="${y}">${y}</option>`);
    }
    for (let m = 1; m <= 12; m++) {
        monthSelect.insertAdjacentHTML('beforeend', `<option value="${m}">${MONTH_NAMES[m]}</option>`);
    }
    // По подразбиране — последният завършен месец
    const last = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    yearSelect.value = last.getFullYear();
    monthSelect.value = last.getMonth() + 1;

    document.getElementById('applyCompare').addEventListener('click', generateCompareReport);
}

async function generateCompareReport() {
    initCompareFilters();
    const year = Number(document.getElementById('compareYear').value);
    const month = Number(document.getElementById('compareMonth').value);
    const mode = document.querySelector('input[name="compareMode"]:checked').value;

    await runInsight('compare', async () => {
        const report = await api.getYearComparisonReport(year, month, mode);
        const periodLabel = y => mode === 'ytd'
            ? `${MONTH_SHORT[1]}–${MONTH_SHORT[month]} ${y}`
            : `${MONTH_NAMES[month]} ${y}`;
        const { expense, income } = report.totals;
        // При разходите ръст е лош (червено), при приходите — добър
        const diffClass = (diff, isExpense) => diff === 0 ? '' : ((diff > 0) === isExpense ? 'negative' : 'positive');

        document.getElementById('compareSummary').innerHTML = [
            insightCard(`Разходи ${periodLabel(year)}`, formatCurrency(expense.current),
                `${periodLabel(year - 1)}: ${formatCurrency(expense.previous)} (<span class="${diffClass(expense.diff, true)}">${formatPercent(expense.pct, { sign: true })}</span>)`, 'negative'),
            insightCard(`Приходи ${periodLabel(year)}`, formatCurrency(income.current),
                `${periodLabel(year - 1)}: ${formatCurrency(income.previous)} (<span class="${diffClass(income.diff, false)}">${formatPercent(income.pct, { sign: true })}</span>)`, 'positive')
        ].join('');

        document.getElementById('comparePrevHeader').textContent = periodLabel(year - 1);
        document.getElementById('compareCurHeader').textContent = periodLabel(year);
        document.getElementById('compareTitle').textContent = 'По категории';

        // Списъците зад клетките: [категория][период]
        const lists = [];
        const periods = { current: report.current, previous: report.previous };
        const row = (r, isExpense, trAttrs = '') => {
            const index = lists.length;
            lists.push(r);
            const cell = (field) => r[field]
                ? `<a href="javascript:void(0)" class="link-dotted" data-action="compare-tx" data-index="${index}" data-period="${field}" title="Покажи транзакциите">${formatCurrency(r[field])}</a>`
                : '-';
            return `
                <tr ${trAttrs}>
                    <td>${categoryGroupToggle(r)}<span class="category-badge" style="background-color: ${r.color};">${escapeHtml(r.name)}</span></td>
                    <td class="num">${cell('previous')}</td>
                    <td class="num">${cell('current')}</td>
                    <td class="num ${diffClass(r.diff, isExpense)}">${r.diff > 0 ? '+' : ''}${formatCurrency(r.diff)}</td>
                    <td class="num ${diffClass(r.diff, isExpense)}">${formatPercent(r.pct, { sign: true })}</td>
                </tr>`;
        };
        const groupRow = (label, t, isExpense) => `
            <tr class="table-group-row">
                <td><strong>${label}</strong></td>
                <td class="num"><strong>${formatCurrency(t.previous)}</strong></td>
                <td class="num"><strong>${formatCurrency(t.current)}</strong></td>
                <td class="num ${diffClass(t.diff, isExpense)}"><strong>${t.diff > 0 ? '+' : ''}${formatCurrency(t.diff)}</strong></td>
                <td class="num ${diffClass(t.diff, isExpense)}"><strong>${formatPercent(t.pct, { sign: true })}</strong></td>
            </tr>`;

        document.querySelector('#compareTable tbody').innerHTML =
            groupRow('💸 Разходи', expense, true) + renderGroupedRows(report.expenses, (r, attrs) => row(r, true, attrs)) +
            groupRow('💰 Приходи', income, false) + renderGroupedRows(report.income, (r, attrs) => row(r, false, attrs));

        insightState.compare = { lists, periods };
    });
}

async function showCompareTransactions(index, period) {
    const state = insightState.compare;
    const r = state && state.lists[index];
    if (!r) return;
    const range = state.periods[period];
    try {
        showLoader();
        const result = await api.getTransactions({
            start_date: range.start,
            end_date: range.end,
            category_id: r.id === null ? 'uncategorized' : r.id,
            limit: 500
        });
        const transactions = result.transactions || result;
        openTransactionsListModal(`${r.name}: ${formatDisplayDate(range.start)} – ${formatDisplayDate(range.end)}`, transactions, { showCategory: true });
    } catch (error) {
        console.error('Error loading compare transactions:', error);
        showNotification('Грешка при зареждане на транзакции', 'error');
    } finally {
        hideLoader();
    }
}

// ─── 4. Банкови разходи ──────────────────────────────────────────────────────

async function generateBankCostsReport() {
    await runInsight('bank costs', async () => {
        const report = await api.getBankCostsReport();
        const { years } = report;
        const thisYear = String(new Date().getFullYear());
        const costs = report.kinds.filter(k => k.key !== 'cashback');
        const cashback = report.kinds.find(k => k.key === 'cashback');
        const costThisYear = costs.reduce((s, k) => s + (k.years[thisYear] || 0), 0);
        const costLastYear = costs.reduce((s, k) => s + (k.years[String(thisYear - 1)] || 0), 0);
        const interest = report.kinds.find(k => k.key === 'interest');

        document.getElementById('bankcostsSummary').innerHTML = [
            insightCard(`Такси и лихви ${thisYear}`, formatCurrencyExact(costThisYear), `${thisYear - 1}: ${formatCurrencyExact(costLastYear)}`, 'negative'),
            insightCard(`Лихви ${thisYear}`, formatCurrencyExact(interest ? (interest.years[thisYear] || 0) : 0), 'кредитна карта и овърдрафт', 'negative'),
            insightCard('Кешбек и върнати такси', formatCurrencyExact(cashback ? cashback.total : 0), 'за целия период', 'positive'),
            insightCard('Нето за целия период', formatCurrencyExact(report.total), '', report.total >= 0 ? 'positive' : 'negative')
        ].join('');

        const head = first => `<tr><th>${first}</th>${years.map(y => `<th class="num">${y}</th>`).join('')}<th class="num">Общо</th><th class="num">Брой</th></tr>`;
        const cells = obj => years.map(y => `<td class="num ${amountSignClass(obj.years[y] || 0)}">${obj.years[y] ? formatCurrencyExact(obj.years[y]) : '-'}</td>`).join('');

        insightState.lists.bankKinds = report.kinds.map(k => ({ title: `Банкови: ${k.label}`, transactions: k.transactions }));
        insightState.lists.bankBanks = report.banks.map(b => ({ title: `Банкови: ${b.label}`, transactions: b.transactions }));

        const kindTable = document.getElementById('bankcostsKindTable');
        kindTable.querySelector('thead').innerHTML = head('Вид');
        kindTable.querySelector('tbody').innerHTML = report.kinds.map((k, i) => `
            <tr><td>${escapeHtml(k.label)}</td>${cells(k)}<td class="num ${amountSignClass(k.total)}">${formatCurrencyExact(k.total)}</td><td class="num">${insightCountLink('bankKinds', i, k.transactions.length)}</td></tr>`).join('');
        kindTable.querySelector('tfoot').innerHTML = `
            <tr><td class="num">Тотал:</td>${years.map(y => `<td class="num ${amountSignClass(report.yearTotals[y])}">${formatCurrencyExact(report.yearTotals[y])}</td>`).join('')}<td class="num ${amountSignClass(report.total)}">${formatCurrencyExact(report.total)}</td><td></td></tr>`;

        const bankTable = document.getElementById('bankcostsBankTable');
        bankTable.querySelector('thead').innerHTML = head('Банка');
        bankTable.querySelector('tbody').innerHTML = report.banks.map((b, i) => `
            <tr><td>${escapeHtml(b.label)}</td>${cells(b)}<td class="num ${amountSignClass(b.total)}">${formatCurrencyExact(b.total)}</td><td class="num">${insightCountLink('bankBanks', i, b.transactions.length)}</td></tr>`).join('');
    });
}

// ─── 5. Пътувания ────────────────────────────────────────────────────────────

async function generateTripsReport() {
    await runInsight('trips', async () => {
        const report = await api.getTripsReport();
        const years = Object.keys(report.byYear).sort().reverse();

        document.getElementById('tripsSummary').innerHTML = years.map(y => {
            const s = report.byYear[y];
            return insightCard(`Пътувания ${y}`, formatCurrency(s.total), `${s.trips} пътувания, ${s.days} дни`, 'negative');
        }).join('');

        insightState.lists.trips = report.trips.map(t => ({
            title: `Пътуване: ${t.countries.map(c => c.name).join(', ')} (${formatDisplayDate(t.start)} – ${formatDisplayDate(t.end)})`,
            transactions: t.transactions
        }));

        const list = document.getElementById('tripsList');
        if (!report.trips.length) {
            list.innerHTML = '<p class="text-muted text-center">Няма открити пътувания в чужбина</p>';
            return;
        }
        list.innerHTML = report.trips.map((trip, index) => {
            const flags = trip.countries.map(c => c.flag).join(' ');
            const names = trip.countries.map(c => c.name).join(', ');
            const bar = trip.categories.map(c =>
                `<span style="width: ${(c.amount / trip.total) * 100}%; background-color: ${c.color};" title="${escapeHtml(c.name)}: ${Math.round(c.amount)} €"></span>`).join('');
            const legend = trip.categories.map(c =>
                `<span><span class="dot" style="background-color: ${c.color};"></span>${escapeHtml(c.name)} ${formatCurrency(c.amount)}</span>`).join('');
            return `
                <div class="trip-card">
                    <div class="trip-head">
                        <div class="trip-title">${flags} ${escapeHtml(names)}</div>
                        <div class="trip-total negative">${formatCurrency(trip.total)}</div>
                    </div>
                    <div class="trip-meta">
                        ${formatDisplayDate(trip.start)} – ${formatDisplayDate(trip.end)} · ${trip.days} ${trip.days === 1 ? 'ден' : 'дни'} ·
                        ${insightCountLink('trips', index, `${trip.count} плащания`)} · ${formatCurrency(trip.total / trip.days)} на ден
                    </div>
                    <div class="trip-bar">${bar}</div>
                    <div class="trip-cats">${legend}</div>
                </div>`;
        }).join('');
    });
}
