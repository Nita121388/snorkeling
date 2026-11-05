// 共享夹具：`node --test` 与 `queue.mjs self-test` 用同一份。
// 校准：LOOP_SLOPPY=1 时门引擎"坏掉"，下列负向夹具必须变红（见 queue.mjs self-test --expect=broken）。

const T0 = Date.parse('2026-11-05T09:00:00Z');

function pkg(over) {
    return { id: 'x', type: 'arch', gates: {}, ...over };
}

const FULL_ARCH = {
    g1: { verdict: 'confirmed', by: 'nita', at: '2026-11-05T09:00', prdHash: 'aaaa11112222' },
    g2: { redProof: 'node x --expect=broken → 3 failed @ abc1234' },
    g5: { ok: true, executedAt: '2026-11-05T09:10' },
    g6: { verdict: 'confirmed', at: '2026-11-05T09:05', planHash: 'bbbb33334444' },
};
const CTX_ARCH = { prdHash: 'aaaa11112222', planHash: 'bbbb33334444', now: T0 + 60 * 60 * 1000 };

export const gateCases = [
    { name: 'arch 凭据齐全 → clear', pkg: pkg({ type: 'arch', gates: FULL_ARCH }), ctx: CTX_ARCH, expect: 'clear' },
    {
        name: 'arch 缺 g1 → blocked:g1',
        pkg: pkg({ type: 'arch', gates: { ...FULL_ARCH, g1: undefined } }),
        ctx: CTX_ARCH,
        expect: 'blocked:g1',
        reason: 'unsigned',
    },
    {
        name: 'arch g1 prd 漂移 → blocked:g1 + drift',
        pkg: pkg({ type: 'arch', gates: FULL_ARCH }),
        ctx: { ...CTX_ARCH, prdHash: 'ffff99998888' },
        expect: 'blocked:g1',
        reason: 'drift',
        drift: true,
    },
    {
        name: 'arch g2 未填 redProof → blocked:g2',
        pkg: pkg({ type: 'arch', gates: { ...FULL_ARCH, g2: { redProof: 'PENDING' } } }),
        ctx: CTX_ARCH,
        expect: 'blocked:g2',
        reason: 'no-red-proof',
    },
    {
        name: 'arch 未跑 G5 → blocked:g5',
        pkg: pkg({ type: 'arch', gates: { ...FULL_ARCH, g5: { ok: false, executedAt: null } } }),
        ctx: CTX_ARCH,
        expect: 'blocked:g5',
        reason: 'not-run',
    },
    {
        name: 'arch g6 超过 24h → blocked:g6 expired',
        pkg: pkg({ type: 'arch', gates: FULL_ARCH }),
        ctx: { ...CTX_ARCH, now: T0 + 48 * 60 * 60 * 1000 },
        expect: 'blocked:g6',
        reason: 'expired',
    },
    {
        name: 'arch g6 计划漂移 → blocked:g6 drift',
        pkg: pkg({ type: 'arch', gates: FULL_ARCH }),
        ctx: { ...CTX_ARCH, planHash: 'cccc' },
        expect: 'blocked:g6',
        reason: 'drift',
        drift: true,
    },
    {
        name: 'redesign 有 g1/g2 缺 g3 → blocked:g3',
        pkg: pkg({ type: 'redesign', gates: { ...FULL_ARCH, g3: undefined } }),
        ctx: CTX_ARCH,
        expect: 'blocked:g3',
        reason: 'unsigned',
    },
    {
        name: 'redesign 有 g3 缺 g4 → blocked:g4',
        pkg: pkg({ type: 'redesign', gates: { ...FULL_ARCH, g3: { verdict: 'confirmed', ref: 'design/prototypes/p' } } }),
        ctx: CTX_ARCH,
        expect: 'blocked:g4',
        reason: 'unsigned',
    },
    {
        name: 'redesign g4 rubric 漂移 → drift',
        pkg: pkg({
            type: 'redesign',
            gates: {
                ...FULL_ARCH,
                g3: { verdict: 'confirmed', ref: 'design/prototypes/p' },
                g4: { verdict: 'confirmed', by: 'nita', rubricHash: 'dddd' },
            },
        }),
        ctx: { ...CTX_ARCH, rubricHash: 'eeee' },
        expect: 'blocked:g4',
        reason: 'drift',
        drift: true,
    },
    {
        name: 'redesign 齐全 → clear',
        pkg: pkg({
            type: 'redesign',
            gates: {
                ...FULL_ARCH,
                g3: { verdict: 'confirmed', ref: 'design/prototypes/p' },
                g4: { verdict: 'confirmed', by: 'nita', rubricHash: 'dddd' },
            },
        }),
        ctx: { ...CTX_ARCH, rubricHash: 'dddd' },
        expect: 'clear',
    },
    { name: 'bug 只需 g2 → clear', pkg: pkg({ type: 'bug', gates: { g2: { redProof: 'x → 5 failed' } } }), ctx: CTX_ARCH, expect: 'clear' },
    {
        name: 'bug 缺 redProof → blocked:g2',
        pkg: pkg({ type: 'bug', gates: {} }),
        ctx: CTX_ARCH,
        expect: 'blocked:g2',
        reason: 'no-red-proof',
    },
    { name: 'docs 只需 g5 → clear', pkg: pkg({ type: 'docs', gates: { g5: { ok: true, executedAt: 'now' } } }), ctx: CTX_ARCH, expect: 'clear' },
    {
        name: 'docs 缺 g5 → blocked:g5',
        pkg: pkg({ type: 'docs', gates: {} }),
        ctx: CTX_ARCH,
        expect: 'blocked:g5',
        reason: 'not-run',
    },
    { name: 'g7 不影响能否开工', pkg: pkg({ type: 'arch', gates: FULL_ARCH }), ctx: CTX_ARCH, expect: 'clear' },
    {
        name: '未知类型回退 fix-small（只看 g2）',
        pkg: pkg({ type: 'weird', gates: { g2: { redProof: 'x' } } }),
        ctx: CTX_ARCH,
        expect: 'clear',
    },
];

export const classifyCases = [
    { name: 'bug: 新增 repro 脚本', signals: { hasRepro: true, addedFiles: ['scripts/verify/a/verify.mjs'] }, expect: 'bug' },
    { name: 'bug: 新增单测', signals: { hasRepro: true, addedFiles: ['frontend/app/a.test.ts'] }, expect: 'bug' },
    { name: 'new-surface: 新增 pages/', signals: { addedFiles: ['src/pages/board.tsx'] }, expect: 'new-surface' },
    {
        name: 'new-surface: 新增 views/',
        signals: { addedFiles: ['frontend/app/view/preview/views/x.tsx'] },
        expect: 'new-surface',
    },
    { name: 'redesign: tokens.css', signals: { changedFiles: ['frontend/app/styles/tokens.css'] }, expect: 'redesign' },
    { name: 'redesign: scss', signals: { changedFiles: ['frontend/app/session-overview/a.scss'] }, expect: 'redesign' },
    { name: 'redesign: components/ui', signals: { changedFiles: ['src/components/ui/button.tsx'] }, expect: 'redesign' },
    { name: 'arch: shared/', signals: { changedFiles: ['shared/types.ts'] }, expect: 'arch' },
    { name: 'arch: pkg/', signals: { changedFiles: ['pkg/aisessions/provider_opencode.go'] }, expect: 'arch' },
    { name: 'arch: package.json', signals: { changedFiles: ['package.json'] }, expect: 'arch' },
    { name: 'arch: deps-policy', signals: { changedFiles: ['deps-policy.json'] }, expect: 'arch' },
    { name: 'docs: 全 md', signals: { changedFiles: ['README.md', 'docs/x/a.md'] }, expect: 'docs' },
    { name: 'chore: lockfile', signals: { changedFiles: ['package-lock.json'] }, expect: 'chore' },
    { name: 'chore: .npmrc', signals: { changedFiles: ['.npmrc'] }, expect: 'chore' },
    { name: 'chore: version.cjs', signals: { changedFiles: ['version.cjs'] }, expect: 'chore' },
    {
        name: 'feature: 人工标记行为变更',
        signals: { changedFiles: ['frontend/app/view/x.tsx'], hints: { behaviorChange: true } },
        expect: 'feature',
    },
    { name: 'fix-small: 兜底', signals: { changedFiles: ['frontend/app/view/x.tsx'] }, expect: 'fix-small' },
    {
        name: 'default up: fix-small + uncertain → feature',
        signals: { changedFiles: ['frontend/app/view/x.tsx'], hints: { uncertain: true } },
        expect: 'feature',
    },
    {
        name: 'default up: feature + uncertain → new-surface',
        signals: { changedFiles: ['frontend/app/view/x.tsx'], hints: { behaviorChange: true, uncertain: true } },
        expect: 'new-surface',
    },
    {
        name: 'default up: docs + uncertain → arch',
        signals: { changedFiles: ['docs/a.md'], hints: { uncertain: true } },
        expect: 'arch',
    },
    {
        name: 'precedence: repro 压过 tokens',
        signals: { hasRepro: true, changedFiles: ['frontend/app/styles/tokens.css'] },
        expect: 'bug',
    },
    {
        name: 'precedence: 新增页面压过 scss',
        signals: { addedFiles: ['src/pages/x.tsx'], changedFiles: ['a.scss'] },
        expect: 'new-surface',
    },
    {
        name: 'hint 只能升不能降（arch + hint fix-small 仍 arch）',
        signals: { changedFiles: ['shared/types.ts'], hints: { type: 'fix-small' } },
        expect: 'arch',
    },
];
