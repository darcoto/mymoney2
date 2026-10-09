// Общ изглед „Детайли на транзакция“: таблица с детайли + табове Детайли / Бележки / Raw данни.
// Ползва се от страница Транзакции (редактируем, transactions.js → showRawData)
// и от списъците в справките (само за четене, reports.js → showTransactionOverlay),
// за да не се разминават двата изгледа.

// Raw данните като форматиран текст
function getTransactionRawText(tx) {
    if (!tx.raw_data) return 'Няма налични raw данни.';
    try {
        return JSON.stringify(JSON.parse(tx.raw_data), null, 2);
    } catch (e) {
        return tx.raw_data;
    }
}

// Ред от таблицата с детайли: заглавие подравнено вдясно, на един ред
function transactionDetailRow(label, value, valueStyle = '') {
    return `
            <tr>
                <td class="detail-label"><strong>${label}</strong></td>
                <td${valueStyle ? ` style="${valueStyle}"` : ''}>${value}</td>
            </tr>`;
}

/**
 * HTML на изгледа с детайли.
 * @param {object} tx — транзакцията
 * @param {object} options
 *   account        — сметката на транзакцията (или null)
 *   countries      — списък държави [{code, name, flag}] за показване на името
 *   countryHtml    — HTML за реда „Държава“ (напр. select); по подразбиране — текст
 *   sidePanelHtml  — десен панел до таблицата (избор на категория) — само в редактируемия изглед
 *   notesEditable  — textarea (id="modalNotesText") вместо текст само за четене
 *   rawActionsHtml — допълнителни бутони над raw данните (до „Копирай“)
 *   activeTab      — 'details' | 'notes' | 'raw'
 */
function renderTransactionDetails(tx, {
    account = null,
    countries = [],
    countryHtml = null,
    sidePanelHtml = '',
    notesEditable = false,
    rawActionsHtml = '',
    activeTab = 'details'
} = {}) {
    const accountName = account ? (account.custom_name || account.name) : 'Неизвестна';
    const bankName = account?.institution_name || 'Неизвестна';

    // Точна сума (без закръгляне)
    let amountDisplay = formatCurrencyExact(tx.amount);
    if (tx.original_amount && tx.original_currency) {
        amountDisplay += ` <span style="color: var(--text-muted); font-size: 12px;">(оригинал: ${escapeHtml(tx.original_amount)} ${escapeHtml(tx.original_currency)})</span>`;
    }

    // Търсене в Google (без префикс "BGR ")
    let googleSearchQuery = tx.counterparty_name || '';
    if (googleSearchQuery.startsWith('BGR ')) {
        googleSearchQuery = googleSearchQuery.substring(4);
    }

    let countryValue = countryHtml;
    if (countryValue === null) {
        const country = tx.country ? countries.find(c => c.code === tx.country) : null;
        countryValue = country
            ? escapeHtml(`${country.flag || ''} ${country.name || country.code}`.trim())
            : escapeHtml(tx.country || '-');
    }

    const tabButton = (tab, label) => `
            <button type="button" class="tab-btn ${activeTab === tab ? 'active' : ''}" data-tab="${tab}">${label}</button>`;
    const tabPanelStyle = tab => activeTab === tab ? '' : 'display: none;';

    const table = `
                    <table class="detail-table">
                        ${transactionDetailRow('ID', escapeHtml(tx.id), 'font-family: monospace; font-size: 10px;')}
                        ${transactionDetailRow('Контрагент', `<span style="color: var(--primary-color); font-weight: 600; font-size: 14px;">${escapeHtml(tx.counterparty_name || '-')}</span> ${tx.counterparty_name ? `<a href="https://www.google.com/search?q=${encodeURIComponent(googleSearchQuery)}" target="_blank" rel="noopener" style="text-decoration: none; margin-left: 6px;" title="Търси в Google">🔍</a>` : ''}`)}
                        ${transactionDetailRow('Сума', amountDisplay, `font-weight: 600; ${tx.amount >= 0 ? 'color: var(--primary-color);' : 'color: var(--danger-color);'}`)}
                        ${transactionDetailRow('Описание', escapeHtml(tx.description || '-'))}
                        ${transactionDetailRow('Категория', tx.category_name
                            ? `<span class="category-badge" style="background-color: ${escapeHtml(tx.category_color)}">${escapeHtml(tx.category_name)}</span>`
                            : '<span style="color: var(--danger-color); font-weight: 600;">Некатегоризирана</span>')}
                        ${transactionDetailRow('Банка', escapeHtml(bankName))}
                        ${transactionDetailRow('Сметка', `${escapeHtml(accountName)} <span style="color: var(--text-muted); font-size: 11px;">(${escapeHtml(account?.iban || '')})</span>`)}
                        ${transactionDetailRow('Дата', escapeHtml(tx.transaction_date || '-'))}
                        ${transactionDetailRow('Дата(осч)', escapeHtml(tx.booking_date || '-'))}
                        ${transactionDetailRow('Държава', countryValue)}
                        ${transactionDetailRow('Създадена', escapeHtml(tx.created_at || '-'))}
                    </table>`;

    const notesPanel = notesEditable
        ? `<textarea id="modalNotesText" class="input" rows="10" style="resize: vertical; font-size: 13px;" placeholder="Добави бележка...">${escapeHtml(tx.notes || '')}</textarea>
                <small class="text-muted">Бележката се записва автоматично при излизане от полето.</small>`
        : (tx.notes
            ? `<div style="white-space: pre-wrap; font-size: 13px; padding: 10px 12px; background: #f9f9f9; border: 1px solid var(--border-color); border-radius: 6px;">${escapeHtml(tx.notes)}</div>`
            : '<p class="text-muted" style="margin: 0;">Няма бележки.</p>');

    return `
            <div class="tabs">
                ${tabButton('details', 'Детайли')}
                ${tabButton('notes', `Бележки${tx.notes ? ' <span class="tab-dot">●</span>' : ''}`)}
                ${tabButton('raw', 'Raw данни')}
            </div>

            <div class="tab-panel" data-tab-panel="details" style="${tabPanelStyle('details')}">
            ${sidePanelHtml ? `
            <div style="display: flex; gap: 24px;">
                <div style="flex: 1; min-width: 0;">${table}
                </div>
                <div style="flex: 0 1 520px; min-width: 260px;">
                    ${sidePanelHtml}
                </div>
            </div>` : table}
            </div>

            <div class="tab-panel" data-tab-panel="notes" style="${tabPanelStyle('notes')}">
                ${notesPanel}
            </div>

            <div class="tab-panel" data-tab-panel="raw" style="${tabPanelStyle('raw')}">
                <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
                    <button type="button" class="btn btn-secondary btn-sm" data-copy-raw style="font-size: 11px; padding: 3px 10px;">Копирай</button>
                    ${rawActionsHtml}
                </div>
                <pre style="background: #1e1e1e; color: #d4d4d4; padding: 12px; border-radius: 6px; max-height: 60vh; overflow: auto; font-size: 11px; white-space: pre-wrap; line-height: 1.3; margin: 0;">${escapeHtml(getTransactionRawText(tx))}</pre>
            </div>
        `;
}

// Закача табовете и бутона „Копирай“ в контейнера; onTabChange(tab) — за запомняне на избрания таб
function bindTransactionDetails(container, tx, { onTabChange } = {}) {
    container.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            if (onTabChange) onTabChange(tab);
            container.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
            container.querySelectorAll('.tab-panel').forEach(panel => {
                panel.style.display = panel.dataset.tabPanel === tab ? '' : 'none';
            });
        });
    });

    container.querySelector('[data-copy-raw]')?.addEventListener('click', () => {
        navigator.clipboard.writeText(getTransactionRawText(tx)).then(() => {
            showNotification('Raw данните са копирани', 'success');
        }).catch(() => {
            showNotification('Грешка при копиране', 'error');
        });
    });
}
