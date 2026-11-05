// 教训库索引：loop/LESSONS.md（可检索、可审计）+ .trellis/spec（可注入）。
// 分工：索引只放一行指针；正文写进 spec，靠 paths 前缀在下次碰到同样文件时自动注入。
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { LOOP_DIR, REPO_ROOT, safeResolve } from './paths.mjs';

export const LESSONS_FILE = 'LESSONS.md';
export const HEADER = `# LESSONS — 教训库索引

> 一条教训 = 索引一行 + 正文写进 \`.trellis/spec/\`（带 \`paths:\` 前缀，下次碰到同样文件自动注入）。
> 只写索引不写 spec = 没人会看见；只写 spec 不写索引 = 无法审计谁在复用。
> 写入用 \`queue.mjs lesson add\`，它会同时校验 spec 存在与 paths 前缀。
`;

/** 解析索引。每条以 `### L-xxxx 标题` 开头，后跟 `- 字段: 值`。 */
export function parseLessons(markdown) {
    const out = [];
    const blocks = String(markdown).split(/^### /m).slice(1);
    for (const b of blocks) {
        const [head, ...rest] = b.split('\n');
        const m = /^(L-\d+)\s+(.+)$/.exec(head.trim());
        if (!m) continue;
        const l = { id: m[1], title: m[2].trim(), key: null, trigger: null, spec: null, at: null, refs: 0 };
        for (const line of rest) {
            const f = /^-\s*(key|触发|规范|入库|引用):\s*(.+)$/.exec(line.trim());
            if (!f) continue;
            const [, k, v] = f;
            if (k === 'key') l.key = v.trim();
            else if (k === '触发') l.trigger = v.trim();
            else if (k === '规范') l.spec = v.trim().replace(/`/g, '');
            else if (k === '入库') l.at = v.trim();
            else if (k === '引用') l.refs = Number(v.replace(/[^\d]/g, '')) || 0;
        }
        out.push(l);
    }
    return out;
}

export function nextLessonId(markdown) {
    const ids = parseLessons(markdown).map((l) => Number(l.id.slice(2)));
    return `L-${String((ids.length ? Math.max(...ids) : 0) + 1).padStart(4, '0')}`;
}

export function renderLesson(l) {
    return [
        `### ${l.id} ${l.title}`,
        `- key: ${l.key}`,
        `- 触发: ${l.trigger}`,
        `- 规范: \`${l.spec}\``,
        `- 入库: ${l.at}`,
        `- 引用: ${l.refs}`,
    ].join('\n');
}

export function readLessons(dir = LOOP_DIR) {
    const p = join(dir, LESSONS_FILE);
    if (!existsSync(p)) return { markdown: HEADER, lessons: [] };
    const markdown = readFileSync(p, 'utf8');
    return { markdown, lessons: parseLessons(markdown) };
}

export function appendLesson(lesson, dir = LOOP_DIR) {
    const { markdown } = readLessons(dir);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, LESSONS_FILE), `${markdown.trimEnd()}\n\n${renderLesson(lesson)}\n`, 'utf8');
    return lesson;
}

/** 目标 spec 必须存在，且 frontmatter 带 `paths:` —— 否则不会被路径注入，等于没写。 */
export function specInjectability(specRel) {
    const abs = safeResolve(REPO_ROOT, specRel);
    if (!existsSync(abs)) return { ok: false, reason: '文件不存在' };
    const text = readFileSync(abs, 'utf8');
    if (!text.startsWith('---')) return { ok: false, reason: '缺 frontmatter，不会被路径注入' };
    const end = text.indexOf('\n---', 4);
    const fm = end < 0 ? '' : text.slice(4, end);
    if (!/^paths:/m.test(fm)) return { ok: false, reason: 'frontmatter 缺 paths:，不会被路径注入' };
    return { ok: true, reason: null };
}

/** 长期未被引用的教训：入库超过 days 天且 refs 为 0。 */
export function staleLessons(lessons, { now = Date.now(), days = 90 } = {}) {
    return lessons.filter((l) => {
        if (l.refs > 0) return false;
        const t = Date.parse(l.at ?? '');
        if (!Number.isFinite(t)) return false;
        return now - t > days * 864e5;
    });
}

/** G8 与教训库对账：G8 要求沉淀的问题键，是否都有对应的教训条目。 */
export function lessonsCovering(lessons, key) {
    return lessons.filter((l) => l.key === key);
}
