// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Pure helpers for the "click-to-toggle task checkbox" feature (Note surface).
 *
 * Contract: the rendered <li> carries data-source-line pointing at the ORIGINAL
 * source line (markdown.tsx coordinate contract). We rewrite exactly that one
 * line — `[ ]` ⇄ `[x]` — and return the full new text, or null when the line
 * holds no task marker (caller then no-ops). We never re-serialize the document.
 */
export function toggleTaskCheckboxAtLine(fullText: string, line: number): string | null {
    const lines = fullText.split("\n");
    const idx = Math.trunc(line) - 1;
    if (!Number.isFinite(idx) || idx < 0 || idx >= lines.length) {
        return null;
    }
    const src = lines[idx];
    // Allow blockquote prefixes (`> > - [ ]`) and unordered/ordered markers.
    const match = src.match(/^(\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/);
    if (match == null) {
        return null;
    }
    const markerStart = match[1].length;
    const flipped = match[2] === " " ? "x" : " ";
    lines[idx] = src.slice(0, markerStart) + flipped + src.slice(markerStart + 1);
    return lines.join("\n");
}
