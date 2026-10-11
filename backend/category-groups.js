/**
 * Групи категории (categories.parent_id): транзакциите и правилата сочат към подкатегория,
 * групата само обобщава. Тук — филтър „категория или нейните подкатегории“ и сбор на редове по групи.
 */

/** SQL условие: колоната е категорията или нейна подкатегория (два параметъра — id, id) */
function categoryFilterSql(column = 't.category_id') {
    return `${column} IN (SELECT id FROM categories WHERE id = ? OR parent_id = ?)`;
}

/**
 * Обединява редовете по група: подкатегориите отиват в children на реда на групата.
 * @param {object[]} rows — редове с id на категория (id: null — без категория)
 * @param {object[]} categories — всички категории
 * @param {{ empty: () => object, merge: (target, row) => void }} sums — нулев сбор и добавяне на ред
 * @returns {object[]} самостоятелните редове + редовете на групите ({ ...група, isGroup, children })
 */
function groupRows(rows, categories, { empty, merge }) {
    const byId = new Map(categories.map(c => [c.id, c]));
    const hasChildren = new Set(categories.filter(c => c.parent_id).map(c => c.parent_id));
    const groups = new Map();
    const top = [];

    const groupFor = category => {
        if (!groups.has(category.id)) {
            groups.set(category.id, {
                id: category.id, name: category.name, color: category.color, type: category.type,
                icon: category.icon, isGroup: true, children: [], ...empty()
            });
        }
        return groups.get(category.id);
    };

    for (const row of rows) {
        const category = row.id !== null && row.id !== undefined ? byId.get(row.id) : null;
        const parent = category && category.parent_id ? byId.get(category.parent_id) : null;
        if (parent) {
            const group = groupFor(parent);
            group.children.push(row);
            merge(group, row);
        } else if (category && hasChildren.has(category.id)) {
            // Транзакции направо в групата — като отделен ред в нея
            const group = groupFor(category);
            group.children.push({ ...row, name: `${row.name} (без подкатегория)` });
            merge(group, row);
        } else {
            top.push(row);
        }
    }
    return [...top, ...groups.values()];
}

module.exports = { categoryFilterSql, groupRows };
