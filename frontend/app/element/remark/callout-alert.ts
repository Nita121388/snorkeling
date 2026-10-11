// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Blockquote, Root } from "mdast";
import type { Plugin } from "unified";
import { visit } from "unist-util-visit";

const alertRegex = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i;
const leadingEmojiRegex = /^(\p{Extended_Pictographic}(?:\uFE0F|\u20E3)?)\s*/u;
type AlertType = "note" | "tip" | "important" | "warning" | "caution" | "quote";

function cloneInlineChildren(children: any[], prefix: RegExp): any[] {
    const cloned = children.map((child) => ({ ...child }));
    const firstText = cloned.find((child) => child?.type === "text" && typeof child.value === "string");
    if (firstText) firstText.value = firstText.value.replace(prefix, "");
    return cloned.filter((child) => child?.type !== "text" || child.value !== "");
}

/** Converts blockquotes to callouts without inventing an emoji. */
export const remarkCalloutAlert: Plugin<[], Root> = () => (tree: any) => {
    const replacements: { node: Blockquote; index: number; parent: any }[] = [];
    visit(tree, "blockquote", (node: any, index: any, parent: any) => {
        if (node && index != null && parent && Array.isArray(parent.children) && Array.isArray(node.children)) {
            replacements.push({ node, index, parent });
        }
    });

    for (let i = replacements.length - 1; i >= 0; i--) {
        const { node, index, parent } = replacements[i];
        const first = node.children[0] as any;
        const firstText = first?.children?.find((child: any) => child?.type === "text");
        const raw = typeof firstText?.value === "string" ? firstText.value : "";
        const marker = raw.match(alertRegex);
        const alertType: AlertType = marker ? (marker[1].toLowerCase() as AlertType) : "quote";
        const afterMarker = marker ? raw.slice(marker[0].length) : raw;
        const emojiMatch = afterMarker.match(leadingEmojiRegex);
        const emoji = emojiMatch?.[1] ?? null;
        const prefix = new RegExp(
            // slice(1) only strips the leading "^" — it must KEEP the trailing "\s*" so the
            // marker is also stripped when the title line has nothing after it (`> [!note]`).
            // slice(1, -1) used to truncate "\s*" to "\s", requiring whitespace that may not exist.
            `^${marker ? alertRegex.source.slice(1) : ""}${emoji ? leadingEmojiRegex.source.slice(1) : ""}`,
            "iu"
        );
        const titleChildren = first?.children ? cloneInlineChildren(first.children, prefix) : [];
        // Every callout/blockquote gets a fixed emoji affordance. The emoji itself
        // remains opt-in: an empty button is shown only as an add interaction.
        const isTitle = true;
        const button = {
            type: "emphasis",
            children: emoji ? [{ type: "text", value: emoji }] : [],
            data: {
                hName: "button",
                hProperties: {
                    className: `markdown-alert-emoji-btn${emoji == null ? " is-empty" : ""}`,
                    type: "button",
                    ariaLabel: emoji == null ? "Add callout emoji" : "Change callout emoji",
                    dataAlertType: alertType,
                    dataAlertLine: first?.position?.start?.line ?? "",
                    dataAlertEmoji: emoji ?? "",
                },
            },
        };
        const title = isTitle
            ? {
                  type: "paragraph",
                  // Wrap the inline content in ONE span so the flex title has exactly two
                  // items (emoji button + text container). Without the wrapper, every inline
                  // element (strong/em/a) becomes its own flex item, collapses to minimum
                  // content width, and CJK text wraps one glyph per line (vertical columns).
                  children: [
                      button,
                      {
                          type: "paragraph",
                          children: titleChildren,
                          data: {
                              hName: "span",
                              hProperties: { className: "markdown-alert-title-text" },
                          },
                      },
                  ],
                  data: { hName: "p", hProperties: { className: "markdown-alert-title" } },
              }
            : null;
        const children = title == null ? node.children : [title, ...node.children.slice(1)];
        parent.children[index] = {
            type: "paragraph",
            children,
            // R1 块身份：保留源码 position（start + end），renderer 的 `srcLineAttrs` 靠它
            // 产出 data-source-line / -end，整块才可能成为行内编辑目标。不带 position 的
            // 话每个 callout 都是“无坐标”节点，点哪都只能命中正文 <p>（并写掉 `> ` 前缀）。
            position: node.position,
            data: {
                // 自定义 tag（沿用 waveblock / mermaidblock 惯例），把 callout 提升为
                // 一等块：renderer-registry 按 key 注册渲染器、sanitize 需要放行该 tag。
                hName: "calloutalert",
                hProperties: { className: `markdown-alert markdown-alert-${alertType}` },
            },
        };
    }
};

export default remarkCalloutAlert;
