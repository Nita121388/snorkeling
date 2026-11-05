import test from 'node:test';
import assert from 'node:assert/strict';
import { parseItem, parseInbox, markDone, archiveDone, appendInbox } from './inbox.mjs';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('parseItem: 基本条目', () => {
    const it = parseItem('- [ ] 2026-11-05 预览块抖动');
    assert.equal(it.done, false);
    assert.equal(it.text, '2026-11-05 预览块抖动');
    assert.equal(it.source, 'self');
});

test('parseItem: 带来源与已完成', () => {
    assert.equal(parseItem('- [ ] 想法 @github').source, 'github');
    assert.equal(parseItem('- [x] 做完了').done, true);
    assert.equal(parseItem('普通段落'), null);
});

test('parseInbox: 只返回未关闭项且连续编号', () => {
    const md = ['# INBOX', '', '- [x] 旧的', '- [ ] 一', '- [ ] 二'].join('\n');
    const items = parseInbox(md);
    assert.deepEqual(items.map((i) => [i.n, i.text]), [[1, '一'], [2, '二']]);
});

test('markDone: 勾掉第 n 个未关闭项（跳过已完成）', () => {
    const md = ['- [x] 旧的', '- [ ] 一', '- [ ] 二'].join('\n');
    const r = markDone(md, 2);
    assert.equal(r.item.text, '二');
    assert.match(r.text, /- \[x\] 旧的\n- \[ \] 一\n- \[x\] 二/);
});

test('markDone: 越界返回 null（不许静默成功）', () => {
    assert.equal(markDone('- [ ] 一', 5), null);
});

test('archiveDone: 已完成条目搬到按月归档', () => {
    const dir = mkdtempSync(join(tmpdir(), 'loop-inbox-'));
    mkdirSync(dir, { recursive: true });
    const md = ['- [x] 旧的', '- [ ] 新的'].join('\n');
    const r = archiveDone(md, { dir, month: '2026-11' });
    assert.equal(r.moved, 1);
    assert.equal(r.markdown.trim(), '- [ ] 新的');
});

test('appendInbox: 写入一行且自动带日期', () => {
    const dir = mkdtempSync(join(tmpdir(), 'loop-inbox-'));
    const line = appendInbox('滚动抖动', { dir, date: '2026-11-05' });
    assert.match(line, /^- \[ \] 2026-11-05 滚动抖动$/);
});
