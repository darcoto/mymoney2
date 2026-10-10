/**
 * Импорт на банкови извлечения от файл
 * Форматът и (когато е възможно) сметката се разпознават по съдържанието:
 *  - ДСК „Excel“ (.xls, HTML) — сметката по номера в заглавието
 *  - Revolut CSV — сметката по колоните „Продукт“ (разплащателна / джоб) и „Валута“
 * Транзакции, които вече са влезли от банката (или от друг файл), не се импортират отново.
 */

const database = require('./database');
const logger = require('./logger');
const dskImport = require('./dsk-import');
const revolutImport = require('./revolut-import');
const matching = require('./transaction-matching');
const { enrichTransaction, loadRules, clearRulesCache } = require('./transaction-processor');

function detectFormat(content) {
    if (dskImport.isDskHtml(content)) return 'dsk-html';
    if (revolutImport.isRevolutCsv(content)) return 'revolut-csv';
    return null;
}

const PARSER_NAMES = {
    'dsk-html': 'Банка ДСК (Excel)',
    'revolut-csv': 'Revolut (CSV)'
};

function compactIban(iban) {
    return String(iban || '').replace(/\s/g, '');
}

/**
 * ДСК: сметка по номера от файла (IBAN завършва на него)
 */
function findDskAccount(accounts, number) {
    if (!number) return null;
    const found = accounts.filter(a => matching.isDskAccount(a) && compactIban(a.iban).endsWith(number));
    return found.length === 1 ? found[0] : null;
}

/**
 * @param {{ fileContent: string, accountId?: string }} params
 *   accountId — празно = автоматично по файла
 */
async function importFile({ fileContent, accountId = null }) {
    const content = String(fileContent || '').replace(/^﻿/, '');
    const format = detectFormat(content);
    if (!format) {
        throw new Error('Неразпознат формат на файла. Поддържани: Банка ДСК (експорт в Excel, .xls) и Revolut (.csv)');
    }

    const accounts = await database.getAllAccounts();
    const byId = new Map(accounts.map(a => [a.id, a]));
    const requested = accountId ? byId.get(accountId) : null;
    if (accountId && !requested) {
        throw new Error('Избраната сметка не е намерена');
    }

    let transactions = [];
    let crossAccountIds = [];
    let autoAssigned = false;
    const warnings = [];

    if (format === 'dsk-html') {
        if (requested && !matching.isDskAccount(requested)) {
            throw new Error(`Файлът е от Банка ДСК, а избраната сметка е от „${requested.institution_name}“`);
        }

        let target = requested;
        const parsed = dskImport.processHtmlForImport(content);
        transactions = parsed.transactions;
        if (parsed.pending) {
            warnings.push(`${parsed.pending} неосчетоводени плащания с карта (блокирани суми) са пропуснати — ще влязат, когато банката ги осчетоводи`);
        }
        const detected = findDskAccount(accounts, parsed.account.number);
        if (detected && requested && detected.id !== requested.id) {
            throw new Error(`Файлът е за сметка №${parsed.account.number} (${matching.accountLabel(detected)}), а е избрана друга сметка`);
        }
        if (detected) {
            target = detected;
            autoAssigned = !requested;
        } else if (!requested) {
            throw new Error(`Не е намерена сметка от ДСК с номер ${parsed.account.number || '?'}. Синхронизирайте сметките или изберете сметка ръчно.`);
        } else {
            warnings.push(`Сметката №${parsed.account.number} от файла не е намерена — използвана е избраната сметка`);
        }
        transactions.forEach(tx => { tx.accountId = target.id; });
    } else {
        transactions = revolutImport.processCsvForImport(content);
        if (requested) {
            if (!matching.isRevolutAccount(requested)) {
                throw new Error(`Файлът е от Revolut, а избраната сметка е от „${requested.institution_name}“`);
            }
            const products = [...new Set(transactions.map(t => t.product).filter(Boolean))];
            if (products.length > 1) {
                throw new Error(`Файлът съдържа транзакции от няколко сметки (${products.join(', ')}). Изберете „Автоматично“, за да се разпределят по сметки.`);
            }
            transactions.forEach(tx => { tx.accountId = requested.id; });
        } else {
            const resolved = await matching.resolveRevolutAccounts(transactions, accounts);
            transactions.forEach(tx => {
                tx.accountId = resolved.get(`${tx.productKind || ''}|${tx.fileCurrency}`).id;
            });
            autoAssigned = true;
        }
        crossAccountIds = accounts.filter(matching.isRevolutAccount).map(a => a.id);
        // Банковите записи на прехвърлянията към джоба първо отиват в правилната сметка
        await matching.fixRevolutPocketTransfers();
    }

    logger.info(`[File Import] ${PARSER_NAMES[format]}: ${transactions.length} transactions`);

    const total = transactions.length;
    let movedSameId = 0;
    if (autoAssigned) {
        movedSameId = await matching.moveSameIdToAccounts(transactions);
    }

    const { toImport, duplicates, moved } = await matching.filterDuplicates(transactions, {
        crossAccountIds,
        moveMatches: autoAssigned
    });

    await loadRules();
    let categorized = 0;
    try {
        for (const tx of toImport) {
            await enrichTransaction(tx);
            if (tx.categoryId) categorized++;
        }
    } finally {
        clearRulesCache();
    }

    const results = toImport.length
        ? await database.importTransactionsBatch(toImport)
        : { imported: 0, skipped: 0, errors: [] };

    // Обобщение по сметки
    const perAccount = new Map();
    for (const tx of transactions) {
        perAccount.set(tx.accountId, (perAccount.get(tx.accountId) || 0) + 1);
    }

    return {
        success: true,
        parser: PARSER_NAMES[format],
        total,
        imported: results.imported,
        skipped: results.skipped,          // същото ID — вече импортирани от файл
        duplicates,                        // вече съществуват (от банката или друг файл)
        moved: moved + movedSameId,        // преместени в правилната сметка
        categorized,
        errors: results.errors,
        warnings,
        accounts: [...perAccount.entries()].map(([id, count]) => ({
            id,
            name: matching.accountLabel(byId.get(id)),
            count
        }))
    };
}

module.exports = { importFile, detectFormat };
