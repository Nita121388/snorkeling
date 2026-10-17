// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { SOURCE_MARKDOWN_HAST_ATTR } from "../shared/source-markdown-attr";
import type { Root } from "mdast";
import type { Plugin } from "unified";
import { getMdHost } from "../core/host";

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
        const wikiLink = getMdHost().parseMarkdownWikiLink(match[0]);
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
            url: getMdHost().makeMarkdownWikiLinkHref(wikiLink.target, wikiLink.heading),
            children: [{ type: "text", value: wikiLink.label }],
            position: segmentOffsetPosition(node.position, match.index, match.index + match[0].length),
            // **带上原始源码**（`match[0]` 就是用户文件里逐字那个 `[[target|label]]`）。
            //
            // 为什么必须带：`wave-wiki:` href **不能**反向重建出原文 ——
            // `parseMarkdownWikiLink` 会给目标补 `.md`，且无法区分“本来就没写 label”
            // 与“label 恰好等于 target”。只靠 href 还原，用户文件里的 `[[note]]` 会被
            // 写成 `[[note.md]]` —— 语义相同但**改写了用户的文件**，这正是本项目要避免的。
            // hProperties 会经 react-markdown 透传到 `<a>` 上，序列化器再读回来。
            // ⚠ 必须用 camelCase（hast 属性约定）：写 kebab 会被 rehype-sanitize
            // 按 camelCase 匹配不上而**静默剥掉**（实测踩过）。
            data: { hProperties: { [SOURCE_MARKDOWN_HAST_ATTR]: match[0] } },
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
            const reference = getMdHost().parseMarkdownFileLineReference(child.value);
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
