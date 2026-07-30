// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Root } from "mdast";
import type { Plugin } from "unified";
import { parseMarkdownFileLineReference, parseMarkdownWikiLink, makeMarkdownWikiLinkHref } from "@/app/view/preview/file-link-navigation";

/**
 * Walks the mdast and turns bare text nodes that look like file references
 * (e.g. `src/foo.ts:12`) or Obsidian wiki links (`[[note]]`, `[[note#heading]]`)
 * into proper mdast link nodes. Skips the interior of `code`, `inlineCode`,
 * and existing `link` nodes so we don't double-process already-resolved hrefs.
 */
export function linkifyMarkdownFileReferences(tree: any): void {
    const visitNode = (node: any) => {
        if (!node || !Array.isArray(node.children) || ["code", "inlineCode", "link"].includes(node.type)) {
            return;
        }
        node.children = node.children.map((child: any) => {
            if (child?.type === "text") {
                const reference = parseMarkdownFileLineReference(child.value);
                if (reference != null) {
                    const label = child.value.trim();
                    return {
                        type: "link",
                        url: label,
                        children: [{ type: "text", value: label }],
                        position: child.position,
                    };
                }
                const wikiLink = parseMarkdownWikiLink(child.value);
                if (wikiLink != null) {
                    return {
                        type: "link",
                        url: makeMarkdownWikiLinkHref(wikiLink.target, wikiLink.heading),
                        children: [{ type: "text", value: wikiLink.label }],
                        position: child.position,
                    };
                }
            }
            visitNode(child);
            return child;
        });
    };
    visitNode(tree);
}

const remarkMarkdownFileReferences: Plugin<[], Root> = function () {
    return linkifyMarkdownFileReferences;
};

export default remarkMarkdownFileReferences;
