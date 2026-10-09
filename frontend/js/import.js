// Диалози „Добави кеш транзакция“ и „Импорт от файл“ (страница Транзакции)

async function showAddManualTransactionModal() {
    try {
        showLoader();
        const categories = await api.getCategories();
        hideLoader();

        const today = formatDate(new Date());

        const categoryOptions = categoryOptionsHtml(categories);

        const body = `
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

                closeModal();
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

        openModal({ title: 'Добави кеш транзакция', body, onSave: saveHandler });

    } catch (error) {
        hideLoader();
        showNotification('Грешка при зареждане: ' + error.message, 'error');
    }
}

async function showImportFileModal() {
    try {
        showLoader();

        // Load all accounts to populate the select
        const accounts = await api.getAccounts();
        hideLoader();

        // Build account options with institution info
        const accountOptions = accounts
            .map(acc => {
                const displayName = acc.custom_name || acc.name || acc.iban;
                const institution = acc.institution_name || '';
                const label = institution ? `${displayName} (${institution})` : displayName;
                return `<option value="${acc.id}" data-institution="${escapeHtml(institution)}">${escapeHtml(label)}</option>`;
            })
            .join('');

        const body = `
            <div class="filter-group">
                <label>Сметка *</label>
                <select id="importFileAccount" class="input" required>
                    <option value="">Изберете сметка</option>
                    ${accountOptions}
                </select>
                <small id="importFileFormat" class="text-muted"></small>
            </div>
            <div class="filter-group">
                <label>Файл с транзакции *</label>
                <input type="file" id="importFile" class="input" accept=".xml,.csv" required>
                <small class="text-muted">Поддържани формати: XML (DSK Bank), CSV (Revolut)</small>
            </div>
            <div class="filter-group" id="importCurrencyGroup" style="display: none;">
                <label>Валута на файла</label>
                <select id="importFileCurrency" class="input">
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

        // saveHandler е дефиниран по-долу; извиква се едва при натискане на „Импорт“
        openModal({
            title: 'Импорт на транзакции от файл',
            body,
            saveText: 'Импорт',
            onSave: () => saveHandler()
        });

        // Update format hint when account is selected
        const accountSelect = document.getElementById('importFileAccount');
        const formatHint = document.getElementById('importFileFormat');
        const currencyGroup = document.getElementById('importCurrencyGroup');

        accountSelect.addEventListener('change', () => {
            const selectedOption = accountSelect.options[accountSelect.selectedIndex];
            const institution = (selectedOption.dataset.institution || '').toUpperCase();

            if (institution.includes('DSK')) {
                formatHint.textContent = '📄 Очаква се XML файл от Банка ДСК';
                currencyGroup.style.display = 'block';
            } else if (institution.includes('REVOLUT')) {
                formatHint.textContent = '📄 Очаква се CSV файл от Revolut';
                currencyGroup.style.display = 'none';
            } else if (accountSelect.value) {
                formatHint.textContent = '⚠️ Импортът не се поддържа за тази банка';
                currencyGroup.style.display = 'none';
            } else {
                formatHint.textContent = '';
                currencyGroup.style.display = 'none';
            }
        });

        const saveHandler = async () => {
            const fileInput = document.getElementById('importFile');
            const accountId = document.getElementById('importFileAccount').value;
            const currency = document.getElementById('importFileCurrency').value;

            if (!accountId) {
                showNotification('Моля, изберете сметка', 'error');
                return;
            }
            if (!fileInput.files || fileInput.files.length === 0) {
                showNotification('Моля, изберете файл', 'error');
                return;
            }

            const file = fileInput.files[0];
            const progressDiv = document.getElementById('importProgress');
            const progressFill = progressDiv.querySelector('.progress-fill');
            const statusText = document.getElementById('importStatus');
            const resultDiv = document.getElementById('importResult');

            // Бутонът „Импорт“ е изключен от openModal, докато тече операцията
            progressDiv.style.display = 'block';
            resultDiv.style.display = 'none';
            progressFill.style.width = '30%';
            statusText.textContent = 'Четене на файла...';

            try {
                // Read file content
                const fileContent = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = (e) => resolve(e.target.result);
                    reader.onerror = () => reject(new Error('Грешка при четене на файла'));
                    reader.readAsText(file, 'UTF-8');
                });

                progressFill.style.width = '60%';
                statusText.textContent = 'Изпращане към сървъра...';

                // Send to server (parser is determined server-side based on account)
                const result = await api.importFileTransactions(fileContent, accountId, currency);

                progressFill.style.width = '100%';
                statusText.textContent = 'Готово!';

                // Show results
                let resultHtml = `<div class="alert ${result.imported > 0 ? 'alert-success' : 'alert-info'}">`;
                resultHtml += `<strong>Резултат:</strong><br>`;
                if (result.parser) {
                    resultHtml += `📋 Парсер: ${escapeHtml(result.parser)}<br>`;
                }
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
                updateModal({ showSave: false, cancelText: 'Затвори' });

            } catch (error) {
                progressDiv.style.display = 'none';
                resultDiv.innerHTML = `<div class="alert alert-error">❌ Грешка: ${escapeHtml(error.message)}</div>`;
                resultDiv.style.display = 'block';
                showNotification('Грешка при импорт: ' + error.message, 'error');
                // Бутонът „Импорт“ се включва отново автоматично след onSave
            }
        };

    } catch (error) {
        hideLoader();
        showNotification('Грешка при зареждане: ' + error.message, 'error');
    }
}
