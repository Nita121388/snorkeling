// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Paragraph, Root } from "mdast";
import type { Plugin } from "unified";
import type { VFile } from "vfile";
import { DEFAULT_BLANK_SPACER_OPTIONS, SPACER_DATA, type BlankSpacerOptions } from "./types";

/**
 * remark plugin that preserves authored blank lines between top-level blocks.
 *
 * Standard Markdown collapses runs of blank lines into a single block break,
 * so 3 consecutive blank lines between paragraphs render identically to 1.
 * Authors who use vertical spacing to chunk prose (CommonMark + GFM allow it)
 * lose that intent. This plugin reads the source `position` on each top-level
 * mdast node, computes the line gap to its neighbour, and inserts one spacer
 * paragraph per `linesPerSpacer` blank lines whenever the gap meets
 * `minSpacerLines`. Spacers carry `data-spacer-lines` so the renderer (and
 * CSS) can size them faithfully — 1 blank line = 1 line of vertical rhythm.
 *
 * Spacers carry an injected `position` pointing at the actual blank source
 * line(s) they represent. The preview's `srcLineAttrs` helper reads that
 * position to emit `data-source-line` / `data-source-line-end`, so clicking
 * a spacer in preview inline-edit mode opens an editor scoped to exactly those
 * blank lines — the same mechanism used for paragraphs, headings, and lists.
 */
function makeSpacer(spacerLines: number, startLine: number, endLine: number): Paragraph {
    return {
        type: "paragraph",
        children: [{ type: "text", value: "" }],
        data: {
            hName: SPACER_DATA.hName,
            hProperties: SPACER_DATA.hProperties(spacerLines),
        },
        // Inject position so react-markdown's hast node carries a valid
        // position and `srcLineAttrs` emits `data-source-line` / `data-source-line-end`.
        position: {
            start: { line: startLine, column: 1, offset: 0 },
            end: { line: endLine, column: 1, offset: 0 },
        },
    };
}

/**
 * Create a spacer for a contiguous range of blank source lines
 * [gapStart..gapStart+count*linesPerSpacer-1], one per linesPerSpacer lines.
 * Each individual spacer's injected position covers exactly the lines it
 * represents so click-to-edit targets a single spacer (and its blank lines)
 * rather than the entire gap.
 */
function makeSpacers(
    gap: number,
    linesPerSpacer: number,
    gapStartLine: number
): Paragraph[] {
    const count = Math.floor(gap / linesPerSpacer);
    const spacers: Paragraph[] = [];
    for (let k = 0; k < count; k++) {
        const startLine = gapStartLine + k * linesPerSpacer;
        const endLine = gapStartLine + (k + 1) * linesPerSpacer - 1;
        spacers.push(makeSpacer(gap, startLine, endLine));
    }
    return spacers;
}

const remarkBlankLineSpacers: Plugin<[BlankSpacerOptions?], Root> = function (opts) {
    const config = { ...DEFAULT_BLANK_SPACER_OPTIONS, ...opts };
    return (tree: Root, file: VFile) => {
        const children = tree.children as any[];
        if (!children.length) return;

        const result: any[] = [];
        const totalLines = file?.toString?.().split("\n").length;

        // Leading blanks: from line 1 to the first node's start.
        const firstStart = children[0]?.position?.start?.line;
        if (config.renderLeadingBlanks && typeof firstStart === "number" && firstStart > 1) {
            const gap = firstStart - 1;
            result.push(...makeSpacers(gap, config.linesPerSpacer, 1));
        }

        for (let i = 0; i < children.length; i++) {
            result.push(children[i]);

            const cur = children[i];
            const next = children[i + 1];
            const curEnd = cur?.position?.end?.line;
            const nextStart = next?.position?.start?.line;
            if (typeof curEnd !== "number" || typeof nextStart !== "number") continue;

            const gap = nextStart - curEnd - 1;
            if (gap < config.minSpacerLines) continue;

            result.push(...makeSpacers(gap, config.linesPerSpacer, curEnd + 1));
        }

        // Trailing blanks: from last node's end to total file lines.
        if (config.renderTrailingBlanks && typeof totalLines === "number") {
            const lastEnd = children[children.length - 1]?.position?.end?.line;
            if (typeof lastEnd === "number" && totalLines > lastEnd) {
                const gap = totalLines - lastEnd;
                result.push(...makeSpacers(gap, config.linesPerSpacer, lastEnd + 1));
            }
        }

        tree.children = result as any;
    };
};

export default remarkBlankLineSpacers;
