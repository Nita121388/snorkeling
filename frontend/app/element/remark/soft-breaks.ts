// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Root } from "mdast";
import type { Plugin } from "unified";
import type { VFile } from "vfile";

/**
 * Splits text nodes containing `\n` into multiple text nodes joined by `break`
 * nodes, so single-paragraph line breaks (Markdown soft breaks) render as
 * explicit `<br/>` rather than being collapsed into a space by the HTML
 * serializer. Mirrors the user's authored line wrapping.
 */
const remarkSoftBreaks: Plugin<[], Root> = function () {
    return (tree: Root, _file: VFile) => {
        const visitNode = (node: any) => {
            if (!node || !Array.isArray(node.children)) {
                return;
            }
            const nextChildren: any[] = [];
            for (const child of node.children) {
                if (child?.type === "text" && typeof child.value === "string" && child.value.includes("\n")) {
                    const lines = child.value.split("\n");
                    lines.forEach((line, index) => {
                        if (index > 0) {
                            nextChildren.push({ type: "break" });
                        }
                        if (line.length > 0) {
                            nextChildren.push({ ...child, value: line });
                        }
                    });
                    continue;
                }
                visitNode(child);
                nextChildren.push(child);
            }
            node.children = nextChildren;
        };
        visitNode(tree);
    };
};

export default remarkSoftBreaks;
