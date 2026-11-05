import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadQueue, loadQueueDetailed, saveQueue, queuePaths } from './queue-io.mjs';

const dir = () => mkdtempSync(join(tmpdir(), 'loop-qio-'));

test('文件不存在 → 空队列（首次使用合法）', () => {
    const d = dir();
    const r = loadQueueDetailed({ dir: d });
    assert.equal(r.source, 'empty');
    assert.deepEqual(r.queue.packages, []);
});

test('正常读取', () => {
    const d = dir();
    writeFileSync(queuePaths(d).file, JSON.stringify({ version: 1, packages: [{ id: 'a' }] }), 'utf8');
    const r = loadQueueDetailed({ dir: d });
    assert.equal(r.source, 'file');
    assert.equal(r.queue.packages.length, 1);
});

test('解析失败 + 有 last-good → 回退快照并告警（绝不静默清空）', () => {
    const d = dir();
    const q = { version: 1, project: 'x', packages: [{ id: 'keep-me' }], dropped: [] };
    saveQueue(structuredClone(q), { dir: d });

    // 把主文件写坏（模拟手改出错 / 半截写入）
    writeFileSync(queuePaths(d).file, '{ "version": 1, "packages": [ ', 'utf8');

    const warnings = [];
    const got = loadQueue({ dir: d, onWarn: (m) => warnings.push(m) });

    assert.equal(got.packages.length, 1, '必须回退到上次成功快照');
    assert.equal(got.packages[0].id, 'keep-me');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /解析失败/);
});

test('解析失败 + 无 last-good → 抛错（不装作空队列）', () => {
    const d = dir();
    writeFileSync(queuePaths(d).file, 'not json at all', 'utf8');
    assert.throws(() => loadQueue({ dir: d, onWarn: () => {} }), /没有可用的 last-good 快照/);
});

test('saveQueue 原子写 + 刷新 last-good', () => {
    const d = dir();
    saveQueue({ version: 1, project: 'p', packages: [], dropped: [] }, { dir: d });
    const p = queuePaths(d);
    assert.ok(existsSync(p.file));
    assert.ok(existsSync(p.lastGood));
    assert.equal(readFileSync(p.file, 'utf8'), readFileSync(p.lastGood, 'utf8'));
    assert.ok(JSON.parse(readFileSync(p.file, 'utf8')).updatedAt);
});
