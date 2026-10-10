/**
 * Синхронизация със сметките в банката — обща за бутона „Синхронизация“ (SSE) и графика.
 * Само една синхронизация в даден момент; след нея — обединяване на импорти и известия.
 */

const database = require('./database');
const logger = require('./logger');
const providerRegistry = require('./providers/provider-registry');
const { reconcileImportedTransactions } = require('./transaction-matching');

let running = null;
const afterSyncHooks = [];

/** Функция, която се вика след синхронизация на транзакции (напр. известия в Telegram) */
function onAfterSync(fn) {
    afterSyncHooks.push(fn);
}

function isRunning() {
    return running !== null;
}

// След всяка синхронизация: транзакциите, импортирани по-рано от файл, се обединяват с банковите,
// Revolut прехвърлянията към джоба отиват в правилната сметка, блокираните суми се премахват
async function reconcileSafely() {
    try {
        return await reconcileImportedTransactions({ dryRun: false });
    } catch (error) {
        logger.error('Post-sync reconcile failed:', error.message);
        return null;
    }
}

/**
 * @param {{ mode?: 'accounts'|'transactions'|'both', trigger?: 'manual'|'schedule', onStep?: Function }} options
 *   onStep({ icon, text }) — стъпките за показване (SSE)
 */
async function runSync({ mode = 'both', trigger = 'manual', onStep = () => {} } = {}) {
    if (running) {
        const error = new Error('Синхронизацията вече тече — изчакайте да приключи');
        error.busy = true;
        throw error;
    }
    running = doSync(mode, trigger, onStep).finally(() => { running = null; });
    return running;
}

async function doSync(mode, trigger, step) {
    const startedAt = new Date().toISOString();
    const result = { mode, trigger, startedAt, accountsSynced: 0, transactionsSynced: 0, errors: [], reconciled: null };

    const configuredProviders = await providerRegistry.getConfiguredProviders();
    if (configuredProviders.length === 0) {
        throw new Error('Няма конфигурирани провайдери');
    }

    if (mode === 'accounts' || mode === 'both') {
        for (const provider of configuredProviders) {
            step({ icon: '🔄', text: `${provider.name}: зарежда сметки...` });
            try {
                const accounts = await provider.syncAllAccounts();
                result.accountsSynced += accounts.length;
                step({ icon: '✅', text: `${provider.name}: ${accounts.length} сметки синхронизирани` });
            } catch (error) {
                result.errors.push(`${provider.name}: ${error.message}`);
                step({ icon: '❌', text: `${provider.name}: ${error.message}` });
            }
        }
    }

    if (mode === 'transactions' || mode === 'both') {
        const accounts = await database.getAllAccounts();
        const providerMap = {};
        for (const p of configuredProviders) providerMap[p.id] = p;

        const syncableAccounts = accounts.filter(a => a.id !== 'CASH');
        if (syncableAccounts.length === 0) {
            step({ icon: '⚠️', text: 'Няма сметки за синхронизация на транзакции' });
        }

        for (const account of syncableAccounts) {
            const provider = providerMap[account.provider_id] || configuredProviders.find(p => p.type === 'gocardless');
            if (!provider) continue;

            const name = account.custom_name || account.name;
            step({ icon: '🔄', text: `${name}...` });
            try {
                const count = await provider.syncAccountTransactions(account.id);
                result.transactionsSynced += count;
                step({ icon: count > 0 ? '✅' : '➖', text: `${name}: ${count} нови транзакции` });
            } catch (error) {
                result.errors.push(`${name}: ${error.message}`);
                step({ icon: '❌', text: `${name}: ${error.message}` });
            }
        }

        const reconciled = await reconcileSafely();
        result.reconciled = reconciled;
        if (reconciled) {
            if (reconciled.duplicatesMerged > 0) {
                step({ icon: '🔁', text: `${reconciled.duplicatesMerged} транзакции, импортирани по-рано от файл, обединени с банковите` });
            }
            if (reconciled.importedMoved > 0) {
                step({ icon: '🔀', text: `Revolut: ${reconciled.importedMoved} импортирани транзакции преместени в сметката по продукта` });
            }
            if (reconciled.cardHoldsRemoved > 0) {
                step({ icon: '💳', text: `ДСК: ${reconciled.cardHoldsRemoved} блокирани суми по карти премахнати` });
            }
        }
    }

    result.finishedAt = new Date().toISOString();
    await database.setSetting('sync.lastResult', JSON.stringify(result)).catch(() => {});
    logger.info(`[Sync] ${trigger} ${mode}: ${result.accountsSynced} accounts, ${result.transactionsSynced} new transactions, ${result.errors.length} errors`);

    if (mode !== 'accounts') {
        for (const hook of afterSyncHooks) {
            try {
                await hook(result);
            } catch (error) {
                logger.error('After-sync hook failed:', error.message);
            }
        }
    }
    return result;
}

module.exports = { runSync, isRunning, onAfterSync, reconcileSafely };
