/**
 * Дебъг: записва суровите отговори от банковите API (GoCardless, Enable Banking) като JSON файлове
 * в data/api-responses/<дата>/ — за анализ без повторни заявки (банката ограничава заявките).
 * Включва се от Настройки → Дебъг (app_settings: debug.apiResponses = '1'); файловете се трият оттам.
 * Заявките за токени не се записват (съдържат тайни).
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');
const database = require('./database');
const logger = require('./logger');

const DIR = path.join(path.dirname(config.databasePath), 'api-responses');
const SECRET_URL = /\/token\b|\/token\/|\/auth\b|\/sessions\b/i;

let enabled = false;
let counter = 0;

function pad(n, len = 2) {
    return String(n).padStart(len, '0');
}

async function load() {
    enabled = (await database.getSetting('debug.apiResponses', '0')) === '1';
    if (enabled) logger.info(`[API debug] Saving raw API responses to ${DIR}`);
    return enabled;
}

function isEnabled() {
    return enabled;
}

async function setEnabled(value) {
    await database.setSetting('debug.apiResponses', value ? '1' : '0');
    enabled = !!value;
    logger.info(`[API debug] Raw API responses ${enabled ? 'enabled' : 'disabled'}`);
}

/**
 * @param {{ provider: string, method: string, url: string, params?: object, requestBody?: any, status?: number, data?: any, error?: string }} entry
 */
function save(entry) {
    if (!enabled || !entry.url || SECRET_URL.test(entry.url)) return;
    try {
        const now = new Date();
        const dayDir = path.join(DIR, `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`);
        fs.mkdirSync(dayDir, { recursive: true });
        const slug = entry.url
            .replace(/^https?:\/\/[^/]+/, '')
            .replace(/^\/(api\/)?v\d+\//, '')
            .replace(/[^\w-]+/g, '_')
            .replace(/^_+|_+$/g, '')
            .slice(0, 90);
        counter = (counter + 1) % 1000;
        const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${pad(now.getMilliseconds(), 3)}${pad(counter, 3)}`;
        const file = path.join(dayDir, `${time}_${entry.provider}_${entry.method}_${slug || 'root'}.json`);
        fs.writeFileSync(file, JSON.stringify({ savedAt: now.toISOString(), ...entry }, null, 2));
    } catch (error) {
        logger.warn('[API debug] Could not save response:', error.message);
    }
}

/** Брой файлове, обем и дни */
function stats() {
    if (!fs.existsSync(DIR)) return { enabled, files: 0, bytes: 0, days: [], dir: path.relative(process.cwd(), DIR) };
    let files = 0;
    let bytes = 0;
    const days = [];
    for (const day of fs.readdirSync(DIR).sort()) {
        const dayDir = path.join(DIR, day);
        if (!fs.statSync(dayDir).isDirectory()) continue;
        const list = fs.readdirSync(dayDir);
        let dayBytes = 0;
        list.forEach(f => { dayBytes += fs.statSync(path.join(dayDir, f)).size; });
        files += list.length;
        bytes += dayBytes;
        days.push({ day, files: list.length, bytes: dayBytes });
    }
    return { enabled, files, bytes, days, dir: path.relative(process.cwd(), DIR) };
}

function clear() {
    const before = stats();
    fs.rmSync(DIR, { recursive: true, force: true });
    logger.info(`[API debug] Deleted ${before.files} saved responses`);
    return before.files;
}

/** Помощник за axios interceptors на провайдерите */
function saveAxiosResponse(provider, response) {
    if (!enabled || !response || !response.config) return;
    const cfg = response.config;
    save({
        provider,
        method: (cfg.method || 'get').toUpperCase(),
        url: `${cfg.baseURL || ''}${cfg.url || ''}`,
        params: cfg.params,
        requestBody: parseBody(cfg.data),
        status: response.status,
        data: response.data
    });
}

function saveAxiosError(provider, error) {
    if (!enabled || !error || !error.config) return;
    const cfg = error.config;
    save({
        provider,
        method: (cfg.method || 'get').toUpperCase(),
        url: `${cfg.baseURL || ''}${cfg.url || ''}`,
        params: cfg.params,
        requestBody: parseBody(cfg.data),
        status: error.response ? error.response.status : null,
        data: error.response ? error.response.data : null,
        error: error.message
    });
}

function parseBody(data) {
    if (!data || typeof data !== 'string') return data || null;
    try {
        return JSON.parse(data);
    } catch (e) {
        return data;
    }
}

module.exports = { load, isEnabled, setEnabled, save, stats, clear, saveAxiosResponse, saveAxiosError, DIR };
