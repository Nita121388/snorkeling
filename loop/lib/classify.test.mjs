import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCases } from './fixtures.mjs';
import { classify, UPGRADE, TYPE_RANK } from './classify.mjs';

for (const c of classifyCases) {
    test(`classify: ${c.name}`, () => {
        assert.equal(classify(c.signals).type, c.expect);
    });
}

test('classify: 空信号 → fix-small 兜底', () => {
    assert.equal(classify({}).type, 'fix-small');
});

test('classify: uncertain 时 escalated=true', () => {
    const r = classify({ changedFiles: ['docs/a.md'], hints: { uncertain: true } });
    assert.equal(r.escalated, true);
    assert.match(r.rule, /uncertain-up/);
});

test('UPGRADE 表单调（rank 只增不减）', () => {
    for (const [from, to] of Object.entries(UPGRADE)) {
        assert.ok(TYPE_RANK[to] >= TYPE_RANK[from], `${from} -> ${to} 不是升级`);
    }
});
