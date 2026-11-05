// 队列聚合层：items/*.md（人写）+ gates.json（机器写）→ 统一的 packages 视图。
// 单一写者：每类字段只有一个写入路径，杜绝漂移。
import { loadStore, saveStore } from './queue-io.mjs';
import { readItems, writeItem, archiveItem, PRIORITIES, ORIGINS } from './item.mjs';
import { nowIso } from './ledger-io.mjs';

export { PRIORITIES, ORIGINS };

/** 合并视图：packages 顺序 = 优先级升序 → order → id。 */
export function loadQueue({ dir, onWarn } = {}) {
    const store = loadStore({ dir, onWarn });
    const gates = store.gates ?? {};
    const packages = readItems(dir).map((it) => ({
        ...it,
        gates: gates[it.id] ?? {},
        typeSource: it.typeSource ?? 'manual',
        reply: it.reply ?? 'none',
    }));
    return {
        version: 2,
        project: store.project ?? 'unknown',
        updatedAt: store.updatedAt ?? null,
        packages,
        dropped: store.dropped ?? [],
        __store: store,
    };
}

/** 只落机器字段（gates / dropped），永不覆盖 items 的人写字段。 */
export function saveQueue(q, { dir } = {}) {
    const gates = {};
    for (const pkg of q.packages ?? []) {
        if (pkg.gates && Object.keys(pkg.gates).length) gates[pkg.id] = pkg.gates;
    }
    const store = {
        version: 2,
        project: q.project ?? 'unknown',
        updatedAt: nowIso(),
        gates,
        dropped: q.dropped ?? [],
    };
    saveStore(store, { dir });
    return store;
}

function requirePkg(q, id) {
    const pkg = q.packages.find((p) => p.id === id);
    if (!pkg) throw new Error(`包不存在：${id}`);
    return pkg;
}

/** 新工作项：写入 items/<id>.md（人写字段），并保留已有 gates。 */
export function createItem({ id, title, type, priority = 'P2', origin = 'self', source, task = null, order = 100, touch = [], rollback = null, budget = { minutes: 40, retries: 2 }, background = '', accept = [] }, { dir } = {}) {
    if (!PRIORITIES.includes(priority)) throw new Error(`priority 必须是 ${PRIORITIES.join('|')}`);
    if (!ORIGINS.includes(origin)) throw new Error(`origin 必须是 ${ORIGINS.join('|')}`);
    const item = {
        id, title, type, priority, status: 'open', origin, source: source ?? nowIso(), task, order,
        touch, rollback, budget, releaseCandidate: false, createdAt: nowIso(),
        accept,
        sections: { 背景: background, 来源: `- ${origin}：${source ?? '（待补）'}`, 验收判据: '', 记录: '' },
    };
    writeItem({ ...item, sections: { ...item.sections, 验收判据: '' } }, dir);
    return item;
}

export function updateItem(id, patch, { dir } = {}) {
    const q = loadQueue({ dir });
    const pkg = requirePkg(q, id);
    const merged = { ...pkg, ...patch, sections: { ...pkg.sections, ...(patch.sections ?? {}) } };
    writeItem(merged, dir);
    return merged;
}

export function dropItem(id, reason, { dir } = {}) {
    const q = loadQueue({ dir });
    const pkg = requirePkg(q, id);
    const to = archiveItem(pkg, { dir });
    q.dropped = [...(q.dropped ?? []), { id, reason, at: nowIso() }];
    q.packages = q.packages.filter((p) => p.id !== id);
    saveQueue(q, { dir });
    return to;
}
