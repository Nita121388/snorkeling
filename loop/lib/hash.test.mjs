import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prdHash, textHash } from './hash.mjs';

const dir = mkdtempSync(join(tmpdir(), 'loop-hash-'));

function writePrd(name, { header, body, signature }) {
    const p = join(dir, name);
    writeFileSync(p, `${header}\n\n---\n\n${body}\n\n## G1 签字\n\n${signature}\n`, 'utf8');
    return p;
}

const BODY = '## Goal\n\n做一件事。\n\n## Requirements\n\n- R1.1 必须\n';

test('prdHash: 头部元信息变化不影响 hash（签字后补 Confirmed 行不能自毁）', () => {
    const a = writePrd('a.md', { header: '> 状态：待签', body: BODY, signature: 'pending' });
    const b = writePrd('b.md', { header: '> 状态：✅ 已签\n> Confirmed: 2026-11-05 @nita', body: BODY, signature: 'confirmed' });
    assert.equal(prdHash(a), prdHash(b));
});

test('prdHash: 需求正文变化 → hash 变化', () => {
    const a = writePrd('c.md', { header: '> x', body: BODY, signature: 's' });
    const b = writePrd('d.md', { header: '> x', body: BODY + '- R1.2 追加\n', signature: 's' });
    assert.notEqual(prdHash(a), prdHash(b));
});

test('prdHash: CRLF 与 LF 等价', () => {
    const p = join(dir, 'e.md');
    writeFileSync(p, '> h\r\n\r\n## Goal\r\n\r\n正文\r\n\r\n## G1 签字\r\n', 'utf8');
    const q = join(dir, 'f.md');
    writeFileSync(q, '> h\n\n## Goal\n\n正文\n\n## G1 签字\n', 'utf8');
    assert.equal(prdHash(p), prdHash(q));
});

test('prdHash: 缺 ## Goal 抛错', () => {
    const p = join(dir, 'g.md');
    writeFileSync(p, '# 只有标题\n', 'utf8');
    assert.throws(() => prdHash(p), /missing "## Goal"/);
});

test('textHash: 12 位十六进制', () => {
    assert.match(textHash('abc'), /^[0-9a-f]{12}$/);
    assert.notEqual(textHash('abc'), textHash('abd'));
});
