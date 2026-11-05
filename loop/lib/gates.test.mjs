import test from 'node:test';
import assert from 'node:assert/strict';
import { gateCases } from './fixtures.mjs';
import { gateStateOf, gateProgress, requiredGates, checkGate } from './gates.mjs';

for (const c of gateCases) {
    test(`gate: ${c.name}`, () => {
        const got = gateStateOf(c.pkg, c.ctx);
        assert.equal(got.state, c.expect);
        if (c.reason) assert.equal(got.reason, c.reason);
        if (c.drift) assert.equal(got.drift, true);
    });
}

test('gateProgress: arch 3/3 门（g1 g2 g5 g6 中 4 道里已过 2）', () => {
    const p = {
        type: 'arch',
        gates: {
            g1: { verdict: 'confirmed', prdHash: 'a' },
            g2: { redProof: 'x' },
        },
    };
    const prog = gateProgress(p, { prdHash: 'a' });
    assert.deepEqual(prog.gates, ['g1', 'g2', 'g5', 'g6']);
    assert.equal(prog.done, 2);
    assert.equal(prog.total, 4);
});

test('requiredGates: 未知类型回退 fix-small', () => {
    assert.deepEqual(requiredGates('nope'), requiredGates('fix-small'));
});

test('checkGate: 未知门返回 unknown-gate', () => {
    assert.equal(checkGate('g9', { gates: {} }).reason, 'unknown-gate');
});
