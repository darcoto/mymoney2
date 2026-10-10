/**
 * Четим текст за транзакция в Telegram: чисто име на търговеца, място (флаг + град), дата и час
 * на покупката, кратко име на сметката/картата, сума в чуждата валута, бележка от основанието.
 * Само форматиране — без заявки към Telegram.
 */

const countryUtils = require('./country-codes');

const BG_CITIES = {
    'SOFIA': 'София', 'SOFIYA': 'София', 'SOFIJA': 'София', 'SOF': 'София', 'VARNA': 'Варна', 'PLOVDIV': 'Пловдив',
    'BURGAS': 'Бургас', 'RUSE': 'Русе', 'STARA ZAGORA': 'Стара Загора', 'PLEVEN': 'Плевен', 'BLAGOEVGRAD': 'Благоевград',
    'BANSKO': 'Банско', 'PRIMORSKO': 'Приморско', 'TSAREVO': 'Царево', 'SOZOPOL': 'Созопол', 'NESEBAR': 'Несебър',
    'KYUSTENDIL': 'Кюстендил', 'SHUMEN': 'Шумен', 'GABROVO': 'Габрово', 'YAMBOL': 'Ямбол', 'VELINGRAD': 'Велинград',
    'PAMPOROVO': 'Пампорово', 'SMOLYAN': 'Смолян', 'VELIKO TARNOVO': 'Велико Търново', 'PERNIK': 'Перник',
    'HASKOVO': 'Хасково', 'DOBRICH': 'Добрич', 'SLIVEN': 'Сливен', 'KAZANLAK': 'Казанлък', 'SAMOKOV': 'Самоков',
    'BOROVETS': 'Боровец', 'POMORIE': 'Поморие', 'SL BRYAG': 'Слънчев бряг', 'MOMCHILOVTSI': 'Момчиловци',
    'PERUSHTITSA': 'Перущица', 'HADZHIDIMITRO': 'Хаджидимитрово', 'DINKATA': 'Динката'
};
const NOT_A_CITY = /^(PAYPAL|GOOGLE|APPLE|AMAZON|AMZN|NO|PP|HELPPAY|G|WWW)$/i;
const LEGAL_FORM = /\b(EOOD|OOD|EAD|AD|ЕООД|ООД|ЕАД|АД|LTD|LLC|GMBH|SRL|SAS|SPA|INC|LIMITED|S\s?L|S\s?A)\b\.?/gi;
const STREET = /\s(UL|BUL|JK|ZH\.?K|PL|KV)\.?\s.*$/i;

function escapeHtml(text) {
    return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** „BGR SOFIA COSTA“ → „Costa“; оставя смесения регистър („Tidal“), къси латински съкращения (OMV, KFC) */
function titleCase(text) {
    const value = String(text || '').replace(/\s+/g, ' ').trim();
    if (!value || /[a-zа-я]/.test(value)) return value;
    return value.split(' ').map(word => {
        if (/^[A-Z0-9&]{1,3}$/.test(word)) return word;
        return word.charAt(0) + word.slice(1).toLowerCase();
    }).join(' ');
}

/**
 * Място и име от контрагента на картово плащане: „BGR SOFIYA HLEBAR SHISHMAN UL TSAR IVAN“
 * → { flag: 🇧🇬, city: 'София', merchant: 'Hlebar Shishman' }
 */
function parseCardCounterparty(counterparty) {
    const m = /^([A-Z]{3})\s+(.+)$/.exec(String(counterparty || '').trim());
    if (!m) return null;
    const info = countryUtils.getCountryInfo(m[1]);
    if (!info) return null;

    let tokens = m[2].split(/\s+/).filter(t => t && !/^\d+$/.test(t));
    if (tokens[0] && /^GR$/i.test(tokens[0])) tokens = tokens.slice(1);

    const english = String((countryUtils.COUNTRY_CODES[m[1]] || {}).name || '').toUpperCase();
    let city = null;
    const two = tokens.slice(0, 2).join(' ').toUpperCase();
    const one = (tokens[0] || '').toUpperCase();
    if (BG_CITIES[two]) {
        city = BG_CITIES[two];
        tokens = tokens.slice(2);
    } else if (BG_CITIES[one]) {
        city = BG_CITIES[one];
        tokens = tokens.slice(1);
    } else if (m[1] !== 'BGR' && tokens.length > 1 && !NOT_A_CITY.test(one) && /^[A-Za-zÀ-ž.-]+$/.test(tokens[0])
               && one !== english) {
        city = titleCase(tokens[0].toUpperCase());
        tokens = tokens.slice(1);
    } else if (one && one === english) {
        tokens = tokens.slice(1); // „IRL IRELAND GOOGLE“ — името на държавата не е град
    }

    // Без номера на обекти/терминали (EUO2604050845, S563) и повторени думи („GOOGLE GOOGLE ONE“)
    tokens = tokens.filter(t => !/\d{3,}/.test(t))
        .filter((t, i, list) => i === 0 || t.toUpperCase() !== list[i - 1].toUpperCase());
    let merchant = tokens.join(' ').replace(STREET, '').replace(LEGAL_FORM, '').replace(/\s+/g, ' ').trim();
    if (!merchant) merchant = m[2];
    return { code: m[1], flag: info.flag || '', country: info.name, city, merchant: titleCase(merchant) };
}

/** Карта и момент на покупката от описанието: „400915xxxxxx1234 ПЛАЩАНЕ НА ПОС 10.10.2026 09:12“ */
function parseCardDescription(description) {
    const text = String(description || '');
    const card = /^\d{6}x{6}(\d{4})/i.exec(text);
    const when = /(\d{2})\.?(\d{2})\.?(20\d{2}) (\d{2}):(\d{2})/.exec(text);
    // Сума в чужда валута: „ПЛАЩАНЕ НА ПОС 18.00 CHF 13082026“ / „С 25.11 USD“
    const fx = /\s(\d+(?:\.\d{1,2})?) ([A-Z]{3})\b/.exec(text);
    return {
        isCard: !!card,
        cardLast4: card ? card[1] : null,
        date: when ? `${when[3]}-${when[2]}-${when[1]}` : null,
        time: when ? `${when[4]}:${when[5]}` : null,
        foreign: fx && !['EUR', 'BGN'].includes(fx[2]) ? { amount: Number(fx[1]), currency: fx[2] } : null
    };
}

/** Бележка от основанието: „From Ivan P Супа,обяд“ → „Супа,обяд“; шумът от банката — null */
function usefulNote(tx) {
    const description = String(tx.description || '').replace(/\s+/g, ' ').trim();
    if (!description || /^\d{6}x{6}\d{4}/i.test(description)) return null;
    if (/^(ПРЕВОД|ПЛАЩАНЕ|PAYMENT|ПОКУПКА|ПРЕВОД P2P.*)$/i.test(description)) return null;
    const cp = String(tx.counterparty_name || '').toUpperCase();
    if (description.toUpperCase() === cp) return null;

    // „To/From <име> <бележка>“ (Revolut, преводи) — името се маха, остава бележката
    const prefix = /^(To|From|Превод към|Превод от|Превод до|Payment from)\s+/i;
    let rest = description;
    if (prefix.test(description)) {
        const cpWords = new Set(cp.split(/\s+/).filter(Boolean));
        const words = description.replace(prefix, '').split(' ');
        let i = 0;
        while (i < words.length && (cpWords.has(words[i].toUpperCase()) || /^[A-ZА-Я]{2,}$/.test(words[i]) || /^[A-Z]$/.test(words[i]))) i++;
        rest = words.slice(i).join(' ');
    } else if (/^(Top-Up|Допълване|Exchanged|Обменено|Revolut Vault)/i.test(description)) {
        return null;
    }
    rest = rest
        .replace(/\s*(КЪМ|ОТ|TO|FROM)\s+[A-Z]{2}-\d+/gi, '')   // „наем КЪМ AC-0000000000001234“
        .replace(/\b[A-Z0-9]*\d{6,}[A-Z0-9]*\b/g, '')           // дълги номера (ISI2404260029257)
        .replace(/\s+/g, ' ').trim();
    if (rest.length < 2 || rest.toUpperCase() === cp) return null;
    // Само главни букви (основания от ДСК) → нормален регистър
    if (!/[a-zа-я]/.test(rest)) rest = rest.charAt(0) + rest.slice(1).toLowerCase();
    return rest.slice(0, 160);
}

function accountShortName(tx) {
    const custom = tx.account_custom_name;
    let name = custom || tx.account_name || '';
    if (/^[A-Z]{2}\d{2}[A-Z0-9]{10,}$/.test(name.replace(/\s/g, ''))) name = 'Revolut';
    if (!custom) {
        // „КРЕДИТНА КАРТА - EUR“ → „Кредитна карта“
        name = name.replace(/\s*-\s*(EUR|BGN|USD)\s*$/i, '');
        if (!/[a-zа-я]/.test(name)) name = name.charAt(0) + name.slice(1).toLowerCase();
    }
    return name;
}

function formatMoney(amount, currency = '€') {
    const abs = Math.abs(amount).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return `${amount < 0 ? '−' : '+'}${abs} ${currency}`;
}

function ordinal(n) {
    const tail = n % 100;
    if (n % 10 === 1 && tail !== 11) return `${n}-во`;
    if (n % 10 === 2 && tail !== 12) return `${n}-ро`;
    if ((n % 10 === 7 || n % 10 === 8) && tail !== 17 && tail !== 18) return `${n}-мо`;
    return `${n}-то`;
}

function emojiOf(category) {
    return category && category.icon && /\p{Extended_Pictographic}/u.test(category.icon) ? category.icon : '';
}

function categoryLabel(category) {
    if (!category) return '';
    const emoji = emojiOf(category);
    return `${emoji ? `${emoji} ` : ''}${category.name}`;
}

/**
 * Всичко за показване на транзакция
 * @param {object} tx — ред от TX_SELECT (с account_* и category_*)
 * @param {{ alias?: string }} extra
 */
function describe(tx, { alias = null } = {}) {
    const place = parseCardCounterparty(tx.counterparty_name);
    const card = parseCardDescription(tx.description);
    const merchant = alias || (place && place.merchant) || titleCase(tx.counterparty_name) || titleCase(tx.description) || '—';

    // Сума: в чуждата валута първо, ако има
    let amountText = `<b>${formatMoney(tx.amount)}</b>`;
    const foreign = (tx.original_currency && !['EUR', 'BGN'].includes(tx.original_currency) && tx.original_amount)
        ? { amount: Math.abs(tx.original_amount), currency: tx.original_currency }
        : card.foreign;
    if (foreign) {
        amountText = `<b>${formatMoney(tx.amount < 0 ? -foreign.amount : foreign.amount, foreign.currency)}</b> (${formatMoney(tx.amount)})`;
    }

    const date = card.date || tx.transaction_date;
    const [, mm, dd] = date.split('-');
    const whenText = `${dd}.${mm}${card.time ? ` в ${card.time}` : ''}`;
    const where = place ? `${place.flag} ${escapeHtml(place.city || place.country)}`.trim() : null;
    const account = card.isCard
        ? `💳 ${escapeHtml(accountShortName(tx))} …${card.cardLast4}`
        : `🏦 ${escapeHtml(accountShortName(tx))}`;

    return {
        merchant,
        amountText,
        icon: tx.amount < 0 ? '🔴' : '🟢',
        metaLine: [where, whenText, account].filter(Boolean).join(' · '),
        note: usefulNote(tx)
    };
}

module.exports = {
    describe,
    titleCase,
    parseCardCounterparty,
    parseCardDescription,
    usefulNote,
    formatMoney,
    ordinal,
    emojiOf,
    categoryLabel,
    escapeHtml
};
