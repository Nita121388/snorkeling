// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { List, Root } from "mdast";
import type { Plugin } from "unified";
import { visit } from "unist-util-visit";

/**
 * Split loose lists into per-visual-group lists at blank-line boundaries.
 *
 * Semantics (see the feature spec): a blank line between two list items means "new group".
 * Each resulting sub-list keeps the source-written number of ITS first item (`start`), and
 * its items then continue sequentially — the user owns group starts, we own the rest.
 *
 * Safety:
 * - Only ORDERED lists are split; unordered lists have no numbering contract.
 * - Only splits at direct-child list items with a >=1 blank line gap.
 * - `spread` is set to false on each group (the separating blanks are now real spacer
 *   blocks between top-level lists, so per-item loose margins would double-count).
 * - Nested lists are untouched: a split only happens between items inside the same
 *   `list.children` array, never across different nesting levels.
 */

// The smallest source gap that counts as "a blank line separators between items".
// position lines are 1-based; end.line=3 (item A) then start.line=5 (item B) → line 4 blank.
const MinGapLines = 2;

type SplitGroup = {
    items: List["children"];
    /** 1-based source line of the group's first item. */
    firstLine: number;
};

function markerNumberForLine(sourceText: string, lineNumber: number): number | null {
    const line = sourceText.split(/\r\n|\n/)[lineNumber - 1];
    if (line == null) {
        return null;
    }
    const match = line.match(/^\s*(\d+)[.)]/);
    if (match == null) {
        return null;
    }
    const num = Number.parseInt(match[1], 10);
    return Number.isFinite(num) ? num : null;
}

const remarkSplitLooseLists: Plugin<[], Root> = () => {
    return (tree, file) => {
        const sourceText = typeof file?.value === "string" ? file.value : String(file ?? "");
        visit(tree, "list", (node, index, parent) => {
            if (!node.ordered || index == null || parent == null || node.children.length < 2) {
                return;
            }
            const groups: SplitGroup[] = [];
            let current: SplitGroup | null = null;
            for (const item of node.children) {
                const startLine = item.position?.start?.line;
                const prevEndLine = current?.items[current.items.length - 1]?.position?.end?.line;
                if (current == null || startLine == null || prevEndLine == null) {
                    // First group, or missing positions — keep items flowing, no split.
                    current ??= { items: [], firstLine: startLine ?? node.position?.start?.line ?? 1 };
                    current.items.push(item);
                    continue;
                }
                if (startLine - prevEndLine >= MinGapLines) {
                    // blank line(s) between items → close current group, start a new one
                    groups.push(current);
                    current = { items: [item], firstLine: startLine };
                } else {
                    current.items.push(item);
                }
            }
            if (current) {
                groups.push(current);
            }
            if (groups.length < 2) {
                return; // nothing to split
            }
            const replacement: List[] = groups.map((group, groupIndex) => {
                const first = group.items[0];
                const last = group.items[group.items.length - 1];
                const start =
                    markerNumberForLine(sourceText, first.position?.start?.line ?? group.firstLine) ?? node.start ?? 1;
                // Mark POST-FIRST split groups on the LIST node itself: the block-grip menu
                // reads `data-split-group` to offer the numbering strategies
                // (continue / keep-written / restart-at-1).
                const data =
                    groupIndex > 0 ? ({ hProperties: { dataSplitGroup: "true" } } as List["data"]) : undefined;
                return {
                    type: "list",
                    ordered: true,
                    spread: false,
                    start,
                    data,
                    children: group.items,
                    position: {
                        start: first.position!.start,
                        end: last.position!.end,
                    },
                };
            });
            parent.children.splice(index, 1, ...replacement);
            // splice changes sibling ordering for the visitor; skipping the freshly inserted
            // nodes is automatic for side-effect visits since we only mutate parent here.
            return index + replacement.length;
        });
    };
};

export default remarkSplitLooseLists;
