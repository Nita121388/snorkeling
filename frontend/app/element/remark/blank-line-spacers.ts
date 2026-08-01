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
 * Spacers are emitted as mdast `paragraph` nodes whose `data.hName`/`hProperties`
 * flow through rehype-sanitize untouched (we keep `p` in the schema, and
 * `data-*` attributes survive the defaultSchema as long as they don't carry
 * `:`). If a future caller wants spacers as `<div>` instead, flip SPACER_DATA
 * .hName — the surrounding `markdownComponents.p` will still receive the
 * resulting element because of the hName override.
 */
function makeSpacer(spacerLines: number): Paragraph {
    return {
        type: "paragraph",
        children: [{ type: "text", value: "" }],
        data: {
            hName: SPACER_DATA.hName,
            hProperties: SPACER_DATA.hProperties(spacerLines),
        },
    };
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
            const count = Math.floor(gap / config.linesPerSpacer);
            for (let i = 0; i < count; i++) {
                result.push(makeSpacer(gap));
            }
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

            const count = Math.floor(gap / config.linesPerSpacer);
            for (let k = 0; k < count; k++) {
                result.push(makeSpacer(gap));
            }
        }

        // Trailing blanks: from last node's end to total file lines.
        if (config.renderTrailingBlanks && typeof totalLines === "number") {
            const lastEnd = children[children.length - 1]?.position?.end?.line;
            if (typeof lastEnd === "number" && totalLines > lastEnd) {
                const gap = totalLines - lastEnd;
                const count = Math.floor(gap / config.linesPerSpacer);
                for (let i = 0; i < count; i++) {
                    result.push(makeSpacer(gap));
                }
            }
        }

        tree.children = result as any;
    };
};

export default remarkBlankLineSpacers;
