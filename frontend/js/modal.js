// Общ помощник за модалните прозорци #modal и #overlayModal.
//
// openModal({ title, body, saveText, cancelText, showSave, onSave, onClose,
//             maxWidth, className, footer, footerAlign, autofocus, key })
// closeModal()                 — затваря #modal (вика onClose)
// updateModal({ title, saveText, cancelText, showSave }) — променя отворения #modal
// isModalOpen(key?)            — отворен ли е #modal (по избор: със същия key)
// openOverlay({ title, body, footer, footerAlign, maxWidth, className, onSave, onClose, autofocus, key })
// closeOverlay(), isOverlayOpen(key?)
//
// Правила:
// - Всяко отваряне нулира състоянието от предишния диалог (бутони, footer, ширина, класове).
// - Отваряне върху вече отворен прозорец го "подменя": onClose на предишния НЕ се вика
//   (така навигацията Предишна/Следваща само пречертава съдържанието).
// - onClose се вика при всяко реално затваряне (X, Отказ, Escape, клик извън, closeModal()).
// - Докато onSave работи, бутонът за запис е изключен, а X/Отказ/Escape/фон не затварят.
//   Програмното closeModal() от самия onSave работи нормално.
// - В custom footer: елемент с data-modal-close затваря, с data-modal-save вика onSave.

function createModalController({ rootId, titleId, bodyId, standardFooter }) {
    let root, content, titleEl, bodyEl, footerEl;
    let session = 0;
    let state = null;          // { onSave, onClose, key }
    let saving = false;
    let pointerDownOnBackdrop = false;
    let opener = null;         // елементът с фокус преди отваряне

    function init() {
        if (root) return true;
        root = document.getElementById(rootId);
        if (!root) return false;
        content = root.querySelector('.modal-content');
        titleEl = document.getElementById(titleId);
        bodyEl = document.getElementById(bodyId);
        footerEl = root.querySelector('.modal-footer');

        root.addEventListener('mousedown', (e) => {
            pointerDownOnBackdrop = e.target === root;
        });
        root.addEventListener('click', (e) => {
            if (e.target === root) {
                // Само ако и натискането е започнало върху фона (не при влачене на селекция)
                if (pointerDownOnBackdrop) requestClose();
                pointerDownOnBackdrop = false;
                return;
            }
            if (e.target.closest('[data-modal-close]')) {
                e.preventDefault();
                requestClose();
            } else if (e.target.closest('[data-modal-save]')) {
                e.preventDefault();
                runSave();
            }
        });
        // Enter в едноредово поле = Запази (не в textarea, select, checkbox, файл...)
        root.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' || e.isComposing || e.shiftKey || e.ctrlKey || e.altKey) return;
            const t = e.target;
            if (!(t instanceof HTMLInputElement) || !bodyEl.contains(t)) return;
            const textTypes = ['text', 'number', 'date', 'email', 'password', 'search', 'tel', 'url', 'month', 'time', 'datetime-local'];
            if (!textTypes.includes(t.type)) return;
            if (!state?.onSave || !getSaveButton()) return;
            e.preventDefault();
            runSave();
        });
        return true;
    }

    function getSaveButton() {
        const btn = footerEl.querySelector('[data-modal-save]');
        if (!btn || btn.disabled || btn.style.display === 'none') return null;
        return btn;
    }

    function resetLayout() {
        content.style.maxWidth = '';
        content.className = 'modal-content';
        footerEl.style.justifyContent = '';
        footerEl.innerHTML = standardFooter;
    }

    function isOpen(key) {
        if (!root || !root.classList.contains('active') || !state) return false;
        return key === undefined || state.key === key;
    }

    function open(options = {}) {
        if (!init()) return;
        const {
            title = '',
            body = '',
            footer = null,
            footerAlign = '',
            maxWidth = '',
            className = '',
            onSave = null,
            onClose = null,
            autofocus = true,
            key = null
        } = options;

        if (!isOpen()) opener = document.activeElement;
        session++;
        saving = false;
        state = { onSave, onClose, key };

        resetLayout();
        if (maxWidth) content.style.maxWidth = maxWidth;
        if (className) content.classList.add(...className.split(/\s+/).filter(Boolean));

        titleEl.textContent = title;
        if (body instanceof Node) {
            bodyEl.innerHTML = '';
            bodyEl.appendChild(body);
        } else {
            bodyEl.innerHTML = body;
        }

        if (footer !== null) {
            footerEl.innerHTML = footer;
            if (footerAlign) footerEl.style.justifyContent = footerAlign;
        } else {
            applyStandardButtons(options);
        }

        root.classList.add('active');
        bodyEl.scrollTop = 0;

        if (autofocus) {
            const field = Array.from(bodyEl.querySelectorAll(
                'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])'
            )).find(el => el.offsetParent !== null);
            if (field) field.focus();
        }
    }

    // Текст/видимост на стандартните бутони (само за #modal, който има Отказ + Запази)
    function applyStandardButtons({ saveText, cancelText, showSave } = {}) {
        const saveBtn = footerEl.querySelector('[data-modal-save]');
        const cancelBtn = footerEl.querySelector('[data-modal-close]');
        if (saveBtn) {
            if (saveText !== undefined) saveBtn.textContent = saveText;
            if (showSave !== undefined) saveBtn.style.display = showSave ? '' : 'none';
        }
        if (cancelBtn && cancelText !== undefined) cancelBtn.textContent = cancelText;
    }

    function update({ title, saveText, cancelText, showSave } = {}) {
        if (!isOpen()) return;
        if (title !== undefined) titleEl.textContent = title;
        applyStandardButtons({ saveText, cancelText, showSave });
    }

    async function runSave() {
        if (saving || !state?.onSave) return;
        const btn = getSaveButton();
        if (!btn) return;
        const mySession = session;
        saving = true;
        btn.disabled = true;
        try {
            await state.onSave();
        } catch (error) {
            console.error('Modal save error:', error);
            showNotification('Грешка: ' + error.message, 'error');
        } finally {
            if (mySession === session) {
                saving = false;
                btn.disabled = false;
            }
        }
    }

    // Затваряне по желание на потребителя — не и докато тече запис
    function requestClose() {
        if (saving) return;
        close();
    }

    function close() {
        if (!isOpen()) return;
        // Фокусираното поле губи фокус ПРЕДИ скриване, за да се изпълни blur (напр. автозапис на бележки)
        if (document.activeElement && root.contains(document.activeElement)) {
            document.activeElement.blur();
        }
        const onClose = state.onClose;
        state = null;
        saving = false;
        session++;
        root.classList.remove('active');
        resetLayout();
        bodyEl.innerHTML = '';

        if (opener && opener.isConnected && typeof opener.focus === 'function') {
            try { opener.focus({ preventScroll: true }); } catch { /* ignore */ }
        }
        opener = null;

        if (onClose) {
            try {
                onClose();
            } catch (error) {
                console.error('Modal onClose error:', error);
            }
        }
    }

    return { open, close, update, isOpen, requestClose, init };
}

const mainModalController = createModalController({
    rootId: 'modal',
    titleId: 'modalTitle',
    bodyId: 'modalBody',
    standardFooter: `
                <button type="button" id="modalCancel" class="btn btn-secondary" data-modal-close>Отказ</button>
                <button type="button" id="modalSave" class="btn btn-primary" data-modal-save>Запази</button>
            `
});

const overlayModalController = createModalController({
    rootId: 'overlayModal',
    titleId: 'overlayModalTitle',
    bodyId: 'overlayModalBody',
    standardFooter: `
                <button type="button" id="overlayModalClose" class="btn btn-secondary" data-modal-close>Затвори</button>
            `
});

function openModal({ saveText = 'Запази', cancelText = 'Отказ', showSave = true, ...rest } = {}) {
    mainModalController.open({ saveText, cancelText, showSave, ...rest });
}

function closeModal() {
    mainModalController.close();
}

function updateModal(changes) {
    mainModalController.update(changes);
}

function isModalOpen(key) {
    return mainModalController.isOpen(key);
}

function openOverlay(options = {}) {
    overlayModalController.open(options);
}

function closeOverlay() {
    overlayModalController.close();
}

function isOverlayOpen(key) {
    return overlayModalController.isOpen(key);
}

// Escape затваря най-горния отворен прозорец: overlay → синхронизация → основен модал.
// Прозорецът за синхронизация не се затваря, докато тече синхронизация (бутонът е disabled).
document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;

    if (overlayModalController.isOpen()) {
        e.preventDefault();
        overlayModalController.requestClose();
        return;
    }

    const syncModal = document.getElementById('syncModal');
    if (syncModal && syncModal.classList.contains('active')) {
        e.preventDefault();
        const cancelBtn = document.getElementById('syncCancelBtn');
        if (cancelBtn && !cancelBtn.disabled) cancelBtn.click();
        return;
    }

    if (mainModalController.isOpen()) {
        e.preventDefault();
        mainModalController.requestClose();
    }
});
