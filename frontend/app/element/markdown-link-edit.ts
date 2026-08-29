// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Pure helpers for the link-edit form (Note surface): the user edits a link's display
 * label and URL in a small form, and we splice exactly the `[label](url)` / `[[target]]`
 * span in the ORIGINAL source — never re-serializing the document.
 *
 * Two lookup strategies, in order:
 *   1) Absolute offsets from the hast node position (most precise with duplicate links).
 *      Always validated: the sliced window must still LOOK like the link syntax.
 *   2) Fallback: search the link's block line range for the syntax carrying this href —
 *      covers transformed-pipeline edge cases where node offsets drift.
 */

export type LinkEditMode = "markdown" | "wiki";

export type LinkEditRequest = {
    mode: LinkEditMode;
    /** Current href: Markdown URL, or the `wave-wiki:...` form for `[[wiki]]` links. */
    href: string;
    /** Current display text (anchor's textContent). */
    label: string;
    /** absolute [start,end) offsets into the source text, when the renderer knows them. */
    startOffset?: number;
    endOffset?: number;
    /** 1-based fallback search window: the block's data-source-line(+end). */
    blockStartLine?: number;
    blockEndLine?: number;
};

/** Characters that would break `[label](url)` syntax once the user types them. */
export function sanitizeLinkLabel(label: string): string {
    return label.replace(/[\[\]\r\n]/g, "");
}

export function sanitizeLinkUrl(url: string): string {
    return url
        .replace(/[\r\n]/g, "")
        .replace(/\)/g, "%29")
        .replace(/ /g, "%20");
}

/** Build the replacement source text for the link span. */
export function buildLinkReplacement(mode: LinkEditMode, label: string, url: string): string {
    if (mode === "wiki") {
        return `[[${url}]]`;
    }
    return `[${sanitizeLinkLabel(label)}](${sanitizeLinkUrl(url)})`;
}

function isMarkdownLinkSyntax(slice: string): boolean {
    return /^\[[\s\S]*\]\([\s\S]*\)$/.test(slice);
}

function isWikiLinkSyntax(slice: string): boolean {
    return /^\[\[[\s\S]*\]\]$/.test(slice);
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Returns the new full text with the link span replaced, or null when the span cannot be
 * located with confidence (callers treat null as a silent no-op — never write garbage).
 */
export function replaceLinkInSource(
    fullText: string,
    request: LinkEditRequest,
    newLabel: string,
    newUrl: string
): string | null {
    const replacement = buildLinkReplacement(request.mode, newLabel, newUrl);
    const validate = request.mode === "wiki" ? isWikiLinkSyntax : isMarkdownLinkSyntax;

    // Strategy 1: absolute offsets, but only if the window still looks like the link.
    const { startOffset, endOffset } = request;
    if (
        startOffset != null &&
        endOffset != null &&
        Number.isInteger(startOffset) &&
        Number.isInteger(endOffset) &&
        startOffset >= 0 &&
        endOffset <= fullText.length &&
        startOffset < endOffset
    ) {
        const slice = fullText.slice(startOffset, endOffset);
        if (validate(slice) && slice.includes(request.href)) {
            return fullText.slice(0, startOffset) + replacement + fullText.slice(endOffset);
        }
    }

    // Strategy 2: scan the block's line window for the first match carrying this href.
    if (request.blockStartLine == null || request.blockEndLine == null) {
        return null;
    }
    const lines = fullText.split("\n");
    const startIdx = request.blockStartLine - 1;
    const endIdx = request.blockEndLine; // slice is exclusive; blockEndLine is inclusive
    if (startIdx < 0 || endIdx > lines.length || startIdx >= endIdx) {
        return null;
    }
    const regex =
        request.mode === "wiki"
            ? /\[\[[^\]\r\n]+\]\]/
            : new RegExp(`\\[[^\\]\\r\\n]*\\]\\(<?${escapeRegExp(request.href)}>?\\)`);
    const blockText = lines.slice(startIdx, endIdx).join("\n");
    const match = blockText.match(regex);
    if (match == null || match.index == null) {
        return null;
    }
    const baseOffset = startIdx === 0 ? 0 : lines.slice(0, startIdx).join("\n").length + 1;
    const absStart = baseOffset + match.index;
    return fullText.slice(0, absStart) + replacement + fullText.slice(absStart + match[0].length);
}

/** Prefill value for the wiki-mode editor field: `wave-wiki:Foo%20Bar#H` → `Foo Bar#H`. */
export function wikiTargetFromHref(href: string, fallback: string): string {
    if (!href.startsWith("wave-wiki:")) {
        return href;
    }
    const raw = decodeURIComponentSafe(href.slice("wave-wiki:".length));
    return raw === "" ? fallback : raw;
}

function decodeURIComponentSafe(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}
