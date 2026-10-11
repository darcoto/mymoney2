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
const fmt = require('./telegram-format');

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

const escapeHtml = fmt.escapeHtml;

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

async function getAlias(tx) {
    if (!tx.counterparty_name) return null;
    const row = await database.getQuery('SELECT display_name FROM counterparty_aliases WHERE original_name = ?', [tx.counterparty_name]);
    return row ? row.display_name : null;
}

function monthStart() {
    return `${zonedNow().date.slice(0, 7)}-01`;
}

/**
 * Ред с контекст: кое поредно плащане при същия търговец е този месец, иначе колко е дадено в категорията
 */
async function contextLine(tx, merchant, category) {
    const from = monthStart();
    if (tx.counterparty_name) {
        const same = await database.getQuery(`SELECT COUNT(*) AS n FROM transactions
            WHERE counterparty_name = ? AND transaction_date >= ? AND transaction_date <= ? AND (amount < 0) = ?`,
            [tx.counterparty_name, from, tx.transaction_date, tx.amount < 0 ? 1 : 0]);
        if (same.n >= 2) return `🔁 ${fmt.ordinal(same.n)} ${tx.amount < 0 ? 'плащане при' : 'постъпление от'} ${fmt.escapeHtml(merchant)} този месец`;
    }
    if (category && tx.amount < 0) {
        const sum = await database.getQuery(`SELECT COUNT(*) AS n, -SUM(amount) AS s FROM transactions
            WHERE category_id = ? AND transaction_date >= ? AND amount < 0`, [category.id, from]);
        if (sum.n > 0) return `${fmt.escapeHtml(fmt.categoryLabel(category))} този месец: ${Math.round(sum.s)} € (${sum.n}×)`;
    }
    return null;
}

/** Подсказката за бележка — в първото съобщение за деня */
async function noteHint() {
    const today = zonedNow().date;
    if ((await database.getSetting('telegram.hintDate')) === today) return null;
    await database.setSetting('telegram.hintDate', today);
    return '<i>💬 Отговорете с текст на съобщението, за да добавите бележка</i>';
}

/** Пълното съобщение за транзакция (за избор на категория) */
async function transactionText(tx, { suggestions = null, withHint = false } = {}) {
    const d = fmt.describe(tx, { alias: await getAlias(tx) });
    const categories = await database.getAllCategories();
    const current = tx.category_id ? categories.find(c => c.id === tx.category_id) : null;
    const lines = [
        `${d.icon} ${d.amountText}   <b>${fmt.escapeHtml(d.merchant)}</b>`,
        d.metaLine
    ];
    if (d.note) lines.push(`💬 <i>${fmt.escapeHtml(d.note)}</i>`);
    lines.push('');
    const status = current ? `🏷️ ${fmt.escapeHtml(fmt.categoryLabel(current))} <i>(автоматично)</i>` : '❔ Без категория';
    // Контекст по категория — само за сигурна (зададена, от правило или от историята на търговеца)
    const likely = suggestions && suggestions[0] && suggestions[0].confident ? suggestions[0].category : null;
    const context = await contextLine(tx, d.merchant, current || likely);
    lines.push(context ? `${status}  ·  ${context}` : status);
    if (withHint) {
        const hint = await noteHint();
        if (hint) lines.push('', hint);
    }
    return lines.join('\n');
}

/** Кратко съобщение след избор: „✅ ☕ Кофис · −4,10 € · Costa“ */
async function compactText(tx, prefix, extraLine = null) {
    const d = fmt.describe(tx, { alias: await getAlias(tx) });
    const lines = [`${prefix} · ${d.amountText} · ${fmt.escapeHtml(d.merchant)}`];
    if (extraLine) lines.push(extraLine);
    return lines.join('\n');
}

/**
 * Най-вероятните категории: правило → история на същия контрагент → най-честите напоследък
 * (за същата посока — плащане или постъпление). confident — от правило или история.
 */
async function suggestCategories(tx, limit = SUGGESTIONS) {
    const found = [];
    const add = (id, confident) => {
        if (id && id !== tx.category_id && !found.some(f => f.id === id)) found.push({ id, confident });
    };

    categorization.clearRulesCache();
    const ruleMatches = await categorization.getSuggestions({ description: tx.description, counterpartyName: tx.counterparty_name });
    categorization.clearRulesCache();
    ruleMatches.forEach(s => add(s.categoryId, true));

    const negative = tx.amount < 0 ? 1 : 0;
    if (tx.counterparty_name) {
        const history = await database.allQuery(`
            SELECT category_id, COUNT(*) AS n FROM transactions
            WHERE counterparty_name = ? AND category_id IS NOT NULL AND id <> ? AND (amount < 0) = ?
            GROUP BY category_id ORDER BY n DESC LIMIT 4`, [tx.counterparty_name, tx.id, negative]);
        history.forEach(h => add(h.category_id, true));
    }
    // Най-честите напоследък — без категориите за преводи (те идват само от правило/история)
    const recent = await database.allQuery(`
        SELECT t.category_id, COUNT(*) AS n FROM transactions t JOIN categories c ON c.id = t.category_id
        WHERE t.transaction_date >= date('now', '-120 days') AND (t.amount < 0) = ? AND c.type <> 'transfer'
        GROUP BY t.category_id ORDER BY n DESC LIMIT 12`, [negative]);
    recent.forEach(r => add(r.category_id, false));

    // Групите не се предлагат — транзакцията отива в подкатегория
    const categories = await database.getAllCategories();
    const groups = childrenByGroup(categories);
    return found
        .map(f => ({ category: categories.find(c => c.id === f.id), confident: f.confident }))
        .filter(f => f.category && !groups.has(f.category.id))
        .slice(0, limit);
}

/** Групите на категориите (id на група → подкатегориите ѝ) */
function childrenByGroup(categories) {
    const map = new Map();
    categories.filter(c => c.parent_id).forEach(c => {
        if (!map.has(c.parent_id)) map.set(c.parent_id, []);
        map.get(c.parent_id).push(c);
    });
    return map;
}

/**
 * Категориите на едно ниво — най-използваните за тази посока първи.
 * parentId: null — горното ниво (групите и самостоятелните), иначе подкатегориите на групата.
 */
async function categoriesSorted(tx, parentId = null) {
    const negative = tx.amount < 0 ? 1 : 0;
    const usage = await database.allQuery(`
        SELECT category_id, COUNT(*) AS n FROM transactions
        WHERE category_id IS NOT NULL AND (amount < 0) = ? GROUP BY category_id`, [negative]);
    const count = new Map(usage.map(u => [u.category_id, u.n]));
    const categories = await database.getAllCategories();
    const children = childrenByGroup(categories);
    // Използването на група — сборът на подкатегориите ѝ
    const used = c => (count.get(c.id) || 0) + (children.get(c.id) || []).reduce((s, ch) => s + (count.get(ch.id) || 0), 0);
    return categories
        .filter(c => (c.parent_id || null) === parentId)
        .map(c => ({ ...c, isGroup: children.has(c.id) }))
        .sort((a, b) => used(b) - used(a) || a.name.localeCompare(b.name, 'bg'));
}

function categoryButton(nid, category, star = false) {
    return { text: `${star ? '⭐ ' : ''}${fmt.categoryLabel(category)}`, callback_data: `c:${nid}:${category.id}` };
}

async function mainKeyboard(nid, tx, suggestions = null) {
    const list = suggestions || await suggestCategories(tx);
    const rows = [];
    if (tx.category_id) {
        const current = (await database.getAllCategories()).find(c => c.id === tx.category_id);
        if (current) rows.push([{ text: `✓ ${fmt.categoryLabel(current)} — вярно`, callback_data: `k:${nid}` }]);
    }
    const buttons = list.map((s, i) => categoryButton(nid, s.category, i === 0 && s.confident && !tx.category_id));
    for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
    rows.push([{ text: '📂 Всички категории', callback_data: `m:${nid}:0` }, { text: '⏭ По-късно', callback_data: `s:${nid}` }]);
    return { inline_keyboard: rows };
}

// Група → бутон, който отваря подкатегориите ѝ
function groupButton(nid, group) {
    return { text: `${fmt.categoryLabel(group)} ›`, callback_data: `g:${nid}:${group.id}` };
}

/** „Всички категории“: групите и самостоятелните категории, на страници */
async function moreKeyboard(nid, tx, page) {
    const all = (await categoriesSorted(tx)).filter(c => c.id !== tx.category_id);
    const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
    const p = Math.min(Math.max(page, 0), pages - 1);
    const items = all.slice(p * PAGE_SIZE, (p + 1) * PAGE_SIZE);
    const rows = [];
    for (let i = 0; i < items.length; i += 2) {
        rows.push(items.slice(i, i + 2).map(c => c.isGroup ? groupButton(nid, c) : categoryButton(nid, c)));
    }
    const nav = [];
    if (p > 0) nav.push({ text: '◀', callback_data: `m:${nid}:${p - 1}` });
    nav.push({ text: `↩ Назад${pages > 1 ? ` (${p + 1}/${pages})` : ''}`, callback_data: `b:${nid}` });
    if (p < pages - 1) nav.push({ text: '▶', callback_data: `m:${nid}:${p + 1}` });
    rows.push(nav);
    return { inline_keyboard: rows };
}

/** Подкатегориите на група; „↩“ — обратно към групите */
async function groupKeyboard(nid, tx, groupId) {
    const items = (await categoriesSorted(tx, groupId)).filter(c => c.id !== tx.category_id);
    const rows = [];
    for (let i = 0; i < items.length; i += 2) {
        rows.push(items.slice(i, i + 2).map(c => categoryButton(nid, c)));
    }
    rows.push([{ text: '↩ Всички категории', callback_data: `m:${nid}:0` }]);
    return { inline_keyboard: rows };
}

async function fullMessage(nid, tx, { withHint = false } = {}) {
    const suggestions = await suggestCategories(tx);
    return {
        text: await transactionText(tx, { suggestions, withHint }),
        reply_markup: await mainKeyboard(nid, tx, suggestions)
    };
}

async function sendTransactionMessage(tx) {
    const chatId = await database.getSetting('telegram.chatId');
    await database.runQuery(
        `INSERT INTO telegram_notifications (transaction_id, chat_id, status) VALUES (?, ?, 'pending')
         ON CONFLICT(transaction_id) DO UPDATE SET chat_id = excluded.chat_id, status = 'pending', handled_at = NULL`,
        [tx.id, chatId]);
    const row = await database.getQuery('SELECT id FROM telegram_notifications WHERE transaction_id = ?', [tx.id]);
    const { text, reply_markup } = await fullMessage(row.id, tx, { withHint: true });
    const message = await sendMessage(text, { reply_markup });
    await database.runQuery('UPDATE telegram_notifications SET message_id = ?, status = ? WHERE id = ?',
        [message ? message.message_id : null, message ? 'sent' : 'failed', row.id]);
}

// ─── Правило „винаги този търговец → тази категория“ ────────────────────────

/** Шаблон за правило: чистото име на търговеца (≥ 4 знака) или целият контрагент */
function rulePattern(tx) {
    const place = fmt.parseCardCounterparty(tx.counterparty_name);
    const merchant = place ? place.merchant.toUpperCase() : '';
    if (merchant.replace(/[^A-ZА-Я0-9]/g, '').length >= 4) return merchant;
    const cp = String(tx.counterparty_name || '').replace(/\s+/g, ' ').trim().toUpperCase();
    return cp.replace(/[^A-ZА-Я0-9]/g, '').length >= 4 ? cp : null;
}

/** Дали да се предложи правило: има шаблон и никое правило още не хваща транзакцията */
async function canOfferRule(tx) {
    if (!rulePattern(tx)) return false;
    categorization.clearRulesCache();
    const matches = await categorization.getSuggestions({ description: tx.description, counterpartyName: tx.counterparty_name });
    categorization.clearRulesCache();
    return matches.length === 0;
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

async function editMessage(chatId, messageId, text, keyboard = null) {
    try {
        await call('editMessageText', {
            chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', disable_web_page_preview: true,
            reply_markup: keyboard || { inline_keyboard: [] }
        });
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
    const answer = text => call('answerCallbackQuery', { callback_query_id: query.id, ...(text ? { text } : {}) });
    const setStatus = status => database.runQuery(
        `UPDATE telegram_notifications SET status = ?, handled_at = ${status === 'sent' ? 'NULL' : 'CURRENT_TIMESTAMP'} WHERE id = ?`,
        [status, nid]);
    const edit = (text, keyboard = null) => editMessage(chatId, messageId, text, keyboard);
    const categories = await database.getAllCategories();

    // Кратко потвърждение с „✏️ Промени“ и (ако още няма правило) „🔁 Винаги …“
    const done = async (category, toast) => {
        const rows = [[{ text: '✏️ Промени', callback_data: `e:${nid}` }]];
        if (await canOfferRule(tx)) {
            const merchant = fmt.describe(tx, { alias: await getAlias(tx) }).merchant;
            rows.push([{ text: `🔁 Винаги „${merchant.slice(0, 24)}“ → ${fmt.categoryLabel(category)}`, callback_data: `r:${nid}:${category.id}` }]);
        }
        await edit(await compactText(tx, `✅ ${fmt.escapeHtml(fmt.categoryLabel(category))}`), { inline_keyboard: rows });
        return answer(toast);
    };

    switch (action) {
        case 'c': {
            const category = categories.find(c => c.id === Number(arg));
            if (!category) return answer('Няма такава категория');
            await database.updateTransactionCategory(tx.id, category.id);
            tx.category_id = category.id;
            await setStatus('categorized');
            logger.info(`[Telegram] ${tx.id} → category ${category.name}`);
            return done(category, `Записано: ${category.name}`);
        }
        case 'k': {
            const category = categories.find(c => c.id === tx.category_id);
            if (!category) return answer('Няма категория за потвърждение');
            await setStatus('confirmed');
            return done(category, 'Потвърдено');
        }
        case 's':
            await setStatus('skipped');
            await edit(await compactText(tx, '⏭ За по-късно'), { inline_keyboard: [[{ text: '🏷️ Категоризирай', callback_data: `e:${nid}` }]] });
            return answer('Ще остане в /pending');
        case 'e': {
            // Обратно към пълното съобщение с предложенията
            await setStatus('sent');
            const { text, reply_markup } = await fullMessage(nid, tx);
            await edit(text, reply_markup);
            return answer();
        }
        case 'r': {
            const category = categories.find(c => c.id === Number(arg));
            const pattern = rulePattern(tx);
            if (!category || !pattern) return answer('Не може да се създаде правило');
            const rules = await database.getAllCategorizationRules();
            if (!rules.some(r => r.pattern.toUpperCase() === pattern && r.category_id === category.id)) {
                await database.createCategorizationRule({ pattern, categoryId: category.id, priority: 15 });
            }
            // Останалите некатегоризирани от същия контрагент — веднага
            const others = tx.counterparty_name ? await database.categorizeByCounterparty(tx.counterparty_name, category.id) : 0;
            logger.info(`[Telegram] Rule ${pattern} → ${category.name} (+${others} uncategorized)`);
            await edit(await compactText(tx, `✅ ${fmt.escapeHtml(fmt.categoryLabel(category))}`,
                `🔁 Правило: <code>${fmt.escapeHtml(pattern)}</code> → ${fmt.escapeHtml(fmt.categoryLabel(category))}${others ? ` (+${others} некатегоризирани)` : ''}`),
                { inline_keyboard: [[{ text: '✏️ Промени', callback_data: `e:${nid}` }]] });
            return answer('Правилото е създадено');
        }
        case 'm':
            await call('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: await moreKeyboard(nid, tx, Number(arg) || 0) });
            return answer();
        case 'g':
            await call('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: await groupKeyboard(nid, tx, Number(arg)) });
            return answer();
        case 'b':
            await call('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: await mainKeyboard(nid, tx) });
            return answer();
        default:
            return answer();
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
        const d = fmt.describe(tx, { alias: await getAlias(tx) });
        return sendMessage(`📝 Бележката е записана към ${d.amountText} · ${fmt.escapeHtml(d.merchant)}`,
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
