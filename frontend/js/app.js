// Main application logic

// Utility functions
function formatCurrency(amount) {
    const formatted = Math.abs(amount).toFixed(2);
    const sign = amount < 0 ? '-' : '';
    return `${sign}${formatted} €`;
}

function formatDate(date) {
    if (typeof date === 'string') {
        date = new Date(date);
    }
    return date.toISOString().split('T')[0];
}

function formatDisplayDate(date) {
    if (typeof date === 'string') {
        date = new Date(date);
    }
    return date.toLocaleDateString('bg-BG', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showLoader() {
    document.getElementById('loader').style.display = 'flex';
}

function hideLoader() {
    document.getElementById('loader').style.display = 'none';
}

function showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 80px;
        right: 20px;
        padding: 16px 24px;
        background: ${type === 'success' ? 'var(--success-color)' : type === 'error' ? 'var(--danger-color)' : 'var(--primary-color)'};
        color: white;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        z-index: 9999;
        max-width: 400px;
        animation: slideIn 0.3s ease;
    `;
    notification.textContent = message;

    // Add animation
    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideIn {
            from { transform: translateX(400px); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
    `;
    document.head.appendChild(style);

    document.body.appendChild(notification);

    // Auto remove after 4 seconds
    setTimeout(() => {
        notification.style.animation = 'slideIn 0.3s ease reverse';
        setTimeout(() => notification.remove(), 300);
    }, 4000);
}

// Page navigation
function navigateToPage(pageName) {
    // Hide all pages
    document.querySelectorAll('.page').forEach(page => {
        page.classList.remove('active');
    });

    // Show selected page
    const targetPage = document.getElementById(`${pageName}-page`);
    if (targetPage) {
        targetPage.classList.add('active');
    }

    // Update nav links
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('active');
    });

    const activeLink = document.querySelector(`[data-page="${pageName}"]`);
    if (activeLink) {
        activeLink.classList.add('active');
    }

    // Load page-specific content
    loadPageContent(pageName);
}

async function loadPageContent(pageName) {
    switch (pageName) {
        case 'dashboard':
            await dashboard.load();
            break;
        case 'transactions':
            await transactionsPage.init();
            await transactionsPage.loadTransactions();
            break;
        case 'categories':
            await loadCategoriesPage();
            break;
        case 'reports':
            await loadReportsPage();
            break;
        case 'settings':
            await loadSettingsPage();
            break;
    }
}

// Categories Page
async function loadCategoriesPage() {
    try {
        showLoader();

        const categories = await api.getCategories();
        const rules = await api.getCategorizationRules();

        // Render categories by type
        renderCategoriesByType(categories, 'expense', 'expenseCategories');
        renderCategoriesByType(categories, 'income', 'incomeCategories');
        renderCategoriesByType(categories, 'transfer', 'transferCategories');

        // Render rules
        renderCategorizationRules(rules);

    } catch (error) {
        console.error('Error loading categories page:', error);
        showNotification('Грешка при зареждане на категориите', 'error');
    } finally {
        hideLoader();
    }
}

function renderCategoriesByType(categories, type, containerId) {
    const container = document.getElementById(containerId);
    const filtered = categories.filter(c => c.type === type);

    if (filtered.length === 0) {
        container.innerHTML = '<p class="text-muted">Няма категории</p>';
        return;
    }

    // Separate parent and child categories
    const parentCategories = filtered.filter(c => !c.parent_id);
    const childCategories = filtered.filter(c => c.parent_id);

    container.innerHTML = '';

    parentCategories.forEach(category => {
        // Render parent
        const div = document.createElement('div');
        div.className = 'category-item';
        div.innerHTML = `
            <div class="category-info">
                <div class="category-color" style="background-color: ${category.color}"></div>
                <span class="category-name">${escapeHtml(category.name)}</span>
            </div>
            <div class="category-actions">
                <button class="btn btn-secondary" onclick="editCategory(${category.id})">Редактирай</button>
                <button class="btn btn-danger" onclick="deleteCategory(${category.id})">Изтрий</button>
            </div>
        `;
        container.appendChild(div);

        // Render children indented
        const children = childCategories.filter(c => c.parent_id === category.id);
        children.forEach(child => {
            const childDiv = document.createElement('div');
            childDiv.className = 'category-item';
            childDiv.style.marginLeft = '24px';
            childDiv.style.borderLeft = `3px solid ${category.color}`;
            childDiv.style.paddingLeft = '12px';
            childDiv.innerHTML = `
                <div class="category-info">
                    <div class="category-color" style="background-color: ${child.color}"></div>
                    <span class="category-name">↳ ${escapeHtml(child.name)}</span>
                </div>
                <div class="category-actions">
                    <button class="btn btn-secondary" onclick="editCategory(${child.id})">Редактирай</button>
                    <button class="btn btn-danger" onclick="deleteCategory(${child.id})">Изтрий</button>
                </div>
            `;
            container.appendChild(childDiv);
        });
    });

    // Render orphan children (if parent was deleted)
    const orphanChildren = childCategories.filter(c => !parentCategories.find(p => p.id === c.parent_id));
    orphanChildren.forEach(category => {
        const div = document.createElement('div');
        div.className = 'category-item';
        div.innerHTML = `
            <div class="category-info">
                <div class="category-color" style="background-color: ${category.color}"></div>
                <span class="category-name">${escapeHtml(category.name)}</span>
            </div>
            <div class="category-actions">
                <button class="btn btn-secondary" onclick="editCategory(${category.id})">Редактирай</button>
                <button class="btn btn-danger" onclick="deleteCategory(${category.id})">Изтрий</button>
            </div>
        `;
        container.appendChild(div);
    });
}

function renderCategorizationRules(rules) {
    const tbody = document.querySelector('#rulesTable tbody');
    tbody.innerHTML = '';

    if (rules.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">Няма правила</td></tr>';
        return;
    }

    rules.forEach(rule => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${escapeHtml(rule.pattern)}</td>
            <td>
                <span class="category-badge" style="background-color: ${rule.category_color}">
                    ${escapeHtml(rule.category_name)}
                </span>
            </td>
            <td>${rule.priority}</td>
            <td>
                <span class="badge ${rule.active ? 'badge-success' : 'badge-danger'}">
                    ${rule.active ? 'Активно' : 'Неактивно'}
                </span>
            </td>
            <td>
                <button class="btn btn-secondary" style="padding: 6px 12px; font-size: 12px;" onclick="editRule(${rule.id})">Редактирай</button>
                <button class="btn btn-danger" style="padding: 6px 12px; font-size: 12px;" onclick="deleteRule(${rule.id})">Изтрий</button>
            </td>
        `;
        tbody.appendChild(row);
    });
}

// Categories CRUD
let allCategories = [];

async function showAddCategoryModal() {
    try {
        showLoader();
        allCategories = await api.getCategories();
        hideLoader();

        const modal = document.getElementById('modal');
        document.getElementById('modalTitle').textContent = 'Нова категория';

        // Filter only parent-level categories (no parent_id)
        const parentOptions = allCategories
            .filter(c => !c.parent_id)
            .map(c => `<option value="${c.id}">${escapeHtml(c.name)} (${c.type === 'expense' ? 'Разход' : c.type === 'income' ? 'Приход' : 'Трансфер'})</option>`)
            .join('');

        document.getElementById('modalBody').innerHTML = `
            <div class="filter-group">
                <label>Име</label>
                <input type="text" id="categoryName" class="input" placeholder="Име на категорията">
            </div>
            <div class="filter-group">
                <label>Тип</label>
                <select id="categoryType" class="input">
                    <option value="expense">Разход</option>
                    <option value="income">Приход</option>
                    <option value="transfer">Трансфер</option>
                </select>
            </div>
            <div class="filter-group">
                <label>Родителска категория</label>
                <select id="categoryParent" class="input">
                    <option value="">Без родител (главна категория)</option>
                    ${parentOptions}
                </select>
                <small class="text-muted">Изберете ако това е подкатегория</small>
            </div>
            <div class="filter-group">
                <label>Цвят</label>
                <input type="color" id="categoryColor" class="input" value="#4CAF50" style="height: 40px; padding: 4px;">
            </div>
        `;

        modal.classList.add('active');
        document.getElementById('modalSave').style.display = 'inline-block';
        document.getElementById('modalCancel').textContent = 'Отказ';

        const saveHandler = async () => {
            const name = document.getElementById('categoryName').value.trim();
            const type = document.getElementById('categoryType').value;
            const color = document.getElementById('categoryColor').value;
            const parentId = document.getElementById('categoryParent').value || null;

            if (!name) {
                showNotification('Моля, въведете име на категорията', 'error');
                return;
            }

            try {
                showLoader();
                await api.createCategory({ name, type, color, parentId: parentId ? parseInt(parentId) : null });
                modal.classList.remove('active');
                showNotification('Категорията е създадена успешно', 'success');
                await loadCategoriesPage();
            } catch (error) {
                showNotification('Грешка при създаване на категория: ' + error.message, 'error');
            } finally {
                hideLoader();
            }
        };

        document.getElementById('modalSave').onclick = saveHandler;
        document.getElementById('modalCancel').onclick = () => modal.classList.remove('active');
        document.querySelector('.modal-close').onclick = () => modal.classList.remove('active');

    } catch (error) {
        hideLoader();
        showNotification('Грешка при зареждане: ' + error.message, 'error');
    }
}

async function editCategory(categoryId) {
    try {
        showLoader();
        const categories = await api.getCategories();
        allCategories = categories;
        const category = categories.find(c => c.id === categoryId);
        hideLoader();

        if (!category) {
            showNotification('Категорията не е намерена', 'error');
            return;
        }

        const modal = document.getElementById('modal');
        document.getElementById('modalTitle').textContent = 'Редактиране на категория';

        // Filter only parent-level categories (no parent_id), excluding the current category
        const parentOptions = allCategories
            .filter(c => !c.parent_id && c.id !== categoryId)
            .map(c => `<option value="${c.id}" ${c.id === category.parent_id ? 'selected' : ''}>${escapeHtml(c.name)} (${c.type === 'expense' ? 'Разход' : c.type === 'income' ? 'Приход' : 'Трансфер'})</option>`)
            .join('');

        document.getElementById('modalBody').innerHTML = `
            <div class="filter-group">
                <label>Име</label>
                <input type="text" id="categoryName" class="input" value="${escapeHtml(category.name)}">
            </div>
            <div class="filter-group">
                <label>Тип</label>
                <select id="categoryType" class="input">
                    <option value="expense" ${category.type === 'expense' ? 'selected' : ''}>Разход</option>
                    <option value="income" ${category.type === 'income' ? 'selected' : ''}>Приход</option>
                    <option value="transfer" ${category.type === 'transfer' ? 'selected' : ''}>Трансфер</option>
                </select>
            </div>
            <div class="filter-group">
                <label>Родителска категория</label>
                <select id="categoryParent" class="input">
                    <option value="">Без родител (главна категория)</option>
                    ${parentOptions}
                </select>
                <small class="text-muted">Изберете ако това е подкатегория</small>
            </div>
            <div class="filter-group">
                <label>Цвят</label>
                <input type="color" id="categoryColor" class="input" value="${category.color || '#4CAF50'}" style="height: 40px; padding: 4px;">
            </div>
        `;

        modal.classList.add('active');
        document.getElementById('modalSave').style.display = 'inline-block';
        document.getElementById('modalCancel').textContent = 'Отказ';

        const saveHandler = async () => {
            const name = document.getElementById('categoryName').value.trim();
            const type = document.getElementById('categoryType').value;
            const color = document.getElementById('categoryColor').value;
            const parentId = document.getElementById('categoryParent').value || null;

            if (!name) {
                showNotification('Моля, въведете име на категорията', 'error');
                return;
            }

            try {
                showLoader();
                await api.updateCategory(categoryId, { name, type, color, parentId: parentId ? parseInt(parentId) : null });
                modal.classList.remove('active');
                showNotification('Категорията е обновена успешно', 'success');
                await loadCategoriesPage();
            } catch (error) {
                showNotification('Грешка при обновяване на категория: ' + error.message, 'error');
            } finally {
                hideLoader();
            }
        };

        document.getElementById('modalSave').onclick = saveHandler;
        document.getElementById('modalCancel').onclick = () => modal.classList.remove('active');
        document.querySelector('.modal-close').onclick = () => modal.classList.remove('active');

    } catch (error) {
        hideLoader();
        showNotification('Грешка при зареждане на категория: ' + error.message, 'error');
    }
}

async function deleteCategory(categoryId) {
    if (!confirm('Сигурни ли сте, че искате да изтриете тази категория?\n\nТранзакциите в тази категория ще останат без категория.')) {
        return;
    }

    try {
        showLoader();
        await api.deleteCategory(categoryId);
        showNotification('Категорията е изтрита успешно', 'success');
        await loadCategoriesPage();
    } catch (error) {
        showNotification('Грешка при изтриване на категория: ' + error.message, 'error');
    } finally {
        hideLoader();
    }
}

// Categorization Rules CRUD
let allRules = [];

async function showAddRuleModal() {
    try {
        showLoader();
        allCategories = await api.getCategories();
        hideLoader();

        const modal = document.getElementById('modal');
        document.getElementById('modalTitle').textContent = 'Ново правило за категоризиране';

        const categoryOptions = allCategories
            .map(cat => `<option value="${cat.id}">${escapeHtml(cat.name)} (${cat.type === 'expense' ? 'Разход' : cat.type === 'income' ? 'Приход' : 'Трансфер'})</option>`)
            .join('');

        document.getElementById('modalBody').innerHTML = `
            <div class="filter-group">
                <label>Шаблон за търсене</label>
                <input type="text" id="rulePattern" class="input" placeholder="напр. Lidl|Kaufland|Billa">
                <small class="text-muted">Използвайте | за няколко варианта. Търси се в описанието и контрагента.</small>
            </div>
            <div class="filter-group">
                <label>Категория</label>
                <select id="ruleCategory" class="input">
                    <option value="">Изберете категория</option>
                    ${categoryOptions}
                </select>
            </div>
            <div class="filter-group">
                <label>Приоритет</label>
                <input type="number" id="rulePriority" class="input" value="5" min="1" max="10">
                <small class="text-muted">По-висок приоритет = проверява се първо (1-10)</small>
            </div>
        `;

        modal.classList.add('active');
        document.getElementById('modalSave').style.display = 'inline-block';
        document.getElementById('modalCancel').textContent = 'Отказ';

        const saveHandler = async () => {
            const pattern = document.getElementById('rulePattern').value.trim();
            const categoryId = document.getElementById('ruleCategory').value;
            const priority = parseInt(document.getElementById('rulePriority').value) || 5;

            if (!pattern) {
                showNotification('Моля, въведете шаблон за търсене', 'error');
                return;
            }
            if (!categoryId) {
                showNotification('Моля, изберете категория', 'error');
                return;
            }

            try {
                showLoader();
                await api.createCategorizationRule({ pattern, categoryId: parseInt(categoryId), priority });
                modal.classList.remove('active');
                showNotification('Правилото е създадено успешно', 'success');
                await loadCategoriesPage();
            } catch (error) {
                showNotification('Грешка при създаване на правило: ' + error.message, 'error');
            } finally {
                hideLoader();
            }
        };

        document.getElementById('modalSave').onclick = saveHandler;
        document.getElementById('modalCancel').onclick = () => modal.classList.remove('active');
        document.querySelector('.modal-close').onclick = () => modal.classList.remove('active');

    } catch (error) {
        hideLoader();
        showNotification('Грешка при зареждане: ' + error.message, 'error');
    }
}

async function editRule(ruleId) {
    try {
        showLoader();
        const [rules, categories] = await Promise.all([
            api.getCategorizationRules(),
            api.getCategories()
        ]);
        allCategories = categories;
        const rule = rules.find(r => r.id === ruleId);
        hideLoader();

        if (!rule) {
            showNotification('Правилото не е намерено', 'error');
            return;
        }

        const modal = document.getElementById('modal');
        document.getElementById('modalTitle').textContent = 'Редактиране на правило';

        const categoryOptions = allCategories
            .map(cat => `<option value="${cat.id}" ${cat.id === rule.category_id ? 'selected' : ''}>${escapeHtml(cat.name)} (${cat.type === 'expense' ? 'Разход' : cat.type === 'income' ? 'Приход' : 'Трансфер'})</option>`)
            .join('');

        document.getElementById('modalBody').innerHTML = `
            <div class="filter-group">
                <label>Шаблон за търсене</label>
                <input type="text" id="rulePattern" class="input" value="${escapeHtml(rule.pattern)}">
                <small class="text-muted">Използвайте | за няколко варианта.</small>
            </div>
            <div class="filter-group">
                <label>Категория</label>
                <select id="ruleCategory" class="input">
                    ${categoryOptions}
                </select>
            </div>
            <div class="filter-group">
                <label>Приоритет</label>
                <input type="number" id="rulePriority" class="input" value="${rule.priority}" min="1" max="10">
            </div>
            <div class="filter-group">
                <label>
                    <input type="checkbox" id="ruleActive" ${rule.active ? 'checked' : ''}> Активно
                </label>
            </div>
        `;

        modal.classList.add('active');
        document.getElementById('modalSave').style.display = 'inline-block';
        document.getElementById('modalCancel').textContent = 'Отказ';

        const saveHandler = async () => {
            const pattern = document.getElementById('rulePattern').value.trim();
            const categoryId = document.getElementById('ruleCategory').value;
            const priority = parseInt(document.getElementById('rulePriority').value) || 5;
            const active = document.getElementById('ruleActive').checked;

            if (!pattern) {
                showNotification('Моля, въведете шаблон за търсене', 'error');
                return;
            }

            try {
                showLoader();
                await api.updateCategorizationRule(ruleId, {
                    pattern,
                    categoryId: parseInt(categoryId),
                    priority,
                    active
                });
                modal.classList.remove('active');
                showNotification('Правилото е обновено успешно', 'success');
                await loadCategoriesPage();
            } catch (error) {
                showNotification('Грешка при обновяване на правило: ' + error.message, 'error');
            } finally {
                hideLoader();
            }
        };

        document.getElementById('modalSave').onclick = saveHandler;
        document.getElementById('modalCancel').onclick = () => modal.classList.remove('active');
        document.querySelector('.modal-close').onclick = () => modal.classList.remove('active');

    } catch (error) {
        hideLoader();
        showNotification('Грешка при зареждане на правило: ' + error.message, 'error');
    }
}

async function deleteRule(ruleId) {
    if (!confirm('Сигурни ли сте, че искате да изтриете това правило?')) {
        return;
    }

    try {
        showLoader();
        await api.deleteCategorizationRule(ruleId);
        showNotification('Правилото е изтрито успешно', 'success');
        await loadCategoriesPage();
    } catch (error) {
        showNotification('Грешка при изтриване на правило: ' + error.message, 'error');
    } finally {
        hideLoader();
    }
}

async function applyRules() {
    if (!confirm('Това ще приложи всички активни правила към некатегоризираните транзакции.\n\nЖелаете ли да продължите?')) {
        return;
    }

    try {
        showLoader();
        const result = await api.applyCategorizationRules();
        hideLoader();

        if (result.success) {
            const message = result.categorizedCount > 0
                ? `Успешно категоризирани ${result.categorizedCount} транзакции!`
                : 'Няма некатегоризирани транзакции, които да съвпадат с правилата.';
            showNotification(message, 'success');
        }
    } catch (error) {
        hideLoader();
        showNotification('Грешка при прилагане на правила: ' + error.message, 'error');
    }
}

// Make functions global for onclick handlers
window.editCategory = editCategory;
window.deleteCategory = deleteCategory;
window.editRule = editRule;
window.deleteRule = deleteRule;

// Backup functionality
async function createBackup() {
    try {
        showLoader();
        const result = await api.createBackup();
        hideLoader();

        if (result.success) {
            document.getElementById('backupStatus').innerHTML =
                `<p style="color: var(--success-color);">✓ ${result.message}</p>`;
            showNotification('Backup създаден успешно!', 'success');
        }
    } catch (error) {
        hideLoader();
        document.getElementById('backupStatus').innerHTML =
            `<p style="color: var(--danger-color);">✗ Грешка: ${error.message}</p>`;
        showNotification('Грешка при създаване на backup: ' + error.message, 'error');
    }
}

// Reports Page
async function loadReportsPage() {
    // Populate year dropdown
    const yearSelect = document.getElementById('reportYear');
    const currentYear = new Date().getFullYear();
    yearSelect.innerHTML = '';

    for (let year = currentYear; year >= currentYear - 5; year--) {
        const option = document.createElement('option');
        option.value = year;
        option.textContent = year;
        if (year === currentYear) option.selected = true;
        yearSelect.appendChild(option);
    }

    // Set current month
    const currentMonth = new Date().getMonth() + 1;
    document.getElementById('reportMonth').value = currentMonth;

    // Set default date range for counterparty report (current month)
    const now = new Date();
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    document.getElementById('counterpartyStartDate').value = formatDate(firstDayOfMonth);
    document.getElementById('counterpartyEndDate').value = formatDate(now);

    // Attach generate buttons
    document.getElementById('generateReport').onclick = generateReport;
    document.getElementById('generateCounterpartyReport').onclick = generateCounterpartyReport;

    // Report tab switching
    document.querySelectorAll('.report-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            // Update tab buttons
            document.querySelectorAll('.report-tab').forEach(t => {
                t.classList.remove('active');
                t.classList.remove('btn-primary');
                t.classList.add('btn-secondary');
            });
            tab.classList.add('active');
            tab.classList.remove('btn-secondary');
            tab.classList.add('btn-primary');

            // Show/hide sections
            const reportType = tab.dataset.report;
            if (reportType === 'monthly') {
                document.getElementById('monthlyReportSection').style.display = 'block';
                document.getElementById('counterpartyReportSection').style.display = 'none';
            } else if (reportType === 'counterparty') {
                document.getElementById('monthlyReportSection').style.display = 'none';
                document.getElementById('counterpartyReportSection').style.display = 'block';
            }
        });
    });
}

async function generateReport() {
    const year = document.getElementById('reportYear').value;
    const month = document.getElementById('reportMonth').value;

    try {
        showLoader();

        const report = await api.getMonthlyReport(year, month);

        // Show results
        document.getElementById('reportResults').style.display = 'block';

        // Update stats
        document.getElementById('reportIncome').textContent = formatCurrency(report.stats.total_income || 0);
        document.getElementById('reportExpenses').textContent = formatCurrency(report.stats.total_expenses || 0);

        const balance = (report.stats.total_income || 0) - (report.stats.total_expenses || 0);
        const balanceEl = document.getElementById('reportBalance');
        balanceEl.textContent = formatCurrency(balance);
        balanceEl.className = 'amount';
        if (balance > 0) balanceEl.classList.add('positive');
        else if (balance < 0) balanceEl.classList.add('negative');

        // Render chart
        const breakdown = report.categoryBreakdown || [];
        if (breakdown.length > 0) {
            const chartData = {
                labels: breakdown.map(c => c.name),
                values: breakdown.map(c => c.total),
                colors: breakdown.map(c => c.color || '#999')
            };
            charts.createCategoryBarChart('reportCategoryChart', chartData);
        }

    } catch (error) {
        console.error('Error generating report:', error);
        showNotification('Грешка при генериране на отчет', 'error');
    } finally {
        hideLoader();
    }
}

async function generateCounterpartyReport() {
    const startDate = document.getElementById('counterpartyStartDate').value;
    const endDate = document.getElementById('counterpartyEndDate').value;

    try {
        showLoader();

        const report = await api.getCounterpartyReport(startDate, endDate);
        const tbody = document.querySelector('#counterpartyTable tbody');

        if (!report || report.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">Няма данни за избрания период</td></tr>';
            return;
        }

        tbody.innerHTML = report.map(row => `
            <tr>
                <td>
                    <a href="https://www.google.com/search?q=${encodeURIComponent(row.counterparty_name)}" target="_blank" rel="noopener" style="color: inherit; text-decoration: underline dotted;" title="Търси в Google">
                        ${escapeHtml(row.counterparty_name)}
                    </a>
                </td>
                <td style="text-align: right;">${row.transaction_count}</td>
                <td style="text-align: right;" class="positive">${row.total_income > 0 ? formatCurrency(row.total_income) : '-'}</td>
                <td style="text-align: right;" class="negative">${row.total_expenses > 0 ? formatCurrency(row.total_expenses) : '-'}</td>
                <td style="text-align: right;" class="${row.net_amount >= 0 ? 'positive' : 'negative'}">${formatCurrency(row.net_amount)}</td>
            </tr>
        `).join('');

        showNotification(`Генерирани ${report.length} контрагента`, 'success');

    } catch (error) {
        console.error('Error generating counterparty report:', error);
        showNotification('Грешка при генериране на справка', 'error');
    } finally {
        hideLoader();
    }
}

// Settings Page
async function loadSettingsPage() {
    try {
        showLoader();

        // Check auth status
        const authStatus = await api.getAuthStatus();
        const statusEl = document.getElementById('connectionStatus');

        if (authStatus.connected) {
            statusEl.textContent = 'Свързан ✓';
            statusEl.className = 'status-badge connected';
        } else {
            statusEl.textContent = 'Несвързан';
            statusEl.className = 'status-badge disconnected';
        }

        // Load requisitions
        const requisitions = await api.getRequisitions();
        renderRequisitionsList(requisitions);

        // Load accounts
        const accounts = await api.getAccounts();
        renderAccountsList(accounts);

    } catch (error) {
        console.error('Error loading settings:', error);
    } finally {
        hideLoader();
    }
}

function renderRequisitionsList(requisitions) {
    const container = document.getElementById('requisitionsList');

    if (!requisitions || requisitions.length === 0) {
        container.innerHTML = '<p class="text-muted">Няма банкови връзки. Кликнете "Добави банка" за да свържете банка.</p>';
        return;
    }

    const statusLabels = {
        'LN': { text: 'Свързана', class: 'badge-success' },
        'EX': { text: 'Изтекла', class: 'badge-danger' },
        'RJ': { text: 'Отхвърлена', class: 'badge-danger' },
        'UA': { text: 'Изчаква одобрение', class: 'badge-warning' },
        'GA': { text: 'Предоставен достъп', class: 'badge-info' },
        'SA': { text: 'Избрани сметки', class: 'badge-info' },
        'CR': { text: 'Създадена', class: 'badge-warning' }
    };

    container.innerHTML = `
        <table class="table" style="font-size: 13px;">
            <thead>
                <tr>
                    <th>Банка</th>
                    <th>Статус</th>
                    <th>Сметки</th>
                    <th>Създадена</th>
                    <th>Действия</th>
                </tr>
            </thead>
            <tbody>
                ${requisitions.map(req => {
                    const status = statusLabels[req.status] || { text: req.status, class: 'badge-secondary' };
                    const createdDate = req.created ? new Date(req.created).toLocaleString('bg-BG') : '-';
                    const isInactive = ['EX', 'RJ'].includes(req.status);

                    return `
                        <tr>
                            <td>${escapeHtml(req.institution_id || '-')}</td>
                            <td><span class="badge ${status.class}">${status.text}</span></td>
                            <td>${req.accounts?.length || 0}</td>
                            <td>${createdDate}</td>
                            <td>
                                ${isInactive ? `
                                    <button class="btn btn-danger" style="padding: 4px 8px; font-size: 11px;"
                                            onclick="deleteRequisition('${req.id}')">Изтрий</button>
                                ` : ''}
                            </td>
                        </tr>
                    `;
                }).join('')}
            </tbody>
        </table>
    `;
}

async function deleteRequisition(requisitionId) {
    if (!confirm('Сигурни ли сте, че искате да изтриете тази банкова връзка?')) {
        return;
    }

    try {
        showLoader();
        await api.deleteRequisition(requisitionId);
        showNotification('Банковата връзка е изтрита', 'success');
        await loadSettingsPage();
    } catch (error) {
        showNotification('Грешка: ' + error.message, 'error');
    } finally {
        hideLoader();
    }
}

window.deleteRequisition = deleteRequisition;

// Add Bank functionality
async function showAddBankModal() {
    try {
        showLoader();

        // Load institutions (banks)
        const institutions = await api.getInstitutions('BG');

        hideLoader();

        const modal = document.getElementById('modal');
        document.getElementById('modalTitle').textContent = 'Добави банкова сметка';

        // Filter Bulgarian banks and popular international ones
        const bulgarianBanks = institutions.filter(inst => inst.countries.includes('BG'));

        // Sort: Bulgarian banks first, then alphabetically
        bulgarianBanks.sort((a, b) => {
            const bgOnlyA = inst => inst.countries.length === 1 && inst.countries[0] === 'BG';
            const bgOnlyB = inst => inst.countries.length === 1 && inst.countries[0] === 'BG';

            if (bgOnlyA(a) && !bgOnlyB(b)) return -1;
            if (!bgOnlyA(a) && bgOnlyB(b)) return 1;
            return a.name.localeCompare(b.name);
        });

        const banksHtml = bulgarianBanks.map(inst => `
            <div class="bank-option" data-institution-id="${inst.id}" style="
                padding: 12px;
                border: 1px solid var(--border-color);
                border-radius: 6px;
                cursor: pointer;
                margin-bottom: 8px;
                display: flex;
                align-items: center;
                gap: 12px;
                transition: all 0.2s;
            " onmouseover="this.style.backgroundColor='var(--light-bg)'"
               onmouseout="this.style.backgroundColor='white'"
               onclick="selectBank('${inst.id}')">
                ${inst.logo ? `<img src="${inst.logo}" alt="${inst.name}" style="width: 32px; height: 32px; object-fit: contain;">` : '🏦'}
                <div style="flex: 1;">
                    <strong>${escapeHtml(inst.name)}</strong>
                    <div style="font-size: 12px; color: var(--text-secondary);">
                        История: ${inst.transaction_total_days} дни | Достъп: ${inst.max_access_valid_for_days} дни
                    </div>
                </div>
            </div>
        `).join('');

        document.getElementById('modalBody').innerHTML = `
            <div style="max-height: 400px; overflow-y: auto;">
                <p style="margin-bottom: 12px; color: var(--text-secondary);">
                    Изберете вашата банка за да свържете сметка:
                </p>
                ${banksHtml}
            </div>
        `;

        modal.classList.add('active');

        // Hide default buttons
        document.getElementById('modalSave').style.display = 'none';
        document.getElementById('modalCancel').textContent = 'Затвори';
        document.getElementById('modalCancel').onclick = () => modal.classList.remove('active');
        document.querySelector('.modal-close').onclick = () => modal.classList.remove('active');

    } catch (error) {
        hideLoader();
        console.error('Error loading banks:', error);
        showNotification('Грешка при зареждане на банки: ' + error.message, 'error');
    }
}

// Select and connect to bank
async function selectBank(institutionId) {
    try {
        showLoader();

        const result = await api.createRequisition(institutionId);

        hideLoader();

        // Close modal
        document.getElementById('modal').classList.remove('active');

        // Show confirmation
        const confirmed = confirm(
            'Ще бъдете пренасочени към сайта на банката за одобрение.\n\n' +
            'След одобрение, върнете се в това приложение и синхронизирайте сметките.\n\n' +
            'Желаете ли да продължите?'
        );

        if (confirmed && result.link) {
            // Open bank authorization in new window
            window.open(result.link, '_blank');

            showNotification(
                'След като одобрите достъпа в банката, върнете се тук и кликнете "Синхронизирай сметки"',
                'info'
            );
        }

    } catch (error) {
        hideLoader();
        console.error('Error creating requisition:', error);
        showNotification('Грешка при свързване с банка: ' + error.message, 'error');
    }
}

// Sync accounts
async function syncAccounts() {
    try {
        showLoader();

        const result = await api.syncAccounts();

        hideLoader();

        if (result.success) {
            showNotification(`Успешно синхронизирани ${result.count} сметки!`, 'success');

            // Reload accounts list
            const accounts = await api.getAccounts();
            renderAccountsList(accounts);

            // Update dashboard if visible
            if (document.getElementById('dashboard-page').classList.contains('active')) {
                dashboard.refresh();
            }
        }

    } catch (error) {
        hideLoader();
        console.error('Error syncing accounts:', error);
        showNotification('Грешка при синхронизация: ' + error.message, 'error');
    }
}

// Sync transactions
async function syncTransactions() {
    try {
        const accounts = await api.getAccounts();

        if (accounts.length === 0) {
            showNotification('Няма сметки за синхронизация. Моля, първо добавете банкова сметка.', 'error');
            return;
        }

        showLoader();
        document.getElementById('syncStatus').innerHTML = '<p class="text-muted">Синхронизиране на транзакции...</p>';

        const result = await api.syncTransactions();

        hideLoader();

        if (result.success) {
            const message = `Успешно синхронизирани ${result.transactionsSynced} транзакции!`;
            showNotification(message, 'success');
            document.getElementById('syncStatus').innerHTML = `<p style="color: var(--success-color);">✓ ${message}</p>`;

            // Update dashboard if visible
            if (document.getElementById('dashboard-page').classList.contains('active')) {
                dashboard.refresh();
            }
        }

    } catch (error) {
        hideLoader();
        console.error('Error syncing transactions:', error);
        const errorMsg = 'Грешка при синхронизация: ' + error.message;
        showNotification(errorMsg, 'error');
        document.getElementById('syncStatus').innerHTML = `<p style="color: var(--danger-color);">✗ ${errorMsg}</p>`;
    }
}

function renderAccountsList(accounts) {
    const container = document.getElementById('accountsList');

    if (accounts.length === 0) {
        container.innerHTML = '<p class="text-muted">Няма свързани сметки</p>';
        return;
    }

    container.innerHTML = '';
    accounts.forEach(account => {
        const displayName = account.custom_name || account.name;
        const lastSyncedText = account.last_synced
            ? new Date(account.last_synced).toLocaleString('bg-BG')
            : 'Никога';

        const div = document.createElement('div');
        div.className = 'account-item';
        div.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 12px; border: 1px solid var(--border-color); border-radius: 8px; margin-bottom: 8px;';
        div.innerHTML = `
            <div class="account-info" style="flex: 1;">
                <h4 style="margin: 0 0 4px 0; display: flex; align-items: center; gap: 8px;">
                    ${escapeHtml(displayName)}
                    <button class="btn btn-secondary" style="padding: 2px 8px; font-size: 11px;" onclick="editAccountName('${account.id}', '${escapeHtml(displayName).replace(/'/g, "\\'")}')">✏️</button>
                </h4>
                <p style="margin: 2px 0; font-size: 13px; color: var(--text-secondary);">${escapeHtml(account.institution_name || '')} - ${escapeHtml(account.iban || '')}</p>
                <p style="margin: 2px 0; font-size: 12px; color: var(--text-muted);">Последна актуализация: ${lastSyncedText}</p>
            </div>
            <div class="account-balance" style="font-size: 18px; font-weight: 600;">
                ${formatCurrency(account.balance || 0)}
            </div>
        `;
        container.appendChild(div);
    });
}

async function editAccountName(accountId, currentName) {
    const newName = prompt('Въведете ново име за сметката:', currentName);
    if (newName !== null && newName.trim() !== '') {
        try {
            showLoader();
            await api.updateAccountName(accountId, newName.trim());
            const accounts = await api.getAccounts();
            renderAccountsList(accounts);
            showNotification('Името на сметката е обновено', 'success');
        } catch (error) {
            showNotification('Грешка: ' + error.message, 'error');
        } finally {
            hideLoader();
        }
    }
}

window.editAccountName = editAccountName;

// Sync functionality - sync all (accounts + transactions)
async function syncData() {
    try {
        await syncAccounts();
        // Small delay between syncs
        setTimeout(async () => {
            await syncTransactions();
        }, 1000);
    } catch (error) {
        console.error('Sync error:', error);
    }
}

// Logs functionality
async function loadLogs() {
    try {
        const response = await fetch('/api/logs?lines=200');
        const data = await response.json();
        document.getElementById('logsContent').textContent = data.logs || 'Няма логове.';
    } catch (error) {
        document.getElementById('logsContent').textContent = 'Грешка при зареждане на логове: ' + error.message;
    }
}

function toggleLogsPanel() {
    const card = document.getElementById('logsCard');
    const btn = document.getElementById('toggleLogsBtn');

    if (card.style.display === 'none') {
        card.style.display = 'block';
        btn.textContent = '📋 Скрий логове';
        loadLogs();
    } else {
        card.style.display = 'none';
        btn.textContent = '📋 Покажи логове';
    }
}

// Make selectBank global so it can be called from onclick
window.selectBank = selectBank;

// Initialize app
document.addEventListener('DOMContentLoaded', async () => {
    // Navigation
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const pageName = link.dataset.page;
            navigateToPage(pageName);
        });
    });

    // Sync button (main nav)
    document.getElementById('syncButton').addEventListener('click', syncData);

    // Categories page buttons
    document.getElementById('addCategoryBtn')?.addEventListener('click', showAddCategoryModal);
    document.getElementById('addRuleBtn')?.addEventListener('click', showAddRuleModal);
    document.getElementById('applyRulesBtn')?.addEventListener('click', applyRules);

    // Settings page buttons
    document.getElementById('addBankBtn')?.addEventListener('click', showAddBankModal);
    document.getElementById('syncAccountsBtn')?.addEventListener('click', syncAccounts);
    document.getElementById('syncTransactionsBtn')?.addEventListener('click', syncTransactions);
    document.getElementById('backupBtn')?.addEventListener('click', createBackup);
    document.getElementById('toggleLogsBtn')?.addEventListener('click', toggleLogsPanel);
    document.getElementById('refreshLogsBtn')?.addEventListener('click', loadLogs);

    // Load initial page
    await navigateToPage('dashboard');
});
