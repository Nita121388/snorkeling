// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Document emoji via frontmatter `emoji:` (方案 05 §2). Whole-line, append-only surgery:
 * we never parse or reformat YAML, we just splice the one `emoji: "…"` line so Obsidian's
 * Properties panel picks the value up verbatim.
 */

export type FrontmatterSpan = { start: number; end: number }; // 0-based indexes of the `---` lines

/**
 * Frontmatter block bounds. Must start at document offset 0: `---` as the very first
 * line, then the closing `---` (or `…`). Returns null when the document doesn't begin
 * with a well-formed fence.
 */
export function findFrontmatterSpan(text: string): FrontmatterSpan | null {
    if (!text.startsWith("---")) {
        return null;
    }
    const lines = text.split(/\r\n|\n/);
    if (lines[0].trim() !== "---") {
        return null;
    }
    for (let i = 1; i < lines.length; i++) {
        const t = lines[i].trim();
        if (t === "---" || t === "...") {
            return { start: 0, end: i };
        }
    }
    return null;
}

const EmojiKeyRe = /^(\s*emoji\s*:\s*)(?:"([^"]*)"|'([^']*)'|(.*))\s*$/;

/** Read the frontmatter `emoji` value (quoted or bare). null when absent. */
export function getFrontmatterEmoji(text: string): string | null {
    const span = findFrontmatterSpan(text);
    if (span == null) {
        return null;
    }
    const lines = text.split(/\r\n|\n/);
    for (let i = span.start + 1; i < span.end; i++) {
        const m = lines[i].match(EmojiKeyRe);
        if (m != null) {
            const value = m[2] ?? m[3] ?? m[4] ?? "";
            const trimmed = value.trim();
            return trimmed === "" ? null : trimmed;
        }
    }
    return null;
}

/**
 * Write the document emoji.
 *  - Set (emoji != null): insert `emoji: "🐠"` before the closing `---`, or replace an
 *    existing emoji line; without ANY frontmatter, prepend a minimal block at the top.
 *  - Remove (emoji === null): drop the emoji line; when that empties the frontmatter,
 *    remove the whole `---…---` block (Obsidian shows no Properties for an empty map).
 *
 * Every other key/line is left byte-identical.
 */
export function setFrontmatterEmoji(text: string, emoji: string | null): string {
    const lines = text.split(/\r\n|\n/);
    const span = findFrontmatterSpan(text);
    if (emoji != null) {
        const emojiLine = `emoji: "${emoji}"`;
        if (span == null) {
            return [`---`, emojiLine, `---`, ...lines].join("\n");
        }
        for (let i = span.start + 1; i < span.end; i++) {
            if (EmojiKeyRe.test(lines[i])) {
                if (getFrontmatterEmoji(text) === emoji) {
                    return text; // no-op
                }
                lines[i] = emojiLine;
                return lines.join("\n");
            }
        }
        lines.splice(span.end, 0, emojiLine);
        return lines.join("\n");
    }
    // remove
    if (span == null) {
        return text;
    }
    for (let i = span.start + 1; i < span.end; i++) {
        if (EmojiKeyRe.test(lines[i])) {
            lines.splice(i, 1);
            const remaining = lines.slice(1, lines.length).slice(0, span.end - span.start - 2);
            const hasOtherKeys = remaining.some((l) => l.trim() !== "");
            if (!hasOtherKeys) {
                // frontmatter held ONLY the emoji — drop the whole fence pair.
                lines.splice(0, 2);
                // tidy: collapse a doubled blank left at the very top
                while (lines.length > 1 && lines[0].trim() === "" && lines[1].trim() === "") {
                    lines.shift();
                }
            }
            return lines.join("\n");
        }
    }
    return text;
}
