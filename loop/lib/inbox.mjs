// INBOX：人自己的随手记录通道。允许粗糙——分类与判据留到分诊。
// 格式刻意宽松：一行一条，`- [ ] 文本`，可选结尾 `@来源`。
import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { LOOP_DIR } from './paths.mjs';

export const INBOX_FILE = 'INBOX.md';

const LINE = /^-\s*\[( |x|X)\]\s*(.+?)\s*$/;

/** 解析一行；不是条目返回 null。 */
export function parseItem(line, index = 0) {
    const m = LINE.exec(String(line).trim());
    if (!m) return null;
    const done = m[1].toLowerCase() === 'x';
    let text = m[2];
    let source = 'self';
    const at = /@([A-Za-z0-9_-]+)$/.exec(text);
    if (at) {
        source = at[1];
        text = text.slice(0, at.index).trim();
    }
    return { n: index, done, text, source };
}

/** 解析整个 INBOX 正文 → 未关闭条目（编号从 1 开始，仅对未关闭项计数）。 */
export function parseInbox(markdown) {
    const items = [];
    let n = 0;
    for (const line of String(markdown).split('\n')) {
        const it = parseItem(line);
        if (!it) continue;
        if (it.done) continue;
        items.push({ ...it, n: ++n });
    }
    return items;
}

/** 把第 n 个未关闭条目勾掉（保留原文，改为 [x]）。找不到返回 null。 */
export function markDone(markdown, n) {
    const lines = String(markdown).split('\n');
    let count = 0;
    for (let i = 0; i < lines.length; i++) {
        const it = parseItem(lines[i]);
        if (!it || it.done) continue;
        if (++count !== n) continue;
        lines[i] = lines[i].replace(/\[( |x|X)\]/, '[x]');
        return { text: lines.join('\n'), item: it };
    }
    return null;
}

export function readInbox(dir = LOOP_DIR) {
    const p = join(dir, INBOX_FILE);
    if (!existsSync(p)) return '';
    return readFileSync(p, 'utf8');
}

/** 追加一条（带日期），返回写入的文本行。 */
export function appendInbox(text, { dir = LOOP_DIR, date = new Date().toISOString().slice(0, 10), source = 'self' } = {}) {
    const p = join(dir, INBOX_FILE);
    const line = `- [ ] ${date} ${String(text).trim()}${source && source !== 'self' ? ` @${source}` : ''}\n`;
    appendFileSync(p, line, 'utf8');
    return line.trim();
}

/** 归档：把已勾掉的条目搬到 INBOX-ARCHIVE/<month>.md。 */
export function archiveDone(markdown, { dir = LOOP_DIR, month = new Date().toISOString().slice(0, 7) } = {}) {
    const keep = [];
    const moved = [];
    for (const line of String(markdown).split('\n')) {
        const it = parseItem(line);
        if (it && it.done) moved.push(line);
        else keep.push(line);
    }
    if (!moved.length) return { moved: 0, markdown: String(markdown) };
    const ad = join(dir, 'INBOX-ARCHIVE');
    if (!existsSync(ad)) mkdirSync(ad, { recursive: true });
    appendFileSync(join(ad, `${month}.md`), moved.join('\n') + '\n', 'utf8');
    return { moved: moved.length, markdown: keep.join('\n') };
}

export function writeInbox(markdown, dir = LOOP_DIR) {
    writeFileSync(join(dir, INBOX_FILE), markdown, 'utf8');
}
