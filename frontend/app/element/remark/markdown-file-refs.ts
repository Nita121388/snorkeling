// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Root } from "mdast";
import type { Plugin } from "unified";
import { parseMarkdownFileLineReference, parseMarkdownWikiLink, makeMarkdownWikiLinkHref } from "@/app/view/preview/file-link-navigation";

/**
 * Walks the mdast and turns bare text nodes that look like file references
 * (e.g. `src/foo.ts:12`) or Obsidian wiki links (`[[note]]`, `[[note#heading]]`)
 * into proper mdast link nodes. Wiki links embedded inside longer text
 * (`看 → [[note]]`) split the text node into text/link/text segments, so any
 * number of them per line becomes clickable. Skips the interior of `code`,
 * `inlineCode`, and existing `link` nodes so we don't double-process
 * already-resolved hrefs.
 */

// Matches the inner payload of a wiki link; brackets can't nest in Obsidian syntax.
const WikiLinkPattern = /\[\[([^\][|]+?)(?:\|([^\][]*))?\]\]/g;

function segmentOffsetPosition(base: any, startOffset?: number, endOffset?: number) {
    if (base?.start?.offset == null || base?.end?.offset == null || startOffset == null || endOffset == null) {
        return undefined;
    }
    const start = { ...base.start, offset: base.start.offset + startOffset };
    const end = { ...base.end, offset: base.start.offset + endOffset };
    return { start, end };
}

// Returns replacement nodes when the text contains at least one embeddable wiki
// link, or null when there is nothing to linkify (caller falls back to other rules).
export function splitTextNodeWithWikiLinks(node: { type: "text"; value: string; position?: any }): any[] | null {
    const value = node.value ?? "";
    WikiLinkPattern.lastIndex = 0;
    const parts: any[] = [];
    let last = 0;
    let found = false;
    let match: RegExpExecArray | null;
    while ((match = WikiLinkPattern.exec(value)) != null) {
        // Skip Obsidian embeds: ![[image]] is not a navigation link.
        if (match.index > 0 && value[match.index - 1] === "!") {
            continue;
        }
        const wikiLink = parseMarkdownWikiLink(match[0]);
        if (wikiLink == null) {
            continue;
        }
        found = true;
        if (match.index > last) {
            parts.push({
                type: "text",
                value: value.slice(last, match.index),
                position: segmentOffsetPosition(node.position, last, match.index),
            });
        }
        parts.push({
            type: "link",
            url: makeMarkdownWikiLinkHref(wikiLink.target, wikiLink.heading),
            children: [{ type: "text", value: wikiLink.label }],
            position: segmentOffsetPosition(node.position, match.index, match.index + match[0].length),
        });
        last = match.index + match[0].length;
    }
    if (!found) {
        return null;
    }
    if (last < value.length) {
        parts.push({ type: "text", value: value.slice(last), position: segmentOffsetPosition(node.position, last, value.length) });
    }
    return parts;
}

export function linkifyMarkdownFileReferences(tree: any): void {
    const visitNode = (node: any) => {
        if (!node || !Array.isArray(node.children) || ["code", "inlineCode", "link"].includes(node.type)) {
            return;
        }
        node.children = node.children.flatMap((child: any) => {
            if (child?.type !== "text") {
                visitNode(child);
                return [child];
            }
            const segments = splitTextNodeWithWikiLinks(child);
            if (segments != null) {
                return segments;
            }
            const reference = parseMarkdownFileLineReference(child.value);
            if (reference != null) {
                const label = child.value.trim();
                return [
                    {
                        type: "link",
                        url: label,
                        children: [{ type: "text", value: label }],
                        position: child.position,
                    },
                ];
            }
            visitNode(child);
            return [child];
        });
    };
    visitNode(tree);
}

const remarkMarkdownFileReferences: Plugin<[], Root> = function () {
    return linkifyMarkdownFileReferences;
};

export default remarkMarkdownFileReferences;
