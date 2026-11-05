import test from 'node:test';
import assert from 'node:assert/strict';
import { safeResolve, assertTrellisWritable, REPO_ROOT, LOOP_DIR } from './paths.mjs';
import { sep } from 'node:path';

test('safeResolve: 仓内相对路径通过', () => {
    const abs = safeResolve(REPO_ROOT, 'loop/queue.json');
    assert.ok(abs.startsWith(LOOP_DIR + sep));
});

test('safeResolve: .. 逃逸被拒', () => {
    assert.throws(() => safeResolve(REPO_ROOT, '../../etc/passwd'), /escapes root/);
});

test('safeResolve: 绝对路径逃逸被拒', () => {
    assert.throws(() => safeResolve(REPO_ROOT, '/etc/passwd'), /escapes root/);
});

test('safeResolve: 中间层 .. 回到根内仍通过', () => {
    assert.doesNotThrow(() => safeResolve(REPO_ROOT, 'loop/../loop/queue.json'));
});

test('assertTrellisWritable: 只放行 prd.md 与 config.yaml', () => {
    assert.equal(assertTrellisWritable('.trellis/tasks/11-05-x/prd.md'), true);
    assert.equal(assertTrellisWritable('.trellis/config.yaml'), true);
    assert.throws(() => assertTrellisWritable('.trellis/tasks/11-05-x/design.md'), /not whitelisted/);
    assert.throws(() => assertTrellisWritable('.trellis/workflow.md'), /not whitelisted/);
    assert.throws(() => assertTrellisWritable('src/a.ts'), /not whitelisted/);
});
