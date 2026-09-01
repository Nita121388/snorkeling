// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Built-in slash commands (方案 02 §2.3). Every command's run() gets the document with
 * the trigger query already stripped and returns the next text (+ caret + focusLine).
 * Anything heavier than a one-liner lives in markdown-transform/ and is unit-tested
 * there; this file is registration glue only.
 */

import { transformBlockType, type BlockKind } from "../../markdown-transform/block-type";
import type { BlockCtx, OpenPickerResult, SlashCommandSpec } from "../registry";

function blockTransformCommand(
    id: string,
    label: string,
    kind: BlockKind,
    extra: { hint?: string; keywords?: string[]; group?: SlashCommandSpec["group"]; when?: SlashCommandSpec["when"] } = {}
): SlashCommandSpec {
    return {
        id,
        label,
        hint: extra.hint,
        keywords: extra.keywords,
        group: extra.group ?? "text",
        when: extra.when,
        run: (ctx: BlockCtx) => {
            const r = transformBlockType(ctx.text, ctx.line, kind, { sourceKind: ctx.kind });
            return r == null ? null : { text: r.text, caret: r.caret, focusLine: ctx.line };
        },
    };
}

/** `> [!note]`-style callout: convert to quote, then tag the first line. */
function calloutCommand(id: string, label: string, tag: string): SlashCommandSpec {
    return {
        id,
        label,
        keywords: ["callout", tag],
        group: "text",
        run: (ctx) => {
            const t = transformBlockType(ctx.text, ctx.line, "quote", { sourceKind: ctx.kind });
            if (t == null) {
                return null;
            }
            const lines = t.text.split("\n");
            const idx = ctx.line - 1;
            const stripped = (lines[idx] ?? "").replace(/^> ?/, "");
            lines[idx] = stripped.length > 0 ? `> [!${tag}] ${stripped}` : `> [!${tag}]`;
            return { text: lines.join("\n"), focusLine: ctx.line };
        },
    };
}

const dividerCommand: SlashCommandSpec = {
    id: "divider",
    label: "Divider",
    hint: "---",
    keywords: ["hr", "rule", "line", "split"],
    group: "structure",
    run: (ctx) => {
        const lines = ctx.text.split("\n");
        // Replace the block with "---", adding one blank separator below when the
        // following line is content (keeps the HR + next-paragraph structure intact).
        const next: string[] = ["---"];
        const after = lines[ctx.endLine];
        if (after != null && after.trim() !== "") {
            next.push("");
        }
        lines.splice(ctx.line - 1, ctx.endLine - ctx.line + 1, ...next);
        return { text: lines.join("\n"), focusLine: undefined };
    },
};

const imageCommand: SlashCommandSpec = {
    id: "image",
    label: "Image",
    hint: "![]()",
    keywords: ["img", "picture", "photo", "img 图片"],
    group: "insert",
    run: (ctx) => {
        const lines = ctx.text.split("\n");
        const insert = "![image](image-url)";
        lines.splice(ctx.line - 1, ctx.endLine - ctx.line + 1, insert);
        const text = lines.join("\n");
        const caret = text.split("\n").slice(0, ctx.line).join("\n").length; // end of the inserted line
        return { text, caret, focusLine: ctx.line };
    },
};

const wikiLinkCommand: SlashCommandSpec = {
    id: "wiki-link",
    label: "Wiki Link",
    hint: "[[…]]",
    keywords: ["link", "wikilink", "wiki"],
    group: "insert",
    run: (ctx) => {
        const lines = ctx.text.split("\n");
        lines.splice(ctx.line - 1, ctx.endLine - ctx.line + 1, "[[]]");
        const text = lines.join("\n");
        // caret between the brackets: line start offset + 2
        const caret = text.split("\n").slice(0, ctx.line - 1).join("\n").length + (ctx.line > 1 ? 1 : 0) + 2;
        return { text, caret, focusLine: ctx.line };
    },
};

const emojiSlashCommand: SlashCommandSpec = {
    id: "emoji",
    label: "Emoji",
    hint: "😀",
    keywords: ["emoji", "biaoqing", "emoticon"],
    group: "insert",
    run: (_ctx): OpenPickerResult => {
        return { type: "open-picker", pickerType: "emoji" };
    },
};

export function builtinSlashCommands(): SlashCommandSpec[] {
    return [
        blockTransformCommand("text", "Text", "text", { keywords: ["paragraph", "plain"] }),
        blockTransformCommand("heading-1", "Heading 1", "heading1", { hint: "#", keywords: ["h1", "bt", "biaoti"] }),
        blockTransformCommand("heading-2", "Heading 2", "heading2", { hint: "##", keywords: ["h2"] }),
        blockTransformCommand("heading-3", "Heading 3", "heading3", { hint: "###", keywords: ["h3"] }),
        blockTransformCommand("heading-4", "Heading 4", "heading4", { hint: "####", keywords: ["h4"] }),
        blockTransformCommand("heading-5", "Heading 5", "heading5", { hint: "#####", keywords: ["h5"] }),
        blockTransformCommand("heading-6", "Heading 6", "heading6", { hint: "######", keywords: ["h6"] }),
        blockTransformCommand("bulleted-list", "Bulleted List", "bulleted", { hint: "•", keywords: ["ul", "list", "bullet"] }),
        blockTransformCommand("numbered-list", "Numbered List", "numbered", { hint: "1.", keywords: ["ol", "ordered", "list"] }),
        blockTransformCommand("todo-list", "To-do List", "todo", { hint: "☐", keywords: ["task", "checkbox", "todo"] }),
        blockTransformCommand("quote", "Quote", "quote", { hint: ">", keywords: ["blockquote", "yhs", "yinyong"] }),
        calloutCommand("callout-note", "Callout: Note", "note"),
        calloutCommand("callout-warning", "Callout: Warning", "warning"),
        calloutCommand("callout-tip", "Callout: Tip", "tip"),
        blockTransformCommand("code-block", "Code Block", "code", { hint: "```", keywords: ["code", "dmk", "daimakuai"], group: "structure" }),
        blockTransformCommand("table", "Table", "table", { hint: "⊞", keywords: ["biaoge", "grid"], group: "structure" }),
        dividerCommand,
        imageCommand,
        wikiLinkCommand,
        emojiSlashCommand,
    ];
}
