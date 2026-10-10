// Общи помощни функции: форматиране, сортиране на таблици, loader, известия

function formatCurrency(amount) {
    const absAmount = Math.round(Math.abs(amount));
    const formatted = absAmount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    const sign = amount < 0 ? '-' : '';
    return `${sign}${formatted} <span class="currency-symbol">€</span>`;
}

// Кредитна карта: банката (ДСК) връща като наличност наличния кредитен лимит, не собствени пари
function isCreditCardAccount(account) {
    return /КРЕДИТНА КАРТА|CREDIT CARD/i.test(`${account.name || ''} ${account.custom_name || ''}`);
}

function formatCurrencyExact(amount) {
    const absAmount = Math.abs(amount).toFixed(2);
    const formatted = absAmount.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    const sign = amount < 0 ? '-' : '';
    return `${sign}${formatted} <span class="currency-symbol">€</span>`;
}

function formatDate(date) {
    // Низ във формат YYYY-MM-DD... се връща директно (без преобразуване през часови зони)
    if (typeof date === 'string') {
        if (/^\d{4}-\d{2}-\d{2}/.test(date)) return date.slice(0, 10);
        date = new Date(date);
    }
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
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
    if (text === null || text === undefined) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Table sorting functionality
function makeTableSortable(tableId) {
    const table = document.getElementById(tableId);
    if (!table) return;

    // Идемпотентно: слушателите се вързват само веднъж
    if (table.dataset.sortable === '1') return;
    table.dataset.sortable = '1';

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
                
                const aRaw = aCell.dataset.sortValue ?? aCell.textContent.trim();
                const bRaw = bCell.dataset.sortValue ?? bCell.textContent.trim();

                // Дати YYYY-MM-DD се сортират като низове
                const isoRe = /^\d{4}-\d{2}-\d{2}/;
                if (isoRe.test(aRaw) && isoRe.test(bRaw)) {
                    return newDir === 'asc' ? aRaw.localeCompare(bRaw) : bRaw.localeCompare(aRaw);
                }

                let aVal = aRaw.replace(/[€\s]/g, '').replace(',', '.');
                let bVal = bRaw.replace(/[€\s]/g, '').replace(',', '.');

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

// Loader с брояч: вложените show/hide не го скриват преждевременно.
// Слоят блокира кликовете веднага, но става видим (фон + spinner) едва след LOADER_DELAY_MS,
// за да не "мига" при бързи операции.
const LOADER_DELAY_MS = 250;
let loaderCount = 0;
let loaderTimer = null;

function showLoader() {
    const loader = document.getElementById('loader');
    loaderCount++;
    if (loaderCount > 1 || !loader) return;
    loader.style.display = 'flex';
    loader.classList.remove('visible');
    loaderTimer = setTimeout(() => {
        loaderTimer = null;
        if (loaderCount > 0) loader.classList.add('visible');
    }, LOADER_DELAY_MS);
}

function hideLoader() {
    if (loaderCount === 0) return;
    loaderCount--;
    if (loaderCount > 0) return;
    clearTimeout(loaderTimer);
    loaderTimer = null;
    const loader = document.getElementById('loader');
    if (!loader) return;
    loader.classList.remove('visible');
    loader.style.display = 'none';
}

// Известия: подредени в общ контейнер горе вдясно; клик ги затваря; грешките стоят по-дълго
const NOTIFICATION_DURATION_MS = { error: 7000, default: 4000 };

function getNotificationContainer() {
    let container = document.getElementById('notificationContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'notificationContainer';
        container.className = 'notification-container';
        container.setAttribute('aria-live', 'polite');
        document.body.appendChild(container);
    }
    return container;
}

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    const kind = ['success', 'error', 'info', 'warning'].includes(type) ? type : 'info';
    notification.className = `notification notification-${kind}`;
    notification.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    notification.title = 'Натисни за затваряне';
    notification.textContent = message;

    let removed = false;
    const dismiss = () => {
        if (removed) return;
        removed = true;
        clearTimeout(timer);
        notification.classList.add('leaving');
        setTimeout(() => notification.remove(), 300);
    };
    const timer = setTimeout(dismiss, NOTIFICATION_DURATION_MS[kind] || NOTIFICATION_DURATION_MS.default);
    notification.addEventListener('click', dismiss);

    getNotificationContainer().appendChild(notification);
}

// Попълва годините (от текущата до 2015) и месеца само ако селектът е празен,
// за да не се губи избраното от потребителя при повторно влизане
function populateReportPeriod(yearSelectId, monthSelectId, currentYear, currentMonth) {
    const yearSelect = document.getElementById(yearSelectId);
    if (yearSelect.options.length === 0) {
        for (let year = currentYear; year >= 2015; year--) {
            const option = document.createElement('option');
            option.value = year;
            option.textContent = year;
            if (year === currentYear) option.selected = true;
            yearSelect.appendChild(option);
        }
        document.getElementById(monthSelectId).value = currentMonth;
    }
}

// Етикет на типа категория (за падащи менюта: „Храна (Разход)“)
function categoryTypeLabel(type) {
    if (type === 'expense') return 'Разход';
    if (type === 'income') return 'Приход';
    return 'Трансфер';
}

// <option> за всяка категория с типа ѝ в скоби; selectedId — избраната (по избор)
function categoryOptionsHtml(categories, selectedId = null) {
    return categories
        .map(c => `<option value="${c.id}" ${c.id === selectedId ? 'selected' : ''}>${escapeHtml(c.name)} (${categoryTypeLabel(c.type)})</option>`)
        .join('');
}
