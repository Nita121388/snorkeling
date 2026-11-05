// 工作项笔记：Obsidian 风格（YAML 子集 frontmatter + 固定小节）。
// 分工：人写 items/*.md（标题/优先级/来源/背景/判据）；机器只写 gates 凭据（queue.json）。
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { LOOP_DIR } from './paths.mjs';

export const ITEMS_DIR = 'items';
export const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
export const ORIGINS = ['self', 'issue', 'pr', 'community', 'social', 'internal'];
export const SECTIONS = ['背景', '来源', '验收判据', '记录'];

const KEY_ORDER = [
    'id', 'title', 'type', 'priority', 'status', 'origin', 'source', 'task',
    'order', 'touch', 'rollback', 'budget', 'releaseCandidate', 'createdAt',
];

// ---------- 标量 ----------
function parseScalar(raw) {
    const s = raw.trim();
    if (s === '' || s === 'null' || s === '~') return null;
    if (s === 'true') return true;
    if (s === 'false') return false;
    if (s.startsWith('[') && s.endsWith(']')) return parseInlineList(s.slice(1, -1));
    if (s.startsWith('{') && s.endsWith('}')) return parseInlineMap(s.slice(1, -1));
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
    if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
    return s;
}

function splitTop(s, sep = ',') {
    const out = [];
    let depth = 0, cur = '', quote = null;
    for (const ch of s) {
        if (quote) { cur += ch; if (ch === quote) quote = null; continue; }
        if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
        if (ch === '[' || ch === '{') depth++;
        if (ch === ']' || ch === '}') depth--;
        if (ch === sep && depth === 0) { out.push(cur); cur = ''; continue; }
        cur += ch;
    }
    if (cur.trim()) out.push(cur);
    return out;
}

function parseInlineList(body) {
    return splitTop(body).map((x) => parseScalar(x)).filter((x) => x !== null || true);
}

function parseInlineMap(body) {
    const obj = {};
    for (const pair of splitTop(body)) {
        const i = pair.indexOf(':');
        if (i < 0) continue;
        obj[pair.slice(0, i).trim()] = parseScalar(pair.slice(i + 1));
    }
    return obj;
}

/** 解析 YAML 子集（支持 2 空格缩进的两层嵌套）。 */
export function parseYamlSubset(text) {
    const lines = String(text).replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'));
    const root = {};
    const stack = [{ indent: -1, obj: root }];
    for (const line of lines) {
        const indent = line.length - line.trimStart().length;
        const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line.trim());
        if (!m) continue;
        while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
        const parent = stack[stack.length - 1].obj;
        const [, key, rest] = m;
        if (rest.trim() === '') {
            const child = {};
            parent[key] = child;
            stack.push({ indent, obj: child });
        } else {
            parent[key] = parseScalar(rest);
        }
    }
    return root;
}

export function splitFrontmatter(text) {
    const src = String(text).replace(/\r\n/g, '\n');
    if (!src.startsWith('---\n')) return { frontmatter: null, body: src };
    const end = src.indexOf('\n---', 4);
    if (end < 0) return { frontmatter: null, body: src };
    return { frontmatter: src.slice(4, end), body: src.slice(end + 4).replace(/^\n/, '') };
}

// ---------- 正文小节 ----------
export function sectionBody(body, name) {
    const re = new RegExp(`^##\\s+${name}\\s*$`, 'm');
    const m = re.exec(body);
    if (!m) return '';
    const rest = body.slice(m.index + m[0].length);
    const next = /^##\s+/m.exec(rest);
    return (next ? rest.slice(0, next.index) : rest).trim();
}

/** 从「验收判据」小节解析 accept：[{cmd, expect}] */
export function parseAccept(body) {
    const out = [];
    for (const line of sectionBody(body, '验收判据').split('\n')) {
        const m = /^\s*-\s*\[[ xX]\]\s*`([^`]+)`\s*(?:→|->)\s*`([^`]+)`/.exec(line);
        if (m) out.push({ cmd: m[1].trim(), expect: m[2].trim() });
    }
    return out;
}

export function renderAccept(accept) {
    if (!accept?.length) return '_（待补：命令 → 期望数字）_\n';
    return accept.map((a) => `- [ ] \`${a.cmd}\` → \`${a.expect}\``).join('\n') + '\n';
}

// ---------- 序列化 ----------
function fmtScalar(v) {
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    const s = String(v);
    if (s === '') return '""';
    if (/^[A-Za-z0-9_./*\-]+$/.test(s) && !/^\d+$/.test(s)) return s;
    return `"${s.replace(/"/g, '\\"')}"`;
}

function fmtInline(v) {
    if (Array.isArray(v)) return `[${v.map(fmtScalar).join(', ')}]`;
    if (v && typeof v === 'object') return `{${Object.entries(v).map(([k, x]) => `${k}: ${fmtScalar(x)}`).join(', ')}}`;
    return fmtScalar(v);
}

export function renderItem(item) {
    const fm = KEY_ORDER.filter((k) => item[k] !== undefined)
        .map((k) => `${k}: ${fmtInline(item[k])}`);
    const body = SECTION_ORDER.map((name) => {
        const given = (item.sections?.[name] ?? '').trim();
        // 「验收判据」以 accept 为准（列表格式）；人只写段落时原样保留
        if (name === '验收判据' && item.accept?.length) return `## ${name}\n\n${renderAccept(item.accept)}`;
        return `## ${name}\n\n${given || '_（待补）_'}\n`;
    }).join('\n');
    return `---\n${fm.join('\n')}\n---\n\n# ${item.title ?? item.id}\n\n${body}`;
}

export const SECTION_ORDER = SECTIONS;

// ---------- 读写 ----------
export function itemsDir(dir = LOOP_DIR) {
    return join(dir, ITEMS_DIR);
}

export function readItem(file) {
    const raw = readFileSync(file, 'utf8');
    const { frontmatter, body } = splitFrontmatter(raw);
    if (!frontmatter) throw new Error(`缺少 frontmatter: ${file}`);
    const data = parseYamlSubset(frontmatter);
    if (!data.id) throw new Error(`frontmatter 缺 id: ${file}`);
    const sections = {};
    for (const name of SECTIONS) sections[name] = sectionBody(body, name);
    return { ...data, accept: parseAccept(body), sections, body, file };
}

export function readItems(dir = LOOP_DIR) {
    const d = itemsDir(dir);
    if (!existsSync(d)) return [];
    return readdirSync(d)
        .filter((f) => f.endsWith('.md'))
        .map((f) => readItem(join(d, f)))
        .sort((a, b) => {
            const pa = PRIORITIES.indexOf(a.priority ?? 'P2');
            const pb = PRIORITIES.indexOf(b.priority ?? 'P2');
            if (pa !== pb) return pa - pb;
            const oa = Number(a.order ?? 100), ob = Number(b.order ?? 100);
            if (oa !== ob) return oa - ob;
            return String(a.id).localeCompare(String(b.id));
        });
}

export function writeItem(item, dir = LOOP_DIR) {
    const d = itemsDir(dir);
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
    const file = join(d, `${item.id}.md`);
    const tmp = `${file}.tmp-${process.pid}`;
    writeFileSync(tmp, renderItem(item), 'utf8');
    renameSync(tmp, file);
    return file;
}

export function archiveItem(item, { dir = LOOP_DIR, month = new Date().toISOString().slice(0, 7) } = {}) {
    const d = join(itemsDir(dir), 'archive', month);
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
    const from = join(itemsDir(dir), `${item.id}.md`);
    const to = join(d, `${item.id}.md`);
    if (existsSync(from)) renameSync(from, to);
    return to;
}

/** 机械校验：必填元信息齐全。 */
export function validateItem(item) {
    const problems = [];
    if (!item.id) problems.push('缺 id');
    if (!item.title) problems.push('缺 title');
    if (!item.type) problems.push('缺 type');
    if (!item.priority) problems.push('缺 priority');
    else if (!PRIORITIES.includes(item.priority)) problems.push(`priority 必须是 ${PRIORITIES.join('|')}`);
    if (!item.origin) problems.push('缺 origin');
    else if (!ORIGINS.includes(item.origin)) problems.push(`origin 必须是 ${ORIGINS.join('|')}`);
    if (!item.source) problems.push('缺 source（来源）');
    if (!item.sections?.背景?.trim()) problems.push('缺「背景」小节');
    return problems;
}
