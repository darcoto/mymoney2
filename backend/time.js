/**
 * Местно време на потребителя — графикът и тихите часове не зависят от часовата зона на сървъра
 */

const TIME_ZONE = process.env.TZ_APP || 'Europe/Sofia';

function zonedNow(date = new Date(), timeZone = TIME_ZONE) {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit'
    }).formatToParts(date).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
    return {
        date: `${parts.year}-${parts.month}-${parts.day}`,
        time: `${parts.hour}:${parts.minute}`,
        minutes: Number(parts.hour) * 60 + Number(parts.minute)
    };
}

/** „07:00, 12:00“ → ['07:00', '12:00'] (валидни, сортирани, без повторения) */
function parseTimes(text) {
    const times = String(text || '')
        .split(/[\s,;]+/)
        .map(t => t.trim())
        .filter(Boolean)
        .map(t => {
            const m = /^(\d{1,2}):(\d{2})$/.exec(t);
            if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
            return `${m[1].padStart(2, '0')}:${m[2]}`;
        });
    if (times.some(t => t === null)) return null;
    return [...new Set(times)].sort();
}

function toMinutes(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
}

/** Дали `now` (минути от полунощ) е в интервала [from, to) — интервалът може да минава през полунощ */
function inRange(now, from, to) {
    const a = toMinutes(from);
    const b = toMinutes(to);
    return a <= b ? now >= a && now < b : now >= a || now < b;
}

module.exports = { TIME_ZONE, zonedNow, parseTimes, toMinutes, inRange };
