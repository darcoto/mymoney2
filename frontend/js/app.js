// Основна логика: навигация между страниците, делегирани data-action кликове и инициализация.
// Зарежда се последен — функциите от останалите скриптове (utils, categories, reports,
// settings, sync, import, transactions, dashboard) вече са дефинирани.

const PAGES = ['dashboard', 'transactions', 'categories', 'reports', 'settings'];

// Page navigation. Връща promise, който изчаква зареждането на съдържанието на страницата.
function navigateToPage(pageName, updateHash = true) {
    // Непозната страница (напр. грешен #hash) → Табло
    if (!PAGES.includes(pageName)) pageName = 'dashboard';

    // Hide all pages
    document.querySelectorAll('.page').forEach(page => {
        page.classList.remove('active');
    });

    // Show selected page
    document.getElementById(`${pageName}-page`)?.classList.add('active');

    // Update nav links
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.toggle('active', link.dataset.page === pageName);
    });

    // Update URL hash (without triggering hashchange if already correct)
    if (updateHash && window.location.hash !== `#${pageName}`) {
        history.pushState(null, '', `#${pageName}`);
    }

    // Load page-specific content
    return loadPageContent(pageName);
}

// Всяка страница рисува само в собствения си контейнер, така че ако потребителят смени
// страницата преди по-бавно зареждане да приключи, закъснелият резултат попада в скритата
// страница и не пречи. Грешките не се пропускат нагоре (навигацията не бива да „гърми“).
async function loadPageContent(pageName) {
    try {
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
    } catch (error) {
        console.error(`Error loading page "${pageName}":`, error);
    }
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
        loadCategoriesPage();
    } else if (pageId === 'reports-page') {
        // Reports are generated on demand, no auto-refresh needed
    } else if (pageId === 'settings-page') {
        loadSettingsPage();
    }
}

// Делегиране на клик събития за елементи с data-action (вместо inline onclick).
// Числовите id-та идват като низове от data-атрибутите и се преобразуват тук.
const ACTION_HANDLERS = {
    // Категории
    'edit-category': d => editCategory(Number(d.categoryId)),
    'delete-category': d => deleteCategory(Number(d.categoryId)),
    'edit-rule': d => editRule(Number(d.ruleId)),
    'delete-rule': d => deleteRule(Number(d.ruleId)),

    // Отчети
    'category-tx': d => {
        const id = d.categoryId === 'null' || d.categoryId === '' ? null : Number(d.categoryId);
        const period = d.year ? { year: d.year, month: d.month } : undefined;
        showCategoryTransactions(id, d.categoryName, period);
    },
    'country-tx': d => showCountryTransactions(d.countryCode, d.countryName),
    'report-row-tx': d => showReportRowTransactions(d.reportKey, Number(d.index)),
    'tx-overlay': d => showTransactionOverlay(Number(d.index)),
    'insight-tx': d => showInsightTransactions(d.insightKey, Number(d.index)),
    'compare-tx': d => showCompareTransactions(Number(d.index), d.period),

    // Настройки
    'provider-credentials': d => showProviderCredentialsModal(Number(d.providerId)),
    'clear-provider-credentials': d => clearProviderCredentials(Number(d.providerId)),
    'select-provider': d => selectProvider(Number(d.providerId), d.providerName),
    'select-bank': d => selectBank(d.institutionId),
    'renew-auth': d => renewProviderAuth(Number(d.providerId), d.institutionId),
    'delete-auth': d => deleteProviderAuth(Number(d.providerId), d.authId),
    'edit-account': d => editAccountName(d.accountId, d.accountName)
};

document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const handler = ACTION_HANDLERS[el.dataset.action];
    if (handler) handler(el.dataset);
});

// Initialize app
document.addEventListener('DOMContentLoaded', async () => {
    // Navigation — менюто и вътрешни връзки като „Виж всички“ на таблото
    document.querySelectorAll('a[data-page]').forEach(link => {
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
    document.getElementById('syncButton').addEventListener('click', showSyncModal);
    document.getElementById('syncStartBtn').addEventListener('click', startSync);
    // syncCancelBtn / syncModalClose получават onclick в showSyncModal / startSync

    // Transactions page buttons
    document.getElementById('addManualTransactionBtn')?.addEventListener('click', showAddManualTransactionModal);
    document.getElementById('importFileBtn')?.addEventListener('click', showImportFileModal);

    // Categories page buttons
    document.getElementById('addCategoryBtn')?.addEventListener('click', showAddCategoryModal);
    document.getElementById('addRuleBtn')?.addEventListener('click', showAddRuleModal);
    document.getElementById('applyRulesBtn')?.addEventListener('click', applyRules);

    // Settings page buttons
    document.getElementById('addBankBtn')?.addEventListener('click', showAddBankModal);
    document.getElementById('applyCategoriesBtn')?.addEventListener('click', applyCategories);
    document.getElementById('backupBtn')?.addEventListener('click', createBackup);
    document.getElementById('reconcileImportsBtn')?.addEventListener('click', reconcileImports);
    document.getElementById('toggleLogsBtn')?.addEventListener('click', toggleLogsPanel);
    document.getElementById('refreshLogsBtn')?.addEventListener('click', loadLogs);

    // Връщане от банката след одобрение (GoCardless добавя ?ref=...) — синхронизираме веднага
    if (new URLSearchParams(window.location.search).has('ref')) {
        history.replaceState(null, '', '/#settings');
        await navigateToPage('settings', false);
        showSyncModal();
        document.querySelector('input[name="syncMode"][value="both"]').checked = true;
        await startSync();
        await loadSettingsPage();
        return;
    }

    // Load initial page from URL hash or default to dashboard
    const initialPage = window.location.hash.replace('#', '') || 'dashboard';
    await navigateToPage(initialPage);
});
