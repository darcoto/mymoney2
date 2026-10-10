// Страница „Категории“: категории и правила за категоризиране

// Categories Page
async function loadCategoriesPage() {
    try {
        showLoader();

        const [categories, rules] = await Promise.all([
            api.getCategories(),
            api.getCategorizationRules()
        ]);

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

    // Елемент от списъка; бутоните се обработват от делегирания [data-action] слушател (app.js).
    // parent — за подкатегория: отстъп и лента в цвета на родителя
    const appendItem = (category, label, parent = null) => {
        const div = document.createElement('div');
        div.className = parent ? 'category-item category-item-child' : 'category-item';
        if (parent) div.style.borderLeftColor = parent.color;
        div.innerHTML = `
            <div class="category-info">
                <div class="category-color" style="background-color: ${category.color}"></div>
                <span class="category-name">${label}</span>
            </div>
            <div class="category-actions">
                <button class="btn btn-secondary" data-action="edit-category" data-category-id="${category.id}">Редактирай</button>
                <button class="btn btn-danger" data-action="delete-category" data-category-id="${category.id}">Изтрий</button>
            </div>
        `;
        container.appendChild(div);
    };

    parentCategories.forEach(category => {
        appendItem(category, escapeHtml(category.name));
        childCategories
            .filter(c => c.parent_id === category.id)
            .forEach(child => appendItem(child, `↳ ${escapeHtml(child.name)}`, category));
    });

    // Render orphan children (if parent was deleted)
    childCategories
        .filter(c => !parentCategories.find(p => p.id === c.parent_id))
        .forEach(category => appendItem(category, escapeHtml(category.name)));
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
                <button class="btn btn-secondary btn-sm" data-action="edit-rule" data-rule-id="${rule.id}">Редактирай</button>
                <button class="btn btn-danger btn-sm" data-action="delete-rule" data-rule-id="${rule.id}">Изтрий</button>
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

        // Filter only parent-level categories (no parent_id)
        const parentOptions = categoryOptionsHtml(allCategories.filter(c => !c.parent_id));

        const body = `
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
            <div class="filter-group">
                <label>Емоджи</label>
                <input type="text" id="categoryEmoji" class="input" maxlength="8" placeholder="напр. ☕ 🍔 🚗 ✈️" value="" style="width: 120px;">
                <small class="text-muted">Показва се в бутоните в Telegram (Win + . отваря емоджитата)</small>
            </div>
        `;

        const saveHandler = async () => {
            const name = document.getElementById('categoryName').value.trim();
            const type = document.getElementById('categoryType').value;
            const color = document.getElementById('categoryColor').value;
            const parentId = document.getElementById('categoryParent').value || null;
            const icon = document.getElementById('categoryEmoji').value.trim() || null;

            if (!name) {
                showNotification('Моля, въведете име на категорията', 'error');
                return;
            }

            try {
                showLoader();
                await api.createCategory({ name, type, color, icon, parentId: parentId ? parseInt(parentId) : null });
                closeModal();
                showNotification('Категорията е създадена успешно', 'success');
                await loadCategoriesPage();
            } catch (error) {
                showNotification('Грешка при създаване на категория: ' + error.message, 'error');
            } finally {
                hideLoader();
            }
        };

        openModal({ title: 'Нова категория', body, onSave: saveHandler });

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

        // Filter only parent-level categories (no parent_id), excluding the current category
        const parentOptions = categoryOptionsHtml(
            allCategories.filter(c => !c.parent_id && c.id !== categoryId),
            category.parent_id
        );

        const body = `
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
                <input type="color" id="categoryColor" class="input" value="${escapeHtml(category.color || '#4CAF50')}" style="height: 40px; padding: 4px;">
            </div>
            <div class="filter-group">
                <label>Емоджи</label>
                <input type="text" id="categoryEmoji" class="input" maxlength="8" placeholder="напр. ☕ 🍔 🚗 ✈️" value="${escapeHtml(category.icon || '')}" style="width: 120px;">
                <small class="text-muted">Показва се в бутоните в Telegram (Win + . отваря емоджитата)</small>
            </div>
        `;

        const saveHandler = async () => {
            const name = document.getElementById('categoryName').value.trim();
            const type = document.getElementById('categoryType').value;
            const color = document.getElementById('categoryColor').value;
            const parentId = document.getElementById('categoryParent').value || null;
            const icon = document.getElementById('categoryEmoji').value.trim() || null;

            if (!name) {
                showNotification('Моля, въведете име на категорията', 'error');
                return;
            }

            try {
                showLoader();
                await api.updateCategory(categoryId, { name, type, color, icon, parentId: parentId ? parseInt(parentId) : null });
                closeModal();
                showNotification('Категорията е обновена успешно', 'success');
                await loadCategoriesPage();
            } catch (error) {
                showNotification('Грешка при обновяване на категория: ' + error.message, 'error');
            } finally {
                hideLoader();
            }
        };

        openModal({ title: 'Редактиране на категория', body, onSave: saveHandler });

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

async function showAddRuleModal() {
    try {
        showLoader();
        allCategories = await api.getCategories();
        hideLoader();

        const categoryOptions = categoryOptionsHtml(allCategories);

        const body = `
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
                closeModal();
                showNotification('Правилото е създадено успешно', 'success');
                await loadCategoriesPage();
            } catch (error) {
                showNotification('Грешка при създаване на правило: ' + error.message, 'error');
            } finally {
                hideLoader();
            }
        };

        openModal({ title: 'Ново правило за категоризиране', body, onSave: saveHandler });

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

        const categoryOptions = categoryOptionsHtml(allCategories, rule.category_id);

        const body = `
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
                closeModal();
                showNotification('Правилото е обновено успешно', 'success');
                await loadCategoriesPage();
            } catch (error) {
                showNotification('Грешка при обновяване на правило: ' + error.message, 'error');
            } finally {
                hideLoader();
            }
        };

        openModal({ title: 'Редактиране на правило', body, onSave: saveHandler });

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
