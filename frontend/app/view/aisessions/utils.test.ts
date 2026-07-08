// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { PlatformMacOS, PlatformWindows, setPlatform } from "@/util/platformutil";
import {
    buildSessionDetailTimeline,
    formatFileSize,
    formatRelativeRefreshTime,
    formatSessionRelativeTime,
    isCollapsibleMessage,
    isReadableMessage,
    restoreCommandForSession,
} from "./utils";

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

    it("formats file sizes for session metadata", () => {
        expect(formatFileSize(0)).toBe("0 B");
        expect(formatFileSize(999)).toBe("999 B");
        expect(formatFileSize(1536)).toBe("1.5 KB");
        expect(formatFileSize(5 * 1024 * 1024)).toBe("5 MB");
    });

    it("formats relative refresh times", () => {
        const now = 1_800_000_000_000;
        expect(formatRelativeRefreshTime(now - 9_000, now)).toBe("Refreshed just now");
        expect(formatRelativeRefreshTime(now - 25_000, now)).toBe("Refreshed 25s ago");
        expect(formatRelativeRefreshTime(now - 3 * 60_000, now)).toBe("Refreshed 3m ago");
        expect(formatRelativeRefreshTime(now - 2 * 60 * 60_000, now)).toBe("Refreshed 2h ago");
        expect(formatRelativeRefreshTime(now - 2 * 24 * 60 * 60_000, now)).toBe("Refreshed 2d ago");
    });

    it("formats session list times as relative age", () => {
        const now = 1_800_000_000_000;
        expect(formatSessionRelativeTime(now - 9_000, now)).toBe("just now");
        expect(formatSessionRelativeTime(now - 25_000, now)).toBe("25s ago");
        expect(formatSessionRelativeTime(now - 3 * 60_000, now)).toBe("3m ago");
        expect(formatSessionRelativeTime(now - 2 * 60 * 60_000, now)).toBe("2h ago");
        expect(formatSessionRelativeTime(now - 2 * 24 * 60 * 60_000, now)).toBe("2d ago");
        expect(formatSessionRelativeTime(Math.floor((now - 45_000) / 1000), now)).toBe("45s ago");
    });

    it("copies Claude resume commands from the session project directory", () => {
        setPlatform(PlatformMacOS);
        expect(
            restoreCommandForSession({
                id: "session-123",
                source: "claude",
                projectPath: "/Users/nita/Project Files/it's-here",
            } as SessionSummary)
        ).toBe(`cd '/Users/nita/Project Files/it'"'"'s-here'\nclaude --resume session-123`);
    });

    it("copies Claude resume commands with Windows-safe quoting and no shell separator", () => {
        setPlatform(PlatformWindows);
        expect(
            restoreCommandForSession({
                id: "session-123",
                source: "claude",
                projectPath: "E:\\code\\snorkeling",
            } as SessionSummary)
        ).toBe(`cd "E:\\code\\snorkeling"\nclaude --resume session-123`);
        expect(
            restoreCommandForSession({
                id: "session-123",
                source: "claude",
                projectPath: "C:\\Program Files\\it's-here",
            } as SessionSummary)
        ).toBe(`cd "C:\\Program Files\\it's-here"\nclaude --resume session-123`);
        setPlatform(PlatformMacOS);
    });

    it("copies Claude resume commands without cd when project path is missing", () => {
        setPlatform(PlatformMacOS);
        expect(
            restoreCommandForSession({
                id: "session-123",
                source: "claude",
                projectPath: "",
            } as SessionSummary)
        ).toBe("claude --resume session-123");
    });
});

describe("AI session message collapse", () => {
    it("keeps up to four lines expanded", () => {
        expect(isCollapsibleMessage("line1\nline2\nline3\nline4")).toBe(false);
    });

    it("collapses five-line messages", () => {
        expect(isCollapsibleMessage("line1\nline2\nline3\nline4\nline5")).toBe(true);
    });

    it("collapses long single-line messages", () => {
        expect(isCollapsibleMessage("x".repeat(600))).toBe(true);
        expect(isCollapsibleMessage("x".repeat(599))).toBe(false);
    });
});
