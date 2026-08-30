// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "vitest";
import { execSlashCommand, transformSessionBlock, composeSessionText, lineStartOffset } from "./exec";
import type { SlashCommandSpec } from "./registry";

const heading2Cmd: SlashCommandSpec = {
    id: "h2",
    label: "Heading 2",
    group: "text",
    run: (ctx) => {
        const lines = ctx.text.split("\n");
        const cur = lines[ctx.line - 1] ?? "";
        lines[ctx.line - 1] = "## " + cur.trimStart();
        return { text: lines.join("\n"), focusLine: ctx.line };
    },
};

// echo command: reports what ctx it saw (for assertions on line/kind)
const echoCmd = (captured: { ctx?: unknown }): SlashCommandSpec => ({
    id: "echo",
    label: "Echo",
    group: "text",
    run: (ctx) => {
        captured.ctx = ctx;
        return { text: ctx.text, focusLine: ctx.line };
    },
});

describe("execSlashCommand", () => {
    test("strips the /query from the draft and transforms the block", () => {
        const text = "before\n\npara\n\nafter";
        const inv = {
            session: { startLine: 3, endLine: 3 },
            draftText: "/h2",
            triggerStart: 0,
            caret: 3,
        };
        const r = execSlashCommand(text, inv, heading2Cmd);
        // draft stripped to "" → the paragraph row collapses; the heading takes that slot
        // (merged with the surrounding blank separators) — one block swap, one diff.
        expect(r?.text).toBe("before\n\n## \nafter");
        expect(r?.focusLine).toBe(3);
    });

    test("query strip keeps surrounding draft text", () => {
        const captured: { ctx?: any } = {};
        const text = "hello world";
        execSlashCommand(
            text,
            { session: { startLine: 1, endLine: 1 }, draftText: "hello /x world", triggerStart: 6, caret: 8 },
            echoCmd(captured)
        );
        // draft "/x" removed → base line is "hello  world"
        expect((captured.ctx as any).text).toBe("hello  world");
    });

    test("placeholder session composes like commitPlaceholderBlock (front separator pushes block)", () => {
        const captured: { ctx?: any } = {};
        const text = "para above\n\nold row\n\npara below";
        execSlashCommand(
            text,
            {
                session: { startLine: 3, endLine: 3, placeholder: true },
                draftText: "/",
                triggerStart: 0,
                caret: 1,
            },
            echoCmd(captured)
        );
        // stripped draft "" replaces row 3 verbatim — no separators added for empty drafts
        expect((captured.ctx as any).line).toBe(3);
        expect((captured.ctx as any).text).toBe("para above\n\n\n\npara below");
    });

    test("insertMode 'after' block starts two lines below the anchor", () => {
        const captured: { ctx?: any } = {};
        const text = "alpha\nbeta";
        execSlashCommand(
            text,
            {
                session: { startLine: 2, endLine: 2, insertMode: "after" },
                draftText: "/h",
                triggerStart: 0,
                caret: 2,
            },
            echoCmd(captured)
        );
        expect((captured.ctx as any).line).toBe(4);
    });

    test("commands never run with the block inside a code fence", () => {
        const text = "```\ncode line\n```";
        const r = execSlashCommand(
            text,
            { session: { startLine: 2, endLine: 2 }, draftText: "/h2", triggerStart: 0, caret: 3 },
            heading2Cmd
        );
        expect(r).toBeNull();
    });
});

describe("transformSessionBlock", () => {
    test("transforms the block being edited to a heading (draft included)", () => {
        const r = transformSessionBlock("old text", { startLine: 1, endLine: 1 }, "new text", "heading2");
        expect(r?.text).toBe("## new text");
        expect(r?.focusLine).toBe(1);
    });

    test("same-kind transform is a no-op", () => {
        expect(transformSessionBlock("# x", { startLine: 1, endLine: 1 }, "# x", "heading1")).toBeNull();
    });
});

describe("lineStartOffset", () => {
    test("computes absolute offsets", () => {
        expect(lineStartOffset("ab\ncd\nef", 1)).toBe(0);
        expect(lineStartOffset("ab\ncd\nef", 2)).toBe(3);
        expect(lineStartOffset("ab\ncd\nef", 3)).toBe(6);
    });
});

describe("composeSessionText", () => {
    test("plain replacement path", () => {
        expect(composeSessionText("a\nb\nc", { startLine: 2, endLine: 2 }, "B")).toBe("a\nB\nc");
    });
});
