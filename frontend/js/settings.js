// Страница „Настройки“: доставчици, банкови връзки, сметки, категоризиране, backup, логове

// Backup functionality
async function createBackup() {
    try {
        showLoader();
        const result = await api.createBackup();
        hideLoader();

        if (result.success) {
            document.getElementById('backupStatus').innerHTML =
                `<p style="color: var(--success-color);">✓ ${escapeHtml(result.message)}</p>`;
            showNotification('Backup създаден успешно!', 'success');
        }
    } catch (error) {
        hideLoader();
        document.getElementById('backupStatus').innerHTML =
            `<p style="color: var(--danger-color);">✗ Грешка: ${escapeHtml(error.message)}</p>`;
        showNotification('Грешка при създаване на backup: ' + error.message, 'error');
    }
}

// Settings Page
async function loadSettingsPage() {
    try {
        showLoader();

        // Load providers
        const providers = await api.getProviders();
        await renderProvidersList(providers);

        // Load authorizations from all configured providers
        await loadAllAuthorizations(providers);

        // Load accounts
        const accounts = await api.getAccounts();
        renderAccountsList(accounts, providers);

        // Load version
        try {
            const versionData = await api.getVersion();
            document.getElementById('appVersion').textContent = versionData.version;
        } catch (e) {
            document.getElementById('appVersion').textContent = 'неизвестна';
        }

    } catch (error) {
        console.error('Error loading settings:', error);
        showNotification('Грешка при зареждане на настройките', 'error');
    } finally {
        hideLoader();
    }
}

// Render providers cards
async function renderProvidersList(providers) {
    const container = document.getElementById('providersList');
    if (!providers || providers.length === 0) {
        container.innerHTML = '<p class="text-muted">Няма налични доставчици</p>';
        return;
    }

    // Статусите се взимат паралелно
    const statuses = await Promise.allSettled(providers.map(p => api.getProviderStatus(p.id)));

    let html = '';
    for (const [i, provider] of providers.entries()) {
        let statusHtml;
        try {
            if (statuses[i].status === 'rejected') throw statuses[i].reason;
            const status = statuses[i].value;
            if (status.configured) {
                statusHtml = `<span class="badge badge-success">Конфигуриран</span>`;
                if (status.accountCount > 0) {
                    statusHtml += ` <span class="badge badge-info">${status.accountCount} сметки</span>`;
                }
            } else {
                statusHtml = `<span class="badge badge-warning">Не е конфигуриран</span>`;
            }
        } catch (e) {
            statusHtml = `<span class="badge badge-danger">Грешка</span>`;
        }

        html += `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; border: 1px solid var(--border-color); border-radius: 8px; margin-bottom: 8px;">
                <div style="flex: 1;">
                    <h4 style="margin: 0 0 4px 0;">${escapeHtml(provider.name)}</h4>
                    <p style="margin: 2px 0; font-size: 13px; color: var(--text-secondary);">${escapeHtml(provider.description || '')}</p>
                    <div style="margin-top: 4px;">${statusHtml}</div>
                </div>
                <div style="display: flex; gap: 8px; align-items: center;">
                    ${provider.website_url ? `<a href="${escapeHtml(provider.website_url)}" target="_blank" class="btn btn-secondary btn-sm">Сайт</a>` : ''}
                    <button class="btn btn-primary btn-sm" data-action="provider-credentials" data-provider-id="${provider.id}">
                        ${provider.is_configured ? 'Промени' : 'Настрой'}
                    </button>
                    ${provider.is_configured ? `<button class="btn btn-danger btn-sm" data-action="clear-provider-credentials" data-provider-id="${provider.id}">Изчисти</button>` : ''}
                </div>
            </div>
        `;
    }

    container.innerHTML = html;
}

// Show credential configuration modal
async function showProviderCredentialsModal(providerId) {
    try {
        showLoader();
        const fields = await api.getProviderCredentialFields(providerId);
        const provider = await api.getProvider(providerId);
        hideLoader();

        let fieldsHtml = '';
        if (provider.setup_instructions) {
            fieldsHtml += `<div style="margin-bottom: 16px; padding: 12px; background: var(--light-bg, #f5f5f5); border-radius: 6px; font-size: 13px;">${provider.setup_instructions}</div>`; // setup_instructions е HTML от доверен backend (seed) — не се escape-ва нарочно
        }

        for (const field of fields) {
            if (field.type === 'textarea') {
                fieldsHtml += `
                    <div class="filter-group">
                        <label>${escapeHtml(field.label)}${field.required ? ' *' : ''}</label>
                        <textarea id="cred_${field.key}" class="input" rows="6"
                            placeholder="${escapeHtml(field.placeholder || '')}"
                            style="font-family: monospace; font-size: 12px;"></textarea>
                    </div>
                `;
            } else {
                fieldsHtml += `
                    <div class="filter-group">
                        <label>${escapeHtml(field.label)}${field.required ? ' *' : ''}</label>
                        <input type="${field.type || 'text'}" id="cred_${field.key}" class="input"
                            placeholder="${escapeHtml(field.placeholder || '')}">
                    </div>
                `;
            }
        }

        const saveHandler = async () => {
            const credentials = {};
            for (const field of fields) {
                const el = document.getElementById(`cred_${field.key}`);
                credentials[field.key] = el ? el.value.trim() : '';
            }

            // Basic validation
            for (const field of fields) {
                if (field.required && !credentials[field.key]) {
                    showNotification(`Полето "${field.label}" е задължително`, 'error');
                    return;
                }
            }

            try {
                showLoader();
                await api.updateProviderCredentials(providerId, credentials);
                closeModal();
                showNotification('Credentials запазени успешно', 'success');
                await loadSettingsPage();
            } catch (error) {
                showNotification('Грешка: ' + error.message, 'error');
            } finally {
                hideLoader();
            }
        };

        openModal({ title: `Настройка на ${provider.name}`, body: fieldsHtml, onSave: saveHandler });

    } catch (error) {
        hideLoader();
        showNotification('Грешка: ' + error.message, 'error');
    }
}

// Clear provider credentials
async function clearProviderCredentials(providerId) {
    if (!confirm('Сигурни ли сте, че искате да изчистите credentials за този доставчик?')) return;

    try {
        showLoader();
        await api.clearProviderCredentials(providerId);
        showNotification('Credentials изчистени', 'success');
        await loadSettingsPage();
    } catch (error) {
        showNotification('Грешка: ' + error.message, 'error');
    } finally {
        hideLoader();
    }
}

// Load all authorizations from configured providers
async function loadAllAuthorizations(providers) {
    const container = document.getElementById('requisitionsList');
    const configuredProviders = providers.filter(p => p.is_configured);

    if (configuredProviders.length === 0) {
        container.innerHTML = '<p class="text-muted">Няма конфигурирани доставчици. Настройте доставчик по-горе.</p>';
        return;
    }

    // Заявките към доставчиците вървят паралелно; грешка при един не спира останалите
    const results = await Promise.allSettled(
        configuredProviders.map(provider => api.getAuthorizations(provider.id))
    );
    const allAuths = [];
    results.forEach((res, i) => {
        const provider = configuredProviders[i];
        if (res.status === 'fulfilled') {
            allAuths.push(...(res.value || []).map(a => ({ ...a, providerName: provider.name, providerId: provider.id })));
        } else {
            console.error(`Error loading authorizations for ${provider.name}:`, res.reason);
        }
    });

    renderAuthorizationsList(allAuths);
}

function renderAuthorizationsList(authorizations) {
    const container = document.getElementById('requisitionsList');

    if (!authorizations || authorizations.length === 0) {
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
        'CR': { text: 'Създадена', class: 'badge-warning' },
        'ACTIVE': { text: 'Активна', class: 'badge-success' },
        'EXPIRED': { text: 'Изтекла', class: 'badge-danger' }
    };

    container.innerHTML = `
        <table class="table" style="font-size: 13px;">
            <thead>
                <tr>
                    <th>Доставчик</th>
                    <th>Банка</th>
                    <th>Статус</th>
                    <th>Сметки</th>
                    <th>Създадена</th>
                    <th>Действия</th>
                </tr>
            </thead>
            <tbody>
                ${authorizations.map(auth => {
                    const status = auth.expired
                        ? { text: 'Изтекъл достъп', class: 'badge-danger' }
                        : statusLabels[auth.status] || { text: escapeHtml(auth.status), class: 'badge-secondary' };
                    const isExpired = auth.expired || auth.status === 'EX' || auth.status === 'EXPIRED';
                    const hasActiveReplacement = authorizations.some(a =>
                        a !== auth && a.providerId === auth.providerId && a.institution_id === auth.institution_id &&
                        (a.status === 'LN' || a.status === 'ACTIVE') && !a.expired);
                    const isNewestForBank = !authorizations.some(a =>
                        a !== auth && a.providerId === auth.providerId && a.institution_id === auth.institution_id &&
                        new Date(a.created) > new Date(auth.created));
                    const renewButton = isExpired && !hasActiveReplacement && isNewestForBank && auth.institution_id
                        ? `<button class="btn btn-primary btn-xs" style="margin-right: 4px;"
                                   data-action="renew-auth" data-provider-id="${auth.providerId}" data-institution-id="${escapeHtml(auth.institution_id)}">Поднови</button>`
                        : '';
                    const createdDate = auth.created ? new Date(auth.created).toLocaleString('bg-BG') : '-';
                    const expiresInfo = auth.expiresAt
                        ? `<div class="text-muted" style="font-size: 11px;">${auth.expired ? 'изтекла' : 'валидна до'} ${new Date(auth.expiresAt).toLocaleDateString('bg-BG')}</div>`
                        : '';

                    return `
                        <tr>
                            <td><span class="badge badge-info" style="font-size: 11px;">${escapeHtml(auth.providerName || '')}</span></td>
                            <td>${escapeHtml(auth.institution_id || '-')}</td>
                            <td><span class="badge ${status.class}">${status.text}</span>${expiresInfo}</td>
                            <td>${auth.accounts?.length || 0}</td>
                            <td>${createdDate}</td>
                            <td style="white-space: nowrap;">
                                ${renewButton}
                                <button class="btn btn-danger btn-xs"
                                        data-action="delete-auth" data-provider-id="${auth.providerId}" data-auth-id="${escapeHtml(auth.id)}">Изтрий</button>
                            </td>
                        </tr>
                    `;
                }).join('')}
            </tbody>
        </table>
    `;
}

// Подновяване на изтекла връзка — нова авторизация към същата банка.
// Сметките и историята им се запазват: при синхронизация бекендът ги разпознава.
async function renewProviderAuth(providerId, institutionId) {
    const confirmed = confirm(
        'Ще бъдете пренасочени към сайта на банката, за да потвърдите достъпа отново.\n\n' +
        'Съществуващите сметки, транзакции и категории се запазват — историята продължава.\n' +
        'След одобрение синхронизацията стартира автоматично.\n\n' +
        'Желаете ли да продължите?'
    );
    if (!confirmed) return;

    try {
        showLoader();
        const result = await api.createAuthorization(providerId, institutionId);
        if (result.link) window.location.href = result.link;
    } catch (error) {
        showNotification('Грешка при подновяване: ' + error.message, 'error');
    } finally {
        hideLoader();
    }
}

async function deleteProviderAuth(providerId, authId) {
    if (!confirm('Сигурни ли сте, че искате да изтриете тази банкова връзка?')) return;
    try {
        showLoader();
        await api.deleteAuthorization(providerId, authId);
        showNotification('Банковата връзка е изтрита', 'success');
        await loadSettingsPage();
    } catch (error) {
        showNotification('Грешка: ' + error.message, 'error');
    } finally {
        hideLoader();
    }
}

// Add Bank functionality - multi-step: provider → country → bank
let addBankState = {};

async function showAddBankModal() {
    try {
        showLoader();
        const providers = await api.getProviders();
        const configuredProviders = providers.filter(p => p.is_configured);
        hideLoader();

        if (configuredProviders.length === 0) {
            showNotification('Няма конфигурирани доставчици. Настройте доставчик от секция "Доставчици".', 'error');
            return;
        }

        // If only one provider, skip selection step
        if (configuredProviders.length === 1) {
            addBankState.providerId = configuredProviders[0].id;
            addBankState.providerName = configuredProviders[0].name;
            await showAddBankCountryStep();
            return;
        }

        // Step 1: Provider selection
        const providersHtml = configuredProviders.map(p => `
            <div class="bank-option" data-action="select-provider" data-provider-id="${p.id}" data-provider-name="${escapeHtml(p.name)}">
                <div class="bank-option-info">
                    <strong>${escapeHtml(p.name)}</strong>
                    <div class="bank-option-meta">${escapeHtml(p.description || '')}</div>
                </div>
            </div>
        `).join('');

        openModal({
            title: 'Добави банка — Избор на доставчик',
            body: `
            <div style="max-height: 400px; overflow-y: auto;">
                <p style="margin-bottom: 12px; color: var(--text-secondary);">
                    Изберете доставчик:
                </p>
                ${providersHtml}
            </div>
        `,
            showSave: false,
            cancelText: 'Затвори'
        });

    } catch (error) {
        hideLoader();
        console.error('Error loading providers:', error);
        showNotification('Грешка: ' + error.message, 'error');
    }
}

async function selectProvider(providerId, providerName) {
    addBankState.providerId = providerId;
    addBankState.providerName = providerName;
    await showAddBankCountryStep();
}

async function showAddBankCountryStep() {
    const body = `
        <div class="filter-group">
            <label>Държава</label>
            <select id="bankCountrySelect" class="input">
                <option value="BG">България</option>
                <option value="DE">Германия</option>
                <option value="AT">Австрия</option>
                <option value="NL">Нидерландия</option>
                <option value="FR">Франция</option>
                <option value="IT">Италия</option>
                <option value="ES">Испания</option>
                <option value="GB">Великобритания</option>
                <option value="RO">Румъния</option>
                <option value="GR">Гърция</option>
                <option value="PT">Португалия</option>
            </select>
        </div>
        <div id="banksList" style="max-height: 350px; overflow-y: auto;">
            <p class="text-muted">Зареждане на банки...</p>
        </div>
    `;

    openModal({
        title: `Добави банка — ${addBankState.providerName}`,
        body,
        showSave: false,
        cancelText: 'Затвори'
    });

    document.getElementById('bankCountrySelect').addEventListener('change', loadBanksList);
    await loadBanksList();
}

async function loadBanksList() {
    const country = document.getElementById('bankCountrySelect')?.value || 'BG';
    const container = document.getElementById('banksList');
    container.innerHTML = '<p class="text-muted">Зареждане...</p>';

    try {
        const institutions = await api.getInstitutions(addBankState.providerId, country);

        if (!institutions || institutions.length === 0) {
            container.innerHTML = '<p class="text-muted">Няма налични банки за тази държава</p>';
            return;
        }

        // Sort alphabetically
        institutions.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        container.innerHTML = institutions.map(inst => `
            <div class="bank-option" data-action="select-bank" data-institution-id="${escapeHtml(inst.id)}">
                ${inst.logo ? `<img src="${escapeHtml(inst.logo)}" alt="${escapeHtml(inst.name)}" class="bank-option-logo">` : ''}
                <div class="bank-option-info">
                    <strong>${escapeHtml(inst.name)}</strong>
                    ${inst.transaction_total_days ? `<div class="bank-option-meta">
                        История: ${inst.transaction_total_days} дни${inst.max_access_valid_for_days ? ` | Достъп: ${inst.max_access_valid_for_days} дни` : ''}
                    </div>` : ''}
                </div>
            </div>
        `).join('');
    } catch (error) {
        container.innerHTML = `<p style="color: var(--danger-color);">Грешка при зареждане: ${escapeHtml(error.message)}</p>`;
    }
}

// Select and connect to bank
async function selectBank(institutionId) {
    // Потвърждение ПРЕДИ създаване на авторизацията, за да не остават неизползвани връзки
    const confirmed = confirm(
        'Ще бъдете пренасочени към сайта на банката, за да одобрите достъпа.\n\n' +
        'След одобрение ще бъдете върнати в приложението и синхронизацията ще стартира автоматично.\n\n' +
        'Желаете ли да продължите?'
    );
    if (!confirmed) return;

    try {
        showLoader();

        const result = await api.createAuthorization(addBankState.providerId, institutionId);

        hideLoader();

        closeModal();

        if (result.link) window.location.href = result.link;

    } catch (error) {
        hideLoader();
        console.error('Error creating authorization:', error);
        showNotification('Грешка при свързване с банка: ' + error.message, 'error');
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
            document.getElementById('syncStatus').innerHTML = `<p style="color: var(--success-color);">✓ ${escapeHtml(message)}</p>`;

            // Refresh current page if it shows transactions
            refreshCurrentPage();
        }
    } catch (error) {
        hideLoader();
        console.error('Error applying categories:', error);
        const errorMsg = 'Грешка при категоризиране: ' + error.message;
        showNotification(errorMsg, 'error');
        document.getElementById('syncStatus').innerHTML = `<p style="color: var(--danger-color);">✗ ${escapeHtml(errorMsg)}</p>`;
    }
}

// Дубликати импорт ↔ банка: първо преглед (dry run), после обединяване след потвърждение
async function reconcileImports() {
    let preview;
    try {
        showLoader();
        preview = await api.reconcileImports(true);
    } catch (error) {
        showNotification('Грешка при проверката: ' + error.message, 'error');
        return;
    } finally {
        hideLoader();
    }

    const holdsRemoved = preview.cardHoldsRemoved || 0;
    const feesFixed = preview.feesFixed || 0;
    const total = preview.pocketTransfersMoved + preview.importedMoved + preview.duplicatesMerged + holdsRemoved + feesFixed;
    if (total === 0) {
        showNotification('Няма дубликати и грешно разпределени транзакции', 'success');
        return;
    }

    const rows = (preview.samples || []).map(s => `
        <tr>
            <td>${escapeHtml(formatDisplayDate(s.date))}</td>
            <td>${escapeHtml(s.account)}</td>
            <td>${escapeHtml(s.description)}</td>
            <td class="num">${formatCurrencyExact(s.amount)}</td>
        </tr>`).join('');

    const body = `
        <ul class="summary-list">
            <li>🔁 Дубликати за обединяване: <strong>${preview.duplicatesMerged}</strong>
                — остава записът от банката, категорията и бележките от файла се пренасят</li>
            <li>🔀 Прехвърляния към джоб в Revolut за преместване: <strong>${preview.pocketTransfersMoved}</strong></li>
            <li>🔀 Импортирани от Revolut „Спестявания“ в грешна сметка: <strong>${preview.importedMoved}</strong></li>
            <li>💳 Блокирани суми по карти на ДСК (записани с плюс) за премахване: <strong>${holdsRemoved}</strong>
                — осчетоводеното плащане остава${preview.cardHoldsUnmatched ? `; още ${preview.cardHoldsUnmatched} без намерено плащане остават непроменени` : ''}</li>
            <li>💱 Стари импорти от Revolut без приспадната такса — поправка на сумата: <strong>${feesFixed}</strong></li>
        </ul>
        ${rows ? `
            <p class="text-muted">Примери (до 20):</p>
            <table class="detail-table">
                <thead><tr><th>Дата</th><th>Сметка</th><th>Описание</th><th class="num">Сума</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>` : ''}
        <p class="text-muted">Преди промените автоматично се създава резервно копие на базата.</p>
    `;

    openModal({
        title: 'Дубликати от импорт',
        body,
        saveText: 'Обедини',
        maxWidth: '760px',
        onSave: async () => {
            try {
                await api.createBackup();
                const result = await api.reconcileImports(false);
                closeModal();
                showNotification(
                    `Обединени ${result.duplicatesMerged} дубликата, преместени ${result.pocketTransfersMoved + result.importedMoved} транзакции, премахнати ${result.cardHoldsRemoved || 0} блокирани суми, поправени ${result.feesFixed || 0} суми`,
                    'success'
                );
                refreshCurrentPage();
            } catch (error) {
                showNotification('Грешка при обединяването: ' + error.message, 'error');
            }
        }
    });
}

function renderAccountsList(accounts, providers) {
    const container = document.getElementById('accountsList');

    if (accounts.length === 0) {
        container.innerHTML = '<p class="text-muted">Няма свързани сметки</p>';
        return;
    }

    // Build provider name map
    const providerMap = {};
    if (providers) {
        providers.forEach(p => { providerMap[p.id] = p.name; });
    }

    container.innerHTML = `
        <div style="overflow-x: auto;">
            <table class="table table-bordered" style="width: 100%;">
                <thead>
                    <tr>
                        <th>Име на сметката</th>
                        <th>Провайдер</th>
                        <th>Идентификатор</th>
                        <th>Id връзка</th>
                        <th>Последна актуализация</th>
                        <th style="text-align: right;">Баланс</th>
                    </tr>
                </thead>
                <tbody>
                    ${accounts.map(account => {
                        const displayName = account.custom_name || account.name;
                        const providerName = providerMap[account.provider_id] || '-';
                        const lastSyncedText = account.last_synced
                            ? new Date(account.last_synced).toLocaleString('bg-BG')
                            : 'Никога';
                        const identifier = account.iban || account.id || '-';
                        const authId = account.authorization_id || '-';

                        return `
                            <tr>
                                <td>
                                    ${escapeHtml(displayName)}
                                    <button class="btn btn-secondary row-action" style="padding: 2px 6px; font-size: 11px; margin-left: 6px;"
                                            data-action="edit-account" data-account-id="${escapeHtml(account.id)}" data-account-name="${escapeHtml(displayName)}">✏️</button>
                                </td>
                                <td><span class="badge badge-info" style="font-size: 11px;">${escapeHtml(providerName)}</span></td>
                                <td style="font-size: 12px; color: var(--text-secondary);">${escapeHtml(identifier)}</td>
                                <td style="font-size: 12px; color: var(--text-muted);">${escapeHtml(authId)}</td>
                                <td style="font-size: 12px;">${lastSyncedText}</td>
                                <td style="text-align: right; font-weight: 600;">${formatCurrency(account.balance || 0)}</td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>
    `;
}

async function editAccountName(accountId, currentName) {
    const newName = prompt('Въведете ново име за сметката:', currentName);
    if (newName !== null && newName.trim() !== '') {
        try {
            showLoader();
            await api.updateAccountName(accountId, newName.trim());
            const [accounts, providers] = await Promise.all([api.getAccounts(), api.getProviders()]);
            renderAccountsList(accounts, providers);
            showNotification('Името на сметката е обновено', 'success');
        } catch (error) {
            showNotification('Грешка: ' + error.message, 'error');
        } finally {
            hideLoader();
        }
    }
}

// Logs functionality
async function loadLogs() {
    try {
        const data = await api.getLogs(200);
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
