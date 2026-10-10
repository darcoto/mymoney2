/**
 * Telegram бот: известие за всяка нова транзакция с бутони за категория, бележка с отговор,
 * команди /status и /pending, предупреждения от графика (неуспешна синхронизация, архив, изтичащ достъп).
 *
 * Получаване на съобщения — long polling (getUpdates): не трябва публичен адрес или отворен порт.
 * Ботът отговаря само на свързания чат (свързване с код от Настройки: /start <код>).
 *
 * Настройки (app_settings): telegram.token, telegram.enabled, telegram.chatId, telegram.chatName,
 * telegram.pairCode, telegram.since (известия само за транзакции след свързването), telegram.offset,
 * telegram.quietFrom / telegram.quietTo (тихи часове — съобщенията идват без звук).
 */

const axios = require('axios');
const crypto = require('crypto');
const database = require('./database');
const logger = require('./logger');
const categorization = require('./categorization');
const { zonedNow, inRange } = require('./time');

const API = 'https://api.telegram.org';
const POLL_TIMEOUT_S = 50;
const MAX_INDIVIDUAL = 15;     // при повече нови транзакции наведнъж — обобщение
const MAX_AGE_DAYS = 10;       // по-стари транзакции (напр. история при ново свързване) — без известие
const SUGGESTIONS = 6;
const PAGE_SIZE = 12;

const state = {
    running: false,
    token: null,
    bot: null,          // { id, username, first_name }
    lastError: null,
    generation: 0       // всеки start() — ново поколение; старият цикъл за четене спира сам
};

// ─── Telegram API ───────────────────────────────────────────────────────────

async function call(method, params = {}, { token = state.token, timeout = 15000 } = {}) {
    if (!token) throw new Error('Telegram: липсва token на бота');
    try {
        const response = await axios.post(`${API}/bot${token}/${method}`, params, { timeout });
        return response.data.result;
    } catch (error) {
        const description = error.response && error.response.data && error.response.data.description;
        const err = new Error(`Telegram: ${description || error.message}`);
        err.status = error.response && error.response.status;
        throw err;
    }
}

function escapeHtml(text) {
    return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatAmount(amount) {
    const abs = Math.abs(amount).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return `${amount < 0 ? '−' : '+'}${abs} €`;
}

function formatDate(dateStr) {
    const [y, m, d] = String(dateStr).split('-');
    return `${d}.${m}.${y}`;
}

async function isQuietNow() {
    const from = await database.getSetting('telegram.quietFrom', '22:30');
    const to = await database.getSetting('telegram.quietTo', '07:00');
    if (!from || !to || from === to) return false;
    return inRange(zonedNow().minutes, from, to);
}

async function sendMessage(text, extra = {}) {
    const chatId = await database.getSetting('telegram.chatId');
    if (!state.token || !chatId) return null;
    return call('sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        disable_notification: await isQuietNow(),
        ...extra
    });
}

/** Кратко съобщение (предупреждения от графика); не хвърля грешка */
async function sendAlert(text) {
    try {
        if (!(await isActive())) return false;
        await sendMessage(text);
        return true;
    } catch (error) {
        logger.error('[Telegram] Alert failed:', error.message);
        return false;
    }
}

async function isActive() {
    return state.running && !!(await database.getSetting('telegram.chatId'));
}

// ─── Транзакции ─────────────────────────────────────────────────────────────

const TX_SELECT = `
    SELECT t.*, c.name AS category_name, c.type AS category_type, c.icon AS category_icon,
           a.name AS account_name, a.custom_name AS account_custom_name, a.iban AS account_iban
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    LEFT JOIN accounts a ON a.id = t.account_id`;

async function getTransaction(id) {
    return database.getQuery(`${TX_SELECT} WHERE t.id = ?`, [id]);
}

function accountLabel(tx) {
    const name = tx.account_custom_name || tx.account_name || '';
    const iban = tx.account_iban || '';
    return iban && name !== iban ? `${name} …${iban.slice(-4)}` : name;
}

function transactionText(tx, resultLine = null) {
    const income = tx.amount > 0;
    const who = (tx.counterparty_name || tx.description || '—').trim();
    const lines = [`${income ? '💰' : '💳'} <b>${formatAmount(tx.amount)}</b> · ${escapeHtml(who)}`];
    if (tx.original_currency && tx.original_currency !== 'EUR' && tx.original_currency !== 'BGN' && tx.original_amount) {
        lines[0] += ` (${Math.abs(tx.original_amount).toFixed(2).replace('.', ',')} ${escapeHtml(tx.original_currency)})`;
    }
    lines.push(`${escapeHtml(accountLabel(tx))} · ${formatDate(tx.transaction_date)}`);
    const description = (tx.description || '').trim();
    if (description && description !== who) lines.push(`<i>${escapeHtml(description.slice(0, 140))}</i>`);
    if (resultLine) {
        lines.push(resultLine);
    } else {
        lines.push(tx.category_name ? `🏷️ ${escapeHtml(tx.category_name)} <i>(автоматично)</i>` : '❔ Без категория');
    }
    return lines.join('\n');
}

/**
 * Най-вероятните категории: правило → история на същия контрагент → най-честите напоследък
 * (за същата посока — плащане или постъпление)
 */
async function suggestCategories(tx, limit = SUGGESTIONS) {
    const ids = [];
    const add = id => { if (id && id !== tx.category_id && !ids.includes(id)) ids.push(id); };

    categorization.clearRulesCache();
    const ruleMatches = await categorization.getSuggestions({ description: tx.description, counterpartyName: tx.counterparty_name });
    categorization.clearRulesCache();
    ruleMatches.forEach(s => add(s.categoryId));

    const negative = tx.amount < 0 ? 1 : 0;
    if (tx.counterparty_name) {
        const history = await database.allQuery(`
            SELECT category_id, COUNT(*) AS n FROM transactions
            WHERE counterparty_name = ? AND category_id IS NOT NULL AND id <> ? AND (amount < 0) = ?
            GROUP BY category_id ORDER BY n DESC LIMIT 4`, [tx.counterparty_name, tx.id, negative]);
        history.forEach(h => add(h.category_id));
    }
    // Най-честите напоследък — без категориите за преводи (те идват само от правило/история)
    const recent = await database.allQuery(`
        SELECT t.category_id, COUNT(*) AS n FROM transactions t JOIN categories c ON c.id = t.category_id
        WHERE t.transaction_date >= date('now', '-120 days') AND (t.amount < 0) = ? AND c.type <> 'transfer'
        GROUP BY t.category_id ORDER BY n DESC LIMIT 12`, [negative]);
    recent.forEach(r => add(r.category_id));

    const categories = await database.getAllCategories();
    return ids.slice(0, limit).map(id => categories.find(c => c.id === id)).filter(Boolean);
}

/** Всички категории — най-използваните за тази посока първи */
async function allCategoriesSorted(tx) {
    const negative = tx.amount < 0 ? 1 : 0;
    const usage = await database.allQuery(`
        SELECT category_id, COUNT(*) AS n FROM transactions
        WHERE category_id IS NOT NULL AND (amount < 0) = ? GROUP BY category_id`, [negative]);
    const count = new Map(usage.map(u => [u.category_id, u.n]));
    const categories = await database.getAllCategories();
    return categories.sort((a, b) => (count.get(b.id) || 0) - (count.get(a.id) || 0) || a.name.localeCompare(b.name, 'bg'));
}

// Иконите на някои категории са имена от библиотека (напр. „utensils“) — в Telegram само емоджи
function categoryButton(nid, category) {
    const icon = category.icon && /\p{Extended_Pictographic}/u.test(category.icon) ? `${category.icon} ` : '';
    return { text: `${icon}${category.name}`, callback_data: `c:${nid}:${category.id}` };
}

async function mainKeyboard(nid, tx) {
    const suggestions = await suggestCategories(tx);
    const rows = [];
    if (tx.category_id && tx.category_name) {
        rows.push([{ text: `✓ ${tx.category_name} — вярно`, callback_data: `k:${nid}` }]);
    }
    for (let i = 0; i < suggestions.length; i += 2) {
        rows.push(suggestions.slice(i, i + 2).map(c => categoryButton(nid, c)));
    }
    rows.push([{ text: 'Още…', callback_data: `m:${nid}:0` }, { text: 'Пропусни', callback_data: `s:${nid}` }]);
    return { inline_keyboard: rows };
}

async function moreKeyboard(nid, tx, page) {
    const all = (await allCategoriesSorted(tx)).filter(c => c.id !== tx.category_id);
    const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
    const p = Math.min(Math.max(page, 0), pages - 1);
    const items = all.slice(p * PAGE_SIZE, (p + 1) * PAGE_SIZE);
    const rows = [];
    for (let i = 0; i < items.length; i += 3) {
        rows.push(items.slice(i, i + 3).map(c => categoryButton(nid, c)));
    }
    const nav = [];
    if (p > 0) nav.push({ text: '◀', callback_data: `m:${nid}:${p - 1}` });
    nav.push({ text: '↩ Назад', callback_data: `b:${nid}` });
    if (p < pages - 1) nav.push({ text: '▶', callback_data: `m:${nid}:${p + 1}` });
    rows.push(nav);
    return { inline_keyboard: rows };
}

async function sendTransactionMessage(tx) {
    const chatId = await database.getSetting('telegram.chatId');
    await database.runQuery(
        `INSERT INTO telegram_notifications (transaction_id, chat_id, status) VALUES (?, ?, 'pending')
         ON CONFLICT(transaction_id) DO UPDATE SET chat_id = excluded.chat_id, status = 'pending', handled_at = NULL`,
        [tx.id, chatId]);
    const row = await database.getQuery('SELECT id FROM telegram_notifications WHERE transaction_id = ?', [tx.id]);
    const message = await sendMessage(transactionText(tx), { reply_markup: await mainKeyboard(row.id, tx) });
    await database.runQuery('UPDATE telegram_notifications SET message_id = ?, status = ? WHERE id = ?',
        [message ? message.message_id : null, message ? 'sent' : 'failed', row.id]);
}

/**
 * Известия за новите банкови транзакции (след синхронизация). Без вътрешните преводи;
 * само транзакции, появили се след свързването на чата и не по-стари от MAX_AGE_DAYS.
 */
async function notifyNewTransactions() {
    if (!(await isActive())) return 0;
    const since = await database.getSetting('telegram.since');
    if (!since) return 0;

    const rows = await database.allQuery(`${TX_SELECT}
        WHERE t.created_at >= ?
          AND t.raw_data LIKE '%"transactionAmount"%'
          AND t.amount <> 0
          AND t.transaction_date >= date('now', '-${MAX_AGE_DAYS} days')
          AND COALESCE(c.type, 'expense') <> 'transfer'
          AND NOT EXISTS (SELECT 1 FROM telegram_notifications n WHERE n.transaction_id = t.id)
        ORDER BY t.transaction_date, t.created_at`, [since]);
    if (!rows.length) return 0;

    if (rows.length > MAX_INDIVIDUAL) {
        const uncategorized = rows.filter(r => !r.category_id).length;
        await sendMessage(`📥 <b>${rows.length} нови транзакции</b> (${uncategorized} без категория).\n` +
            'Твърде много са за отделни съобщения — категоризирайте ги в приложението или с /pending (по 10).');
        for (const tx of rows) {
            await database.runQuery(`INSERT OR IGNORE INTO telegram_notifications (transaction_id, status) VALUES (?, 'summarized')`, [tx.id]);
        }
        return rows.length;
    }

    for (const tx of rows) {
        try {
            await sendTransactionMessage(tx);
        } catch (error) {
            logger.error(`[Telegram] Could not send ${tx.id}:`, error.message);
        }
    }
    logger.info(`[Telegram] Sent ${rows.length} transaction notifications`);
    return rows.length;
}

/** До 10 некатегоризирани транзакции от последните 30 дни, които още чакат решение */
async function sendPending() {
    const rows = await database.allQuery(`${TX_SELECT}
        LEFT JOIN telegram_notifications n ON n.transaction_id = t.id
        WHERE t.category_id IS NULL AND t.amount <> 0 AND t.account_id <> 'CASH'
          AND t.transaction_date >= date('now', '-30 days')
          AND (n.status IS NULL OR n.status NOT IN ('categorized', 'confirmed', 'skipped'))
        ORDER BY t.transaction_date DESC LIMIT 10`);
    if (!rows.length) {
        await sendMessage('✅ Няма некатегоризирани транзакции от последните 30 дни.');
        return 0;
    }
    for (const tx of rows.reverse()) await sendTransactionMessage(tx);
    return rows.length;
}

// ─── Входящи съобщения и бутони ─────────────────────────────────────────────

async function finishMessage(chatId, messageId, text) {
    try {
        await call('editMessageText', { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', disable_web_page_preview: true });
    } catch (error) {
        if (!/message is not modified/i.test(error.message)) throw error;
    }
}

async function handleCallback(query) {
    const chatId = String(query.message && query.message.chat.id);
    if (chatId !== await database.getSetting('telegram.chatId')) {
        return call('answerCallbackQuery', { callback_query_id: query.id, text: 'Този бот е личен.' });
    }
    const [action, nidText, arg] = String(query.data || '').split(':');
    const nid = Number(nidText);
    const messageId = query.message.message_id;
    const notification = await database.getQuery('SELECT * FROM telegram_notifications WHERE id = ?', [nid]);
    const tx = notification && await getTransaction(notification.transaction_id);
    if (!tx) {
        await call('answerCallbackQuery', { callback_query_id: query.id, text: 'Транзакцията вече не съществува (обединена или изтрита)' });
        await call('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } }).catch(() => {});
        return null;
    }

    const handled = async (status, line, toast) => {
        await database.runQuery('UPDATE telegram_notifications SET status = ?, handled_at = CURRENT_TIMESTAMP WHERE id = ?', [status, nid]);
        await finishMessage(chatId, messageId, transactionText(tx, line));
        return call('answerCallbackQuery', { callback_query_id: query.id, text: toast });
    };

    switch (action) {
        case 'c': {
            const category = (await database.getAllCategories()).find(c => c.id === Number(arg));
            if (!category) return call('answerCallbackQuery', { callback_query_id: query.id, text: 'Няма такава категория' });
            await database.updateTransactionCategory(tx.id, category.id);
            logger.info(`[Telegram] ${tx.id} → category ${category.name}`);
            return handled('categorized', `✅ ${escapeHtml(category.name)}`, `Записано: ${category.name}`);
        }
        case 'k':
            return handled('confirmed', `✅ ${escapeHtml(tx.category_name || '')} <i>(потвърдена)</i>`, 'Потвърдено');
        case 's':
            return handled('skipped', '⏭ Пропусната', 'Пропусната');
        case 'm':
            await call('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: await moreKeyboard(nid, tx, Number(arg) || 0) });
            return call('answerCallbackQuery', { callback_query_id: query.id });
        case 'b':
            await call('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: await mainKeyboard(nid, tx) });
            return call('answerCallbackQuery', { callback_query_id: query.id });
        default:
            return call('answerCallbackQuery', { callback_query_id: query.id });
    }
}

const HELP = [
    '<b>MyMoney²</b>',
    'При нова транзакция идва съобщение — изберете категория с бутоните.',
    'Отговор (reply) на съобщението с текст — записва се като бележка.',
    '',
    '/pending — некатегоризираните от последните 30 дни (по 10)',
    '/status — последна синхронизация и архив'
].join('\n');

async function statusText() {
    const backup = require('./backup');
    const lines = ['<b>Състояние</b>'];
    const last = JSON.parse(await database.getSetting('sync.lastResult', 'null') || 'null');
    if (last) {
        const when = new Date(last.finishedAt || last.startedAt);
        lines.push(`🔄 Синхронизация: ${when.toLocaleString('bg-BG', { timeZone: 'Europe/Sofia' })} — ${last.transactionsSynced} нови${last.errors.length ? `, ⚠️ ${last.errors.length} грешки` : ''}`);
    } else {
        lines.push('🔄 Синхронизация: още не е правена');
    }
    const b = backup.lastAutoBackup();
    lines.push(b ? `💾 Архив: ${new Date(b.createdAt).toLocaleString('bg-BG', { timeZone: 'Europe/Sofia' })} (${Math.round(b.size / 1024)} KB, общо ${b.count})` : '💾 Архив: още няма ежедневен');
    const unc = await database.getQuery(`SELECT COUNT(*) AS n FROM transactions WHERE category_id IS NULL AND account_id <> 'CASH' AND transaction_date >= date('now', '-30 days')`);
    lines.push(`❔ Без категория (30 дни): ${unc.n}`);
    return lines.join('\n');
}

async function handleMessage(message) {
    const chatId = String(message.chat.id);
    const text = (message.text || '').trim();
    const pairedChat = await database.getSetting('telegram.chatId');

    // Свързване: /start <код от Настройки>
    const start = /^\/start(?:@\w+)?\s+(\S+)/.exec(text);
    if (start) {
        const code = await database.getSetting('telegram.pairCode');
        if (code && start[1] === code) {
            const name = [message.chat.first_name, message.chat.last_name].filter(Boolean).join(' ') || message.chat.username || chatId;
            await database.setSetting('telegram.chatId', chatId);
            await database.setSetting('telegram.chatName', name);
            await database.setSetting('telegram.pairCode', null);
            // created_at в базата е UTC „YYYY-MM-DD HH:MM:SS“
            await database.setSetting('telegram.since', new Date().toISOString().replace('T', ' ').slice(0, 19));
            logger.info(`[Telegram] Paired with chat ${chatId} (${name})`);
            return call('sendMessage', { chat_id: chatId, text: `✅ Свързано, ${escapeHtml(name)}!\n\n${HELP}`, parse_mode: 'HTML' });
        }
    }
    if (chatId !== pairedChat) {
        // Непознат чат — само кратък отговор, без данни
        if (/^\/start/.test(text)) {
            return call('sendMessage', { chat_id: chatId, text: 'Този бот е личен. За свързване въведете кода от Настройки → Telegram: /start <код>' });
        }
        return null;
    }

    // Отговор на известие → бележка към транзакцията
    if (message.reply_to_message && text && !text.startsWith('/')) {
        const notification = await database.getQuery('SELECT * FROM telegram_notifications WHERE chat_id = ? AND message_id = ?',
            [chatId, message.reply_to_message.message_id]);
        const tx = notification && await getTransaction(notification.transaction_id);
        if (!tx) return sendMessage('Не намерих транзакцията за това съобщение.');
        const notes = tx.notes ? `${tx.notes}\n${text}` : text;
        await database.updateTransactionNotes(tx.id, notes);
        return sendMessage(`📝 Бележката е записана към ${escapeHtml(formatAmount(tx.amount))} · ${escapeHtml(tx.counterparty_name || tx.description || '')}`,
            { reply_to_message_id: message.message_id });
    }

    if (/^\/status/.test(text)) return sendMessage(await statusText());
    if (/^\/pending/.test(text)) return sendPending();
    return sendMessage(HELP);
}

// ─── Polling ────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function pollLoop(generation) {
    const alive = () => state.running && state.generation === generation;
    while (alive()) {
        try {
            const offset = Number(await database.getSetting('telegram.offset', '0')) || undefined;
            const updates = await call('getUpdates', { offset, timeout: POLL_TIMEOUT_S, allowed_updates: ['message', 'callback_query'] },
                { timeout: (POLL_TIMEOUT_S + 10) * 1000 });
            state.lastError = null;
            if (!alive()) break;
            for (const update of updates) {
                await database.setSetting('telegram.offset', update.update_id + 1);
                try {
                    if (update.callback_query) await handleCallback(update.callback_query);
                    else if (update.message) await handleMessage(update.message);
                } catch (error) {
                    logger.error('[Telegram] Update handling failed:', error.message);
                }
            }
        } catch (error) {
            if (!alive()) break;
            state.lastError = error.message;
            if (error.status === 401 || error.status === 404) {
                logger.error('[Telegram] Invalid bot token — polling stopped');
                state.running = false;
                break;
            }
            // 409: друга инстанция чете същия бот (напр. копие на приложението на друг компютър)
            const wait = error.status === 409 ? 60000 : 10000;
            logger.warn(`[Telegram] Polling error (${error.status || 'network'}): ${error.message} — retry in ${wait / 1000}s`);
            await sleep(wait);
        }
    }
}

async function start() {
    stop();
    const token = await database.getSetting('telegram.token');
    const enabled = (await database.getSetting('telegram.enabled', '1')) === '1';
    if (!token || !enabled) return false;
    try {
        state.bot = await call('getMe', {}, { token });
    } catch (error) {
        state.lastError = error.message;
        logger.error('[Telegram] getMe failed:', error.message);
        return false;
    }
    state.token = token;
    state.running = true;
    state.lastError = null;
    state.generation++;
    logger.info(`[Telegram] Bot @${state.bot.username} started`);
    pollLoop(state.generation);
    return true;
}

function stop() {
    state.running = false;
    state.generation++;
}

async function createPairCode() {
    const code = String(crypto.randomInt(100000, 1000000));
    await database.setSetting('telegram.pairCode', code);
    return code;
}

async function getStatus() {
    return {
        configured: !!(await database.getSetting('telegram.token')),
        enabled: (await database.getSetting('telegram.enabled', '1')) === '1',
        running: state.running,
        bot: state.bot ? { username: state.bot.username, name: state.bot.first_name } : null,
        chatId: await database.getSetting('telegram.chatId'),
        chatName: await database.getSetting('telegram.chatName'),
        pairCode: await database.getSetting('telegram.pairCode'),
        quietFrom: await database.getSetting('telegram.quietFrom', '22:30'),
        quietTo: await database.getSetting('telegram.quietTo', '07:00'),
        lastError: state.lastError
    };
}

module.exports = {
    start,
    stop,
    getStatus,
    createPairCode,
    notifyNewTransactions,
    sendPending,
    sendAlert,
    sendMessage,
    // за тестове
    _internal: { transactionText, suggestCategories, mainKeyboard, moreKeyboard, handleCallback, handleMessage, state, call }
};
