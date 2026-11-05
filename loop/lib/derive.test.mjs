import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveRunStates, isRunnable } from './derive.mjs';

const ev = (o) => ({ ts: '2026-11-05T22:00:00Z', shift: 'night', id: 'p1', action: 'x', from: null, to: null, ...o });

test('derive: 空事件 → idle', () => {
    assert.equal(deriveRunStates([]).size, 0);
});

test('derive: queued → running → green → committed', () => {
    const m = deriveRunStates([
        ev({ action: 'approve', to: 'queued' }),
        ev({ action: 'pick', from: 'queued', to: 'running' }),
        ev({ action: 'verify', from: 'running', to: 'green', evidence: 'r.md#L1' }),
        ev({ action: 'commit', to: 'committed', commit: 'abc1234' }),
    ]);
    const s = m.get('p1');
    assert.equal(s.runState, 'committed');
    assert.equal(s.commit, 'abc1234');
    assert.equal(s.evidence, 'r.md#L1');
    assert.equal(s.events, 4);
});

test('derive: park 记录原因，恢复后清空', () => {
    const m = deriveRunStates([
        ev({ action: 'pick', to: 'running' }),
        ev({ action: 'park', from: 'running', to: 'parked', verdict: 'human-wall' }),
    ]);
    assert.equal(m.get('p1').runState, 'parked');
    assert.equal(m.get('p1').parkReason, 'human-wall');

    const m2 = deriveRunStates([
        ev({ action: 'pick', to: 'running' }),
        ev({ action: 'park', from: 'running', to: 'parked', verdict: 'flaky' }),
        ev({ action: 'pick', from: 'parked', to: 'running' }),
    ]);
    assert.equal(m2.get('p1').parkReason, null);
});

test('derive: 无 id 的行被忽略（钩子可能写空 id）', () => {
    const m = deriveRunStates([ev({ id: null, to: 'running' }), ev({ id: '', to: 'running' })]);
    assert.equal(m.size, 0);
});

test('derive: 回放幂等（同一序列算两次结果相同）', () => {
    const seq = [ev({ action: 'pick', to: 'running' }), ev({ action: 'verify', to: 'green' })];
    assert.deepEqual(deriveRunStates(seq), deriveRunStates(structuredClone(seq)));
});

test('isRunnable: accepted/released/dropped 不可再进夜班', () => {
    for (const s of ['accepted', 'released', 'dropped']) assert.equal(isRunnable({ runState: s }), false);
    for (const s of ['idle', 'queued', 'running', 'green', 'red', 'parked', 'committed']) {
        assert.equal(isRunnable({ runState: s }), true);
    }
});
