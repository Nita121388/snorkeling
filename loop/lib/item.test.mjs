import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    parseYamlSubset, splitFrontmatter, parseAccept, renderItem, readItem, writeItem,
    readItems, validateItem, PRIORITIES,
} from './item.mjs';

const FM = `---
id: N-1
title: "预览块滚动抖动"
type: bug
priority: P1
origin: self
source: "INBOX #3"
touch: [loop/**, docs/]
budget: {minutes: 40, retries: 2}
releaseCandidate: false
---

# 预览块滚动抖动

## 背景

滚到顶部时轻微抖动。

## 验收判据

- [ ] \`node a.mjs\` → \`0 failed\`
- [x] \`node b.mjs\` → \`31/31\`
`;

test('parseYamlSubset: 标量 / 内联数组 / 内联对象 / 引号', () => {
    const d = parseYamlSubset(FM.split('---')[1]);
    assert.equal(d.id, 'N-1');
    assert.equal(d.priority, 'P1');
    assert.equal(d.title, '预览块滚动抖动');
    assert.deepEqual(d.touch, ['loop/**', 'docs/']);
    assert.deepEqual(d.budget, { minutes: 40, retries: 2 });
    assert.equal(d.releaseCandidate, false);
});

test('parseYamlSubset: 两层嵌套（gates）', () => {
    const d = parseYamlSubset(['gates:', '  g2:', '    redProof: "x failed"'].join('\n'));
    assert.equal(d.gates.g2.redProof, 'x failed');
});

test('splitFrontmatter: 无 frontmatter 返回 null 且保留正文', () => {
    const r = splitFrontmatter('普通文本');
    assert.equal(r.frontmatter, null);
    assert.equal(r.body, '普通文本');
});

test('parseAccept: 只取带反引号的命令与期望', () => {
    const items = parseAccept(FM);
    assert.deepEqual(items, [
        { cmd: 'node a.mjs', expect: '0 failed' },
        { cmd: 'node b.mjs', expect: '31/31' },
    ]);
});

test('round-trip: render 后 read 字段一致', () => {
    const dir = mkdtempSync(join(tmpdir(), 'loop-item-'));
    const item = {
        id: 'N-2', title: '往返测试', type: 'chore', priority: 'P2', origin: 'self',
        source: '测试', order: 100, touch: ['loop/**'], budget: { minutes: 20, retries: 1 },
        accept: [{ cmd: 'node x', expect: '1 passed' }],
        sections: { 背景: '背景文字', 来源: '- self：测试', 验收判据: '', 记录: '' },
    };
    const file = writeItem(item, dir);
    const back = readItem(file);
    assert.equal(back.id, 'N-2');
    assert.equal(back.priority, 'P2');
    assert.deepEqual(back.touch, ['loop/**']);
    assert.deepEqual(back.budget, { minutes: 20, retries: 1 });
    assert.deepEqual(back.accept, [{ cmd: 'node x', expect: '1 passed' }]);
    assert.equal(back.sections.背景, '背景文字');
});

test('readItems: 按优先级排序（P0 在最前）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'loop-item-'));
    mkdirSync(join(dir, 'items'), { recursive: true });
    const base = { type: 'chore', origin: 'self', source: 's', sections: { 背景: 'b' } };
    writeItem({ ...base, id: 'a', title: 'A', priority: 'P2' }, dir);
    writeItem({ ...base, id: 'b', title: 'B', priority: 'P0' }, dir);
    assert.deepEqual(readItems(dir).map((i) => i.id), ['b', 'a']);
});

test('validateItem: 缺背景与缺来源都要报', () => {
    const problems = validateItem({ id: 'x', title: 't', type: 'bug', priority: 'P0', origin: 'self', sections: {} });
    assert.ok(problems.some((p) => p.includes('背景')));
    assert.ok(problems.some((p) => p.includes('来源')));
});

test('PRIORITIES: 枚举固定为 P0..P3', () => {
    assert.deepEqual(PRIORITIES, ['P0', 'P1', 'P2', 'P3']);
});

test('renderItem: 四个小节始终存在', () => {
    const text = renderItem({ id: 'z', title: 'Z', type: 'bug', priority: 'P3', origin: 'self', sections: {} });
    for (const s of ['## 背景', '## 来源', '## 验收判据', '## 记录']) assert.ok(text.includes(s), s);
});
