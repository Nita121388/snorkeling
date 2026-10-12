// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Code-block helpers (方案 04 §2). Pure functions; the UI (language badge) calls
 * setCodeBlockLanguage and commits the result through the usual inline-edit funnel.
 */

import { computeFenceSpans } from "./block-type";

const FenceOpenRe = /^( {0,3})(`{3,}|~{3,})(.*)$/;

/**
 * Set (or clear, lang === null/"") the language of the fenced block containing 1-based
 * `line`. Only the opening fence line is rewritten; `~` fences keep their marker char.
 * Returns null when the line isn't inside a fence or the language is unchanged.
 */
export function setCodeBlockLanguage(text: string, line: number, lang: string | null): string | null {
    const lines = text.split(/\r\n|\n/);
    const idx = Math.trunc(line) - 1;
    if (!Number.isFinite(idx) || idx < 0 || idx >= lines.length) {
        return null;
    }
    const spans = computeFenceSpans(lines);
    const span = spans.find((sp) => idx >= sp.start && idx <= sp.end);
    if (span == null) {
        return null;
    }
    const opener = lines[span.start].match(FenceOpenRe);
    if (opener == null) {
        return null;
    }
    const normalized = (lang ?? "").trim().replace(/\s+/g, "");
    const current = opener[3].trim();
    if (normalized === current) {
        return null;
    }
    lines[span.start] = `${opener[1]}${opener[2]}${normalized}`;
    return lines.join("\n");
}

/** Language string of the fenced block containing 1-based `line` ("" = none). */
export function getCodeBlockLanguage(text: string, line: number): string | null {
    const lines = text.split(/\r\n|\n/);
    const idx = Math.trunc(line) - 1;
    if (!Number.isFinite(idx) || idx < 0 || idx >= lines.length) {
        return null;
    }
    const spans = computeFenceSpans(lines);
    const span = spans.find((sp) => idx >= sp.start && idx <= sp.end);
    if (span == null) {
        return null;
    }
    const opener = lines[span.start].match(FenceOpenRe);
    return opener == null ? null : opener[3].trim();
}
