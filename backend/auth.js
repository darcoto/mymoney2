/**
 * Парола за уеб достъпа (без потребители). Хешът (scrypt) е в app_settings → пътува с базата;
 * без парола достъпът е свободен. Сесия — подписана бисквитка (HMAC) за 30 дни; смяната на
 * паролата прекратява всички сесии (подписът включва хеша).
 *
 * Забравена парола: node bin/set-password.js <нова>   (или --off)
 */

const crypto = require('crypto');
const express = require('express');
const database = require('./database');
const logger = require('./logger');

const COOKIE = 'mm_session';
const SESSION_DAYS = 30;
const MAX_FAILURES = 5;
const BLOCK_MINUTES = 15;
const CACHE_MS = 5000;
// Без вход: страницата за вход, самият вход, проверката дали има парола
const PUBLIC_PATHS = new Set(['/login.html', '/api/login', '/api/session', '/api/health']);

// ─── Парола ─────────────────────────────────────────────────────────────────

function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(String(password), salt, 32);
    return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
    const [scheme, saltHex, hashHex] = String(stored || '').split('$');
    if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), expected.length);
    return crypto.timingSafeEqual(actual, expected);
}

let cache = { at: 0, hash: null, secret: null };

async function loadAuthSettings() {
    if (Date.now() - cache.at < CACHE_MS) return cache;
    let secret = await database.getSetting('auth.secret');
    if (!secret) {
        secret = crypto.randomBytes(32).toString('hex');
        await database.setSetting('auth.secret', secret);
    }
    cache = { at: Date.now(), hash: (await database.getSetting('auth.passwordHash')) || null, secret };
    return cache;
}

async function setPassword(password) {
    await database.setSetting('auth.passwordHash', password ? hashPassword(password) : '');
    cache.at = 0;
}

// ─── Сесия (бисквитка) ──────────────────────────────────────────────────────

function sign(expires, { hash, secret }) {
    return crypto.createHmac('sha256', secret).update(`${expires}.${hash}`).digest('hex');
}

function readCookie(req, name) {
    const header = req.headers.cookie || '';
    for (const part of header.split(';')) {
        const [key, ...rest] = part.trim().split('=');
        if (key === name) return decodeURIComponent(rest.join('='));
    }
    return null;
}

function isValidSession(req, auth) {
    const [expiresText, signature] = String(readCookie(req, COOKIE) || '').split('.');
    const expires = Number(expiresText);
    if (!expires || expires < Date.now() || !signature) return false;
    const expected = sign(expires, auth);
    return signature.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

function setSessionCookie(req, res, auth) {
    const expires = Date.now() + SESSION_DAYS * 24 * 3600 * 1000;
    const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
    res.setHeader('Set-Cookie', `${COOKIE}=${expires}.${sign(expires, auth)}; Path=/; HttpOnly; SameSite=Lax; ` +
        `Max-Age=${SESSION_DAYS * 24 * 3600}${secure ? '; Secure' : ''}`);
}

function clearSessionCookie(res) {
    res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

// ─── Защита от налучкване: 5 грешни опита → 15 минути блокиране (по IP) ─────────

const failures = new Map(); // ip → { count, blockedUntil }

function blockedFor(ip) {
    const entry = failures.get(ip);
    return entry && entry.blockedUntil > Date.now() ? Math.ceil((entry.blockedUntil - Date.now()) / 60000) : 0;
}

function recordFailure(ip) {
    const entry = failures.get(ip) || { count: 0, blockedUntil: 0 };
    entry.count += 1;
    if (entry.count >= MAX_FAILURES) {
        entry.blockedUntil = Date.now() + BLOCK_MINUTES * 60000;
        entry.count = 0;
        logger.warn(`[Auth] ${ip}: ${MAX_FAILURES} грешни пароли — блокиран за ${BLOCK_MINUTES} мин.`);
    }
    failures.set(ip, entry);
}

// ─── Middleware и маршрути ──────────────────────────────────────────────────

async function middleware(req, res, next) {
    if (PUBLIC_PATHS.has(req.path)) return next();
    let auth;
    try {
        auth = await loadAuthSettings();
    } catch (error) {
        // Базата още не е готова (стартиране) — по-добре отказ, отколкото отворен достъп
        return res.status(503).json({ error: 'Приложението стартира — опитайте след малко' });
    }
    if (!auth.hash || isValidSession(req, auth)) return next();

    if (req.path.startsWith('/api/')) {
        return res.status(401).json({ error: 'Нужен е вход' });
    }
    if (req.method === 'GET') {
        return res.redirect(`/login.html?next=${encodeURIComponent(req.originalUrl)}`);
    }
    return res.status(401).end();
}

const router = express.Router();

router.get('/session', async (req, res) => {
    const auth = await loadAuthSettings();
    res.json({ enabled: !!auth.hash, authenticated: !auth.hash || isValidSession(req, auth) });
});

router.post('/login', async (req, res) => {
    const ip = req.ip;
    const minutes = blockedFor(ip);
    if (minutes) {
        return res.status(429).json({ error: `Твърде много грешни опити — опитайте след ${minutes} мин.` });
    }
    const auth = await loadAuthSettings();
    if (!auth.hash) return res.json({ ok: true });
    if (!verifyPassword(req.body && req.body.password, auth.hash)) {
        recordFailure(ip);
        await new Promise(resolve => setTimeout(resolve, 500));
        return res.status(401).json({ error: 'Грешна парола' });
    }
    failures.delete(ip);
    setSessionCookie(req, res, auth);
    logger.info(`[Auth] Вход от ${ip}`);
    res.json({ ok: true });
});

router.post('/logout', (req, res) => {
    clearSessionCookie(res);
    res.json({ ok: true });
});

// Смяна (или махане) на паролата — минава през middleware, т.е. иска вход
router.put('/password', async (req, res) => {
    const { current, password } = req.body || {};
    const auth = await loadAuthSettings();
    if (auth.hash && !verifyPassword(current, auth.hash)) {
        return res.status(400).json({ error: 'Текущата парола е грешна' });
    }
    if (password && String(password).length < 8) {
        return res.status(400).json({ error: 'Паролата трябва да е поне 8 знака' });
    }
    await setPassword(password || null);
    logger.info(`[Auth] Паролата е ${password ? 'сменена' : 'махната'}`);
    if (password) setSessionCookie(req, res, await loadAuthSettings());
    res.json({ ok: true, enabled: !!password });
});

module.exports = { middleware, router, setPassword, hashPassword, verifyPassword };
