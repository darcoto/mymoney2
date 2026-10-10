/**
 * Архив на базата.
 * VACUUM INTO прави последователно копие дори докато приложението пише в базата
 * (обикновеното копиране на файла може да хване база по средата на запис).
 *
 * Имена в data/backups/:
 *  - <база>_backup_<дата>_<час>.db — ръчни (бутон „Архивиране“, преди обединяване и т.н.) — не се трият
 *  - <база>_auto_<дата>.db         — ежедневни; пазят се последните KEEP_DAILY и по едно на месец за KEEP_MONTHLY месеца
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');
const database = require('./database');
const logger = require('./logger');

const KEEP_DAILY = 14;
const KEEP_MONTHLY = 12;

function pad(n) {
    return String(n).padStart(2, '0');
}

function backupDir() {
    const dir = path.join(path.dirname(config.databasePath), 'backups');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function dbName() {
    return path.basename(config.databasePath, '.db');
}

function localDate(date = new Date()) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * @param {'manual'|'auto'} kind
 * @returns {Promise<{ path: string, size: number }>}
 */
async function createBackup(kind = 'manual') {
    const now = new Date();
    const file = kind === 'auto'
        ? `${dbName()}_auto_${localDate(now)}.db`
        : `${dbName()}_backup_${localDate(now)}_${pad(now.getHours())}${pad(now.getMinutes())}.db`;
    const target = path.join(backupDir(), file);

    // VACUUM INTO не презаписва съществуващ файл
    if (fs.existsSync(target)) fs.unlinkSync(target);
    await database.runQuery('VACUUM INTO ?', [target]);

    const size = fs.statSync(target).size;
    logger.info(`[Backup] ${kind}: ${file} (${Math.round(size / 1024)} KB)`);
    if (kind === 'auto') pruneAutoBackups();
    return { path: target, file, size };
}

/**
 * Ежедневните архиви: последните KEEP_DAILY + първият за всеки от последните KEEP_MONTHLY месеца
 */
function pruneAutoBackups() {
    const prefix = `${dbName()}_auto_`;
    const files = fs.readdirSync(backupDir())
        .filter(f => f.startsWith(prefix) && f.endsWith('.db'))
        .map(f => ({ file: f, date: f.slice(prefix.length, prefix.length + 10) }))
        .sort((a, b) => b.date.localeCompare(a.date)); // най-новите първи

    const keep = new Set(files.slice(0, KEEP_DAILY).map(f => f.file));
    const months = new Map();
    // Най-ранният архив за всеки месец
    [...files].reverse().forEach(f => {
        const month = f.date.slice(0, 7);
        if (!months.has(month)) months.set(month, f.file);
    });
    [...months.keys()].sort().reverse().slice(0, KEEP_MONTHLY).forEach(m => keep.add(months.get(m)));

    let removed = 0;
    for (const f of files) {
        if (keep.has(f.file)) continue;
        try {
            fs.unlinkSync(path.join(backupDir(), f.file));
            removed++;
        } catch (error) {
            logger.warn(`[Backup] Could not delete ${f.file}: ${error.message}`);
        }
    }
    if (removed) logger.info(`[Backup] Removed ${removed} old automatic backups`);
}

/**
 * Последният ежедневен архив (за статуса в Настройки)
 */
function lastAutoBackup() {
    const prefix = `${dbName()}_auto_`;
    const files = fs.readdirSync(backupDir()).filter(f => f.startsWith(prefix) && f.endsWith('.db')).sort();
    if (!files.length) return null;
    const file = files[files.length - 1];
    const stat = fs.statSync(path.join(backupDir(), file));
    return { file, size: stat.size, createdAt: stat.mtime.toISOString(), count: files.length };
}

module.exports = { createBackup, pruneAutoBackups, lastAutoBackup, KEEP_DAILY, KEEP_MONTHLY };
