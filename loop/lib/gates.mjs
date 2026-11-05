// 门引擎核心（无 re-export，便于单测直接引用）。
// 设计：PRD §R2；门凭据与冻结规则：design.md §5。

export const GATE_MATRIX = {
    bug: ['g2', 'g7'],
    'fix-small': ['g2', 'g7'],
    docs: ['g5', 'g7'],
    chore: ['g5', 'g7'],
    feature: ['g1', 'g2', 'g5', 'g7'],
    redesign: ['g1', 'g2', 'g3', 'g4', 'g5', 'g7'],
    'new-surface': ['g1', 'g2', 'g3', 'g4', 'g5', 'g7'],
    arch: ['g1', 'g2', 'g5', 'g6', 'g7'],
};

/** 门序号（判定顺序 = 这个顺序；第一个未满足的门决定 blockedBy）。 */
export const GATE_ORDER = ['g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7'];

/** G7 是终态验收门，不参与"能否开工"的判定（否则永远无法 clear）。 */
export const PRE_ACCEPT_GATES = ['g1', 'g2', 'g3', 'g4', 'g5', 'g6'];

export const HUMAN_GATES = new Set(['g1', 'g3', 'g4', 'g6']);

export const GATE_LABEL = {
    g1: '需求',
    g2: '器具',
    g3: '原型',
    g4: '评审',
    g5: '合规',
    g6: '方案',
    g7: '验收',
};

export const TASK_TYPES = Object.keys(GATE_MATRIX);

const DAY_MS = 24 * 60 * 60 * 1000;

export function requiredGates(type) {
    return GATE_MATRIX[type] ?? GATE_MATRIX['fix-small'];
}

export function isHumanGate(gate) {
    return HUMAN_GATES.has(gate);
}

/** 校准开关：LOOP_SLOPPY=1 时引擎"坏掉"，所有门判为满足。用于证明夹具真的会红。 */
function sloppy() {
    return process.env.LOOP_SLOPPY === '1';
}

function hashMismatch(want, got) {
    // 调用方无法算出 hash（例如包没有对应 task）时传 undefined → 不做 hash 校验。
    if (got === undefined) return false;
    if (!want) return true;
    return want !== got;
}

/**
 * @param {string} gate  g1..g7
 * @param {object} pkg   queue.json 里的包
 * @param {object} ctx   { prdHash?, rubricHash?, planHash?, now? }
 * @returns {{ok:boolean, reason:string|null, drift?:boolean}}
 */
export function checkGate(gate, pkg, ctx = {}) {
    if (sloppy()) return { ok: true, reason: null };
    const g = pkg?.gates?.[gate] ?? null;
    const now = ctx.now ?? Date.now();

    switch (gate) {
        case 'g1': {
            if (g?.verdict !== 'confirmed') return { ok: false, reason: 'unsigned' };
            if (hashMismatch(g?.prdHash, ctx.prdHash)) return { ok: false, reason: 'drift', drift: true };
            return { ok: true, reason: null };
        }
        case 'g2': {
            const p = typeof g?.redProof === 'string' ? g.redProof.trim() : '';
            if (!p || p === 'PENDING') return { ok: false, reason: 'no-red-proof' };
            return { ok: true, reason: null };
        }
        case 'g3': {
            if (g?.verdict !== 'confirmed') return { ok: false, reason: 'unsigned' };
            if (!g?.ref) return { ok: false, reason: 'no-prototype-ref' };
            return { ok: true, reason: null };
        }
        case 'g4': {
            if (g?.verdict !== 'confirmed') return { ok: false, reason: 'unsigned' };
            if (hashMismatch(g?.rubricHash, ctx.rubricHash)) return { ok: false, reason: 'drift', drift: true };
            return { ok: true, reason: null };
        }
        case 'g5': {
            if (g?.ok !== true) return { ok: false, reason: 'not-run' };
            if (!g?.executedAt) return { ok: false, reason: 'not-run' };
            return { ok: true, reason: null };
        }
        case 'g6': {
            if (g?.verdict !== 'confirmed') return { ok: false, reason: 'unsigned' };
            if (hashMismatch(g?.planHash, ctx.planHash)) return { ok: false, reason: 'drift', drift: true };
            const at = Date.parse(g?.at ?? '');
            if (!Number.isFinite(at)) return { ok: false, reason: 'no-timestamp' };
            if (now - at > DAY_MS) return { ok: false, reason: 'expired' };
            return { ok: true, reason: null };
        }
        case 'g7':
            return g?.verdict === 'confirmed' ? { ok: true, reason: null } : { ok: false, reason: 'unsigned' };
        default:
            return { ok: false, reason: 'unknown-gate' };
    }
}

/**
 * @returns {{state:string, blockedBy:string|null, reason:string|null, drift:boolean}}
 *   state = 'clear' | 'blocked:g1' ... 'blocked:g6'
 */
export function gateStateOf(pkg, ctx = {}) {
    const req = requiredGates(pkg?.type);
    for (const gate of GATE_ORDER) {
        if (!PRE_ACCEPT_GATES.includes(gate)) continue;
        if (!req.includes(gate)) continue;
        const r = checkGate(gate, pkg, ctx);
        if (!r.ok) {
            return { state: `blocked:${gate}`, blockedBy: gate, reason: r.reason, drift: r.drift === true };
        }
    }
    return { state: 'clear', blockedBy: null, reason: null, drift: false };
}

/** 门进度：用于卡片 `●●○`。 */
export function gateProgress(pkg, ctx = {}) {
    const req = requiredGates(pkg?.type).filter((g) => PRE_ACCEPT_GATES.includes(g));
    const done = req.filter((g) => checkGate(g, pkg, ctx).ok).length;
    return { done, total: req.length, gates: req };
}
