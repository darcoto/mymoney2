/**
 * График в самото приложение (без cron): синхронизация в зададени часове, ежедневен архив,
 * предупреждение за изтичащ достъп до банката. Часовете са по местно време (Europe/Sofia).
 *
 * Настройки (app_settings):
 *  schedule.syncEnabled ('0' по подразбиране — включва се от Настройки на сървъра, който работи постоянно)
 *  schedule.syncTimes   ('07:00,12:00,17:00,22:00' — GoCardless позволява ~4 заявки на ден за сметка)
 *  schedule.backupEnabled ('1'), schedule.backupTime ('03:00')
 *  schedule.lastSyncSlot / schedule.lastBackupDate / schedule.lastConsentCheck — какво вече е изпълнено
 */

const database = require('./database');
const logger = require('./logger');
const backup = require('./backup');
const telegram = require('./telegram');
const providerRegistry = require('./providers/provider-registry');
const { runSync, isRunning } = require('./sync-service');
const { zonedNow, parseTimes, toMinutes } = require('./time');

const TICK_MS = 30 * 1000;
const CONSENT_WARN_DAYS = 7;

const DEFAULTS = {
    syncEnabled: '0',
    syncTimes: '07:00,12:00,17:00,22:00',
    backupEnabled: '1',
    backupTime: '03:00'
};

let timer = null;
let ticking = false;

async function getSchedule() {
    const get = key => database.getSetting(`schedule.${key}`, DEFAULTS[key]);
    return {
        syncEnabled: (await get('syncEnabled')) === '1',
        syncTimes: parseTimes(await get('syncTimes')) || parseTimes(DEFAULTS.syncTimes),
        backupEnabled: (await get('backupEnabled')) === '1',
        backupTime: (parseTimes(await get('backupTime')) || [DEFAULTS.backupTime])[0]
    };
}

async function runScheduledSync(slot) {
    await database.setSetting('schedule.lastSyncSlot', slot);
    if (isRunning()) {
        logger.info('[Scheduler] Sync already running — slot skipped');
        return;
    }
    try {
        const result = await runSync({ mode: 'both', trigger: 'schedule' });
        if (result.errors.length) {
            await telegram.sendAlert(`⚠️ <b>Синхронизацията в ${slot.slice(11)} завърши с грешки</b>\n${result.errors.map(e => `• ${e}`).join('\n')}`);
        }
    } catch (error) {
        logger.error('[Scheduler] Sync failed:', error.message);
        await telegram.sendAlert(`⚠️ <b>Синхронизацията не беше изпълнена</b>\n${error.message}`);
    }
}

async function runScheduledBackup(date) {
    await database.setSetting('schedule.lastBackupDate', date);
    try {
        await backup.createBackup('auto');
    } catch (error) {
        logger.error('[Scheduler] Backup failed:', error.message);
        await telegram.sendAlert(`⚠️ <b>Ежедневният архив не беше създаден</b>\n${error.message}`);
    }
}

/** Достъпът до банката (EUA) изтича след 180 дни и не може да се удължи — напомняне 7 дни преди това */
async function checkConsents(date) {
    await database.setSetting('schedule.lastConsentCheck', date);
    try {
        const providers = await providerRegistry.getConfiguredProviders();
        const accounts = await database.getAllAccounts();
        const usedAuthIds = new Set(accounts.map(a => a.authorization_id).filter(Boolean));
        for (const provider of providers) {
            if (typeof provider.listAuthorizations !== 'function') continue;
            const auths = await provider.listAuthorizations();
            for (const auth of auths) {
                if (!usedAuthIds.has(auth.id) || !auth.expiresAt || auth.expired) continue;
                const days = Math.ceil((Date.parse(auth.expiresAt) - Date.now()) / 86400000);
                if (days <= CONSENT_WARN_DAYS) {
                    await telegram.sendAlert(`🔑 <b>Достъпът до ${auth.institution_id || 'банката'} изтича след ${days} ${days === 1 ? 'ден' : 'дни'}</b>\n` +
                        'Отворете Настройки → Банкови връзки → „Поднови“ и потвърдете в банката.');
                }
            }
        }
    } catch (error) {
        logger.warn('[Scheduler] Consent check failed:', error.message);
    }
}

async function tick() {
    if (ticking) return;
    ticking = true;
    try {
        const now = zonedNow();
        const schedule = await getSchedule();

        // Синхронизация — точно в зададените часове (пропуснат час не се наваксва: лимитът на банката)
        if (schedule.syncEnabled) {
            const due = schedule.syncTimes.filter(t => toMinutes(t) <= now.minutes && now.minutes - toMinutes(t) < 5);
            if (due.length) {
                const slot = `${now.date} ${due[due.length - 1]}`;
                if ((await database.getSetting('schedule.lastSyncSlot')) !== slot) await runScheduledSync(slot);
            }
        }

        // Архив — веднъж дневно след зададения час (ако сървърът е бил спрян, наваксва при старт)
        if (schedule.backupEnabled && now.minutes >= toMinutes(schedule.backupTime)
            && (await database.getSetting('schedule.lastBackupDate')) !== now.date) {
            await runScheduledBackup(now.date);
        }

        // Изтичащ достъп до банката — веднъж дневно, след 09:00
        if (now.minutes >= 9 * 60 && (await database.getSetting('schedule.lastConsentCheck')) !== now.date) {
            await checkConsents(now.date);
        }
    } catch (error) {
        logger.error('[Scheduler] Tick failed:', error.message);
    } finally {
        ticking = false;
    }
}

function start() {
    if (timer) return;
    timer = setInterval(tick, TICK_MS);
    setTimeout(tick, 15 * 1000);
    logger.info('[Scheduler] Started');
}

function stop() {
    if (timer) clearInterval(timer);
    timer = null;
}

async function getStatus() {
    const schedule = await getSchedule();
    const now = zonedNow();
    const next = schedule.syncEnabled
        ? (schedule.syncTimes.find(t => toMinutes(t) > now.minutes) || `${schedule.syncTimes[0]} (утре)`)
        : null;
    return {
        ...schedule,
        nextSync: next,
        lastSync: JSON.parse(await database.getSetting('sync.lastResult', 'null') || 'null'),
        lastBackup: backup.lastAutoBackup(),
        keepDaily: backup.KEEP_DAILY,
        keepMonthly: backup.KEEP_MONTHLY,
        timeZone: require('./time').TIME_ZONE,
        serverTime: `${now.date} ${now.time}`
    };
}

/**
 * @param {{ syncEnabled?: boolean, syncTimes?: string, backupEnabled?: boolean, backupTime?: string }} changes
 */
async function updateSchedule(changes) {
    if (changes.syncTimes !== undefined) {
        const times = parseTimes(changes.syncTimes);
        if (!times || !times.length) throw new Error('Невалидни часове за синхронизация — пример: 07:00, 12:00, 17:00, 22:00');
        if (times.length > 4) throw new Error('Най-много 4 синхронизации на ден — банката ограничава заявките (~4 на ден за сметка)');
        await database.setSetting('schedule.syncTimes', times.join(','));
    }
    if (changes.backupTime !== undefined) {
        const times = parseTimes(changes.backupTime);
        if (!times || times.length !== 1) throw new Error('Невалиден час за архива — пример: 03:00');
        await database.setSetting('schedule.backupTime', times[0]);
    }
    if (changes.syncEnabled !== undefined) await database.setSetting('schedule.syncEnabled', changes.syncEnabled ? '1' : '0');
    if (changes.backupEnabled !== undefined) await database.setSetting('schedule.backupEnabled', changes.backupEnabled ? '1' : '0');
    return getStatus();
}

module.exports = { start, stop, tick, getStatus, updateSchedule };
