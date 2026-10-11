// Transactions page functionality

class TransactionsPage {
    constructor() {
        this.currentPage = 0;
        this.pageSize = 50;
        this.totalCount = 0;
        this.totalAmount = 0;
        this.filters = {};
        this.transactions = [];
        this.categories = [];
        this.accounts = [];
        this.countries = [];
        this.currentTransactionIndex = -1; // For prev/next navigation in modal
    }

    async init() {
        // Load categories, accounts, and countries for filters
        try {
            [this.categories, this.accounts, this.countries] = await Promise.all([
                api.getCategories(),
                api.getAccounts(),
                api.getCountries()
            ]);

            this.populateFilterDropdowns();
            // init() се вика при всяко отваряне на страницата — слушателите се закачат само веднъж
            if (!this.listenersAttached) {
                this.attachEventListeners();
                this.listenersAttached = true;
            }
        } catch (error) {
            console.error('Error initializing transactions page:', error);
        }
    }

    populateFilterDropdowns() {
        // Запазваме текущия избор при презареждане на списъците
        const previous = {};
        ['filterAccount', 'filterCategory', 'filterCountry'].forEach(id => {
            previous[id] = document.getElementById(id)?.value || '';
        });
        const restore = (select) => {
            const prev = previous[select.id];
            if (prev && Array.from(select.options).some(o => o.value === prev)) {
                select.value = prev;
            }
        };

        // Populate account filter
        const accountSelect = document.getElementById('filterAccount');
        accountSelect.innerHTML = '<option value="">Всички сметки</option>';
        this.accounts.forEach(account => {
            const option = document.createElement('option');
            option.value = account.id;
            option.textContent = account.custom_name || account.name;
            accountSelect.appendChild(option);
        });
        restore(accountSelect);

        // Populate category filter
        const categorySelect = document.getElementById('filterCategory');
        categorySelect.innerHTML = '<option value="">Всички категории</option><option value="uncategorized">Без категория</option>' +
            categoryFilterOptionsHtml(this.categories);
        restore(categorySelect);

        // Populate country filter
        const countrySelect = document.getElementById('filterCountry');
        if (countrySelect && this.countries) {
            countrySelect.innerHTML = '<option value="">Всички</option><option value="none">Без държава</option>';
            this.countries.forEach(country => {
                const option = document.createElement('option');
                option.value = country.code;
                option.textContent = `${country.flag || ''} ${country.name || country.code}`.trim();
                countrySelect.appendChild(option);
            });
            restore(countrySelect);
        }
    }

    attachEventListeners() {
        document.querySelector('#transactionsTable tbody')?.addEventListener('click', (e) => this.handleTableClick(e));
        document.getElementById('applyFilters').addEventListener('click', () => this.applyFilters());
        document.getElementById('clearFilters').addEventListener('click', () => this.clearFilters());

        // Quick date filter buttons
        document.getElementById('filterThisMonth')?.addEventListener('click', () => this.setDateFilter('thisMonth'));
        document.getElementById('filterLastMonth')?.addEventListener('click', () => this.setDateFilter('lastMonth'));
        document.getElementById('filterLastYear')?.addEventListener('click', () => this.setDateFilter('lastYear'));

        // Quick filter uncategorized button
        const quickFilterBtn = document.getElementById('quickFilterUncategorized');
        quickFilterBtn?.addEventListener('click', (e) => {
            // Бутонът е в заглавката на филтрите — да не я сгъва/разгъва
            e.stopPropagation();
            this.filterUncategorized();
        });

        // Пагинация (горе и долу): делегиран слушател за бутоните с data-page-index
        ['transactionsPaginationTop', 'transactionsPagination'].forEach(id => {
            document.getElementById(id)?.addEventListener('click', (e) => {
                const btn = e.target.closest('button[data-page-index]');
                if (btn && !btn.disabled) this.goToPage(Number(btn.dataset.pageIndex));
            });
        });

        // Filter section toggle
        const filtersToggle = document.getElementById('filtersToggle');
        const filtersBody = document.getElementById('filtersBody');
        const filtersToggleIcon = document.getElementById('filtersToggleIcon');

        if (filtersToggle && filtersBody) {
            filtersToggle.addEventListener('click', () => {
                const isVisible = filtersBody.style.display !== 'none';
                filtersBody.style.display = isVisible ? 'none' : 'block';
                filtersToggleIcon.textContent = isVisible ? '▼' : '▲';
                // Toggle quick filter button visibility
                if (quickFilterBtn) {
                    quickFilterBtn.style.display = isVisible ? 'inline-flex' : 'none';
                }
            });
        }
    }

    filterUncategorized() {
        // Clear other filters and set category to uncategorized
        document.getElementById('filterStartDate').value = '';
        document.getElementById('filterEndDate').value = '';
        document.getElementById('filterAccount').value = '';
        document.getElementById('filterCategory').value = 'uncategorized';
        document.getElementById('filterType').value = '';
        document.getElementById('filterCountry').value = '';
        document.getElementById('filterSearch').value = '';

        this.applyFilters();
    }

    setDateFilter(period) {
        const now = new Date();
        let startDate, endDate;

        switch (period) {
            case 'thisMonth':
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
                break;
            case 'lastMonth':
                startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                endDate = new Date(now.getFullYear(), now.getMonth(), 0);
                break;
            case 'lastYear':
                startDate = new Date(now.getFullYear() - 1, 0, 1);
                endDate = new Date(now.getFullYear() - 1, 11, 31);
                break;
        }

        // formatDate е глобална (utils.js) и връща локална дата YYYY-MM-DD
        document.getElementById('filterStartDate').value = formatDate(startDate);
        document.getElementById('filterEndDate').value = formatDate(endDate);
    }

    async applyFilters() {
        this.filters = {
            start_date: document.getElementById('filterStartDate').value,
            end_date: document.getElementById('filterEndDate').value,
            account_id: document.getElementById('filterAccount').value,
            category_id: document.getElementById('filterCategory').value,
            type: document.getElementById('filterType').value,
            country: document.getElementById('filterCountry').value,
            search: document.getElementById('filterSearch').value
        };

        this.currentPage = 0;
        await this.loadTransactions();
    }

    clearFilters() {
        document.getElementById('filterStartDate').value = '';
        document.getElementById('filterEndDate').value = '';
        document.getElementById('filterAccount').value = '';
        document.getElementById('filterCategory').value = '';
        document.getElementById('filterType').value = '';
        document.getElementById('filterCountry').value = '';
        document.getElementById('filterSearch').value = '';

        this.filters = {};
        this.currentPage = 0;
        this.loadTransactions();
    }

    async loadTransactions() {
        try {
            showLoader();

            const params = {
                ...this.filters,
                limit: this.pageSize,
                offset: this.currentPage * this.pageSize
            };

            const result = await api.getTransactions(params);

            // Handle both array response and object with total
            if (Array.isArray(result)) {
                this.transactions = result;
                this.totalCount = result.length;
                this.totalAmount = 0;
            } else {
                this.transactions = result.transactions || result;
                this.totalCount = result.total || this.transactions.length;
                this.totalAmount = result.totalAmount || 0;
            }

            this.renderTransactions();
            this.renderPagination();

        } catch (error) {
            console.error('Error loading transactions:', error);
            showNotification('Грешка при зареждане на транзакции', 'error');
        } finally {
            hideLoader();
        }
    }

    renderTransactions() {
        const tbody = document.querySelector('#transactionsTable tbody');
        tbody.innerHTML = '';

        // Update header with total count
        const headerInfo = document.getElementById('transactionsHeaderInfo');
        if (headerInfo) {
            const start = this.currentPage * this.pageSize + 1;
            const end = Math.min((this.currentPage + 1) * this.pageSize, this.totalCount);
            headerInfo.textContent = this.totalCount > 0
                ? `Показване ${start}-${end} от ${this.totalCount} транзакции`
                : '';
        }

        // Update footer with total amount
        const tfoot = document.getElementById('transactionsTableFoot');
        const totalAmountCell = document.getElementById('transactionsTotalAmount');
        if (tfoot && totalAmountCell) {
            if (this.transactions.length > 0) {
                tfoot.style.display = '';
                const amountClass = this.totalAmount >= 0 ? 'positive' : 'negative';
                totalAmountCell.className = amountClass;
                totalAmountCell.innerHTML = formatCurrency(this.totalAmount);
            } else {
                tfoot.style.display = 'none';
            }
        }

        if (this.transactions.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">Няма транзакции</td></tr>';
            return;
        }

        this.transactions.forEach((tx, index) => {
            const account = this.accounts.find(a => a.id === tx.account_id);
            const accountName = account ? (account.custom_name || account.name) : '';
            const bankName = account?.institution_name || '';

            // Use display name if available, otherwise original counterparty name
            const displayName = tx.counterparty_display_name || tx.counterparty_name;
            const hasAlias = !!tx.counterparty_display_name;

            const row = document.createElement('tr');
            row.classList.add('transaction-row');
            row.innerHTML = `
                <td style="white-space: nowrap;">${formatDate(tx.transaction_date)}</td>
                <td class="description-cell" data-id="${escapeHtml(tx.id)}" data-index="${index}" style="cursor: pointer;" title="Кликни за детайли">
                    <div style="font-weight: 500; display: flex; align-items: center; gap: 6px;">
                        <span class="counterparty-name">${displayName ? escapeHtml(displayName) : '<span class="text-muted">—</span>'}</span>
                        ${tx.counterparty_name ? `<span class="alias-btn" data-counterparty="${escapeHtml(tx.counterparty_name)}" data-display="${escapeHtml(tx.counterparty_display_name || '')}" style="cursor: pointer; font-size: 12px; opacity: 0; transition: opacity 0.2s;" title="Задай синоним">✏️</span>` : ''}
                    </div>
                    <div style="font-size: 12px; color: var(--text-secondary); margin-top: 2px;">
                        ${bankName ? `<span style="font-weight: 500;">${escapeHtml(bankName)}</span>` : ''}${bankName && tx.description ? ' · ' : ''}${tx.description ? `<span style="font-style: italic;">${escapeHtml(tx.description)}</span>` : ''}
                    </div>
                </td>
                <td>
                    ${tx.category_name
                        ? `<span class="category-badge" style="background-color: ${tx.category_color}">${escapeHtml(tx.category_name)}</span>`
                        : '<span class="badge badge-warning">Некатегоризирана</span>'
                    }
                </td>
                <td class="${tx.amount >= 0 ? 'positive' : 'negative'}" style="font-weight: 600; text-align: right; white-space: nowrap;">
                    ${formatCurrencyExact(tx.amount)}
                </td>
                <td style="text-align: center; white-space: nowrap;">
                    <span class="details-cell" data-id="${escapeHtml(tx.id)}" data-index="${index}" title="Детайли${tx.notes ? '\n📝 ' + escapeHtml(tx.notes) : ''}" style="cursor: pointer; font-size: 18px;">
                        ${tx.notes ? '📋📝' : '📋'}
                    </span>
                </td>
            `;
            tbody.appendChild(row);
        });

        // Кликовете се обработват от делегиран слушател на tbody (attachEventListeners)
        // Add hover effect for transaction rows to show/hide icons
        tbody.querySelectorAll('.transaction-row').forEach(row => {
            row.addEventListener('mouseenter', () => {
                row.querySelectorAll('.alias-btn').forEach(el => {
                    el.style.opacity = '0.7';
                });
            });
            row.addEventListener('mouseleave', () => {
                row.querySelectorAll('.alias-btn').forEach(el => {
                    el.style.opacity = '0';
                });
            });
        });
    }

    // Делегиран обработчик на кликове в таблицата с транзакции (закача се веднъж)
    handleTableClick(e) {
        const aliasBtn = e.target.closest('.alias-btn');
        if (aliasBtn) {
            e.stopPropagation();
            this.editCounterpartyAlias(aliasBtn.dataset.counterparty, aliasBtn.dataset.display || '');
            return;
        }
        if (e.target.closest('a')) return;

        const cell = e.target.closest('.details-cell, .description-cell');
        if (cell) {
            this.showRawData(cell.dataset.id, parseInt(cell.dataset.index));
        }
    }

    renderPagination() {
        const containers = [
            document.getElementById('transactionsPaginationTop'),
            document.getElementById('transactionsPagination')
        ];

        const totalPages = Math.ceil(this.totalCount / this.pageSize);

        if (totalPages <= 1) {
            containers.forEach(c => { if (c) c.innerHTML = ''; });
            return;
        }

        // Бутон към страница (0-базиран индекс); кликовете се обработват от слушателя в attachEventListeners
        const pageBtn = (page, label, current = false) =>
            `<button type="button" class="page-btn${current ? ' page-btn-current' : ''}" data-page-index="${page}">${label}</button>`;
        const disabledBtn = label => `<button type="button" class="page-btn" disabled>${label}</button>`;
        const ellipsis = '<span class="page-ellipsis">...</span>';

        let html = '<div class="page-nav">';

        // Previous button
        html += this.currentPage === 0 ? disabledBtn('← Предишна') : pageBtn(this.currentPage - 1, '← Предишна');

        // Page numbers
        const maxVisiblePages = 5;
        let startPage = Math.max(0, this.currentPage - Math.floor(maxVisiblePages / 2));
        let endPage = Math.min(totalPages, startPage + maxVisiblePages);

        if (endPage - startPage < maxVisiblePages) {
            startPage = Math.max(0, endPage - maxVisiblePages);
        }

        if (startPage > 0) {
            html += pageBtn(0, '1');
            if (startPage > 1) html += ellipsis;
        }

        for (let i = startPage; i < endPage; i++) {
            html += pageBtn(i, i + 1, i === this.currentPage);
        }

        if (endPage < totalPages) {
            if (endPage < totalPages - 1) html += ellipsis;
            html += pageBtn(totalPages - 1, totalPages);
        }

        // Next button
        html += this.currentPage >= totalPages - 1 ? disabledBtn('Следваща →') : pageBtn(this.currentPage + 1, 'Следваща →');

        html += '</div>';

        containers.forEach(c => { if (c) c.innerHTML = html; });
    }

    goToPage(page) {
        this.currentPage = page;
        this.loadTransactions();
        // Scroll to top of table
        document.getElementById('transactionsTable')?.scrollIntoView({ behavior: 'smooth' });
    }

    // Презарежда списъка и опреснява отворения модал, като пази правилната навигация.
    // Ако транзакцията е изпаднала от списъка (напр. филтър "Некатегоризирани"), тя остава
    // показана ("откъсната"): "Следваща" отива към транзакцията, заела нейното място.
    async reloadAndRefreshModal(transaction, { forceRender = false } = {}) {
        const previousIndex = this.currentTransactionIndex;
        const wasDetached = this.detachedTransaction;
        await this.loadTransactions();

        if (!isModalOpen('tx-details')) return;

        const newIndex = this.transactions.findIndex(t => t.id === transaction.id);
        if (newIndex >= 0) {
            if (forceRender || wasDetached || newIndex !== previousIndex) {
                this.showRawData(null, newIndex);
            }
        } else {
            const position = Math.min(Math.max(previousIndex, 0), this.transactions.length);
            this.showRawData(null, position, transaction);
        }
    }

    showRawData(transactionId, index = -1, detachedTransaction = null) {
        // Find transaction by ID or use index
        let transaction;
        if (detachedTransaction) {
            // Транзакцията вече не е в списъка; index е мястото, където се е намирала
            transaction = detachedTransaction;
            this.currentTransactionIndex = index;
            this.detachedTransaction = detachedTransaction;
        } else if (index >= 0 && index < this.transactions.length) {
            transaction = this.transactions[index];
            this.currentTransactionIndex = index;
            this.detachedTransaction = null;
        } else {
            transaction = this.transactions.find(t => t.id === transactionId);
            this.currentTransactionIndex = this.transactions.findIndex(t => t.id === transactionId);
            this.detachedTransaction = null;
        }
        if (!transaction) return;
        this.currentTransactionId = transaction.id;
        const isDetached = !!this.detachedTransaction;

        const account = this.accounts.find(a => a.id === transaction.account_id);

        // Навигация Предишна/Следваща
        const hasPrev = this.currentTransactionIndex > 0;
        const hasNext = isDetached
            ? this.currentTransactionIndex < this.transactions.length
            : this.currentTransactionIndex < this.transactions.length - 1;
        const navStyle = enabled => enabled ? '' : 'opacity: 0.5; cursor: not-allowed;';

        // Избор на категория (десен панел)
        const renderCategoryBubbles = (cats, title) => {
            if (cats.length === 0) return '';
            return `
                <div style="margin-bottom: 12px;">
                    <label style="font-size: 11px; color: var(--text-secondary); margin-bottom: 6px; display: block; font-weight: 600;">${escapeHtml(title)}</label>
                    <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                        ${cats.map(cat => `
                            <button type="button" class="modal-category-btn ${cat.id === transaction.category_id ? 'selected' : ''}"
                                    data-category-id="${cat.id}"
                                    style="padding: 5px 10px; border-radius: 16px; border: 2px solid ${cat.color};
                                           background: ${cat.id === transaction.category_id ? cat.color : 'white'};
                                           color: ${cat.id === transaction.category_id ? 'white' : cat.color};
                                           cursor: pointer; font-size: 12px; font-weight: 500;
                                           transition: all 0.2s;">
                                ${escapeHtml(cat.name)}
                            </button>
                        `).join('')}
                    </div>
                </div>
            `;
        };

        // По групи: всяка група — със заглавие и подкатегориите си; самостоятелните — под заглавието на типа
        const children = categoryChildrenMap(this.categories);
        const renderType = (type, title) => {
            const top = topLevelCategories(this.categories).filter(c => c.type === type);
            const groups = top.filter(c => children.has(c.id));
            return groups
                .map(group => renderCategoryBubbles(children.get(group.id), `${group.icon ? `${group.icon} ` : ''}${group.name}`))
                .join('') +
                renderCategoryBubbles(top.filter(c => !children.has(c.id)), groups.length ? `${title.split(' ')[0]} Други` : title);
        };

        const sidePanelHtml = `
                    <div style="background: #f9f9f9; padding: 12px; border-radius: 8px; border: 1px solid var(--border-color);">
                        ${renderType('expense', '💸 Разходи')}
                        ${renderType('income', '💰 Приходи')}
                        ${renderType('transfer', '🔄 Трансфери')}
                        <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border-color);">
                            <label style="display: flex; align-items: center; gap: 8px; font-size: 12px; cursor: pointer;">
                                <input type="checkbox" id="modalApplyToAll" checked style="width: 16px; height: 16px;">
                                <span>Приложи за всички транзакции с този контрагент</span>
                            </label>
                        </div>
                    </div>`;

        const countryHtml = `
                            <select id="modalCountrySelect" style="padding: 4px 8px; border: 1px solid #ccc; border-radius: 4px; font-size: 13px; min-width: 150px;">
                                <option value="">-- Без държава --</option>
                                ${this.countries.map(c => `<option value="${escapeHtml(c.code)}" ${transaction.country === c.code ? 'selected' : ''}>${escapeHtml(`${c.flag || ''} ${c.name || c.code}`)}</option>`).join('')}
                            </select>`;

        // Повторно отваряне при навигация само пречертава модала (без onClose)
        openModal({
            key: 'tx-details',
            title: isDetached
                ? 'Детайли на транзакция'
                : `Детайли на транзакция (${this.currentTransactionIndex + 1}/${this.transactions.length})`,
            body: renderTransactionDetails(transaction, {
                account,
                countryHtml,
                sidePanelHtml,
                notesEditable: true,
                rawActionsHtml: '<button type="button" id="reprocessBtn" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 3px 10px;">Преизчисли</button>',
                activeTab: this.detailsTab || 'details'
            }),
            footer: `
            <button type="button" id="modalPrevTx" class="btn btn-secondary" ${hasPrev ? '' : 'disabled'} style="${navStyle(hasPrev)}">← Предишна</button>
            <button type="button" id="modalNextTx" class="btn btn-secondary" ${hasNext ? '' : 'disabled'} style="${navStyle(hasNext)}">Следваща →</button>
            <button type="button" class="btn btn-secondary" data-modal-close>Затвори</button>
        `,
            footerAlign: 'space-between',
            maxWidth: '1100px',
            className: 'modal-compact',
            autofocus: false
        });

        const modalBody = document.getElementById('modalBody');

        // Табове (избраният таб се запазва при навигация) + „Копирай“
        bindTransactionDetails(modalBody, transaction, {
            onTabChange: tab => { this.detailsTab = tab; }
        });

        // Reprocess button - re-run parsing rules and show preview
        document.getElementById('reprocessBtn')?.addEventListener('click', async () => {
            try {
                showLoader();
                const result = await api.reprocessTransaction(transaction.id);
                hideLoader();

                if (!result.changes) {
                    showNotification('Няма промени', 'info');
                    return;
                }

                const changes = result.changes;
                const fieldLabels = {
                    counterparty_name: 'Контрагент',
                    description: 'Описание',
                    amount: 'Сума',
                    original_amount: 'Оригинална сума',
                    original_currency: 'Оригинална валута',
                    transaction_date: 'Дата',
                    booking_date: 'Дата(осч)',
                    country: 'Държава',
                    category_id: 'Категория'
                };

                const formatVal = (field, val, extra) => {
                    if (val === null || val === undefined) return '<span class="text-muted">-</span>';
                    if (field === 'amount' || field === 'original_amount') return formatCurrencyExact(val);
                    if (field === 'category_id') {
                        const name = extra?.name;
                        const color = extra?.color;
                        if (name) return `<span class="category-badge" style="background-color: ${escapeHtml(color)}">${escapeHtml(name)}</span>`;
                        return '<span style="color: var(--danger-color); font-weight: 600;">Некатегоризирана</span>';
                    }
                    return escapeHtml(String(val));
                };

                const rows = Object.entries(changes).map(([field, info]) => {
                    const currentVal = formatVal(field, info.current, { name: info.currentName, color: info.currentColor });
                    const newVal = formatVal(field, info.new, { name: info.newName, color: info.newColor });
                    const changed = String(info.current ?? '') !== String(info.new ?? '');
                    return `
                        <tr${changed ? ' class="row-changed"' : ''}>
                            <td style="font-weight: 600; white-space: nowrap;">${fieldLabels[field] || escapeHtml(field)}</td>
                            <td>${currentVal}</td>
                            <td>${newVal}</td>
                            <td class="text-center">${changed ? '⚠️' : '✓'}</td>
                        </tr>
                    `;
                }).join('');

                openOverlay({
                    title: 'Преизчисляване на транзакция',
                    maxWidth: '800px',
                    body: `
                    <p style="margin: 0 0 12px 0; color: var(--text-secondary); font-size: 13px;">Маркираните в жълто полета ще бъдат променени.</p>
                    <div class="table-responsive">
                        <table class="detail-table">
                            <thead>
                                <tr>
                                    <th>Поле</th>
                                    <th>Текуща стойност</th>
                                    <th>Нова стойност</th>
                                    <th class="text-center" style="width: 40px;"></th>
                                </tr>
                            </thead>
                            <tbody>${rows}</tbody>
                        </table>
                    </div>
                `,
                    footer: `
                    <button type="button" class="btn btn-secondary" data-modal-close>Отказ</button>
                    <button type="button" class="btn btn-primary" data-modal-save>Приложи промените</button>
                `,
                    onSave: async () => {
                        try {
                            showLoader();
                            await api.reprocessTransaction(transaction.id, true);
                            closeOverlay();
                            showNotification('Транзакцията е актуализирана', 'success');
                            // Refresh the list and the transaction detail modal
                            await this.reloadAndRefreshModal(transaction, { forceRender: true });
                        } catch (err) {
                            showNotification('Грешка: ' + err.message, 'error');
                        } finally {
                            hideLoader();
                        }
                    }
                });
            } catch (error) {
                hideLoader();
                showNotification('Грешка при преизчисляване: ' + error.message, 'error');
            }
        });

        // Add category button handlers
        modalBody.querySelectorAll('.modal-category-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const categoryId = parseInt(btn.dataset.categoryId);
                const applyToAll = document.getElementById('modalApplyToAll')?.checked;

                try {
                    showLoader();
                    await api.updateTransactionCategory(transaction.id, categoryId);

                    let updatedCount = 0;
                    if (applyToAll && transaction.counterparty_name) {
                        const result = await api.categorizeByCounterparty(transaction.counterparty_name, categoryId);
                        updatedCount = Number(result?.updatedCount) || 0;
                    }

                    // Update local transaction data
                    const cat = this.categories.find(c => c.id === categoryId);
                    transaction.category_id = categoryId;
                    transaction.category_name = cat?.name;
                    transaction.category_color = cat?.color;

                    // Refresh the list and the modal content
                    await this.reloadAndRefreshModal(transaction, { forceRender: true });

                    showNotification(
                        updatedCount > 0
                            ? `Категорията е записана (+${updatedCount} със същия контрагент)`
                            : 'Категорията е записана',
                        'success'
                    );
                } catch (error) {
                    showNotification('Грешка при записване: ' + error.message, 'error');
                } finally {
                    hideLoader();
                }
            });
        });

        // Add navigation button handlers
        document.getElementById('modalPrevTx')?.addEventListener('click', () => {
            if (this.currentTransactionIndex > 0) {
                // и при "откъсната" транзакция index-1 е предишната в списъка
                this.showRawData(null, this.currentTransactionIndex - 1);
            }
        });
        document.getElementById('modalNextTx')?.addEventListener('click', () => {
            if (this.detachedTransaction) {
                // Следващата транзакция вече е на мястото на текущата
                if (this.currentTransactionIndex < this.transactions.length) {
                    this.showRawData(null, this.currentTransactionIndex);
                }
            } else if (this.currentTransactionIndex < this.transactions.length - 1) {
                this.showRawData(null, this.currentTransactionIndex + 1);
            }
        });

        // Auto-save notes on blur (closeModal() маха фокуса преди затваряне, така че blur винаги се изпълнява)
        document.getElementById('modalNotesText')?.addEventListener('blur', async (e) => {
            const notes = e.target.value;
            // Only save if notes changed
            if (notes === (transaction.notes || '')) return;

            try {
                await api.updateTransactionNotes(transaction.id, notes);
                transaction.notes = notes;
                if (this.currentTransactionId === transaction.id) {
                    await this.reloadAndRefreshModal(transaction);
                } else {
                    // Междувременно е отворена друга транзакция (Предишна/Следваща) — не я подменяме
                    await this.loadTransactions();
                }
                showNotification('Бележките са запазени', 'success');
            } catch (error) {
                showNotification('Грешка при запазване: ' + error.message, 'error');
            }
        });

        // Auto-save country on change
        document.getElementById('modalCountrySelect')?.addEventListener('change', async (e) => {
            const country = e.target.value || null;
            try {
                await api.updateTransactionCountry(transaction.id, country);
                transaction.country = country;
                await this.reloadAndRefreshModal(transaction);
                showNotification('Държавата е записана', 'success');
            } catch (error) {
                showNotification('Грешка при запазване: ' + error.message, 'error');
            }
        });
    }

    async editCounterpartyAlias(originalName, currentDisplayName) {
        const newName = prompt(
            `Задайте говорящо име за контрагент "${originalName}":`,
            currentDisplayName || originalName
        );

        if (newName !== null && newName.trim() !== '') {
            try {
                showLoader();
                await api.createCounterpartyAlias(originalName, newName.trim());
                await this.loadTransactions();
                showNotification('Синонимът е запазен', 'success');
            } catch (error) {
                showNotification('Грешка при запазване: ' + error.message, 'error');
            } finally {
                hideLoader();
            }
        }
    }
}

// Create global instance
const transactionsPage = new TransactionsPage();
