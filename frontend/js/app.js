// Main application logic

// Utility functions
function formatCurrency(amount) {
    const absAmount = Math.abs(amount);
    const formatted = absAmount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
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


// Table sorting functionality
function makeTableSortable(tableId) {
    const table = document.getElementById(tableId);
    if (!table) return;

    const headers = table.querySelectorAll('thead th');
    headers.forEach((header, index) => {
        // Skip if header has no sortable attribute or is the first column (name/category)
        if (header.dataset.sortable === 'false') return;
        
        header.style.cursor = 'pointer';
        header.style.userSelect = 'none';
        
        // Add sort indicator
        if (!header.querySelector('.sort-indicator')) {
            header.innerHTML += ' <span class="sort-indicator" style="opacity: 0.5;">↕</span>';
        }

        header.addEventListener('click', () => {
            const tbody = table.querySelector('tbody');
            const rows = Array.from(tbody.querySelectorAll('tr'));
            
            // Determine sort direction
            const currentDir = header.dataset.sortDir || 'none';
            const newDir = currentDir === 'asc' ? 'desc' : 'asc';
            
            // Reset all headers
            headers.forEach(h => {
                h.dataset.sortDir = 'none';
                const indicator = h.querySelector('.sort-indicator');
                if (indicator) indicator.textContent = '↕';
            });
            
            // Set current header
            header.dataset.sortDir = newDir;
            const indicator = header.querySelector('.sort-indicator');
            if (indicator) indicator.textContent = newDir === 'asc' ? '↑' : '↓';

            // Sort rows
            rows.sort((a, b) => {
                const aCell = a.cells[index];
                const bCell = b.cells[index];
                
                if (!aCell || !bCell) return 0;
                
                let aVal = aCell.textContent.trim().replace(/[€\s]/g, '').replace(',', '.');
                let bVal = bCell.textContent.trim().replace(/[€\s]/g, '').replace(',', '.');
                
                // Check if numeric
                const aNum = parseFloat(aVal.replace('-', ''));
                const bNum = parseFloat(bVal.replace('-', ''));
                
                if (!isNaN(aNum) && !isNaN(bNum)) {
                    // Handle negative values
                    const aFinal = aVal.startsWith('-') ? -aNum : aNum;
                    const bFinal = bVal.startsWith('-') ? -bNum : bNum;
                    return newDir === 'asc' ? aFinal - bFinal : bFinal - aFinal;
                }
                
                // String comparison
                return newDir === 'asc' 
                    ? aVal.localeCompare(bVal, 'bg') 
                    : bVal.localeCompare(aVal, 'bg');
            });

            // Re-append sorted rows
            rows.forEach(row => tbody.appendChild(row));
        });
    });
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
function navigateToPage(pageName, updateHash = true) {
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

    // Update URL hash (without triggering hashchange if already correct)
    if (updateHash && window.location.hash !== `#${pageName}`) {
        history.pushState(null, '', `#${pageName}`);
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
            let message;
            if (result.totalUncategorized === 0) {
                message = 'Няма некатегоризирани транзакции';
            } else if (result.categorizedCount === 0) {
                message = `Намерени ${result.totalUncategorized} некатегоризирани, но няма съвпадения`;
            } else {
                message = `Намерени ${result.totalUncategorized} → категоризирани ${result.categorizedCount}`;
            }
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

    // Attach generate button
    document.getElementById('generateReport').onclick = generateReport;

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
                document.getElementById('yearlyReportSection').style.display = 'none';
            } else if (reportType === 'yearly') {
                document.getElementById('monthlyReportSection').style.display = 'none';
                document.getElementById('yearlyReportSection').style.display = 'block';
                generateYearlyReport();
            }
        });
    });
}

async function generateReport() {
    const year = document.getElementById('reportYear').value;
    const month = document.getElementById('reportMonth').value;

    // Store for category click handler
    window.currentReportPeriod = { year, month };

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

        // Render category table
        const categoryBreakdown = report.categoryBreakdown || [];
        const categoryTbody = document.querySelector('#reportCategoryTable tbody');
        const categoryTfoot = document.querySelector('#reportCategoryTable tfoot');

        if (categoryBreakdown.length === 0) {
            categoryTbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">Няма данни</td></tr>';
            categoryTfoot.innerHTML = '';
        } else {
            let totalCount = 0, totalIncome = 0, totalExpenses = 0, totalNet = 0;

            categoryTbody.innerHTML = categoryBreakdown.map(row => {
                totalCount += row.count || 0;
                totalIncome += row.income || 0;
                totalExpenses += row.expenses || 0;
                totalNet += row.net || 0;

                return `
                    <tr>
                        <td>
                            <span class="category-badge category-clickable" style="background-color: ${row.color}; cursor: pointer;" 
                                  data-category-id="${row.id}" data-category-name="${escapeHtml(row.name)}"
                                  onclick="showCategoryTransactions(${row.id}, '${escapeHtml(row.name).replace(/'/g, "\\'")}')">
                                ${escapeHtml(row.name)}
                            </span>
                        </td>
                        <td style="text-align: right;">${row.count}</td>
                        <td style="text-align: right;" class="positive">${row.income > 0 ? formatCurrency(row.income) : '-'}</td>
                        <td style="text-align: right;" class="negative">${row.expenses > 0 ? formatCurrency(row.expenses) : '-'}</td>
                        <td style="text-align: right;" class="${row.net >= 0 ? 'positive' : 'negative'}">${formatCurrency(row.net)}</td>
                    </tr>
                `;
            }).join('');

            categoryTfoot.innerHTML = `
                <tr>
                    <td style="text-align: right;">Тотал:</td>
                    <td style="text-align: right;">${totalCount}</td>
                    <td style="text-align: right;" class="positive">${formatCurrency(totalIncome)}</td>
                    <td style="text-align: right;" class="negative">${formatCurrency(totalExpenses)}</td>
                    <td style="text-align: right;" class="${totalNet >= 0 ? 'positive' : 'negative'}">${formatCurrency(totalNet)}</td>
                </tr>
            `;
        }

        // Render counterparty table
        const counterpartyBreakdown = report.counterpartyBreakdown || [];
        const counterpartyTbody = document.querySelector('#reportCounterpartyTable tbody');
        const counterpartyTfoot = document.querySelector('#reportCounterpartyTable tfoot');

        if (counterpartyBreakdown.length === 0) {
            counterpartyTbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">Няма данни</td></tr>';
            counterpartyTfoot.innerHTML = '';
        } else {
            let totalCount = 0, totalIncome = 0, totalExpenses = 0, totalNet = 0;

            counterpartyTbody.innerHTML = counterpartyBreakdown.map(row => {
                totalCount += row.transaction_count || 0;
                totalIncome += row.total_income || 0;
                totalExpenses += row.total_expenses || 0;
                totalNet += row.net_amount || 0;

                const displayName = row.display_name || row.counterparty_name;

                return `
                    <tr>
                        <td>
                            <a href="https://www.google.com/search?q=${encodeURIComponent(row.counterparty_name)}" target="_blank" rel="noopener" style="color: inherit; text-decoration: underline dotted;" title="Търси в Google">
                                ${escapeHtml(displayName)}
                            </a>
                        </td>
                        <td style="text-align: right;">${row.transaction_count}</td>
                        <td style="text-align: right;" class="positive">${row.total_income > 0 ? formatCurrency(row.total_income) : '-'}</td>
                        <td style="text-align: right;" class="negative">${row.total_expenses > 0 ? formatCurrency(row.total_expenses) : '-'}</td>
                        <td style="text-align: right;" class="${row.net_amount >= 0 ? 'positive' : 'negative'}">${formatCurrency(row.net_amount)}</td>
                    </tr>
                `;
            }).join('');

            counterpartyTfoot.innerHTML = `
                <tr>
                    <td style="text-align: right;">Тотал:</td>
                    <td style="text-align: right;">${totalCount}</td>
                    <td style="text-align: right;" class="positive">${formatCurrency(totalIncome)}</td>
                    <td style="text-align: right;" class="negative">${formatCurrency(totalExpenses)}</td>
                    <td style="text-align: right;" class="${totalNet >= 0 ? 'positive' : 'negative'}">${formatCurrency(totalNet)}</td>
                </tr>
            `;
        }

        // Render account table
        const accountBreakdown = report.accountBreakdown || [];
        const accountTbody = document.querySelector('#reportAccountTable tbody');
        const accountTfoot = document.querySelector('#reportAccountTable tfoot');

        if (accountBreakdown.length === 0) {
            accountTbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">Няма данни</td></tr>';
            accountTfoot.innerHTML = '';
        } else {
            let totalCount = 0, totalIncome = 0, totalExpenses = 0, totalNet = 0;

            accountTbody.innerHTML = accountBreakdown.map(row => {
                totalCount += row.count || 0;
                totalIncome += row.income || 0;
                totalExpenses += row.expenses || 0;
                totalNet += row.net || 0;

                const accountName = row.custom_name || row.name || 'Неизвестна';
                const bankName = row.institution_name || '';

                return `
                    <tr>
                        <td>${escapeHtml(accountName)}${bankName ? ` <span style="color: var(--text-muted);">(${escapeHtml(bankName)})</span>` : ''}</td>
                        <td style="text-align: right;">${row.count}</td>
                        <td style="text-align: right;" class="positive">${row.income > 0 ? formatCurrency(row.income) : '-'}</td>
                        <td style="text-align: right;" class="negative">${row.expenses > 0 ? formatCurrency(row.expenses) : '-'}</td>
                        <td style="text-align: right;" class="${row.net >= 0 ? 'positive' : 'negative'}">${formatCurrency(row.net)}</td>
                    </tr>
                `;
            }).join('');

            accountTfoot.innerHTML = `
                <tr>
                    <td style="text-align: right;">Тотал:</td>
                    <td style="text-align: right;">${totalCount}</td>
                    <td style="text-align: right;" class="positive">${formatCurrency(totalIncome)}</td>
                    <td style="text-align: right;" class="negative">${formatCurrency(totalExpenses)}</td>
                    <td style="text-align: right;" class="${totalNet >= 0 ? 'positive' : 'negative'}">${formatCurrency(totalNet)}</td>
                </tr>
            `;
        }

        // Make tables sortable
        makeTableSortable('reportCategoryTable');
        makeTableSortable('reportCounterpartyTable');
        makeTableSortable('reportAccountTable');

    } catch (error) {
        console.error('Error generating report:', error);
        showNotification('Грешка при генериране на отчет', 'error');
    } finally {
        hideLoader();
    }
}


async function showCategoryTransactions(categoryId, categoryName) {
    const period = window.currentReportPeriod;
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

        const modal = document.getElementById('modal');
        const modalContent = modal.querySelector('.modal-content');
        modalContent.style.maxWidth = '800px';

        document.getElementById('modalTitle').textContent = `Транзакции: ${categoryName}`;
        document.getElementById('modalSave').style.display = 'none';
        document.getElementById('modalCancel').textContent = 'Затвори';

        if (!transactions || transactions.length === 0) {
            document.getElementById('modalBody').innerHTML = '<p class="text-muted text-center">Няма транзакции за този период</p>';
        } else {
            let totalAmount = 0;
            const rows = transactions.map(tx => {
                totalAmount += tx.amount;
                return `
                    <tr>
                        <td style="white-space: nowrap;">${formatDate(new Date(tx.transaction_date))}</td>
                        <td>${escapeHtml(tx.counterparty_name || tx.description || '-')}</td>
                        <td class="${tx.amount >= 0 ? 'positive' : 'negative'}" style="text-align: right; font-weight: 600;">
                            ${formatCurrency(tx.amount)}
                        </td>
                    </tr>
                `;
            }).join('');

            document.getElementById('modalBody').innerHTML = `
                <div class="table-responsive" style="max-height: 400px; overflow-y: auto;">
                    <table class="table">
                        <thead>
                            <tr>
                                <th style="width: 100px;">Дата</th>
                                <th>Контрагент</th>
                                <th style="width: 120px; text-align: right;">Сума</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                        <tfoot style="font-weight: 600; background: #f5f5f5;">
                            <tr>
                                <td colspan="2" style="text-align: right;">Тотал (${transactions.length} транзакции):</td>
                                <td class="${totalAmount >= 0 ? 'positive' : 'negative'}" style="text-align: right;">${formatCurrency(totalAmount)}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            `;
        }

        modal.classList.add('active');

        document.getElementById('modalCancel').onclick = () => {
            modalContent.style.maxWidth = '';
            modal.classList.remove('active');
        };
        document.querySelector('.modal-close').onclick = () => {
            modalContent.style.maxWidth = '';
            modal.classList.remove('active');
        };

    } catch (error) {
        console.error('Error loading category transactions:', error);
        showNotification('Грешка при зареждане на транзакции', 'error');
    } finally {
        hideLoader();
    }
}


async function showAddManualTransactionModal() {
    try {
        showLoader();
        const categories = await api.getCategories();
        hideLoader();

        const modal = document.getElementById('modal');
        document.getElementById('modalTitle').textContent = 'Добави кеш транзакция';
        document.getElementById('modalSave').style.display = 'inline-block';
        document.getElementById('modalCancel').textContent = 'Отказ';

        const today = new Date().toISOString().split('T')[0];

        const categoryOptions = categories
            .map(cat => `<option value="${cat.id}">${escapeHtml(cat.name)} (${cat.type === 'expense' ? 'Разход' : cat.type === 'income' ? 'Приход' : 'Трансфер'})</option>`)
            .join('');

        document.getElementById('modalBody').innerHTML = `
            <div class="filter-group">
                <label>Дата *</label>
                <input type="date" id="manualTxDate" class="input" value="${today}" required>
            </div>
            <div class="filter-group">
                <label>Контрагент</label>
                <input type="text" id="manualTxCounterparty" class="input" placeholder="Име на магазин, лице и т.н.">
            </div>
            <div class="filter-group">
                <label>Сума * (отрицателна за разход)</label>
                <input type="number" id="manualTxAmount" class="input" step="0.01" placeholder="-50.00" required>
                <small class="text-muted">Използвайте минус за разходи (напр. -25.50)</small>
            </div>
            <div class="filter-group">
                <label>Категория</label>
                <select id="manualTxCategory" class="input">
                    <option value="">Без категория</option>
                    ${categoryOptions}
                </select>
            </div>
            <div class="filter-group">
                <label>Описание</label>
                <input type="text" id="manualTxDescription" class="input" placeholder="Допълнителни бележки">
            </div>
        `;

        modal.classList.add('active');

        const saveHandler = async () => {
            const transactionDate = document.getElementById('manualTxDate').value;
            const counterpartyName = document.getElementById('manualTxCounterparty').value.trim();
            const amount = parseFloat(document.getElementById('manualTxAmount').value);
            const categoryId = document.getElementById('manualTxCategory').value;
            const description = document.getElementById('manualTxDescription').value.trim();

            if (!transactionDate) {
                showNotification('Моля, въведете дата', 'error');
                return;
            }
            if (isNaN(amount)) {
                showNotification('Моля, въведете валидна сума', 'error');
                return;
            }

            try {
                showLoader();
                await api.createTransaction({
                    transactionDate,
                    counterpartyName: counterpartyName || null,
                    amount,
                    categoryId: categoryId ? parseInt(categoryId) : null,
                    description: description || null
                });

                modal.classList.remove('active');
                showNotification('Транзакцията е добавена успешно', 'success');

                // Refresh transactions list if on transactions page
                if (typeof transactionsPage !== 'undefined') {
                    await transactionsPage.loadTransactions();
                }
            } catch (error) {
                showNotification('Грешка: ' + error.message, 'error');
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

async function showImportXmlModal() {
    try {
        showLoader();

        // Load all accounts to populate the select
        const accounts = await api.getAccounts();
        hideLoader();

        const modal = document.getElementById('modal');
        document.getElementById('modalTitle').textContent = 'Импорт на транзакции от XML';
        document.getElementById('modalSave').style.display = 'inline-block';
        document.getElementById('modalSave').textContent = 'Импорт';
        document.getElementById('modalCancel').textContent = 'Отказ';

        // Build account options
        const accountOptions = accounts
            .map(acc => {
                const displayName = acc.custom_name || acc.name || acc.institution_name || acc.iban;
                return `<option value="${acc.id}">${escapeHtml(displayName)}</option>`;
            })
            .join('');

        document.getElementById('modalBody').innerHTML = `
            <div class="filter-group">
                <label>XML файл от Банка ДСК *</label>
                <input type="file" id="importXmlFile" class="input" accept=".xml" required>
                <small class="text-muted">Изберете XML файл, експортиран от Банка ДСК</small>
            </div>
            <div class="filter-group">
                <label>Сметка *</label>
                <select id="importXmlAccount" class="input" required>
                    <option value="">Изберете сметка</option>
                    ${accountOptions}
                </select>
            </div>
            <div class="filter-group">
                <label>Валута на файла</label>
                <select id="importXmlCurrency" class="input">
                    <option value="BGN">BGN (ще се конвертира в EUR)</option>
                    <option value="EUR">EUR</option>
                </select>
            </div>
            <div id="importProgress" style="display: none; margin-top: 15px;">
                <div class="progress-bar">
                    <div class="progress-fill" style="width: 0%;"></div>
                </div>
                <p id="importStatus" class="text-muted" style="margin-top: 5px;">Обработка...</p>
            </div>
            <div id="importResult" style="display: none; margin-top: 15px;"></div>
        `;

        modal.classList.add('active');

        const saveHandler = async () => {
            const fileInput = document.getElementById('importXmlFile');
            const accountId = document.getElementById('importXmlAccount').value;
            const currency = document.getElementById('importXmlCurrency').value;

            if (!fileInput.files || fileInput.files.length === 0) {
                showNotification('Моля, изберете XML файл', 'error');
                return;
            }
            if (!accountId) {
                showNotification('Моля, изберете сметка', 'error');
                return;
            }

            const file = fileInput.files[0];
            const progressDiv = document.getElementById('importProgress');
            const progressFill = progressDiv.querySelector('.progress-fill');
            const statusText = document.getElementById('importStatus');
            const resultDiv = document.getElementById('importResult');
            const importBtn = document.getElementById('modalSave');

            // Disable import button during operation
            importBtn.disabled = true;
            importBtn.style.opacity = '0.6';
            importBtn.style.cursor = 'not-allowed';

            progressDiv.style.display = 'block';
            resultDiv.style.display = 'none';
            progressFill.style.width = '30%';
            statusText.textContent = 'Четене на файла...';

            try {
                // Read file content
                const xmlContent = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = (e) => resolve(e.target.result);
                    reader.onerror = () => reject(new Error('Грешка при четене на файла'));
                    reader.readAsText(file, 'UTF-8');
                });

                progressFill.style.width = '60%';
                statusText.textContent = 'Изпращане към сървъра...';

                // Send to server
                const result = await api.importXmlTransactions(xmlContent, accountId, currency);

                progressFill.style.width = '100%';
                statusText.textContent = 'Готово!';

                // Show results
                let resultHtml = `<div class="alert ${result.imported > 0 ? 'alert-success' : 'alert-info'}">`;
                resultHtml += `<strong>Резултат:</strong><br>`;
                resultHtml += `✅ Импортирани: ${result.imported}<br>`;
                resultHtml += `🏷️ Категоризирани: ${result.categorized || 0}<br>`;
                resultHtml += `⏭️ Пропуснати (вече съществуват): ${result.skipped}<br>`;
                resultHtml += `📊 Общо обработени: ${result.total}`;

                if (result.errors && result.errors.length > 0) {
                    resultHtml += `<br><br>⚠️ Грешки: ${result.errors.length}`;
                }
                resultHtml += '</div>';

                resultDiv.innerHTML = resultHtml;
                resultDiv.style.display = 'block';
                progressDiv.style.display = 'none';

                if (result.imported > 0) {
                    showNotification(`Успешно импортирани ${result.imported} транзакции`, 'success');

                    // Refresh transactions list if on transactions page
                    if (typeof transactionsPage !== 'undefined') {
                        await transactionsPage.loadTransactions();
                    }
                }

                // Change button to close
                document.getElementById('modalSave').style.display = 'none';
                document.getElementById('modalCancel').textContent = 'Затвори';

            } catch (error) {
                progressDiv.style.display = 'none';
                resultDiv.innerHTML = `<div class="alert alert-error">❌ Грешка: ${escapeHtml(error.message)}</div>`;
                resultDiv.style.display = 'block';
                showNotification('Грешка при импорт: ' + error.message, 'error');

                // Re-enable import button on error
                importBtn.disabled = false;
                importBtn.style.opacity = '1';
                importBtn.style.cursor = 'pointer';
            }
        };

        document.getElementById('modalSave').onclick = saveHandler;
        document.getElementById('modalCancel').onclick = () => {
            document.getElementById('modalSave').textContent = 'Запази';
            modal.classList.remove('active');
        };
        document.querySelector('.modal-close').onclick = () => {
            document.getElementById('modalSave').textContent = 'Запази';
            modal.classList.remove('active');
        };

    } catch (error) {
        hideLoader();
        showNotification('Грешка при зареждане: ' + error.message, 'error');
    }
}

window.showCategoryTransactions = showCategoryTransactions;


async function generateYearlyReport() {
    try {
        showLoader();

        const report = await api.getLast12MonthsReport();

        const monthNames = ['', 'Януари', 'Февруари', 'Март', 'Април', 'Май', 'Юни', 
                           'Юли', 'Август', 'Септември', 'Октомври', 'Ноември', 'Декември'];

        const tbody = document.querySelector('#yearlyReportTable tbody');
        const tfoot = document.querySelector('#yearlyReportTable tfoot');

        if (!report || report.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">Няма данни</td></tr>';
            tfoot.innerHTML = '';
            return;
        }

        let totalCount = 0, totalIncome = 0, totalExpenses = 0, totalNet = 0;

        tbody.innerHTML = report.map(row => {
            totalCount += row.count || 0;
            totalIncome += row.income || 0;
            totalExpenses += row.expenses || 0;
            totalNet += row.net || 0;

            return `
                <tr>
                    <td>${monthNames[row.month]} ${row.year}</td>
                    <td style="text-align: right;">${row.count}</td>
                    <td style="text-align: right;" class="positive">${row.income > 0 ? formatCurrency(row.income) : '-'}</td>
                    <td style="text-align: right;" class="negative">${row.expenses > 0 ? formatCurrency(row.expenses) : '-'}</td>
                    <td style="text-align: right;" class="${row.net >= 0 ? 'positive' : 'negative'}">${formatCurrency(row.net)}</td>
                </tr>
            `;
        }).join('');

        tfoot.innerHTML = `
            <tr>
                <td style="text-align: right;">Тотал:</td>
                <td style="text-align: right;">${totalCount}</td>
                <td style="text-align: right;" class="positive">${formatCurrency(totalIncome)}</td>
                <td style="text-align: right;" class="negative">${formatCurrency(totalExpenses)}</td>
                <td style="text-align: right;" class="${totalNet >= 0 ? 'positive' : 'negative'}">${formatCurrency(totalNet)}</td>
            </tr>
        `;

        // Make table sortable
        makeTableSortable('yearlyReportTable');

    } catch (error) {
        console.error('Error generating yearly report:', error);
        showNotification('Грешка при генериране на отчет', 'error');
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

// Cleanup requisitions - delete all with status UA (pending) or CR (created)
async function cleanupRequisitions() {
    try {
        const requisitions = await api.getRequisitions();

        // Filter requisitions to delete: UA (Изчаква одобрение), CR (Създадена)
        const toDelete = requisitions.filter(req => ['UA', 'CR'].includes(req.status));

        if (toDelete.length === 0) {
            showNotification('Няма връзки за изчистване', 'info');
            return;
        }

        if (!confirm(`Сигурни ли сте, че искате да изтриете ${toDelete.length} незавършени банкови връзки?`)) {
            return;
        }

        showLoader();
        let deletedCount = 0;

        for (const req of toDelete) {
            try {
                await api.deleteRequisition(req.id);
                deletedCount++;
            } catch (error) {
                console.error(`Error deleting requisition ${req.id}:`, error);
            }
        }

        hideLoader();
        showNotification(`Изтрити ${deletedCount} банкови връзки`, 'success');

        // Reload settings page
        loadSettings();
    } catch (error) {
        hideLoader();
        console.error('Error cleaning up requisitions:', error);
        showNotification('Грешка при изчистване: ' + error.message, 'error');
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

            // Build detailed status with breakdown by account
            let statusHtml = `<p style="color: var(--success-color); margin-bottom: 10px;">✓ ${message}</p>`;

            if (result.byAccount && result.byAccount.length > 0) {
                statusHtml += '<div style="font-size: 13px;">';
                result.byAccount.forEach(acc => {
                    const icon = acc.error ? '❌' : (acc.count > 0 ? '✅' : '➖');
                    const text = acc.error ? 'грешка' : `${acc.count} нови`;
                    statusHtml += `<p style="margin: 3px 0;">${icon} ${escapeHtml(acc.accountName)}: ${text}</p>`;
                });
                statusHtml += '</div>';
            }

            document.getElementById('syncStatus').innerHTML = statusHtml;

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

// Apply categorization rules to uncategorized transactions
async function applyCategories() {
    try {
        showLoader();
        document.getElementById('syncStatus').innerHTML = '<p class="text-muted">Прилагане на категоризиране...</p>';

        const result = await api.applyCategorizationRules();

        hideLoader();

        if (result.success) {
            let message;
            if (result.totalUncategorized === 0) {
                message = 'Няма некатегоризирани транзакции';
            } else if (result.categorizedCount === 0) {
                message = `Намерени ${result.totalUncategorized} некатегоризирани, но няма съвпадения с правилата`;
            } else {
                message = `Намерени ${result.totalUncategorized} некатегоризирани → категоризирани ${result.categorizedCount}`;
            }
            showNotification(message, 'success');
            document.getElementById('syncStatus').innerHTML = `<p style="color: var(--success-color);">✓ ${message}</p>`;

            // Refresh current page if it shows transactions
            refreshCurrentPage();
        }
    } catch (error) {
        hideLoader();
        console.error('Error applying categories:', error);
        const errorMsg = 'Грешка при категоризиране: ' + error.message;
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
    const modal = document.getElementById('modal');
    const modalContent = modal.querySelector('.modal-content');
    
    document.getElementById('modalTitle').textContent = 'Синхронизация на данни';
    document.getElementById('modalSave').style.display = 'none';
    document.getElementById('modalCancel').style.display = 'none';
    document.querySelector('.modal-close').style.display = 'none';
    
    document.getElementById('modalBody').innerHTML = `
        <div id="syncProgress" style="min-height: 150px;">
            <div style="text-align: center; padding: 20px;">
                <div class="spinner" style="margin: 0 auto 15px;"></div>
                <p>Стартиране на синхронизация...</p>
            </div>
        </div>
    `;
    
    modal.classList.add('active');
    
    const progressDiv = document.getElementById('syncProgress');
    let syncResults = [];
    
    try {
        // Sync accounts
        progressDiv.innerHTML = `
            <div style="padding: 10px;">
                <p><strong>⏳ Синхронизиране на сметки...</strong></p>
            </div>
        `;
        
        const accountResult = await api.syncAccounts();
        
        if (accountResult.success) {
            syncResults.push(`<p>✅ <strong>Синхронизирани сметки:</strong> ${accountResult.count}</p>`);
        }
        
        // Display intermediate results
        progressDiv.innerHTML = `
            <div style="padding: 10px;">
                ${syncResults.join('')}
                <p style="margin-top: 15px;"><strong>⏳ Синхронизиране на транзакции...</strong></p>
            </div>
        `;
        
        // Small delay
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Sync transactions
        const txResult = await api.syncTransactions();

        if (txResult.success) {
            syncResults.push(`<p>✅ <strong>Синхронизирани транзакции:</strong> ${txResult.transactionsSynced}</p>`);

            // Show breakdown by account if available
            if (txResult.byAccount && txResult.byAccount.length > 0) {
                syncResults.push(`<hr style="margin: 15px 0; border: none; border-top: 1px solid #e0e0e0;">`);
                syncResults.push(`<p style="margin-bottom: 10px; font-weight: 500;">Разбивка по сметки:</p>`);

                txResult.byAccount.forEach(acc => {
                    const statusIcon = acc.error ? '❌' : (acc.count > 0 ? '✅' : '➖');
                    const countText = acc.error
                        ? `<span style="color: var(--danger-color);">Грешка: ${escapeHtml(acc.error)}</span>`
                        : `${acc.count} нови транзакции`;

                    syncResults.push(`
                        <div style="margin-bottom: 8px; padding: 10px; background: #f5f5f5; border-radius: 6px;">
                            <p style="margin: 0 0 3px 0;">
                                ${statusIcon} <strong>${escapeHtml(acc.accountName)}</strong>
                            </p>
                            <p style="margin: 0; font-size: 12px; color: var(--text-secondary);">
                                🏦 ${escapeHtml(acc.institutionName)} · ${countText}
                            </p>
                        </div>
                    `);
                });
            }
        }
        
        // Show final results
        progressDiv.innerHTML = `
            <div style="padding: 10px;">
                ${syncResults.join('')}
                <p style="margin-top: 15px; color: var(--success-color); font-weight: 600;">
                    ✅ Синхронизацията завърши успешно!
                </p>
            </div>
        `;
        
        showNotification('Синхронизацията завърши успешно', 'success');

    } catch (error) {
        console.error('Sync error:', error);
        progressDiv.innerHTML = `
            <div style="padding: 10px;">
                ${syncResults.join('')}
                <p style="margin-top: 15px; color: var(--danger-color);">
                    ❌ Грешка: ${escapeHtml(error.message)}
                </p>
            </div>
        `;
        showNotification('Грешка при синхронизация: ' + error.message, 'error');
    }
    
    // Show close button and refresh page data on close
    const closeAndRefresh = () => {
        modal.classList.remove('active');
        refreshCurrentPage();
    };

    document.getElementById('modalCancel').textContent = 'Затвори';
    document.getElementById('modalCancel').style.display = 'inline-block';
    document.querySelector('.modal-close').style.display = 'block';
    document.getElementById('modalCancel').onclick = closeAndRefresh;
    document.querySelector('.modal-close').onclick = closeAndRefresh;
}

// Refresh data on current page
async function refreshCurrentPage() {
    const activePage = document.querySelector('.page.active');
    if (!activePage) return;

    const pageId = activePage.id;

    if (pageId === 'dashboard-page' && typeof dashboard !== 'undefined') {
        dashboard.refresh();
    } else if (pageId === 'transactions-page' && typeof transactionsPage !== 'undefined') {
        transactionsPage.loadTransactions();
    } else if (pageId === 'categories-page') {
        loadCategories();
    } else if (pageId === 'reports-page') {
        // Reports are generated on demand, no auto-refresh needed
    } else if (pageId === 'settings-page') {
        loadSettings();
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

    // Handle browser back/forward buttons
    window.addEventListener('popstate', () => {
        const hash = window.location.hash.replace('#', '') || 'dashboard';
        navigateToPage(hash, false);
    });

    // Sync button (main nav)
    document.getElementById('syncButton').addEventListener('click', syncData);

    // Transactions page buttons
    document.getElementById('addManualTransactionBtn')?.addEventListener('click', showAddManualTransactionModal);
    document.getElementById('importXmlBtn')?.addEventListener('click', showImportXmlModal);

    // Categories page buttons
    document.getElementById('addCategoryBtn')?.addEventListener('click', showAddCategoryModal);
    document.getElementById('addRuleBtn')?.addEventListener('click', showAddRuleModal);
    document.getElementById('applyRulesBtn')?.addEventListener('click', applyRules);

    // Settings page buttons
    document.getElementById('addBankBtn')?.addEventListener('click', showAddBankModal);
    document.getElementById('cleanupRequisitionsBtn')?.addEventListener('click', cleanupRequisitions);
    document.getElementById('syncAccountsBtn')?.addEventListener('click', syncAccounts);
    document.getElementById('syncTransactionsBtn')?.addEventListener('click', syncTransactions);
    document.getElementById('applyCategoriesBtn')?.addEventListener('click', applyCategories);
    document.getElementById('backupBtn')?.addEventListener('click', createBackup);
    document.getElementById('toggleLogsBtn')?.addEventListener('click', toggleLogsPanel);
    document.getElementById('refreshLogsBtn')?.addEventListener('click', loadLogs);

    // Load initial page from URL hash or default to dashboard
    const initialPage = window.location.hash.replace('#', '') || 'dashboard';
    await navigateToPage(initialPage);
});
