import test from 'node:test';
import assert from 'node:assert/strict';
import { issueKey, repeatedIssues, sedimentGate, sediments } from './sediment.mjs';

const NOW = Date.parse('2026-11-05T12:00:00Z');
const ev = (o) => ({ ts: new Date(NOW).toISOString(), shift: 'night', id: 'p1', action: 'note', verdict: null, ...o });

test('issueKey: park 与 drop 折算成键，普通 note 不算', () => {
    assert.equal(issueKey(ev({ action: 'park', verdict: 'human-wall' })), 'park:human-wall');
    assert.equal(issueKey(ev({ action: 'drop', verdict: 'dup' })), 'drop:dup');
    assert.equal(issueKey(ev({ action: 'note', verdict: 'type-override:bug' })), null);
    assert.equal(issueKey(ev({ action: 'verify', to: 'green' })), null);
    assert.equal(issueKey(null), null);
});

test('repeatedIssues: 同键两次才算重复', () => {
    const events = [
        ev({ id: 'a', action: 'park', verdict: 'flaky' }),
        ev({ id: 'b', action: 'park', verdict: 'flaky' }),
        ev({ id: 'c', action: 'park', verdict: 'budget' }),
    ];
    const r = repeatedIssues(events, { now: NOW });
    assert.equal(r.length, 1);
    assert.equal(r[0].key, 'park:flaky');
    assert.equal(r[0].count, 2);
    assert.deepEqual(r[0].ids, ['a', 'b']);
});

test('repeatedIssues: 窗口外的旧问题不计入', () => {
    const old = new Date(NOW - 120 * 864e5).toISOString();
    const events = [
        ev({ id: 'a', action: 'park', verdict: 'flaky', ts: old }),
        ev({ id: 'b', action: 'park', verdict: 'flaky' }),
    ];
    assert.equal(repeatedIssues(events, { now: NOW }).length, 0);
});

test('sedimentGate: 有重复但没沉淀 → 不通过', () => {
    const events = [
        ev({ id: 'a', action: 'park', verdict: 'human-wall' }),
        ev({ id: 'b', action: 'park', verdict: 'human-wall' }),
    ];
    const g = sedimentGate(events, { now: NOW });
    assert.equal(g.ok, false);
    assert.equal(g.missing[0].key, 'park:human-wall');
});

test('sedimentGate: 写了 sediment 记录 → 通过', () => {
    const events = [
        ev({ id: 'a', action: 'park', verdict: 'human-wall' }),
        ev({ id: 'b', action: 'park', verdict: 'human-wall' }),
        ev({ id: null, action: 'note', verdict: 'sediment:park:human-wall', evidence: '.trellis/spec/guides/x.md' }),
    ];
    const g = sedimentGate(events, { now: NOW });
    assert.equal(g.ok, true);
    assert.equal(g.sediments[0].evidence, '.trellis/spec/guides/x.md');
});

test('sedimentGate: 不重复的问题不要求沉淀', () => {
    const events = [ev({ action: 'park', verdict: 'budget' })];
    assert.equal(sedimentGate(events, { now: NOW }).ok, true);
});

test('sediments: 只认 note 且以 sediment: 开头', () => {
    const list = sediments([
        ev({ action: 'note', verdict: 'sediment:park:flaky' }),
        ev({ action: 'note', verdict: 'type-override:arch' }),
        ev({ action: 'park', verdict: 'sediment:fake' }),
    ]);
    assert.equal(list.length, 1);
    assert.equal(list[0].key, 'park:flaky');
});
