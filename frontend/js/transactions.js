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
        this.currentTransactionIndex = -1; // For prev/next navigation in modal
    }

    async init() {
        // Load categories and accounts for filters
        try {
            this.categories = await api.getCategories();
            this.accounts = await api.getAccounts();

            this.populateFilterDropdowns();
            this.attachEventListeners();
        } catch (error) {
            console.error('Error initializing transactions page:', error);
        }
    }

    populateFilterDropdowns() {
        // Populate account filter
        const accountSelect = document.getElementById('filterAccount');
        accountSelect.innerHTML = '<option value="">Всички сметки</option>';
        this.accounts.forEach(account => {
            const option = document.createElement('option');
            option.value = account.id;
            option.textContent = account.custom_name || account.name;
            accountSelect.appendChild(option);
        });

        // Populate category filter
        const categorySelect = document.getElementById('filterCategory');
        categorySelect.innerHTML = '<option value="">Всички категории</option><option value="uncategorized">Без категория</option>';
        this.categories.forEach(category => {
            const option = document.createElement('option');
            option.value = category.id;
            option.textContent = category.name;
            categorySelect.appendChild(option);
        });
    }

    attachEventListeners() {
        document.getElementById('applyFilters').addEventListener('click', () => this.applyFilters());
        document.getElementById('clearFilters').addEventListener('click', () => this.clearFilters());

        // Quick date filter buttons
        document.getElementById('filterThisMonth')?.addEventListener('click', () => this.setDateFilter('thisMonth'));
        document.getElementById('filterLastMonth')?.addEventListener('click', () => this.setDateFilter('lastMonth'));
        document.getElementById('filterLastYear')?.addEventListener('click', () => this.setDateFilter('lastYear'));

        // Quick filter uncategorized button
        const quickFilterBtn = document.getElementById('quickFilterUncategorized');
        quickFilterBtn?.addEventListener('click', () => this.filterUncategorized());

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

        // Format dates as YYYY-MM-DD
        const formatDate = (date) => date.toISOString().split('T')[0];

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
                <td style="white-space: nowrap;">${formatDate(new Date(tx.transaction_date))}</td>
                <td class="description-cell" data-id="${tx.id}" data-index="${index}" style="cursor: pointer;" title="Кликни за детайли">
                    <div style="font-weight: 500; display: flex; align-items: center; gap: 6px;">
                        <span class="counterparty-name">${displayName ? escapeHtml(displayName) : '<span class="text-muted">—</span>'}</span>
                        ${tx.counterparty_name ? `<span class="alias-btn" data-counterparty="${escapeHtml(tx.counterparty_name)}" data-display="${escapeHtml(tx.counterparty_display_name || '')}" onclick="event.stopPropagation(); transactionsPage.editCounterpartyAlias('${escapeHtml(tx.counterparty_name).replace(/'/g, "\\'")}', '${escapeHtml(tx.counterparty_display_name || '').replace(/'/g, "\\'")}')" style="cursor: pointer; font-size: 12px; opacity: 0; transition: opacity 0.2s;" title="Задай синоним">✏️</span>` : ''}
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
                    ${formatCurrency(tx.amount)}
                </td>
                <td style="text-align: center; white-space: nowrap;">
                    <span class="details-cell" data-id="${tx.id}" data-index="${index}" title="Детайли${tx.notes ? '\n📝 ' + escapeHtml(tx.notes) : ''}" style="cursor: pointer; font-size: 18px;">
                        ${tx.notes ? '📋📝' : '📋'}
                    </span>
                </td>
            `;
            tbody.appendChild(row);
        });

        // Add click handlers for details cells
        document.querySelectorAll('.details-cell').forEach(cell => {
            cell.addEventListener('click', () => {
                const index = parseInt(cell.dataset.index);
                this.showRawData(cell.dataset.id, index);
            });
        });

        document.querySelectorAll('.description-cell').forEach(cell => {
            cell.addEventListener('click', (e) => {
                // Don't trigger if clicking on a link or alias button
                if (e.target.tagName !== 'A' && !e.target.classList.contains('alias-btn')) {
                    const index = parseInt(cell.dataset.index);
                    this.showRawData(cell.dataset.id, index);
                }
            });
        });

        // Add hover effect for transaction rows to show/hide icons
        document.querySelectorAll('.transaction-row').forEach(row => {
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

        // Button styles with explicit colors
        const btnStyle = 'padding: 6px 12px; background: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer;';
        const btnActiveStyle = 'padding: 6px 10px; background: var(--primary-color, #4a90d9); color: white; border: none; border-radius: 4px; cursor: pointer;';
        const btnDisabledStyle = 'padding: 6px 12px; background: #ccc; color: #666; border: none; border-radius: 4px; cursor: not-allowed;';

        let html = '<div style="display: flex; gap: 8px; justify-content: center; align-items: center; padding: 12px 0;">';

        // Previous button
        if (this.currentPage === 0) {
            html += `<button style="${btnDisabledStyle}" disabled>← Предишна</button>`;
        } else {
            html += `<button style="${btnStyle}" onclick="transactionsPage.goToPage(${this.currentPage - 1})">← Предишна</button>`;
        }

        // Page numbers
        const maxVisiblePages = 5;
        let startPage = Math.max(0, this.currentPage - Math.floor(maxVisiblePages / 2));
        let endPage = Math.min(totalPages, startPage + maxVisiblePages);

        if (endPage - startPage < maxVisiblePages) {
            startPage = Math.max(0, endPage - maxVisiblePages);
        }

        if (startPage > 0) {
            html += `<button style="${btnStyle}" onclick="transactionsPage.goToPage(0)">1</button>`;
            if (startPage > 1) {
                html += '<span style="color: #666; padding: 0 4px;">...</span>';
            }
        }

        for (let i = startPage; i < endPage; i++) {
            const isActive = i === this.currentPage;
            html += `<button style="${isActive ? btnActiveStyle : btnStyle}" onclick="transactionsPage.goToPage(${i})">${i + 1}</button>`;
        }

        if (endPage < totalPages) {
            if (endPage < totalPages - 1) {
                html += '<span style="color: #666; padding: 0 4px;">...</span>';
            }
            html += `<button style="${btnStyle}" onclick="transactionsPage.goToPage(${totalPages - 1})">${totalPages}</button>`;
        }

        // Next button
        if (this.currentPage >= totalPages - 1) {
            html += `<button style="${btnDisabledStyle}" disabled>Следваща →</button>`;
        } else {
            html += `<button style="${btnStyle}" onclick="transactionsPage.goToPage(${this.currentPage + 1})">Следваща →</button>`;
        }

        html += '</div>';

        containers.forEach(c => { if (c) c.innerHTML = html; });
    }

    goToPage(page) {
        this.currentPage = page;
        this.loadTransactions();
        // Scroll to top of table
        document.getElementById('transactionsTable')?.scrollIntoView({ behavior: 'smooth' });
    }

    showRawData(transactionId, index = -1) {
        // Find transaction by ID or use index
        let transaction;
        if (index >= 0 && index < this.transactions.length) {
            transaction = this.transactions[index];
            this.currentTransactionIndex = index;
        } else {
            transaction = this.transactions.find(t => t.id === transactionId);
            this.currentTransactionIndex = this.transactions.findIndex(t => t.id === transactionId);
        }
        if (!transaction) return;

        // Find account info
        const account = this.accounts.find(a => a.id === transaction.account_id);
        const accountName = account ? (account.custom_name || account.name) : 'Неизвестна';
        const bankName = account?.institution_name || 'Неизвестна';

        const modal = document.getElementById('modal');
        const modalContent = modal.querySelector('.modal-content');
        modalContent.style.maxWidth = '1100px';

        // Navigation buttons for modal footer
        const hasPrev = this.currentTransactionIndex > 0;
        const hasNext = this.currentTransactionIndex < this.transactions.length - 1;

        document.getElementById('modalTitle').textContent = `Детайли на транзакция (${this.currentTransactionIndex + 1}/${this.transactions.length})`;

        // Update footer with navigation buttons
        const modalFooter = modal.querySelector('.modal-footer');
        modalFooter.style.justifyContent = 'space-between';
        modalFooter.innerHTML = `
            <button id="modalPrevTx" class="btn btn-secondary" ${hasPrev ? '' : 'disabled'} style="${hasPrev ? '' : 'opacity: 0.5; cursor: not-allowed;'}">← Предишна</button>
            <button id="modalCancel" class="btn btn-secondary">Затвори</button>
            <button id="modalNextTx" class="btn btn-secondary" ${hasNext ? '' : 'disabled'} style="${hasNext ? '' : 'opacity: 0.5; cursor: not-allowed;'}">Следваща →</button>
        `;

        let rawDataContent = 'Няма налични raw данни.';
        if (transaction.raw_data) {
            try {
                const rawData = JSON.parse(transaction.raw_data);
                rawDataContent = JSON.stringify(rawData, null, 2);
            } catch (e) {
                rawDataContent = transaction.raw_data;
            }
        }

        // Show original amount if converted
        let amountDisplay = formatCurrency(transaction.amount);
        if (transaction.original_amount && transaction.original_currency) {
            amountDisplay += ` <span style="color: var(--text-muted); font-size: 12px;">(оригинал: ${transaction.original_amount} ${transaction.original_currency})</span>`;
        }

        // Prepare Google search query (remove "BGR " prefix if present)
        let googleSearchQuery = transaction.counterparty_name || '';
        if (googleSearchQuery.startsWith('BGR ')) {
            googleSearchQuery = googleSearchQuery.substring(4);
        }

        // Build category selection HTML
        const renderCategoryBubbles = (cats, title) => {
            if (cats.length === 0) return '';
            return `
                <div style="margin-bottom: 12px;">
                    <label style="font-size: 11px; color: var(--text-secondary); margin-bottom: 6px; display: block; font-weight: 600;">${title}</label>
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

        const expenseCategories = this.categories.filter(c => c.type === 'expense');
        const incomeCategories = this.categories.filter(c => c.type === 'income');
        const transferCategories = this.categories.filter(c => c.type === 'transfer');

        document.getElementById('modalBody').innerHTML = `
            <div style="display: flex; gap: 24px;">
                <div style="flex: 1; min-width: 0;">
                    <h4 style="margin: 0 0 12px 0; color: var(--primary-color);">Основна информация</h4>
                    <table style="width: 100%; font-size: 13px; border-collapse: collapse;">
                        <tr><td style="padding: 6px 10px; background: #f5f5f5; width: 110px; border: 1px solid #e0e0e0;"><strong>ID:</strong></td><td style="padding: 6px 10px; border: 1px solid #e0e0e0; font-family: monospace; font-size: 10px;">${escapeHtml(transaction.id)}</td></tr>
                        <tr><td style="padding: 6px 10px; background: #f5f5f5; border: 1px solid #e0e0e0;"><strong>Контрагент:</strong></td><td style="padding: 6px 10px; border: 1px solid #e0e0e0;"><span style="color: var(--primary-color); font-weight: 600; font-size: 14px;">${escapeHtml(transaction.counterparty_name || '-')}</span> ${transaction.counterparty_name ? `<a href="https://www.google.com/search?q=${encodeURIComponent(googleSearchQuery)}" target="_blank" rel="noopener" style="text-decoration: none; margin-left: 6px;" title="Търси в Google">🔍</a>` : ''}</td></tr>
                        <tr><td style="padding: 6px 10px; background: #f5f5f5; border: 1px solid #e0e0e0;"><strong>Сума:</strong></td><td style="padding: 6px 10px; border: 1px solid #e0e0e0; font-weight: 600; ${transaction.amount >= 0 ? 'color: var(--success-color);' : 'color: var(--danger-color);'}">${amountDisplay}</td></tr>
                        <tr><td style="padding: 6px 10px; background: #f5f5f5; border: 1px solid #e0e0e0;"><strong>Описание:</strong></td><td style="padding: 6px 10px; border: 1px solid #e0e0e0;">${escapeHtml(transaction.description || '-')}</td></tr>
                        <tr><td style="padding: 6px 10px; background: #f5f5f5; border: 1px solid #e0e0e0;"><strong>Банка:</strong></td><td style="padding: 6px 10px; border: 1px solid #e0e0e0;">${escapeHtml(bankName)}</td></tr>
                        <tr><td style="padding: 6px 10px; background: #f5f5f5; border: 1px solid #e0e0e0;"><strong>Сметка:</strong></td><td style="padding: 6px 10px; border: 1px solid #e0e0e0;">${escapeHtml(accountName)} <span style="color: #888; font-size: 11px;">(${escapeHtml(account?.iban || '')})</span></td></tr>
                        <tr><td style="padding: 6px 10px; background: #f5f5f5; border: 1px solid #e0e0e0;"><strong>Дата:</strong></td><td style="padding: 6px 10px; border: 1px solid #e0e0e0;">${transaction.transaction_date}</td></tr>
                        <tr><td style="padding: 6px 10px; background: #f5f5f5; border: 1px solid #e0e0e0;"><strong>Дата осчетов.:</strong></td><td style="padding: 6px 10px; border: 1px solid #e0e0e0;">${transaction.booking_date || '-'}</td></tr>
                        <tr><td style="padding: 6px 10px; background: #f5f5f5; border: 1px solid #e0e0e0;"><strong>Създадена:</strong></td><td style="padding: 6px 10px; border: 1px solid #e0e0e0;">${transaction.created_at || '-'}</td></tr>
                    </table>

                    <h4 style="margin: 16px 0 12px 0; color: var(--primary-color);">Raw данни от GoCardless API</h4>
                    <pre style="background: #1e1e1e; color: #d4d4d4; padding: 12px; border-radius: 6px; max-height: 200px; overflow: auto; font-size: 11px; white-space: pre-wrap; line-height: 1.3;">${escapeHtml(rawDataContent)}</pre>
                </div>
                <div style="width: 520px; flex-shrink: 0;">
                    <h4 style="margin: 0 0 12px 0; color: var(--primary-color);">Категория</h4>
                    <div style="background: #f9f9f9; padding: 12px; border-radius: 8px; border: 1px solid #e0e0e0;">
                        <div style="margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px solid #e0e0e0;">
                            <strong>Текуща:</strong>
                            ${transaction.category_name
                                ? `<span class="category-badge" style="background-color: ${transaction.category_color}">${escapeHtml(transaction.category_name)}</span>`
                                : '<span class="text-muted">Некатегоризирана</span>'}
                        </div>
                        ${renderCategoryBubbles(expenseCategories, '💸 Разходи')}
                        ${renderCategoryBubbles(incomeCategories, '💰 Приходи')}
                        ${renderCategoryBubbles(transferCategories, '🔄 Трансфери')}
                        <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #e0e0e0;">
                            <label style="display: flex; align-items: center; gap: 8px; font-size: 12px; cursor: pointer;">
                                <input type="checkbox" id="modalApplyToAll" checked style="width: 16px; height: 16px;">
                                <span>Приложи за всички транзакции с този контрагент</span>
                            </label>
                        </div>
                    </div>

                    <h4 style="margin: 16px 0 12px 0; color: var(--primary-color);">📝 Бележки</h4>
                    <textarea id="modalNotesText" class="input" rows="3" style="resize: vertical; font-size: 13px;" placeholder="Добави бележка...">${escapeHtml(transaction.notes || '')}</textarea>
                </div>
            </div>
        `;

        modal.classList.add('active');

        // Add category button handlers
        document.querySelectorAll('.modal-category-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const categoryId = parseInt(btn.dataset.categoryId);
                const applyToAll = document.getElementById('modalApplyToAll')?.checked;

                try {
                    showLoader();
                    await api.updateTransactionCategory(transaction.id, categoryId);

                    if (applyToAll && transaction.counterparty_name) {
                        await api.categorizeByCounterparty(transaction.counterparty_name, categoryId);
                    }

                    // Update local transaction data
                    const cat = this.categories.find(c => c.id === categoryId);
                    transaction.category_id = categoryId;
                    transaction.category_name = cat?.name;
                    transaction.category_color = cat?.color;

                    // Refresh the modal content
                    this.showRawData(null, this.currentTransactionIndex);

                    // Refresh the transaction list
                    await this.loadTransactions();

                    showNotification('Категорията е записана', 'success');
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
                this.showRawData(null, this.currentTransactionIndex - 1);
            }
        });
        document.getElementById('modalNextTx')?.addEventListener('click', () => {
            if (this.currentTransactionIndex < this.transactions.length - 1) {
                this.showRawData(null, this.currentTransactionIndex + 1);
            }
        });

        // Auto-save notes on blur
        document.getElementById('modalNotesText')?.addEventListener('blur', async (e) => {
            const notes = e.target.value;
            // Only save if notes changed
            if (notes === (transaction.notes || '')) return;

            try {
                await api.updateTransactionNotes(transaction.id, notes);
                transaction.notes = notes;
                await this.loadTransactions();
                showNotification('Бележките са запазени', 'success');
            } catch (error) {
                showNotification('Грешка при запазване: ' + error.message, 'error');
            }
        });

        const closeModal = () => {
            modalContent.style.maxWidth = '';
            // Restore original footer
            modalFooter.style.justifyContent = 'flex-end';
            modalFooter.innerHTML = `
                <button id="modalCancel" class="btn btn-secondary">Отказ</button>
                <button id="modalSave" class="btn btn-primary">Запази</button>
            `;
            modal.classList.remove('active');
        };

        document.getElementById('modalCancel').onclick = closeModal;
        document.querySelector('.modal-close').onclick = closeModal;
    }

    async editNotes(transactionId) {
        const transaction = this.transactions.find(t => t.id === transactionId);
        if (!transaction) return;

        const modal = document.getElementById('modal');
        document.getElementById('modalTitle').textContent = 'Редактиране на бележки';
        document.getElementById('modalSave').style.display = 'inline-block';

        document.getElementById('modalBody').innerHTML = `
            <div class="filter-group">
                <label>Бележки</label>
                <textarea id="editNotesText" class="input" rows="4" style="resize: vertical;">${escapeHtml(transaction.notes || '')}</textarea>
            </div>
        `;

        modal.classList.add('active');

        const saveHandler = async () => {
            const notes = document.getElementById('editNotesText').value;
            try {
                showLoader();
                await api.updateTransactionNotes(transactionId, notes);
                await this.loadTransactions();
                modal.classList.remove('active');
                showNotification('Бележките са обновени', 'success');
            } catch (error) {
                showNotification('Грешка при обновяване на бележки', 'error');
            } finally {
                hideLoader();
            }
        };

        document.getElementById('modalSave').onclick = saveHandler;
        document.getElementById('modalCancel').onclick = () => modal.classList.remove('active');
        document.querySelector('.modal-close').onclick = () => modal.classList.remove('active');
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
