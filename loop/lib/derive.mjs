// 状态折叠：LEDGER 事件流 → 每个包的 runState。纯函数，可回放重建。
// 设计：design.md §2.2 / §4。

export const RUN_STATES = [
    'idle',
    'queued',
    'running',
    'green',
    'red',
    'parked',
    'committed',
    'accepted',
    'released',
    'dropped',
];

export const PARK_REASONS = ['human-wall', 'gate-reopen', 'out-of-scope', 'budget', 'flaky'];

const TERMINAL = new Set(['released', 'dropped']);

function emptyState() {
    return {
        runState: 'idle',
        parkReason: null,
        lastTs: null,
        lastAction: null,
        commit: null,
        evidence: null,
        events: 0,
    };
}

/**
 * @param {Array<object>} events LEDGER 行（时间升序；乱序也能折叠，以每行 to 覆盖）
 * @returns {Map<string, object>} id → 折叠状态
 */
export function deriveRunStates(events) {
    const map = new Map();
    for (const e of events) {
        if (!e || typeof e.id !== 'string' || !e.id) continue;
        if (e.from === null && e.to === null) continue;
        const cur = map.get(e.id) ?? emptyState();
        const next = { ...cur };

        next.events = cur.events + 1;
        if (e.ts) next.lastTs = e.ts;
        if (e.action) next.lastAction = e.action;
        if (e.commit) next.commit = e.commit;
        if (e.evidence) next.evidence = e.evidence;

        if (e.to) next.runState = e.to;
        if (e.action === 'park') {
            next.parkReason = e.verdict ?? 'unspecified';
        } else if (next.runState !== 'parked') {
            next.parkReason = null;
        }

        map.set(e.id, next);
    }
    return map;
}

/** 终态包不再进夜班队列。 */
export function isRunnable(state) {
    if (!state) return true;
    if (TERMINAL.has(state.runState)) return false;
    if (state.runState === 'accepted') return false;
    return true;
}

/**
 * 队列 + 事件 → 看板/晨会用的派生视图。
 * @param {object} queue  queue.json
 * @param {Array} events  LEDGER 事件
 * @param {(pkg:object)=>{prdHash?:string,rubricHash?:string,planHash?:string}} ctxOf
 */
export function deriveAll(queue, events, ctxOf = () => ({})) {
    const states = deriveRunStates(events);
    const packages = (queue?.packages ?? []).map((pkg) => {
        const st = states.get(pkg.id) ?? emptyState();
        const ctx = ctxOf(pkg) ?? {};
        return { pkg, ctx, state: st };
    });
    return { states, packages };
}
