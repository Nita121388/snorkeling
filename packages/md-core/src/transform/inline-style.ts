// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Inline text styles for the floating toolbar + keyboard shortcuts (方案 03 §1).
 * All functions are pure: they operate on (draftText, selection) and return the new
 * text plus the selection the textarea should restore. Toggle semantics: applying a
 * style to text already wrapped STRIPS the wrapper instead of double-wrapping.
 *
 * Selection contract: `start`/`end` are 0-based char offsets into `text`
 * (textarea selectionStart/selectionEnd). Returned selection marks the same logical
 * content after the edit (markers stripped → caret shifts left by marker length).
 */

export type InlineStyleId = "bold" | "italic" | "strike" | "code" | "kbd" | "link";

export type InlineEdit = { text: string; start: number; end: number };

const WRAPPERS: Record<Exclude<InlineStyleId, "link">, { pre: string; post: string }> = {
    bold: { pre: "**", post: "**" },
    italic: { pre: "*", post: "*" },
    strike: { pre: "~~", post: "~~" },
    code: { pre: "`", post: "`" },
    kbd: { pre: "<kbd>", post: "</kbd>" },
};

/**
 * Apply (or strip) an inline style over [start..end].
 *
 * Strip cases (checked in order):
 *   A. markers lie OUTSIDE the selection:  `|bold|` inside `**bold**`
 *   B. markers lie INSIDE the selection:  `**`+`bold`**` selected wholesale
 * Empty selection inserts an empty marker pair with the caret between them
 * ("cursor enters bold mode", Notion-style).
 *
 * Returns null when the edit is unsafe / meaningless (e.g. wrapping across a line
 * break for single-line styles keeps sources clean, so we refuse multi-line wraps).
 */
export function applyInlineStyle(
    text: string,
    start: number,
    end: number,
    style: InlineStyleId
): InlineEdit | null {
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
        return null;
    }
    const s = Math.max(0, Math.min(Math.trunc(start), text.length));
    const e = Math.max(s, Math.min(Math.trunc(end), text.length));
    if (style === "link") {
        return applyLink(text, s, e);
    }
    const { pre, post } = WRAPPERS[style];
    // Refuse to wrap across line boundaries — an unterminated `**` would spill styling
    // into the next markdown construct (and CommonMark wouldn't render it anyway).
    if (text.slice(s, e).includes("\n")) {
        return null;
    }
    const outerRaw = text.slice(s - pre.length, s) === pre && text.slice(e, e + post.length) === post;
    // Italic guard: never mistake one half of a "**bold**" pair for an italic wrapper,
    // or pressing I inside bold text would silently degrade it to "*bold*".
    const outer =
        outerRaw &&
        !(style === "italic" && (text[s - pre.length - 1] === "*" || text[e + post.length] === "*"));
    const selText = text.slice(s, e);
    const inner =
        selText.length >= pre.length + post.length && selText.startsWith(pre) && selText.endsWith(post);
    if (outer) {
        // Strip: remove the surrounding markers; selection keeps covering the content.
        const next = text.slice(0, s - pre.length) + selText + text.slice(e + post.length);
        return { text: next, start: s - pre.length, end: e - pre.length };
    }
    if (inner) {
        // Strip: the user selected "**bold**" wholesale.
        const content = selText.slice(pre.length, selText.length - post.length);
        const next = text.slice(0, s) + content + text.slice(e);
        return { text: next, start: s, end: s + content.length };
    }
    // Empty selection → drop marker pair, caret in the middle.
    if (s === e) {
        const next = text.slice(0, s) + pre + post + text.slice(e);
        return { text: next, start: s + pre.length, end: s + pre.length };
    }
    // Wrap.
    const next = text.slice(0, s) + pre + selText + post + text.slice(e);
    return { text: next, start: s + pre.length, end: e + pre.length };
}

/** True when [start..end] currently sits inside (or exactly covers) the style's wrapper —
 *  used by the toolbar to show the active (pressed) state. */
export function hasInlineStyle(text: string, start: number, end: number, style: InlineStyleId): boolean {
    if (style === "link") {
        return isLinkActive(text, start, end);
    }
    const { pre, post } = WRAPPERS[style];
    const sel = text.slice(start, end);
    const outer = text.slice(Math.max(0, start - pre.length), start) === pre && text.slice(end, end + post.length) === post;
    const inner = sel.startsWith(pre) && sel.endsWith(post) && sel.length >= pre.length + post.length;
    return outer || inner;
}

/** Selection looks like the label portion of an existing `[label](href)` link. */
function isLinkActive(text: string, start: number, end: number): boolean {
    const sel = text.slice(start, end);
    if (/^\[[^\]]*\]\([^)]*\)$/.test(sel)) {
        return true;
    }
    const before = text.slice(0, start);
    const after = text.slice(end);
    const lineBefore = before.slice(before.lastIndexOf("\n") + 1);
    const nl = after.indexOf("\n");
    const lineAfter = nl === -1 ? after : after.slice(0, nl);
    return /\[[^\]]*$/.test(lineBefore) && /^[^\]]*\]\([^)]*\)/.test(lineAfter);
}

/**
 * Link is special: wrapping produces `[sel](url-slot)` with the caret parked inside the
 * parens so the user types the URL immediately. If the selection already looks like a
 * URL, it becomes the href and the caret lands in the LABEL slot instead. Stripping a
 * full `[label](href)` selection restores the bare label.
 */
function applyLink(text: string, s: number, e: number): InlineEdit | null {
    const sel = text.slice(s, e);
    if (sel.includes("\n")) {
        return null;
    }
    const whole = /^\[([^\]]*)\]\(([^)]*)\)$/.exec(sel);
    if (whole != null) {
        // Strip: `[label](url)` → `label`.
        const next = text.slice(0, s) + whole[1] + text.slice(e);
        return { text: next, start: s, end: s + whole[1].length };
    }
    if (/^https?:\/\/\S+$/.test(sel)) {
        // URL selected → it becomes the href; caret goes to the empty label slot.
        const insert = `[](${sel})`;
        const next = text.slice(0, s) + insert + text.slice(e);
        return { text: next, start: s + 1, end: s + 1 };
    }
    // Label selected (or empty) → caret lands inside the parens.
    const next = text.slice(0, s) + "[" + sel + "](" + ")" + text.slice(e);
    const caret = s + 1 + sel.length + 2; // past "[sel]("
    return { text: next, start: caret, end: caret };
}
