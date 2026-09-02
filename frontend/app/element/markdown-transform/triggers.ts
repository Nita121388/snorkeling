// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Unified trigger layer (方案 05 §0): full-width and half-width variants of the same
 * glyph must behave identically so Chinese IME state never changes what a key means.
 *
 *   中文输入法下敲 "：" == 英文下敲 ":" —— both resolve to the same command.
 *
 * This module is pure: no DOM, no React, no side effects. `detectInlineTrigger` scans
 * backwards from the caret for an eligible trigger char and reports the match window;
 * the emoji picker (M3) and slash palette (M2) both consume it.
 */

/** Canonical half-width form for each full-width trigger glyph. */
export const FULL_TO_HALF: Record<string, string> = {
    "：": ":",
    "／": "/",
    "＃": "#",
    "＞": ">",
    "＊": "*",
    "＋": "+",
    "·": "`",
    "！": "!",
};

export function normalizeTriggerChar(ch: string): string {
    return FULL_TO_HALF[ch] ?? ch;
}

export type TriggerCommand = "emoji" | "slash" | "heading" | "quote" | "list" | "code";

export type TriggerWhere = "line-start" | "inline-after-boundary";

export interface TriggerSpec {
    chars: string[];
    where: TriggerWhere;
    command: TriggerCommand;
}

/**
 * The trigger registry. Order irrelevant; detection goes by the character found before
 * the caret, then applies the `where` rule for that spec.
 */
export const TRIGGERS: TriggerSpec[] = [
    { chars: [":", "："], where: "inline-after-boundary", command: "emoji" },
    { chars: ["/", "／"], where: "line-start", command: "slash" },
    { chars: ["#", "＃"], where: "line-start", command: "heading" },
    { chars: [">", "＞"], where: "line-start", command: "quote" },
    { chars: ["-", "*", "+", "＊", "＋"], where: "line-start", command: "list" },
    { chars: ["`", "·"], where: "line-start", command: "code" },
];

export type InlineTriggerMatch = {
    command: TriggerCommand;
    /** 0-based index of the trigger char inside `text` (the char itself, e.g. ":"). */
    triggerStart: number;
    /** 0-based index where the user's query text begins (trigger char excluded). */
    queryStart: number;
    /** The query text between trigger and caret (never contains whitespace). */
    query: string;
};

/** Boundary chars allowed immediately before an `inline-after-boundary` trigger. A
 *  trigger preceded by anything else (letters, digits, "/", ":", …) does not fire —
 *  that's how "https://…" and "a:b" stay inert. */
const BOUNDARY_CHARS = new Set([" ", "\t", "\n", "(", "[", "{", "<", "（", "【", "「", "『", "《", "　", '"', "'", "\u201c", "\u201d"]);

function isBoundaryChar(ch: string | undefined): boolean {
    return ch === undefined || BOUNDARY_CHARS.has(ch);
}

/** True when the char is a colon (half-width `:` or full-width `：`). */
function isColon(ch: string | undefined): boolean {
    if (ch == null) return false;
    return ch === ":" || ch === "：";
}

/**
 * Scan the text before `caret` for the nearest eligible trigger char on the caret's
 * own line. Returns null when:
 *   - no trigger char is present before the caret on that line,
 *   - the nearest candidate's `where` rule fails (slash not at line-start, emoji `::` not
 *     after a boundary char),
 *   - the query between trigger and caret already contains whitespace (the user typed a
 *     space → palette dismissed),
 *   - the caret sits inside a fenced code block (triggers never fire inside code).
 *
 * Emoji trigger specifically requires TWO consecutive colons (`::` / `：：` / `:：` / `：:`)
 * to avoid conflicts with normal typing like `https://` or `a:b`.
 *
 * `text` is the CURRENT BLOCK's draft text (not the whole document) and `caret` is a
 * 0-based char offset into it — matching how the inline-edit textarea reports them.
 */
export function detectInlineTrigger(text: string, caret: number): InlineTriggerMatch | null {
    if (caret < 0 || caret > text.length) {
        return null;
    }
    const clamped = Math.min(Math.max(0, Math.trunc(caret)), text.length);
    const lineStart = text.lastIndexOf("\n", clamped - 1) + 1;
    const beforeCaret = text.slice(lineStart, clamped);
    if (beforeCaret.length === 0) {
        return null;
    }
    // Nearest trigger candidate = last trigger char in the run before the caret.
    for (let i = beforeCaret.length - 1; i >= 0; i--) {
        const raw = beforeCaret[i];
        const norm = normalizeTriggerChar(raw);
        const spec = TRIGGERS.find((t) => t.chars.includes(raw) || t.chars.includes(norm));
        if (spec == null) {
            continue;
        }

        // Emoji trigger: require double colon (`::` / `：：` / mixed half+full width)
        if (spec.command === "emoji") {
            // The char at `i` is a colon. The char before it (`i-1`) must also be a colon.
            if (i < 1 || !isColon(beforeCaret[i - 1])) {
                continue; // single colon — not a trigger, keep scanning
            }
            // `triggerStart` points to the FIRST colon (position i-1).
            const doubleColonStart = i - 1;
            const query = beforeCaret.slice(i + 1);
            // Query must be a single word: any whitespace between trigger and caret kills it.
            if (/[\s]/.test(query)) {
                return null;
            }
            // Boundary check: the char before the FIRST colon must be a boundary.
            const prev = doubleColonStart === 0 ? undefined : beforeCaret[doubleColonStart - 1];
            if (!isBoundaryChar(prev)) {
                continue; // boundary fails — keep scanning for another pair
            }
            if (isCaretInFence(text, clamped)) {
                return null;
            }
            return {
                command: spec.command,
                triggerStart: lineStart + doubleColonStart,
                queryStart: lineStart + doubleColonStart + 2,
                query,
            };
        }

        // Non-emoji triggers (slash, heading, etc.): original single-char logic.
        // Query must be a single word: any whitespace between trigger and caret kills it.
        const query = beforeCaret.slice(i + 1);
        if (/[\s]/.test(query)) {
            return null;
        }
        if (spec.where === "line-start") {
            // Only whitespace may precede the trigger on its line.
            if (!/^\s*$/.test(beforeCaret.slice(0, i))) {
                return null;
            }
        } else {
            // inline-after-boundary: previous char must be a boundary (or line start).
            const prev = i === 0 ? undefined : beforeCaret[i - 1];
            if (!isBoundaryChar(prev)) {
                return null;
            }
        }
        if (isCaretInFence(text, clamped)) {
            return null;
        }
        return {
            command: spec.command,
            triggerStart: lineStart + i,
            queryStart: lineStart + i + 1,
            query,
        };
    }
    return null;
}

/**
 * True when the 0-based offset sits inside a fenced code block (```` ``` ```` or `~~~`)
 * of the given block draft. Kept deliberately small: fence open/close runs top-down;
 * an unterminated fence extends to the end of the text.
 */
export function isCaretInFence(text: string, offset: number): boolean {
    const lines = text.split("\n");
    let pos = 0;
    let inFence = false;
    let fenceChar: string | null = null;
    let fenceLen = 0;
    for (const line of lines) {
        const m = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
        if (m != null) {
            const ch = m[1][0];
            if (!inFence && !(ch === "`" && m[2].includes("`"))) {
                inFence = true;
                fenceChar = ch;
                fenceLen = m[1].length;
            } else if (inFence && ch === fenceChar && m[1].length >= fenceLen && /^\s*$/.test(m[2])) {
                inFence = false;
                fenceChar = null;
                fenceLen = 0;
            }
        }
        const lineEnd = pos + line.length; // offset of this line's last char
        if (offset <= lineEnd) {
            return inFence;
        }
        pos = lineEnd + 1; // skip the "\n"
    }
    return inFence;
}
