// Настройки → „Автоматизация“ (синхронизация по график, ежедневен архив) и „Telegram“

const automationState = {
    bound: false,
    pairTimer: null
};

function formatDateTime(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('bg-BG', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function loadAutomationSettings() {
    bindAutomationEvents();
    await Promise.all([renderScheduleSettings(), renderTelegramSettings(), renderDebugSettings()]);
}

// ─── График ─────────────────────────────────────────────────────────────────

async function renderScheduleSettings() {
    const container = document.getElementById('automationSettings');
    try {
        const s = await api.getSchedule();
        const last = s.lastSync;
        const lastText = last
            ? `${formatDateTime(last.finishedAt || last.startedAt)} (${last.trigger === 'schedule' ? 'по график' : 'ръчно'}) — ${last.transactionsSynced} нови${last.errors && last.errors.length ? `, <span class="negative">${last.errors.length} грешки</span>` : ''}`
            : 'още не е правена';
        const backup = s.lastBackup
            ? `${formatDateTime(s.lastBackup.createdAt)} — ${Math.round(s.lastBackup.size / 1024)} KB (общо ${s.lastBackup.count})`
            : 'още няма';

        container.innerHTML = `
            <div class="automation-row">
                <label class="check-label">
                    <input type="checkbox" id="scheduleSyncEnabled" ${s.syncEnabled ? 'checked' : ''}>
                    <span><strong>Синхронизация по график</strong></span>
                </label>
                <input type="text" id="scheduleSyncTimes" class="input automation-times" value="${escapeHtml(s.syncTimes.join(', '))}" placeholder="07:00, 12:00, 17:00, 22:00">
            </div>
            <p class="text-muted automation-hint">
                До 4 пъти на ден — банката (GoCardless) позволява около 4 заявки на ден за сметка; ръчна синхронизация в същия ден може да получи отказ.
                Включете само на сървъра, който работи постоянно.<br>
                Последна: ${lastText}${s.nextSync ? ` · Следваща: ${escapeHtml(s.nextSync)}` : ''}
            </p>
            <div class="automation-row">
                <label class="check-label">
                    <input type="checkbox" id="scheduleBackupEnabled" ${s.backupEnabled ? 'checked' : ''}>
                    <span><strong>Ежедневен архив</strong> в</span>
                </label>
                <input type="text" id="scheduleBackupTime" class="input automation-time" value="${escapeHtml(s.backupTime)}" placeholder="03:00">
            </div>
            <p class="text-muted automation-hint">
                Пазят се последните ${s.keepDaily} дневни и по един за месец за ${s.keepMonthly} месеца (data/backups).<br>
                Последен: ${backup}
            </p>
            <p class="text-muted automation-hint">Часовете са по ${escapeHtml(s.timeZone)} (сега ${escapeHtml(s.serverTime.slice(11))}).</p>
            <button class="btn btn-primary" data-auto-action="save-schedule">Запази</button>
        `;
    } catch (error) {
        container.innerHTML = `<p class="negative">Грешка при зареждане: ${escapeHtml(error.message)}</p>`;
    }
}

async function saveSchedule() {
    try {
        await api.updateSchedule({
            syncEnabled: document.getElementById('scheduleSyncEnabled').checked,
            syncTimes: document.getElementById('scheduleSyncTimes').value,
            backupEnabled: document.getElementById('scheduleBackupEnabled').checked,
            backupTime: document.getElementById('scheduleBackupTime').value
        });
        showNotification('Графикът е запазен', 'success');
        renderScheduleSettings();
    } catch (error) {
        showNotification(error.message, 'error');
    }
}

// ─── Telegram ───────────────────────────────────────────────────────────────

async function renderTelegramSettings() {
    const container = document.getElementById('telegramSettings');
    try {
        const t = await api.getTelegramStatus();

        if (!t.configured) {
            container.innerHTML = `
                <p>Известие за всяка нова транзакция с бутони за категория — категоризирате още докато помните за какво е.</p>
                <ol class="telegram-steps">
                    <li>В Telegram отворете <a href="https://t.me/BotFather" target="_blank" rel="noopener">@BotFather</a> и изпратете <code>/newbot</code> — изберете име (напр. „MyMoney“) и потребителско име, завършващо на „bot“.</li>
                    <li>Копирайте token-а, който BotFather връща (вид <code>123456789:AA...</code>), и го поставете тук.</li>
                </ol>
                <div class="automation-row">
                    <input type="password" id="telegramToken" class="input automation-token" placeholder="Token на бота" autocomplete="off">
                    <button class="btn btn-primary" data-auto-action="save-token">Запази</button>
                </div>`;
            return;
        }

        const botLine = t.bot
            ? `Бот: <a href="https://t.me/${escapeHtml(t.bot.username)}" target="_blank" rel="noopener">@${escapeHtml(t.bot.username)}</a> — ${t.running ? '<span class="positive">работи</span>' : '<span class="negative">спрян</span>'}`
            : '<span class="negative">Ботът не отговаря</span>';
        const errorLine = t.lastError ? `<p class="negative automation-hint">${escapeHtml(t.lastError)}</p>` : '';

        let chatBlock;
        if (t.chatId) {
            chatBlock = `
                <p>Свързан с: <strong>${escapeHtml(t.chatName || t.chatId)}</strong></p>
                <div class="automation-buttons">
                    <button class="btn btn-secondary" data-auto-action="test">🔔 Тестово съобщение</button>
                    <button class="btn btn-secondary" data-auto-action="pending">❔ Изпрати некатегоризираните</button>
                    <button class="btn btn-secondary" data-auto-action="unlink">Прекъсни връзката с чата</button>
                </div>`;
        } else if (t.pairCode && t.bot) {
            const link = `https://t.me/${t.bot.username}?start=${t.pairCode}`;
            chatBlock = `
                <p><strong>Свържете чата си:</strong> отворете
                   <a href="${escapeHtml(link)}" target="_blank" rel="noopener">${escapeHtml(link)}</a>
                   и натиснете „Start“ — или изпратете на бота <code>/start ${escapeHtml(t.pairCode)}</code>.</p>
                <p class="text-muted automation-hint">Изчаква свързване…</p>`;
            startPairPolling();
        } else {
            chatBlock = `
                <p>Чатът още не е свързан.</p>
                <button class="btn btn-primary" data-auto-action="pair">Свържи моя Telegram</button>`;
        }

        container.innerHTML = `
            <p>${botLine}</p>
            ${errorLine}
            ${chatBlock}
            <hr class="automation-divider">
            <div class="automation-row">
                <label class="check-label">
                    <input type="checkbox" id="telegramEnabled" ${t.enabled ? 'checked' : ''}>
                    <span>Известия включени</span>
                </label>
                <span class="text-muted">Тихи часове (без звук) от</span>
                <input type="text" id="telegramQuietFrom" class="input automation-time" value="${escapeHtml(t.quietFrom || '')}" placeholder="22:30">
                <span class="text-muted">до</span>
                <input type="text" id="telegramQuietTo" class="input automation-time" value="${escapeHtml(t.quietTo || '')}" placeholder="07:00">
                <button class="btn btn-primary" data-auto-action="save-telegram">Запази</button>
            </div>
            <p class="text-muted automation-hint">Известия идват за новите транзакции от банката (без преводите между собствените сметки). Отговор с текст на съобщение се записва като бележка. Команди: /pending, /status.</p>
            <button class="btn btn-secondary btn-sm" data-auto-action="remove-bot">Премахни бота</button>
        `;
    } catch (error) {
        container.innerHTML = `<p class="negative">Грешка при зареждане: ${escapeHtml(error.message)}</p>`;
    }
}

// Докато се чака свързването — проверка на всеки 3 секунди (до 3 минути)
function startPairPolling() {
    if (automationState.pairTimer) return;
    let attempts = 0;
    automationState.pairTimer = setInterval(async () => {
        attempts++;
        const settingsVisible = document.getElementById('settings-page')?.classList.contains('active');
        try {
            const t = await api.getTelegramStatus();
            if (t.chatId || !t.pairCode || attempts > 60 || !settingsVisible) {
                clearInterval(automationState.pairTimer);
                automationState.pairTimer = null;
                if (t.chatId) {
                    showNotification(`Telegram е свързан с ${t.chatName || t.chatId}`, 'success');
                    renderTelegramSettings();
                }
            }
        } catch (error) {
            clearInterval(automationState.pairTimer);
            automationState.pairTimer = null;
        }
    }, 3000);
}

async function telegramAction(action) {
    try {
        switch (action) {
            case 'save-token': {
                const token = document.getElementById('telegramToken').value.trim();
                if (!token) return showNotification('Поставете token-а на бота', 'error');
                await api.updateTelegram({ token, enabled: true });
                showNotification('Ботът е свързан', 'success');
                break;
            }
            case 'pair':
                await api.createTelegramPairCode();
                break;
            case 'test':
                await api.sendTelegramTest();
                showNotification('Изпратено — проверете Telegram', 'success');
                return;
            case 'pending': {
                const result = await api.sendTelegramPending();
                showNotification(result.sent ? `Изпратени ${result.sent} транзакции` : 'Няма некатегоризирани от последните 30 дни', 'success');
                return;
            }
            case 'unlink':
                if (!confirm('Да се прекъсне връзката с чата? Известията спират, докато не свържете отново.')) return;
                await api.unlinkTelegramChat();
                break;
            case 'save-telegram':
                await api.updateTelegram({
                    enabled: document.getElementById('telegramEnabled').checked,
                    quietFrom: document.getElementById('telegramQuietFrom').value.trim(),
                    quietTo: document.getElementById('telegramQuietTo').value.trim()
                });
                showNotification('Настройките на Telegram са запазени', 'success');
                break;
            case 'remove-bot':
                if (!confirm('Да се премахне ботът (token и свързаният чат)?')) return;
                await api.removeTelegram();
                break;
            default:
                return;
        }
        renderTelegramSettings();
    } catch (error) {
        showNotification(error.message, 'error');
    }
}

// ─── Дебъг: сурови отговори от банковите API ────────────────────────────────

function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function renderDebugSettings() {
    const container = document.getElementById('debugSettings');
    try {
        const d = await api.getDebugStatus();
        const days = d.days.length
            ? d.days.slice(-7).map(x => `${escapeHtml(x.day)}: ${x.files} (${formatBytes(x.bytes)})`).join(' · ')
            : '';
        container.innerHTML = `
            <label class="check-label">
                <input type="checkbox" id="debugApiResponses" ${d.enabled ? 'checked' : ''}>
                <span><strong>Записвай суровите отговори от банковите API</strong></span>
            </label>
            <p class="text-muted automation-hint">
                Всеки отговор от GoCardless / Enable Banking се записва като JSON в <code>${escapeHtml(d.dir)}</code> — за анализ на проблеми без повторни заявки към банката (заявките са ограничени).
                Без заявките за токени. Изключете, когато не е нужно.<br>
                Записани: <strong>${d.files}</strong> файла, ${formatBytes(d.bytes)}${days ? ` — ${days}` : ''}
            </p>
            ${d.files ? '<button class="btn btn-secondary btn-sm" data-auto-action="clear-debug">Изтрий записаните отговори</button>' : ''}
        `;
    } catch (error) {
        container.innerHTML = `<p class="negative">Грешка при зареждане: ${escapeHtml(error.message)}</p>`;
    }
}

async function debugAction(action, el) {
    try {
        if (action === 'toggle-debug') {
            await api.setDebugApiResponses(el.checked);
            showNotification(el.checked ? 'Отговорите от банковите API ще се записват' : 'Записването е изключено', 'success');
        } else if (action === 'clear-debug') {
            if (!confirm('Да се изтрият всички записани отговори от банковите API?')) return;
            const result = await api.clearDebugApiResponses();
            showNotification(`Изтрити ${result.deleted} файла`, 'success');
        }
        renderDebugSettings();
    } catch (error) {
        showNotification(error.message, 'error');
    }
}

// Делегирани слушатели — вързват се веднъж, съдържанието се рендерира наново
function bindAutomationEvents() {
    if (automationState.bound) return;
    automationState.bound = true;
    document.getElementById('automationSettings').addEventListener('click', e => {
        const el = e.target.closest('[data-auto-action]');
        if (el && el.dataset.autoAction === 'save-schedule') saveSchedule();
    });
    const debug = document.getElementById('debugSettings');
    debug.addEventListener('change', e => {
        if (e.target.id === 'debugApiResponses') debugAction('toggle-debug', e.target);
    });
    debug.addEventListener('click', e => {
        const el = e.target.closest('[data-auto-action]');
        if (el) debugAction(el.dataset.autoAction, el);
    });
    document.getElementById('telegramSettings').addEventListener('click', e => {
        const el = e.target.closest('[data-auto-action]');
        if (el) telegramAction(el.dataset.autoAction);
    });
}
