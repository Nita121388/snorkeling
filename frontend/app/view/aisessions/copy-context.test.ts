// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it } from "vitest";
import { formatDateTimeToSecond } from "./utils";
import {
    clearSessionContextResolvers,
    parseSessionCopyMeta,
    registerSessionContextResolver,
    resolveSessionContext,
    sessionContextAttrs,
} from "@/app/element/copy-context-contract";
import {
    CopyContextMaxChars,
    fencedBlock,
    formatSessionContext,
    formatTermContext,
    longestBacktickRun,
    makeSessionContextResolver,
    type SessionCopyMessage,
    type SessionCopySource,
} from "./copy-context";

function message(seq: number, role: string, text: string, extra?: Partial<SessionCopyMessage>): SessionCopyMessage {
    return { seq, role, text, ...extra };
}

function source(overrides: Partial<SessionCopySource> = {}): SessionCopySource {
    return {
        summary: {
            id: "sess-1",
            source: "claude",
            title: "修复 VCS 中文路径乱码",
            projectPath: "E:\\code\\snorkeling",
        },
        messages: [
            message(1, "user", "为什么 git status 输出是乱码？", { timestamp: 1760000000000 }),
            message(2, "assistant", "因为 quotePath 会转义非 ASCII。", {
                timestamp: 1760000060000,
                model: "claude-sonnet-4-5",
            }),
            message(3, "assistant", "需要先解码再进前端状态。", { timestamp: 1760000120000 }),
        ],
        seqStart: 2,
        seqEnd: 2,
        selectedText: "因为 quotePath 会转义非 ASCII。",
        ...overrides,
    };
}

/** Split the output into header lines (inclusive of `</context>`) and body. */
function split(text: string): { header: string[]; body: string } {
    const close = "</context>";
    const index = text.indexOf(close);
    if (index < 0) {
        return { header: text.split("\n"), body: "" };
    }
    let body = text.slice(index + close.length);
    if (body.startsWith("\n\n")) {
        body = body.slice(2);
    } else if (body.startsWith("\n")) {
        body = body.slice(1);
    }
    return { header: text.slice(0, index + close.length).split("\n"), body };
}

describe("formatSessionContext", () => {
    it("emits every available field in contract order for a single message", () => {
        const text = formatSessionContext(source());
        expect(text).toBe(
            [
                "<context>",
                "session: 修复 VCS 中文路径乱码",
                "session-id: sess-1",
                "source: claude",
                "model: claude-sonnet-4-5",
                "project: E:\\code\\snorkeling",
                "message-seq: 2",
                "messages-referenced: 1",
                "role: assistant",
                `time: ${formatDateTimeToSecond(1760000060000)}`,
                "</context>",
                "",
                "因为 quotePath 会转义非 ASCII。",
            ].join("\n")
        );
    });

    it("omits lines for missing model, project and timestamp", () => {
        const text = formatSessionContext(
            source({
                summary: { id: "sess-2", source: "codex" },
                messages: [message(7, "user", "hello")],
                seqStart: 7,
                seqEnd: 7,
                selectedText: "hello",
            })
        );
        const { header } = split(text);
        expect(header).toEqual([
            "<context>",
            "session: sess-2",
            "session-id: sess-2",
            "source: codex",
            "message-seq: 7",
            "messages-referenced: 1",
            "role: user",
            "</context>",
        ]);
    });

    it("falls back to the session id when the title is blank", () => {
        const text = formatSessionContext(
            source({ summary: { id: "sess-3", source: "pi", title: "   " } })
        );
        expect(text).toContain("session: sess-3");
    });

    it("reports a seq range and drops role for mixed-role ranges", () => {
        const text = formatSessionContext(source({ seqStart: 1, seqEnd: 3, selectedText: "partial" }));
        const { header, body } = split(text);
        expect(header).toContain("message-seq: 1-3");
        expect(header.some((line) => line.startsWith("role:"))).toBe(false);
        // Range body is rebuilt from the model, not from the partial DOM text.
        expect(body).toBe(
            [
                "**user:**",
                "",
                "为什么 git status 输出是乱码？",
                "",
                "**assistant:**",
                "",
                "因为 quotePath 会转义非 ASCII。",
                "",
                "**assistant:**",
                "",
                "需要先解码再进前端状态。",
            ].join("\n")
        );
    });

    it("keeps role when every covered message shares it", () => {
        const text = formatSessionContext(source({ seqStart: 2, seqEnd: 3 }));
        const { header } = split(text);
        expect(header).toContain("role: assistant");
        expect(header).toContain("message-seq: 2-3");
    });

    it("does not truncate a body of exactly the limit", () => {
        const body = "x".repeat(CopyContextMaxChars);
        const text = formatSessionContext(source({ selectedText: body }));
        const { body: out } = split(text);
        expect(out.length).toBe(CopyContextMaxChars);
        expect(out).not.toContain("truncated");
    });

    it("truncates one char over the limit and reports the exact omitted count", () => {
        const body = "x".repeat(CopyContextMaxChars + 1);
        const text = formatSessionContext(source({ selectedText: body }));
        const { body: out } = split(text);
        expect(out).toBe(`${"x".repeat(CopyContextMaxChars)}\n\n… (truncated, 1 chars omitted)`);
    });

    it("collapses newlines inside header values", () => {
        const text = formatSessionContext(
            source({ summary: { id: "sess-4", source: "claude", title: "line1\nline2" } })
        );
        expect(text).toContain("session: line1 line2");
        expect(text).not.toContain("session: line1\nline2");
    });

    it("includes tool fields when anchored in a tool card", () => {
        const text = formatSessionContext(source({ toolName: "bash", exitCode: 2 }));
        const { header } = split(text);
        expect(header).toContain("tool: bash");
        expect(header).toContain("tool-exit: 2");
    });

    it("omits tool-exit for a zero exit code", () => {
        const text = formatSessionContext(source({ toolName: "read", exitCode: 0 }));
        const { header } = split(text);
        expect(header).toContain("tool: read");
        expect(header.some((line) => line.startsWith("tool-exit:"))).toBe(false);
    });
});

describe("longestBacktickRun", () => {
    it("counts the longest consecutive backtick run", () => {
        expect(longestBacktickRun("plain")).toBe(0);
        expect(longestBacktickRun("a `b` c")).toBe(1);
        expect(longestBacktickRun("a ```b``` c")).toBe(3);
        expect(longestBacktickRun("`````")).toBe(5);
    });
});

describe("fencedBlock", () => {
    it("uses three backticks by default", () => {
        expect(fencedBlock("hello")).toBe("```\nhello\n```");
    });

    it("grows past a triple-backtick run inside the text", () => {
        expect(fencedBlock("a ```js b")).toBe("````\na ```js b\n````");
    });

    it("grows past a five-backtick run", () => {
        expect(fencedBlock("`````")).toBe("``````\n`````\n``````");
    });

    it("appends the language tag", () => {
        expect(fencedBlock("const a = 1;", "ts")).toBe("```ts\nconst a = 1;\n```");
    });
});

describe("formatTermContext", () => {
    it("formats the terminal context block with a fenced body", () => {
        const text = formatTermContext({
            blockId: "block-1",
            agent: "claude",
            cwd: "E:\\code\\snorkeling",
            connection: "local",
            selectedLines: { start: 14, end: 21 },
            text: "line a\nline b",
        });
        expect(text).toBe(
            [
                "<context>",
                "block: block-1",
                "agent: claude",
                "cwd: E:\\code\\snorkeling",
                "connection: local",
                "selected-lines: 14-21",
                "lines: 8",
                "</context>",
                "",
                "```",
                "line a",
                "line b",
                "```",
            ].join("\n")
        );
    });

    it("omits optional lines and defaults connection to local", () => {
        const text = formatTermContext({ blockId: "b2", text: "x" });
        expect(text).toBe(["<context>", "block: b2", "connection: local", "</context>", "", "```", "x", "```"].join("\n"));
    });

    it("normalizes a reversed line range", () => {
        const text = formatTermContext({ blockId: "b3", selectedLines: { start: 21, end: 14 }, text: "x" });
        expect(text).toContain("selected-lines: 14-21");
    });
});

describe("parseSessionCopyMeta", () => {
    it("parses a well-formed payload", () => {
        const meta = parseSessionCopyMeta(
            JSON.stringify({ sessionId: "s1", seq: 4, role: "user", model: "m", exitCode: 0 })
        );
        expect(meta).toEqual({
            sessionId: "s1",
            source: undefined,
            title: undefined,
            projectPath: undefined,
            model: "m",
            seq: 4,
            role: "user",
            timestamp: undefined,
            toolName: undefined,
            exitCode: 0,
        });
    });

    it("returns null for missing, malformed or id-less payloads", () => {
        expect(parseSessionCopyMeta(null)).toBeNull();
        expect(parseSessionCopyMeta(undefined)).toBeNull();
        expect(parseSessionCopyMeta("")).toBeNull();
        expect(parseSessionCopyMeta("{")).toBeNull();
        expect(parseSessionCopyMeta("42")).toBeNull();
        expect(parseSessionCopyMeta("{}")).toBeNull();
        expect(parseSessionCopyMeta(JSON.stringify({ sessionId: "" }))).toBeNull();
    });
});

describe("sessionContextAttrs / resolver registry", () => {
    afterEach(() => {
        clearSessionContextResolvers();
    });

    it("round-trips meta through the DOM attribute payload", () => {
        const meta = { sessionId: "s9", seq: 3, role: "user", title: "标题" };
        const attrs = sessionContextAttrs(meta);
        expect(parseSessionCopyMeta(attrs["data-copy-context-meta"])?.sessionId).toBe("s9");
        expect(attrs["data-copy-context-kind"]).toBe("aisession");
    });

    it("returns null when no resolver is registered for the session", () => {
        expect(resolveSessionContext({ sessionId: "missing", seq: 1 }, "text")).toBeNull();
    });

    it("uses the tracked range over the anchor message", () => {
        const state = {
            summary: { id: "s1", source: "claude", title: "T", projectPath: "E:\\p" },
            messages: [
                message(1, "user", "q"),
                message(2, "assistant", "a"),
                message(3, "assistant", "b"),
            ],
            seqRange: { start: 1, end: 3 },
        };
        const unregister = registerSessionContextResolver("s1", makeSessionContextResolver(() => state));
        const text = resolveSessionContext({ sessionId: "s1", seq: 3 }, "ignored");
        unregister();
        expect(text).toContain("message-seq: 1-3");
        expect(text).toContain("**user:**");
    });

    it("falls back to the anchor seq when no range was tracked", () => {
        const state = {
            summary: { id: "s2", source: "claude" },
            messages: [message(5, "user", "hello"), message(6, "assistant", "hi")],
            seqRange: null,
        };
        registerSessionContextResolver("s2", makeSessionContextResolver(() => state));
        const text = resolveSessionContext({ sessionId: "s2", seq: 5 }, "hello");
        expect(text).toContain("message-seq: 5");
        expect(text).toContain("role: user");
    });

    it("drops the resolver on unregister and on replacement", () => {
        const state = { summary: { id: "s3" }, messages: [message(1, "user", "x")], seqRange: null };
        const first = registerSessionContextResolver("s3", makeSessionContextResolver(() => state));
        first();
        expect(resolveSessionContext({ sessionId: "s3", seq: 1 }, "x")).toBeNull();

        registerSessionContextResolver("s3", makeSessionContextResolver(() => state));
        // A stale unregister from the first registration must not evict the second.
        first();
        expect(resolveSessionContext({ sessionId: "s3", seq: 1 }, "x")).not.toBeNull();
    });

    it("returns null when the state getter yields nothing", () => {
        registerSessionContextResolver("s4", makeSessionContextResolver(() => null));
        expect(resolveSessionContext({ sessionId: "s4", seq: 1 }, "x")).toBeNull();
    });
});

describe("formatSessionContext — locator fields", () => {
    const locatorSummary = {
        id: "sess-loc",
        key: "parent/sess-loc",
        source: "pi",
        title: "定位测试",
        projectPath: "E:/code/snorkeling",
        filePath: "C:/Users/me/sessions/sess-loc.jsonl",
        createdAt: 1760000000000,
        updatedAt: 1760003600000,
        messageCount: 143,
        parentKey: "parent-session-key",
    };

    it("emits every session locator an agent needs to find the file", () => {
        const text = formatSessionContext({
            summary: locatorSummary,
            messages: [{ seq: 9, role: "assistant", text: "x", entryId: "entry-9", itemKey: "item-9" }],
            seqStart: 9,
            seqEnd: 9,
            selectedText: "x",
        });
        const { header } = split(text);
        expect(header).toContain("session-file: C:/Users/me/sessions/sess-loc.jsonl");
        expect(header).toContain(`created: ${formatDateTimeToSecond(1760000000000)}`);
        expect(header).toContain(`updated: ${formatDateTimeToSecond(1760003600000)}`);
        expect(header).toContain("parent-session: parent-session-key");
        expect(header).toContain("session-messages: 143");
        expect(header).toContain("messages-referenced: 1");
        expect(header).toContain("entry-id: entry-9");
        expect(header).toContain("item-key: item-9");
    });

    it("orders locators before the quote content", () => {
        const text = formatSessionContext({
            summary: locatorSummary,
            messages: [{ seq: 9, role: "assistant", text: "x" }],
            seqStart: 9,
            seqEnd: 9,
            selectedText: "x",
        });
        const { header } = split(text);
        const keys = header.map((line) => line.split(":")[0]);
        expect(keys.indexOf("session-file")).toBeLessThan(keys.indexOf("message-seq"));
        expect(keys.indexOf("message-seq")).toBeLessThan(keys.indexOf("role"));
    });

    it("drops entry-id and item-key for a multi-message range", () => {
        const text = formatSessionContext({
            summary: locatorSummary,
            messages: [
                { seq: 1, role: "user", text: "a", entryId: "e1" },
                { seq: 2, role: "assistant", text: "b", entryId: "e2" },
            ],
            seqStart: 1,
            seqEnd: 2,
            selectedText: "",
        });
        const { header } = split(text);
        expect(header.some((line) => line.startsWith("entry-id:"))).toBe(false);
        expect(header.some((line) => line.startsWith("item-key:"))).toBe(false);
        expect(header).toContain("messages-referenced: 2");
    });

    it("emits time-end only for ranges and keeps the start time", () => {
        const text = formatSessionContext({
            summary: { id: "s" },
            messages: [
                { seq: 1, role: "user", text: "a", timestamp: 1760000000000 },
                { seq: 2, role: "assistant", text: "b", timestamp: 1760000120000 },
            ],
            seqStart: 1,
            seqEnd: 2,
            selectedText: "",
        });
        const { header } = split(text);
        expect(header).toContain(`time: ${formatDateTimeToSecond(1760000000000)}`);
        expect(header).toContain(`time-end: ${formatDateTimeToSecond(1760000120000)}`);
    });

    it("omits time-end for a single message", () => {
        const text = formatSessionContext(source());
        const { header } = split(text);
        expect(header.some((line) => line.startsWith("time-end:"))).toBe(false);
    });

    it("omits every optional locator when the summary is bare", () => {
        const text = formatSessionContext({
            summary: { id: "bare" },
            messages: [{ seq: 1, role: "user", text: "a" }],
            seqStart: 1,
            seqEnd: 1,
            selectedText: "a",
        });
        const { header } = split(text);
        expect(header).toEqual([
            "<context>",
            "session: bare",
            "session-id: bare",
            "message-seq: 1",
            "messages-referenced: 1",
            "role: user",
            "</context>",
        ]);
    });
});
