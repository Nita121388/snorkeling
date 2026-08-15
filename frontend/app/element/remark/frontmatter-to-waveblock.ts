// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Paragraph, Root } from "mdast";
import type { Transformer } from "unified";

/**
 * remark plugin that replaces a contiguous line range with a single waveblock node.
 *
 * Used to swap a file's YAML frontmatter (rendered by GFN as a thematic break +
 * plain paragraphs) for one placeholder node that the renderer can map to a custom
 * React component (e.g. the Obsidian-style properties card). The replacement is
 * done on the mdast tree only — the raw text and its line numbers are untouched,
 * so inline-edit coordinates (which slice the original text) stay valid and a
 * commit never loses the frontmatter.
 *
 * Node selection is by source line: every top-level child whose position starts
 * inside [startLine..endLine] (1-based, inclusive) is removed, and the whole gap
 * is replaced by one `waveblock` paragraph carrying `blockkey`. The injected
 * position spans the original range so blank-line-spacer gap math around the
 * block keeps working.
 */
export type FrontmatterToWaveBlockOptions = {
    /** 1-based, inclusive — first line of the region to collapse (usually the opening `---`). */
    startLine: number;
    /** 1-based, inclusive — last line of the region (usually the closing `---`/`...`). */
    endLine: number;
    /** `hProperties.blockkey` emitted on the waveblock node; must match a registered content block. */
    blockKey: string;
};

const remarkFrontmatterToWaveBlock = function (
    opts: FrontmatterToWaveBlockOptions
): Transformer<Root> {
    const { startLine, endLine, blockKey } = opts;
    return (tree: Root) => {
        const children = tree.children;
        if (!children.length || endLine < startLine) {
            return;
        }
        // Find the first node whose start line lands inside the region. Top-level
        // children are in document order, so the remaining nodes in the range form
        // a contiguous slice starting here.
        let replaceStart = -1;
        for (let i = 0; i < children.length; i++) {
            const line = children[i]?.position?.start?.line;
            if (typeof line !== "number" || line > endLine) {
                break;
            }
            if (line >= startLine) {
                replaceStart = i;
                break;
            }
        }
        if (replaceStart < 0) {
            return;
        }
        // Consume every following child whose start line stays in range (a
        // paragraph spanning across endLine is still fully swallowed).
        let replaceEnd = replaceStart;
        for (let i = replaceStart + 1; i < children.length; i++) {
            const line = children[i]?.position?.start?.line;
            if (typeof line !== "number" || line > endLine) {
                break;
            }
            replaceEnd = i;
        }
        if (replaceStart > 0 && replaceEnd < children.length && replaceEnd < replaceStart) {
            return;
        }

        const first = children[replaceStart];
        const last = children[replaceEnd];
        const startPos = first?.position?.start;
        const endPos = last?.position?.end;
        const waveBlock: Paragraph = {
            type: "paragraph",
            children: [{ type: "text", value: "" }],
            data: {
                hName: "waveblock",
                hProperties: { blockkey: blockKey },
            },
            position: {
                start: startPos ?? { line: startLine, column: 1, offset: 0 },
                end: endPos ?? { line: endLine, column: 1, offset: 0 },
            },
        };
        tree.children = [
            ...children.slice(0, replaceStart),
            waveBlock,
            ...children.slice(replaceEnd + 1),
        ];
    };
};

export default remarkFrontmatterToWaveBlock;