// График (синхронизация, архив) и Telegram — настройки от страница „Настройки“
const express = require('express');
const database = require('../database');
const logger = require('../logger');
const scheduler = require('../scheduler');
const telegram = require('../telegram');
const apiDebug = require('../api-debug');
const { apiError } = require('./helpers');

const scheduleRouter = express.Router();
const telegramRouter = express.Router();
const debugRouter = express.Router();

// Грешките на български (валидация) и от Telegram API са за потребителя
function sendError(res, error) {
    if (/[а-яА-Я]/.test(error.message) || error.message.startsWith('Telegram:')) {
        return res.status(400).json({ error: error.message });
    }
    return apiError(res, error);
}

// ─── График ─────────────────────────────────────────────────────────────────

scheduleRouter.get('/', async (req, res) => {
    try {
        res.json(await scheduler.getStatus());
    } catch (error) {
        sendError(res, error);
    }
});

scheduleRouter.put('/', async (req, res) => {
    try {
        const { syncEnabled, syncTimes, backupEnabled, backupTime } = req.body;
        res.json(await scheduler.updateSchedule({ syncEnabled, syncTimes, backupEnabled, backupTime }));
    } catch (error) {
        sendError(res, error);
    }
});

// ─── Telegram ───────────────────────────────────────────────────────────────

telegramRouter.get('/', async (req, res) => {
    try {
        res.json(await telegram.getStatus());
    } catch (error) {
        sendError(res, error);
    }
});

telegramRouter.put('/', async (req, res) => {
    try {
        const { token, enabled, quietFrom, quietTo } = req.body;
        if (token !== undefined) {
            const value = String(token || '').trim();
            if (!/^\d+:[\w-]{30,}$/.test(value)) {
                throw new Error('Невалиден token — копирайте го от @BotFather (вид 123456789:AA...)');
            }
            // Проверка преди запис
            await telegram._internal.call('getMe', {}, { token: value });
            const previous = await database.getSetting('telegram.token');
            await database.setSetting('telegram.token', value);
            if (previous && previous !== value) {
                // Нов бот — старото свързване и позицията в съобщенията не важат
                for (const key of ['telegram.chatId', 'telegram.chatName', 'telegram.since', 'telegram.offset', 'telegram.pairCode']) {
                    await database.setSetting(key, null);
                }
            }
        }
        if (enabled !== undefined) await database.setSetting('telegram.enabled', enabled ? '1' : '0');
        for (const [key, value] of [['quietFrom', quietFrom], ['quietTo', quietTo]]) {
            if (value === undefined) continue;
            if (value && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error('Невалиден час за тихите часове — пример: 22:30');
            await database.setSetting(`telegram.${key}`, value || null);
        }
        await telegram.start();
        res.json(await telegram.getStatus());
    } catch (error) {
        sendError(res, error);
    }
});

telegramRouter.delete('/', async (req, res) => {
    try {
        telegram.stop();
        for (const key of ['telegram.token', 'telegram.chatId', 'telegram.chatName', 'telegram.since', 'telegram.offset', 'telegram.pairCode']) {
            await database.setSetting(key, null);
        }
        logger.info('[Telegram] Bot removed');
        res.json(await telegram.getStatus());
    } catch (error) {
        sendError(res, error);
    }
});

// Код за свързване: потребителят изпраща /start <код> на бота (или отваря връзката)
telegramRouter.post('/pair', async (req, res) => {
    try {
        const status = await telegram.getStatus();
        if (!status.running || !status.bot) throw new Error('Първо въведете token на бота');
        const code = await telegram.createPairCode();
        res.json({ code, link: `https://t.me/${status.bot.username}?start=${code}`, bot: status.bot.username });
    } catch (error) {
        sendError(res, error);
    }
});

telegramRouter.delete('/chat', async (req, res) => {
    try {
        for (const key of ['telegram.chatId', 'telegram.chatName', 'telegram.since']) {
            await database.setSetting(key, null);
        }
        res.json(await telegram.getStatus());
    } catch (error) {
        sendError(res, error);
    }
});

telegramRouter.post('/test', async (req, res) => {
    try {
        const status = await telegram.getStatus();
        if (!status.chatId) throw new Error('Чатът още не е свързан');
        await telegram.sendMessage('🔔 Тестово съобщение от MyMoney² — известията работят.');
        res.json({ success: true });
    } catch (error) {
        sendError(res, error);
    }
});

// Некатегоризираните от последните 30 дни (както командата /pending)
telegramRouter.post('/pending', async (req, res) => {
    try {
        const status = await telegram.getStatus();
        if (!status.chatId) throw new Error('Чатът още не е свързан');
        res.json({ sent: await telegram.sendPending() });
    } catch (error) {
        sendError(res, error);
    }
});

// ─── Дебъг: сурови отговори от банковите API ────────────────────────────────

debugRouter.get('/', async (req, res) => {
    try {
        res.json(apiDebug.stats());
    } catch (error) {
        sendError(res, error);
    }
});

debugRouter.put('/', async (req, res) => {
    try {
        await apiDebug.setEnabled(!!req.body.apiResponses);
        res.json(apiDebug.stats());
    } catch (error) {
        sendError(res, error);
    }
});

debugRouter.delete('/api-responses', async (req, res) => {
    try {
        const deleted = apiDebug.clear();
        res.json({ deleted, ...apiDebug.stats() });
    } catch (error) {
        sendError(res, error);
    }
});

module.exports = { scheduleRouter, telegramRouter, debugRouter };
