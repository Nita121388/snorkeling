// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * L1 block-type engine (方案 02): pure functions that detect a block's kind and rewrite
 * it into another kind, all on the markdown source text. NO full-document re-serialize:
 * every transform replaces exactly the lines of the anchor block and returns the new
 * full text, so a UI action always maps to ONE line/block diff.
 *
 *   detectBlockKind(lines, line)       — what kind is the block containing `line`?
 *   transformBlockType(text, line, to) — rewrite the block at `line` into kind `to`
 *   matchTypingPattern(line)           — "# " / "> " / "- [ ] " / "```js" / "| a |" typed
 *                                        at a block start (半角 + 全角 equivalent)
 *   rewriteDraftFirstLine(draft)       — commit-path helper: canonicalize a typed draft
 *   applyTypingPatternAtLine(text, ln) — committed-text variant (Enter-split flow)
 *
 * Design notes:
 *   - "callout" is detected (`> [!note] …`) but is not a transform TARGET in M1.
 *   - Code fences guard everything: lines inside ```` ``` ```` never match patterns and
 *     never get their block re-detected as heading/list/… (CommonMark agrees).
 *   - Table detection requires a separator row as line 2 of a pipe-run ("| --- |"); a
 *     lone "| a | b |" paragraph line is NOT auto-detected as a table (only the explicit
 *     typing pattern / Turn-into converts it).
 */

import { normalizeTriggerChar } from "./triggers";

export type BlockKind =
    | "text"
    | "heading1"
    | "heading2"
    | "heading3"
    | "heading4"
    | "heading5"
    | "heading6"
    | "bulleted"
    | "numbered"
    | "todo"
    | "quote"
    | "code"
    | "table"
    | "callout";

export type BlockRange = { start: number; end: number }; // 0-based, inclusive

const FenceLineRe = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const HeadingLineRe = /^ {0,3}(#{1,6})(?:[ \t]+|$)/;
const QuoteLineRe = /^ {0,3}>/;
const CalloutFirstLineRe = /^ {0,3}>\s*\[![A-Za-z]+\]/;
const ListItemLineRe = /^(\s*)([-+*]|\d{1,9}[.)])([ \t]+\[[ xX]\])?[ \t]+/;
const HrLineRe = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const TableSeparatorRe = /^\s*\|?(?:\s*:?-+:?\s*\|?)+\s*$/;

function isBlank(line: string): boolean {
    return line.trim() === "";
}

function isFenceLine(line: string): boolean {
    return FenceLineRe.test(line);
}

export function isTableSeparatorLine(line: string): boolean {
    return line.includes("-") && TableSeparatorRe.test(line);
}

function isTableRowCandidate(line: string): boolean {
    return !isBlank(line) && line.includes("|") && !isFenceLine(line);
}

// ---------------------------------------------------------------------------
// Fences: scan the whole doc once and remember `[start..end]` spans (0-based,
// inclusive). An unterminated opener spans to the document end, matching remark.
// ---------------------------------------------------------------------------

export type FenceSpan = BlockRange & { closed: boolean };

export function computeFenceSpans(lines: string[]): FenceSpan[] {
    const spans: FenceSpan[] = [];
    let open = -1;
    let fenceChar = "";
    let fenceLen = 0;
    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(FenceLineRe);
        if (m == null) {
            continue;
        }
        if (open < 0) {
            // CommonMark: a backtick fence whose info string contains a backtick is not a fence.
            if (m[1][0] === "`" && m[2].includes("`")) {
                continue;
            }
            open = i;
            fenceChar = m[1][0];
            fenceLen = m[1].length;
        } else if (m[1][0] === fenceChar && m[1].length >= fenceLen && /^\s*$/.test(m[2])) {
            spans.push({ start: open, end: i, closed: true });
            open = -1;
            fenceChar = "";
            fenceLen = 0;
        }
    }
    if (open >= 0) {
        spans.push({ start: open, end: lines.length - 1, closed: false });
    }
    return spans;
}

function fenceSpanAt(spans: FenceSpan[], idx: number): FenceSpan | null {
    for (const span of spans) {
        if (idx < span.start) {
            break;
        }
        if (idx <= span.end) {
            return span;
        }
    }
    return null;
}

// ---------------------------------------------------------------------------
// Block range finders (0-based line indexes).
// ---------------------------------------------------------------------------

function findTableRange(lines: string[], idx: number): BlockRange | null {
    if (!isTableRowCandidate(lines[idx])) {
        return null;
    }
    let start = idx;
    let end = idx;
    while (start > 0 && isTableRowCandidate(lines[start - 1])) {
        start--;
    }
    while (end < lines.length - 1 && isTableRowCandidate(lines[end + 1])) {
        end++;
    }
    // A GFM table = header row + separator row + optional body rows. The separator must
    // be the SECOND line of the run.
    if (end - start < 1 || !isTableSeparatorLine(lines[start + 1])) {
        return null;
    }
    return { start, end };
}

function findQuoteRange(lines: string[], idx: number): BlockRange | null {
    if (!QuoteLineRe.test(lines[idx])) {
        return null;
    }
    let start = idx;
    let end = idx;
    while (start > 0 && QuoteLineRe.test(lines[start - 1])) {
        start--;
    }
    while (end < lines.length - 1 && QuoteLineRe.test(lines[end + 1])) {
        end++;
    }
    return { start, end };
}

function findListRange(lines: string[], idx: number): BlockRange | null {
    // Expand up: list items, or indented continuation lines once an item was seen above.
    let start = -1;
    for (let i = idx; i >= 0; i--) {
        const l = lines[i];
        if (ListItemLineRe.test(l)) {
            start = i;
            continue;
        }
        if (isBlank(l)) {
            break;
        }
        // Indented non-blank lines are candidate item continuations — accepted only when
        // the scan eventually reaches a real item marker above them.
        if (/^\s+\S/.test(l)) {
            continue;
        }
        break;
    }
    if (start < 0) {
        return null;
    }
    let end = start;
    for (let i = start + 1; i < lines.length; i++) {
        const l = lines[i];
        if (ListItemLineRe.test(l)) {
            end = i;
            continue;
        }
        if (isBlank(l)) {
            break; // loose-list groups were already split apart at blanks upstream
        }
        if (/^\s+\S/.test(l)) {
            end = i;
            continue;
        }
        break;
    }
    if (idx > end) {
        return null;
    }
    return { start, end };
}

/** Lines that can START a non-paragraph block — paragraph expansion stops at these. */
function isParagraphBarrier(line: string): boolean {
    return (
        isBlank(line) ||
        isFenceLine(line) ||
        HeadingLineRe.test(line) ||
        QuoteLineRe.test(line) ||
        ListItemLineRe.test(line) ||
        HrLineRe.test(line)
    );
}

function findParagraphRange(lines: string[], idx: number): BlockRange {
    let start = idx;
    let end = idx;
    while (start > 0 && !isParagraphBarrier(lines[start - 1])) {
        start--;
    }
    while (end < lines.length - 1 && !isParagraphBarrier(lines[end + 1])) {
        end++;
    }
    return { start, end };
}

// ---------------------------------------------------------------------------
// detectBlockKind
// ---------------------------------------------------------------------------

/**
 * What kind of block contains 1-based `line`? Returns null for blank/out-of-range
 * lines. Fence lines themselves report "code"; table separator rows report "table".
 */
export function detectBlockKind(lines: string[], line: number): BlockKind | null {
    const idx = Math.trunc(line) - 1;
    if (!Number.isFinite(idx) || idx < 0 || idx >= lines.length || isBlank(lines[idx])) {
        return null;
    }
    const spans = computeFenceSpans(lines);
    if (fenceSpanAt(spans, idx) != null) {
        return "code";
    }
    const table = findTableRange(lines, idx);
    if (table != null) {
        return "table";
    }
    const heading = lines[idx].match(HeadingLineRe);
    if (heading != null) {
        return `heading${heading[1].length}` as BlockKind;
    }
    const quote = findQuoteRange(lines, idx);
    if (quote != null) {
        return CalloutFirstLineRe.test(lines[quote.start]) ? "callout" : "quote";
    }
    const list = findListRange(lines, idx);
    if (list != null) {
        const m = lines[list.start].match(ListItemLineRe)!;
        if (m[3] != null) {
            return "todo";
        }
        return /^\d/.test(m[2]) ? "numbered" : "bulleted";
    }
    return "text";
}

/** Full block range (0-based, inclusive) at 1-based `line`, or null on blank/invalid. */
export function findBlockRangeAtLine(
    lines: string[],
    line: number
): (BlockRange & { kind: BlockKind }) | null {
    const idx = Math.trunc(line) - 1;
    if (!Number.isFinite(idx) || idx < 0 || idx >= lines.length || isBlank(lines[idx])) {
        return null;
    }
    const spans = computeFenceSpans(lines);
    const fence = fenceSpanAt(spans, idx);
    if (fence != null) {
        return { ...fence, kind: "code" };
    }
    const table = findTableRange(lines, idx);
    if (table != null) {
        return { ...table, kind: "table" };
    }
    const heading = lines[idx].match(HeadingLineRe);
    if (heading != null) {
        return { start: idx, end: idx, kind: `heading${heading[1].length}` as BlockKind };
    }
    const quote = findQuoteRange(lines, idx);
    if (quote != null) {
        const kind: BlockKind = CalloutFirstLineRe.test(lines[quote.start]) ? "callout" : "quote";
        return { ...quote, kind };
    }
    const list = findListRange(lines, idx);
    if (list != null) {
        const m = lines[list.start].match(ListItemLineRe)!;
        const kind: BlockKind = m[3] != null ? "todo" : /^\d/.test(m[2]) ? "numbered" : "bulleted";
        return { ...list, kind };
    }
    return { ...findParagraphRange(lines, idx), kind: "text" };
}

// ---------------------------------------------------------------------------
// transformBlockType — normalize a block to plain content lines, then re-emit them
// in the target shape. Content is never dropped; formatting wrappers are swapped.
// ---------------------------------------------------------------------------

function isListFamily(kind: BlockKind): boolean {
    return kind === "bulleted" || kind === "numbered" || kind === "todo";
}

/** Is the "|" at s[idx] escaped? Escaped = preceded by an odd run of backslashes (GFM). */
function isEscapedPipe(s: string, idx: number): boolean {
    let backslashes = 0;
    let i = idx - 1;
    while (i >= 0 && s[i] === "\\") {
        backslashes++;
        i--;
    }
    return backslashes % 2 === 1;
}

/** Parse a `| a | b |` table row into trimmed cell texts (outer pipes dropped).
 *  Pipe-escape aware: `\|` stays INSIDE its cell instead of splitting it. */
export function splitTableCells(line: string): string[] {
    let core = line.trim();
    if (core.startsWith("|")) {
        core = core.slice(1);
    }
    if (core.endsWith("|") && !isEscapedPipe(core, core.length - 1)) {
        core = core.slice(0, -1);
    }
    const cells: string[] = [];
    let current = "";
    for (let i = 0; i < core.length; i++) {
        if (core[i] === "|" && !isEscapedPipe(core, i)) {
            cells.push(current.trim());
            current = "";
            continue;
        }
        current += core[i];
    }
    cells.push(current.trim());
    return cells;
}

/** Strip a block's formatting wrapper down to plain content lines (indent preserved). */
function stripToPlain(block: string[], kind: BlockKind): string[] {
    if (kind === "code") {
        const inner = block.slice(1);
        // Drop the closing fence when present (an unterminated fence's span runs to EOF —
        // nothing to drop there).
        if (inner.length > 0 && isFenceLine(inner[inner.length - 1])) {
            inner.pop();
        }
        return inner;
    }
    if (isListFamily(kind)) {
        return block.map((line) => {
            const m = line.match(ListItemLineRe);
            if (m == null) {
                return line; // continuation line: keep verbatim
            }
            return m[1] + line.slice(m[0].length);
        });
    }
    if (kind === "quote" || kind === "callout") {
        return block.map((line) => line.replace(/^ {0,3}>[ \t]?/, ""));
    }
    if (kind === "table") {
        return block
            .filter((line) => !isTableSeparatorLine(line))
            .map((line) => splitTableCells(line).join(" | "));
    }
    const headingMatch = kind.match(/^heading([1-6])$/);
    if (headingMatch != null) {
        const first = block[0].replace(/^ {0,3}#{1,6}[ \t]*/, "");
        return [first, ...block.slice(1)];
    }
    return block.slice();
}

/** Re-emit plain content lines in the target shape. */
function plainToBlock(plain: string[], to: BlockKind): string[] | null {
    const headingMatch = to.match(/^heading([1-6])$/);
    if (headingMatch != null) {
        const marks = "#".repeat(Number(headingMatch[1]));
        const first = plain[0] ?? "";
        return [first.length > 0 ? `${marks} ${first}` : marks, ...plain.slice(1)];
    }
    if (to === "bulleted" || to === "numbered" || to === "todo") {
        // Every non-blank line becomes an item at its own (preserved) indent. Numbered
        // counters run per-indent so nested groups number 1,2,3… independently.
        const counters = new Map<string, number>();
        return plain.map((line) => {
            if (isBlank(line)) {
                return line;
            }
            const indent = line.match(/^\s*/)?.[0] ?? "";
            const content = line.slice(indent.length);
            if (to === "bulleted") {
                return `${indent}- ${content}`;
            }
            if (to === "todo") {
                return `${indent}- [ ] ${content}`;
            }
            const n = (counters.get(indent) ?? 0) + 1;
            counters.set(indent, n);
            return `${indent}${n}. ${content}`;
        });
    }
    if (to === "quote") {
        return plain.map((line) => (isBlank(line) ? ">" : `> ${line}`));
    }
    if (to === "code") {
        return ["```", ...plain, "```"];
    }
    if (to === "table") {
        // Each plain line becomes a row: pipe-bearing lines split into cells, the rest
        // become single-cell rows. Row 0 is the header; the separator follows.
        const rows = plain.map((line) => (line.includes("|") ? splitTableCells(line) : [line]));
        const cols = Math.max(1, ...rows.map((r) => r.length));
        const fmt = (cells: string[]) => {
            const padded = [...cells, ...Array(cols - cells.length).fill("")];
            return `| ${padded.join(" | ")} |`;
        };
        const sep = `| ${Array(cols).fill("---").join(" | ")} |`;
        const header = rows.length > 0 ? fmt(rows[0]) : fmt([""]);
        return [header, sep, ...rows.slice(1).map(fmt)];
    }
    if (to === "text") {
        return plain.slice();
    }
    return null; // "callout" is not a transform target in M1
}

/** Swap the root markers of every list-item line in a list block (bullet ⇄ ordered ⇄ task). */
function rewriteListMarkers(block: string[], to: BlockKind): string[] {
    const counters = new Map<string, number>();
    return block.map((line) => {
        const m = line.match(ListItemLineRe);
        if (m == null) {
            return line;
        }
        const indent = m[1];
        const head = m[2]; // "-" / "*" / "+" / "3." / "2)"
        const checkbox = m[3] ?? null; // e.g. " [ ]"
        const content = line.slice(m[0].length);
        if (to === "bulleted") {
            return `${indent}- ${content}`;
        }
        if (to === "todo") {
            // Keep an existing checked state when the item already was a task.
            const box = checkbox != null ? checkbox.replace(/^\s+/, " ") : " [ ]";
            return `${indent}-${box} ${content}`;
        }
        const n = (counters.get(indent) ?? 0) + 1;
        counters.set(indent, n);
        return `${indent}${n}. ${content}`;
    });
}

/**
 * Rewrite the block containing 1-based `line` into kind `to`. Returns the new full text
 * plus a caret offset (end of the first rewritten line) — or null when the transform is
 * a no-op (same kind), the anchor is blank/out of range, or the target is unsupported.
 */
export function transformBlockType(
    text: string,
    line: number,
    to: BlockKind,
    opts?: { sourceKind?: BlockKind }
): { text: string; caret?: number } | null {
    const lines = text.split(/\r\n|\n/);
    const idx = Math.trunc(line) - 1;
    if (!Number.isFinite(idx) || idx < 0 || idx >= lines.length || isBlank(lines[idx])) {
        return null;
    }
    const from = opts?.sourceKind ?? detectBlockKind(lines, line);
    if (from == null || from === to) {
        return null;
    }
    const range = findBlockRangeAtLine(lines, line);
    if (range == null) {
        return null;
    }
    const block = lines.slice(range.start, range.end + 1);
    const nextBlock =
        isListFamily(range.kind) && isListFamily(to)
            ? rewriteListMarkers(block, to)
            : plainToBlock(stripToPlain(block, range.kind), to);
    if (nextBlock == null) {
        return null;
    }
    const nextLines = [...lines.slice(0, range.start), ...nextBlock, ...lines.slice(range.end + 1)];
    const caret = nextLines.slice(0, range.start + 1).join("\n").length;
    return { text: nextLines.join("\n"), caret };
}

// ---------------------------------------------------------------------------
// Typing patterns (方案 02 §2.1): canonicalize a freshly typed block-start line.
// Full-width variants （＃ ＞ ＊ ＋ ···) rewrite to their half-width forms so the
// source stays canonical (Obsidian-clean). """lang""" auto-closes into an empty fenced
// block; a pipe-line gains its separator row. Canonical half-width input returns an
// UNCHANGED rewrittenLine, which callers treat as a no-op.
// ---------------------------------------------------------------------------

export type TypingPatternMatch = { kind: BlockKind; rewrittenLine: string };

function normalizeTypedBullet(ch: string): string {
    // Full-width list markers canonicalize to "-"; half-width markers stay as typed.
    return normalizeTriggerChar(ch) === ch ? ch : "-";
}

export function matchTypingPattern(line: string): TypingPatternMatch | null {
    const indent = line.match(/^\s{0,3}/)?.[0] ?? "";
    if (indent.length > 3) {
        return null; // 4+ space indent is a code block, not a trigger context
    }
    const rest = line.slice(indent.length);
    if (rest.length === 0) {
        return null;
    }
    // Heading: "# title" .. "###### title", incl. full-width ＃.
    let m = rest.match(/^([#＃]{1,6})[ \t]+(.*)$/);
    if (m != null) {
        return {
            kind: `heading${m[1].length}` as BlockKind,
            rewrittenLine: `${indent}${"#".repeat(m[1].length)} ${m[2]}`,
        };
    }
    // Code fence: ```lang / ~~~lang / 全角 ···lang — auto-close with an empty body.
    m = rest.match(/^([`·｀]{3,}|~{3,})([A-Za-z0-9_+#.-]*)$/);
    if (m != null) {
        const lang = m[2];
        return { kind: "code", rewrittenLine: `${indent}\`\`\`${lang}\n${indent}\`\`\`` };
    }
    // Task list: "- [ ] x" / "* [x]" / "1. [ ]" (+ full-width markers). Checkbox lowercase-x.
    m = rest.match(/^([-*+＊＋]|\d{1,9}[.)])[ \t]+\[([ xX])\][ \t]+(.*)$/);
    if (m != null) {
        const marker = /^\d/.test(m[1]) ? m[1] : normalizeTypedBullet(m[1]);
        return { kind: "todo", rewrittenLine: `${indent}${marker} [${m[2].toLowerCase()}] ${m[3]}` };
    }
    // Bullet list: - * + （全角 ＊ ＋ → "-"）.
    m = rest.match(/^([-*+＊＋])[ \t]+(.*)$/);
    if (m != null) {
        return { kind: "bulleted", rewrittenLine: `${indent}${normalizeTypedBullet(m[1])} ${m[2]}` };
    }
    // Ordered list: "1. x" / "2) x".
    m = rest.match(/^(\d{1,9}[.)])[ \t]+(.*)$/);
    if (m != null) {
        return { kind: "numbered", rewrittenLine: `${indent}${m[1]} ${m[2]}` };
    }
    // Quote / callout: "> " / 全角 ＞.
    m = rest.match(/^([>＞])[ \t]?(.*)$/);
    if (m != null) {
        const canonical = m[2].length > 0 ? `> ${m[2]}` : ">";
        const kind: BlockKind = /^>[ \t]?\[![A-Za-z]+\]/.test(canonical) ? "callout" : "quote";
        return { kind, rewrittenLine: indent + canonical };
    }
    // Table: a single "| a | b |" line gains its separator row.
    if (rest.length >= 2 && rest.startsWith("|") && rest.endsWith("|")) {
        const cells = splitTableCells(rest);
        const header = `| ${cells.join(" | ")} |`;
        const sep = `| ${cells.map(() => "---").join(" | ")} |`;
        return { kind: "table", rewrittenLine: `${indent}${header}\n${indent}${sep}` };
    }
    return null;
}

/**
 * Inline-edit commit helper (方案 02 §2.1): inspect the FIRST line of a draft that a
 * paragraph/blank editor is about to commit; when it matches a typing pattern, return
 * the draft with that line canonicalized (full-width → half-width, fence auto-close,
 * table separator). Returns null when nothing needs rewriting.
 */
export function rewriteDraftFirstLine(draft: string): string | null {
    if (draft.length === 0) {
        return null;
    }
    const nl = draft.indexOf("\n");
    const first = nl === -1 ? draft : draft.slice(0, nl);
    const match = matchTypingPattern(first);
    if (match == null || match.rewrittenLine === first) {
        return null;
    }
    return match.rewrittenLine + (nl === -1 ? "" : draft.slice(nl));
}

/**
 * Committed-text variant used by the Enter-split flow: the front half of the split was
 * already committed, so we inspect the line AT `line` (1-based) in the full text.
 * Guards: lines inside an existing fenced block never transform; a fence line that
 * already has its closing fence does not get a second one; existing table rows are left
 * alone. `lineDelta` tells the caller how many lines the transform added below `line`,
 * so follow-up focus targets stay correct.
 */
export function applyTypingPatternAtLine(
    text: string,
    line: number
): { text: string; lineDelta: number } | null {
    const lines = text.split(/\r\n|\n/);
    const idx = Math.trunc(line) - 1;
    if (!Number.isFinite(idx) || idx < 0 || idx >= lines.length || isBlank(lines[idx])) {
        return null;
    }
    const match = matchTypingPattern(lines[idx]);
    if (match == null || match.rewrittenLine === lines[idx]) {
        return null;
    }
    const span = fenceSpanAt(computeFenceSpans(lines), idx);
    if (match.kind === "code") {
        // Already a properly closed fence → nothing to auto-close.
        if (span != null && span.start === idx && span.end > idx && span.closed) {
            return null;
        }
    } else if (span != null) {
        // Inside an existing fence: code content never rewrites.
        return null;
    } else {
        const kind = detectBlockKind(lines, line);
        if (kind === "table" || kind === "code") {
            return null;
        }
    }
    const replacement = match.rewrittenLine.split("\n");
    lines.splice(idx, 1, ...replacement);
    return { text: lines.join("\n"), lineDelta: replacement.length - 1 };
}
