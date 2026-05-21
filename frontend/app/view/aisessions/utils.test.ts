// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { buildSessionDetailTimeline, isReadableMessage } from "./utils";

function makeMessage(seq: number, role: string, text: string): Message {
    return {
        seq,
        role,
        text,
        charCount: text.length,
    };
}

function makeToolCall(seq: number, name: string): ToolCall {
    return {
        seq,
        name,
        summary: `${name} input`,
        output: `${name} output`,
    };
}

describe("AI session detail timeline", () => {
    it("keeps tool placeholders hidden from readable messages", () => {
        expect(isReadableMessage(makeMessage(1, "assistant", "[Tool: shell]"))).toBe(false);
        expect(isReadableMessage(makeMessage(2, "tool", "file1.txt"))).toBe(false);
        expect(isReadableMessage(makeMessage(3, "assistant", "done"))).toBe(true);
    });

    it("inserts loaded tool calls at their hidden placeholder position", () => {
        const allMessages = [
            makeMessage(1, "user", "list files"),
            makeMessage(2, "assistant", "[Tool: shell]"),
            makeMessage(3, "tool", "file1.txt"),
            makeMessage(4, "assistant", "done"),
        ];
        const visibleMessages = allMessages.filter((message) => isReadableMessage(message));

        const timeline = buildSessionDetailTimeline(allMessages, visibleMessages, [makeToolCall(1, "shell")], true);

        expect(
            timeline.map((item) => (item.kind === "message" ? `message:${item.message.seq}` : `tool:${item.anchorSeq}`))
        ).toEqual(["message:1", "tool:2", "message:4"]);
    });

    it("inserts a tool call after a readable assistant message that contains a tool marker", () => {
        const allMessages = [
            makeMessage(1, "user", "list files"),
            makeMessage(2, "assistant", "I will inspect the folder.\n[Tool: shell]"),
            makeMessage(3, "tool", "file1.txt"),
            makeMessage(4, "assistant", "done"),
        ];
        const visibleMessages = allMessages.filter((message) => isReadableMessage(message));

        const timeline = buildSessionDetailTimeline(allMessages, visibleMessages, [makeToolCall(1, "shell")], true);

        expect(
            timeline.map((item) => (item.kind === "message" ? `message:${item.message.seq}` : `tool:${item.anchorSeq}`))
        ).toEqual(["message:1", "message:2", "tool:2", "message:4"]);
    });

    it("does not insert tool calls before the visible message window", () => {
        const allMessages = [
            makeMessage(1, "user", "old question"),
            makeMessage(2, "assistant", "[Tool: old_tool]"),
            makeMessage(3, "assistant", "old answer"),
            makeMessage(4, "user", "new question"),
            makeMessage(5, "assistant", "[Tool: new_tool]"),
            makeMessage(6, "assistant", "new answer"),
        ];
        const visibleMessages = [allMessages[3], allMessages[5]];

        const timeline = buildSessionDetailTimeline(
            allMessages,
            visibleMessages,
            [makeToolCall(1, "old_tool"), makeToolCall(2, "new_tool")],
            true
        );

        expect(
            timeline.map((item) => (item.kind === "message" ? `message:${item.message.seq}` : `tool:${item.anchorSeq}`))
        ).toEqual(["message:4", "tool:5", "message:6"]);
    });

    it("keeps the original message-only timeline when tool calls are hidden", () => {
        const allMessages = [
            makeMessage(1, "user", "list files"),
            makeMessage(2, "assistant", "[Tool: shell]"),
            makeMessage(3, "assistant", "done"),
        ];
        const visibleMessages = allMessages.filter((message) => isReadableMessage(message));

        const timeline = buildSessionDetailTimeline(allMessages, visibleMessages, [makeToolCall(1, "shell")], false);

        expect(timeline.map((item) => item.kind === "message" && item.message.seq)).toEqual([1, 3]);
    });
});
