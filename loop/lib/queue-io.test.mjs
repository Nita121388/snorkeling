import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadStore, loadStoreDetailed, saveStore, queuePaths } from './queue-io.mjs';

const dir = () => mkdtempSync(join(tmpdir(), 'loop-qio-'));

test('文件不存在 → 空凭据（首次使用合法）', () => {
    const d = dir();
    const r = loadStoreDetailed({ dir: d });
    assert.equal(r.source, 'empty');
    assert.deepEqual(r.queue.gates, {});
});

test('正常读取', () => {
    const d = dir();
    writeFileSync(queuePaths(d).file, JSON.stringify({ version: 2, gates: { a: { g2: {} } } }), 'utf8');
    const r = loadStoreDetailed({ dir: d });
    assert.equal(r.source, 'file');
    assert.ok(r.queue.gates.a);
});

test('解析失败 + 有 last-good → 回退快照并告警（绝不静默清空）', () => {
    const d = dir();
    const store = { version: 2, gates: { keep: { g2: { redProof: 'x' } } }, dropped: [] };
    saveStore(structuredClone(store), { dir: d });
    writeFileSync(queuePaths(d).file, '{ "version": 2, "gates": { ', 'utf8');

    const warnings = [];
    const got = loadStore({ dir: d, onWarn: (m) => warnings.push(m) });
    assert.ok(got.gates.keep, '必须回退到上次成功快照');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /解析失败/);
});

test('解析失败 + 无 last-good → 抛错（不装作空凭据）', () => {
    const d = dir();
    writeFileSync(queuePaths(d).file, 'not json at all', 'utf8');
    assert.throws(() => loadStore({ dir: d, onWarn: () => {} }), /没有可用的 last-good 快照/);
});

test('saveStore 原子写 + 刷新 last-good', () => {
    const d = dir();
    saveStore({ version: 2, gates: {}, dropped: [] }, { dir: d });
    const p = queuePaths(d);
    assert.ok(existsSync(p.file));
    assert.ok(existsSync(p.lastGood));
    assert.equal(readFileSync(p.file, 'utf8'), readFileSync(p.lastGood, 'utf8'));
    assert.ok(JSON.parse(readFileSync(p.file, 'utf8')).updatedAt);
});
