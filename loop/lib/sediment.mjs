// G8 沉淀门：同一个问题出现第二次，必须先写一条规范才算过验收。
// 纯函数，无 IO。设计见 design-framework.md §G、RUNBOOK §10。
import { PARK_REASONS } from './derive.mjs';

export const DEFAULT_WINDOW_DAYS = 90;
export const DEFAULT_MIN_REPEAT = 2;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 把一条事件折算成「问题类别键」；不是问题类事件则返回 null。 */
export function issueKey(ev) {
    if (!ev || typeof ev !== 'object') return null;
    if (ev.action === 'park') return `park:${ev.verdict ?? 'unspecified'}`;
    if (ev.action === 'drop') return `drop:${ev.verdict ?? 'unspecified'}`;
    const v = String(ev.verdict ?? '');
    if (ev.action === 'note' && v.startsWith('sediment:')) return null; // 沉淀记录本身不算问题
    return null;
}

/**
 * 窗口内重复出现的问题。
 * @returns {Array<{key:string,count:number,ids:string[],last:string|null}>}
 */
export function repeatedIssues(events, { now = Date.now(), days = DEFAULT_WINDOW_DAYS, min = DEFAULT_MIN_REPEAT } = {}) {
    const since = now - days * DAY_MS;
    const buckets = new Map();
    for (const ev of events ?? []) {
        const key = issueKey(ev);
        if (!key) continue;
        const ts = Date.parse(ev.ts ?? '');
        if (!Number.isFinite(ts) || ts < since) continue;
        const cur = buckets.get(key) ?? { key, count: 0, ids: new Set(), last: null };
        cur.count += 1;
        if (ev.id) cur.ids.add(ev.id);
        if (!cur.last || String(ev.ts) > cur.last) cur.last = ev.ts;
        buckets.set(key, cur);
    }
    return [...buckets.values()]
        .filter((b) => b.count >= min)
        .map((b) => ({ key: b.key, count: b.count, ids: [...b.ids], last: b.last }));
}

/** 沉淀凭据：ledger note 事件，verdict = `sediment:<问题键>`，evidence = 规范路径。 */
export function sediments(events) {
    return (events ?? [])
        .filter((e) => e.action === 'note' && String(e.verdict ?? '').startsWith('sediment:'))
        .map((e) => ({ key: String(e.verdict).slice('sediment:'.length).trim(), evidence: e.evidence ?? null, ts: e.ts }));
}

/** G8 判定：窗口内重复过的问题，是否都已沉淀。 */
export function sedimentGate(events, opts = {}) {
    const repeated = repeatedIssues(events, opts);
    const done = sediments(events);
    const missing = repeated.filter((r) => !done.some((d) => d.key === r.key));
    return { ok: missing.length === 0, repeated, sediments: done, missing };
}

/** 训练/文档用：可用的问题键枚举是否与 derive 的原因枚举一致。 */
export function knownParkReasons() {
    return [...PARK_REASONS];
}
