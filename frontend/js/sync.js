// Модал „Синхронизация“ (SSE поток от /api/sync/run)

function showSyncModal() {
    const modal = document.getElementById('syncModal');
    // Reset to selection phase
    document.getElementById('syncModalSelection').style.display = '';
    document.getElementById('syncModalProgress').style.display = 'none';
    document.getElementById('syncProgressLog').innerHTML = '';
    document.getElementById('syncSummary').style.display = 'none';
    document.getElementById('syncStartBtn').style.display = '';
    document.getElementById('syncCancelBtn').textContent = 'Откажи';
    document.getElementById('syncCancelBtn').onclick = closeSyncModal;
    document.getElementById('syncModalClose').onclick = closeSyncModal;
    // Default: transactions
    document.querySelector('input[name="syncMode"][value="transactions"]').checked = true;
    modal.classList.add('active');
}

function closeSyncModal() {
    document.getElementById('syncModal').classList.remove('active');
}

function addSyncLogLine(icon, text) {
    const log = document.getElementById('syncProgressLog');
    const line = document.createElement('div');
    line.className = 'sync-log-line';
    line.innerHTML = `<span class="sync-log-icon">${icon}</span><span>${escapeHtml(text)}</span>`;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
}

async function startSync() {
    const mode = document.querySelector('input[name="syncMode"]:checked')?.value || 'transactions';

    // Switch to progress phase
    document.getElementById('syncModalSelection').style.display = 'none';
    document.getElementById('syncModalProgress').style.display = '';
    document.getElementById('syncStartBtn').style.display = 'none';
    document.getElementById('syncCancelBtn').textContent = 'Затвори';
    document.getElementById('syncCancelBtn').onclick = null; // disable close during sync
    document.getElementById('syncCancelBtn').disabled = true;
    document.getElementById('syncModalClose').style.display = 'none';

    const log = document.getElementById('syncProgressLog');
    log.innerHTML = '';
    addSyncLogLine('⏳', 'Стартиране...');

    try {
        const response = await fetch('/api/sync/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode })
        });

        if (response.status === 401) {
            redirectToLogin();
            return;
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop(); // last incomplete line stays in buffer
            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                try {
                    const msg = JSON.parse(line.slice(6));
                    if (msg.type === 'step') {
                        addSyncLogLine(msg.icon, msg.text);
                    } else if (msg.type === 'done') {
                        const parts = [];
                        if (mode === 'accounts' || mode === 'both')
                            parts.push(`Сметки: ${msg.accountsSynced}`);
                        if (mode === 'transactions' || mode === 'both')
                            parts.push(`Нови транзакции: ${msg.transactionsSynced}`);
                        document.getElementById('syncSummary').style.display = '';
                        document.getElementById('syncSummary').innerHTML =
                            `✅ <strong>Завършено.</strong> ${parts.join(' &nbsp;·&nbsp; ')}`;
                    } else if (msg.type === 'error') {
                        addSyncLogLine('❌', msg.text);
                    }
                } catch { /* ignore malformed line */ }
            }
        }

    } catch (error) {
        addSyncLogLine('❌', 'Грешка: ' + error.message);
    }

    // Enable close
    document.getElementById('syncCancelBtn').disabled = false;
    document.getElementById('syncCancelBtn').onclick = () => {
        closeSyncModal();
        refreshCurrentPage();
    };
    document.getElementById('syncModalClose').style.display = '';
    document.getElementById('syncModalClose').onclick = () => {
        closeSyncModal();
        refreshCurrentPage();
    };
}
