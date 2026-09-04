// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { PlatformMacOS, PlatformWindows, setPlatform } from "@/util/platformutil";
import { describe, expect, it } from "vitest";
import {
    buildSessionDetailTimeline,
    formatFileSize,
    formatRelativeRefreshTime,
    formatSessionRelativeTime,
    groupSessionsByProject,
    isReadableMessage,
    restoreCommandForSession,
    restoreMetaForSession,
    shouldStartEmptyChat,
    UnclassifiedGroupName,
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

describe("AI sessions empty state", () => {
    it("starts a new chat only after an unfiltered empty list loads successfully", () => {
        expect(shouldStartEmptyChat(false, 0, false, false, "")).toBe(true);
        expect(shouldStartEmptyChat(true, 0, false, false, "")).toBe(false);
        expect(shouldStartEmptyChat(false, 0, false, true, "")).toBe(false);
        expect(shouldStartEmptyChat(false, 0, false, false, "load failed")).toBe(false);
        expect(shouldStartEmptyChat(false, 1, false, false, "")).toBe(false);
        expect(shouldStartEmptyChat(false, 0, true, false, "")).toBe(false);
    });
});

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

    it("keeps the Claude vendor config in copied resume commands", () => {
        setPlatform(PlatformWindows);
        expect(
            restoreCommandForSession({
                id: "session-123",
                source: "claude",
                projectPath: "C:\\work project",
                configdir: "C:\\Wave Data\\claude-vendors\\vendor-a",
            } as SessionSummary)
        ).toBe(
            `cd "C:\\work project"\n$env:CLAUDE_CONFIG_DIR = 'C:\\Wave Data\\claude-vendors\\vendor-a'\nclaude --resume session-123`
        );
        setPlatform(PlatformMacOS);
        expect(
            restoreCommandForSession({
                id: "session-123",
                source: "claude",
                configdir: "/tmp/Wave Data/claude-vendors/vendor-a",
            } as SessionSummary)
        ).toBe("CLAUDE_CONFIG_DIR='/tmp/Wave Data/claude-vendors/vendor-a' claude --resume session-123");
    });

    it("builds OpenCode resume commands with --session flag", () => {
        setPlatform(PlatformMacOS);
        expect(
            restoreCommandForSession({
                id: "oc-session-456",
                source: "opencode",
                projectPath: "/Users/nita/dev/proj",
            } as SessionSummary)
        ).toBe(`cd /Users/nita/dev/proj\nopencode --session oc-session-456`);
        expect(
            restoreCommandForSession({
                id: "oc-session-456",
                source: "opencode",
                projectPath: "",
            } as SessionSummary)
        ).toBe("opencode --session oc-session-456");
    });

    it("injects OPENCODE_HOME into OpenCode resume commands when configdir is set", () => {
        setPlatform(PlatformMacOS);
        expect(
            restoreCommandForSession({
                id: "oc-session-456",
                source: "opencode",
                projectPath: "/Users/nita/dev/proj",
                configdir: "/tmp/Wave Data/opencode-vendors/vendor-a",
            } as SessionSummary)
        ).toBe(
            `cd /Users/nita/dev/proj\nOPENCODE_HOME='/tmp/Wave Data/opencode-vendors/vendor-a' opencode --session oc-session-456`
        );
        setPlatform(PlatformWindows);
        expect(
            restoreCommandForSession({
                id: "oc-session-456",
                source: "opencode",
                projectPath: "C:\\dev\\proj",
                configdir: "C:\\Wave Data\\opencode-vendors\\vendor-a",
            } as SessionSummary)
        ).toBe(
            `cd "C:\\dev\\proj"\n$env:OPENCODE_HOME = 'C:\\Wave Data\\opencode-vendors\\vendor-a'\nopencode --session oc-session-456`
        );
        setPlatform(PlatformMacOS);
    });

    it("builds Pi resume commands with --session-id flag", () => {
        setPlatform(PlatformMacOS);
        expect(
            restoreCommandForSession({
                id: "pi-session-789",
                source: "pi",
                projectPath: "/Users/nita/dev/proj",
            } as SessionSummary)
        ).toBe(`cd /Users/nita/dev/proj\npi --session-id pi-session-789`);
        expect(
            restoreCommandForSession({
                id: "pi-session-789",
                source: "pi",
                projectPath: "",
            } as SessionSummary)
        ).toBe("pi --session-id pi-session-789");
    });

    it("injects PI_CODING_AGENT_SESSION_DIR into Pi resume commands when configdir is set", () => {
        setPlatform(PlatformMacOS);
        expect(
            restoreCommandForSession({
                id: "pi-session-789",
                source: "pi",
                projectPath: "/Users/nita/dev/proj",
                configdir: "/tmp/Wave Data/pi-sessions/vendor-a",
            } as SessionSummary)
        ).toBe(
            `cd /Users/nita/dev/proj\nPI_CODING_AGENT_SESSION_DIR='/tmp/Wave Data/pi-sessions/vendor-a' pi --session-id pi-session-789`
        );
        setPlatform(PlatformWindows);
        expect(
            restoreCommandForSession({
                id: "pi-session-789",
                source: "pi",
                projectPath: "C:\\dev\\proj",
                configdir: "C:\\Wave Data\\pi-sessions\\vendor-a",
            } as SessionSummary)
        ).toBe(
            `cd "C:\\dev\\proj"\n$env:PI_CODING_AGENT_SESSION_DIR = 'C:\\Wave Data\\pi-sessions\\vendor-a'\npi --session-id pi-session-789`
        );
        setPlatform(PlatformMacOS);
    });

    it("builds vendor restore metadata only from validated context", () => {
        expect(
            restoreMetaForSession({
                sessionid: "session-123",
                source: "claude",
                projectpath: "C:\\work",
                vendorid: "vendor-a",
                vendorname: "Vendor A",
                configdir: "C:\\Wave Data\\claude-vendors\\vendor-a",
            })
        ).toMatchObject({
            cmd: "claude",
            "cmd:cwd": "C:\\work",
            "cmd:env": { CLAUDE_CONFIG_DIR: "C:\\Wave Data\\claude-vendors\\vendor-a" },
            "agent:sessionid": "session-123",
            "agent:claudevendorid": "vendor-a",
            "agent:claudevendorname": "Vendor A",
        });
    });
});

function makeSummary(key: string, projectPath?: string, updatedAt = 1000): SessionSummary {
    return { key, id: key, source: "pi", projectPath, updatedAt };
}

describe("groupSessionsByProject", () => {
    it("buckets sessions by the basename of their project path", () => {
        const groups = groupSessionsByProject([
            makeSummary("a", "/Users/me/work/snorkeling"),
            makeSummary("b", "/Users/me/work/snorkeling"),
            makeSummary("c", "/Users/me/work/other"),
        ]);
        expect(groups.map((g) => g.name)).toEqual(["snorkeling", "other"]);
        expect(groups[0].sessions.length).toBe(2);
        expect(groups[1].sessions.length).toBe(1);
    });

    it("groups Windows and trailing-slash paths by their last component", () => {
        const groups = groupSessionsByProject([
            makeSummary("a", "C:\\Repo\\lyra\\", 200),
            makeSummary("b", "~/Primary/projects/Lyra", 100),
        ]);
        expect(groups.map((g) => g.name)).toEqual(["lyra", "Lyra"]);
    });

    it("sinks every missing or empty projectPath into one muted 未归类 bucket", () => {
        const groups = groupSessionsByProject([
            makeSummary("a", ""),
            makeSummary("b", "   "),
            makeSummary("c", undefined),
            makeSummary("d", "/Users/me/work/real"),
        ]);
        expect(groups[0].name).toBe("real");
        expect(groups[1].name).toBe(UnclassifiedGroupName);
        expect(groups[1].unclassified).toBe(true);
        expect(groups[1].sessions.length).toBe(3);
    });

    it("orders groups by their most recently touched session, newest bucket first", () => {
        const groups = groupSessionsByProject([
            makeSummary("old", "/work/stale", 100),
            makeSummary("fresh", "/work/fresh", 999),
            makeSummary("mid", "/work/mid", 500),
        ]);
        expect(groups.map((g) => g.name)).toEqual(["fresh", "mid", "stale"]);
    });

    it("keeps per-group sessions in the caller's newest-first order", () => {
        const groups = groupSessionsByProject([
            makeSummary("new", "/work/x", 300),
            makeSummary("old", "/work/x", 100),
        ]);
        expect(groups[0].sessions.map((s) => s.key)).toEqual(["new", "old"]);
    });
});
