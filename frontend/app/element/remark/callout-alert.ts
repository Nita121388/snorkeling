// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { visit } from "unist-util-visit";
import type { Plugin } from "unified";
import type { Root, Blockquote, Paragraph, PhrasingContent } from "mdast";

const alertRegex = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i;

type AlertType = "note" | "tip" | "important" | "warning" | "caution" | "quote";

const alertConfig: Record<AlertType, { icon: string; label: string }> = {
    note: { icon: "ℹ️", label: "NOTE" },
    tip: { icon: "💡", label: "TIP" },
    important: { icon: "❗", label: "IMPORTANT" },
    warning: { icon: "⚠️", label: "WARNING" },
    caution: { icon: "🚨", label: "CAUTION" },
    quote: { icon: "💬", label: "" },
};

function makeEmojiButton(alertType: string, icon: string): PhrasingContent {
    return {
        type: "text",
        value: icon,
    } as any;
}

/**
 * Remark plugin to transform blockquotes into styled callouts with emoji icons.
 *
 * Uses mdast html nodes so rehype-raw picks them up, then rehype-sanitize
 * allows them through the `html` tagName (if configured) or we use the
 * paragraph wrapper with data.hName approach.
 *
 * Regular blockquote:
 * > Content
 *
 * Becomes:
 * <div class="markdown-alert markdown-alert-quote">💬 Content</div>
 */
export const remarkCalloutAlert: Plugin<[], Root> = () => {
    return (tree: any) => {
        const toReplace: { node: Blockquote; index: number; parent: any }[] = [];

        visit(tree, "blockquote", (node: any, index: any, parent: any) => {
            if (node == null || typeof node !== "object") return;
            if (index == null || parent == null) return;
            if (!Array.isArray(parent.children)) return;
            if (!Array.isArray(node.children)) return;
            toReplace.push({ node, index, parent });
        });

        for (let i = toReplace.length - 1; i >= 0; i--) {
            const { node, index, parent } = toReplace[i];

            const firstChild = node.children[0] as any;
            const firstLine = firstChild?.children?.[0] as any;
            const textValue = typeof firstLine?.value === "string" ? firstLine.value : "";
            const match = textValue.match(alertRegex);

            let alertType: AlertType;
            let config: (typeof alertConfig)[AlertType];

            if (match) {
                alertType = match[1].toLowerCase() as AlertType;
                config = alertConfig[alertType];
            } else {
                alertType = "quote";
                config = alertConfig.quote;
            }

            // Build new children for the div wrapper
            const newChildren: Paragraph[] = [];

            // Emoji button paragraph (will be rendered as the first element)
            const emojiText: PhrasingContent[] = [
                { type: "text", value: `${config.icon} ` } as any,
            ];
            newChildren.push({
                type: "paragraph",
                children: emojiText,
                data: {
                    hName: "span",
                    hProperties: { className: "markdown-alert-emoji" },
                },
            } as any);

            // For GitHub-style callouts, add title
            if (match && config.label) {
                const remaining = textValue.replace(alertRegex, "").replace(/^\n+/, "").trim();
                const titleChildren: PhrasingContent[] = [
                    { type: "text", value: `${config.icon} ${config.label}` } as any,
                ];
                if (remaining) {
                    titleChildren.push({ type: "text", value: ` ${remaining}` } as any);
                }
                newChildren.push({
                    type: "paragraph",
                    children: titleChildren,
                    data: {
                        hName: "p",
                        hProperties: { className: "markdown-alert-title" },
                    },
                } as any);
            }

            // Content paragraphs
            for (let j = 0; j < node.children.length; j++) {
                const child = node.children[j] as any;
                if (j === 0 && match) {
                    // For callouts, skip the [!TYPE] line but keep remaining content
                    const remaining = textValue.replace(alertRegex, "").replace(/^\n+/, "").trim();
                    if (remaining) {
                        newChildren.push({
                            type: "paragraph",
                            children: [{ type: "text", value: remaining }],
                        });
                    }
                } else {
                    newChildren.push(child);
                }
            }

            // Create wrapper paragraph that becomes a div via data.hName
            const wrapperNode: any = {
                type: "paragraph",
                children: newChildren,
                data: {
                    hName: "div",
                    hProperties: {
                        className: `markdown-alert markdown-alert-${alertType}`,
                    },
                },
            };

            parent.children[index] = wrapperNode;
        }
    };
};

export default remarkCalloutAlert;
