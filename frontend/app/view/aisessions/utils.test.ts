// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { PlatformMacOS, PlatformWindows, setPlatform } from "@/util/platformutil";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    applySelectionRange,
    buildBatchCopyText,
    buildSessionDetailTimeline,
    describeSessionDates,
    formatFileSize,
    formatRelativeRefreshTime,
    formatSessionDateCompact,
    formatSessionRelativeTime,
    groupSessionsByProject,
    countSubSessions,
    isReadableMessage,
    makeSessionComparator,
    pruneSelectionToVisible,
    readExpandAllTagsPreference,
    restoreCommandForSession,
    restoreMetaForSession,
    shouldExpandAllTags,
    shouldStartEmptyChat,
    sortSessions,
    UnclassifiedGroupName,
    writeExpandAllTagsPreference,
} from "./utils";
import { expandAllTagsStorageKey, sanitizeSortChain, DefaultSortChain, MaxSortChainLength } from "./types";

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

    it("omits the year in compact dates when it matches the current year", () => {
        const now = new Date(2026, 2, 15, 12, 0, 0).getTime();
        expect(formatSessionDateCompact(new Date(2026, 2, 14, 9, 0, 0).getTime(), now)).toBe("03-14");
        expect(formatSessionDateCompact(new Date(2026, 0, 1, 0, 0, 0).getTime(), now)).toBe("01-01");
        expect(formatSessionDateCompact(new Date(2025, 11, 31, 23, 0, 0).getTime(), now)).toBe("2025-12-31");
    });

    it("returns an empty compact date for missing or invalid timestamps", () => {
        const now = new Date(2026, 2, 15, 12, 0, 0).getTime();
        expect(formatSessionDateCompact(0, now)).toBe("");
        expect(formatSessionDateCompact(Number.NaN, now)).toBe("");
    });

    it("accepts second-level timestamps for compact dates", () => {
        const now = new Date(2026, 2, 15, 12, 0, 0).getTime();
        const created = Math.floor(new Date(2026, 2, 14, 9, 0, 0).getTime() / 1000);
        expect(formatSessionDateCompact(created, now)).toBe("03-14");
    });

    it("describes created and updated dates for a session row", () => {
        const now = new Date(2026, 2, 15, 12, 0, 0).getTime();
        const created = new Date(2026, 2, 14, 9, 0, 0).getTime();
        const updated = new Date(2026, 2, 15, 10, 0, 0).getTime();
        const info = describeSessionDates(created, updated, now);
        expect(info.updatedText).toBe("2h ago · 03-15");
        expect(info.createdText).toBe("03-14");
        expect(info.updatedFull).toBe("2026-03-15 10:00:00");
        expect(info.createdFull).toBe("2026-03-14 09:00:00");
    });

    it("merges created into updated when both land on the same calendar day", () => {
        const now = new Date(2026, 2, 15, 12, 0, 0).getTime();
        const created = new Date(2026, 2, 15, 8, 0, 0).getTime();
        const updated = new Date(2026, 2, 15, 10, 0, 0).getTime();
        expect(describeSessionDates(created, updated, now).createdText).toBe("");
    });

    it("falls back to created time and hides the created segment when it is missing", () => {
        const now = new Date(2026, 2, 15, 12, 0, 0).getTime();
        const created = new Date(2026, 2, 14, 9, 0, 0).getTime();
        const onlyCreated = describeSessionDates(created, 0, now);
        expect(onlyCreated.updatedText).toBe("1d ago · 03-14");
        expect(onlyCreated.createdText).toBe("");
        expect(describeSessionDates(0, 0, now)).toEqual({
            updatedText: "",
            createdText: "",
            updatedFull: "never",
            createdFull: "never",
        });
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

describe("expand-all-tags preference (option B)", () => {
    // The suite runs in the node environment, so window/localStorage must be
    // stubbed the same way the preview draft tests do it.
    function stubStorage(): Map<string, string> {
        const storage = new Map<string, string>();
        vi.stubGlobal("window", {
            localStorage: {
                getItem: (key: string) => storage.get(key) ?? null,
                setItem: (key: string, value: string) => {
                    storage.set(key, value);
                },
                removeItem: (key: string) => {
                    storage.delete(key);
                },
            },
        });
        return storage;
    }

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("defaults to collapsed when storage is empty", () => {
        stubStorage();
        // The preference is opt-in: a fresh user keeps the 4-tag + "+N" layout,
        // otherwise every row would be padded out by its tags.
        expect(readExpandAllTagsPreference()).toBe(false);
    });

    it("round-trips through localStorage", () => {
        stubStorage();
        writeExpandAllTagsPreference(true);
        expect(readExpandAllTagsPreference()).toBe(true);
        writeExpandAllTagsPreference(false);
        expect(readExpandAllTagsPreference()).toBe(false);
    });

    it("treats any non-'1' stored value as collapsed", () => {
        const storage = stubStorage();
        storage.set(expandAllTagsStorageKey, "yes");
        expect(readExpandAllTagsPreference()).toBe(false);
    });

    it("expands a row when either the global preference or the row is open", () => {
        expect(shouldExpandAllTags(true, false)).toBe(true);
        expect(shouldExpandAllTags(false, true)).toBe(true);
        expect(shouldExpandAllTags(true, true)).toBe(true);
        expect(shouldExpandAllTags(false, false)).toBe(false);
    });
});

// ─── 多选与批量操作 ───

describe("pruneSelectionToVisible", () => {
    it("returns an empty array for an empty selection", () => {
        expect(pruneSelectionToVisible([], ["a", "b"])).toEqual([]);
    });

    it("keeps keys that are still visible, in the original order", () => {
        expect(pruneSelectionToVisible(["b", "a"], ["a", "b", "c"])).toEqual(["b", "a"]);
        expect(pruneSelectionToVisible(["a", "b"], ["a", "b"])).toEqual(["a", "b"]);
    });

    it("drops keys that the filter removed", () => {
        expect(pruneSelectionToVisible(["a", "gone", "b"], ["a", "b"])).toEqual(["a", "b"]);
        expect(pruneSelectionToVisible(["a", "b"], [])).toEqual([]);
    });

    it("drops blank keys and de-duplicates", () => {
        expect(pruneSelectionToVisible(["", "a", "a", "b"], ["a", "b"])).toEqual(["a", "b"]);
    });
});

describe("applySelectionRange", () => {
    const keys = ["k1", "k2", "k3", "k4", "k5"];

    it("selects forward from anchor to target", () => {
        expect(applySelectionRange(keys, "k2", "k4")).toEqual(["k2", "k3", "k4"]);
    });

    it("selects backward when the target precedes the anchor", () => {
        expect(applySelectionRange(keys, "k4", "k2")).toEqual(["k2", "k3", "k4"]);
    });

    it("returns just the target when the anchor is blank or no longer visible", () => {
        expect(applySelectionRange(keys, "", "k3")).toEqual(["k3"]);
        expect(applySelectionRange(keys, "dropped", "k3")).toEqual(["k3"]);
    });

    it("returns an empty array when the target is not visible", () => {
        expect(applySelectionRange(keys, "k2", "dropped")).toEqual([]);
        expect(applySelectionRange(keys, "k2", "")).toEqual([]);
    });

    it("selects a single row when anchor and target are the same", () => {
        expect(applySelectionRange(keys, "k3", "k3")).toEqual(["k3"]);
    });
});

describe("buildBatchCopyText", () => {
    const sessions: SessionSummary[] = [
        { key: "k1", id: "s1", source: "codex", filePath: "/a/one.jsonl", projectPath: "/Users/nita/work" } as SessionSummary,
        { key: "k2", id: "s2", source: "codex", filePath: "/a/two.jsonl", projectPath: "/users/nita/work" } as SessionSummary,
        { key: "k3", id: "s3", source: "codex", filePath: "/a/three.jsonl", projectPath: "/tmp/scratch" } as SessionSummary,
    ];

    it("returns an empty string for no sessions", () => {
        expect(buildBatchCopyText([], "ids")).toBe("");
    });

    it("returns an empty string when every field is blank", () => {
        const blank = [{ key: "k", id: "  ", source: "codex", filePath: "", projectPath: "" } as SessionSummary];
        expect(buildBatchCopyText(blank, "ids")).toBe("");
        expect(buildBatchCopyText(blank, "filePaths")).toBe("");
    });

    it("copies one id per line", () => {
        expect(buildBatchCopyText(sessions, "ids")).toBe("s1\ns2\ns3");
    });

    it("copies file paths verbatim, including Windows separators", () => {
        const windowsPath = String.raw`E:\code\snorkeling\a.jsonl`;
        const windows = [{ key: "k", id: "s", source: "codex", filePath: windowsPath } as SessionSummary];
        expect(buildBatchCopyText(windows, "filePaths")).toBe("E:\\code\\snorkeling\\a.jsonl");
    });

    it("de-duplicates project paths case-insensitively", () => {
        expect(buildBatchCopyText(sessions, "projectPaths")).toBe("/Users/nita/work\n/tmp/scratch");
    });

    it("follows the caller's order, not the list order", () => {
        expect(buildBatchCopyText([sessions[2], sessions[0]], "ids")).toBe("s3\ns1");
    });

    it("skips sessions with a blank field but keeps the rest", () => {
        const mixed = [
            { key: "k1", id: "", source: "codex", filePath: "" } as SessionSummary,
            { key: "k2", id: "s2", source: "codex", filePath: "/b.jsonl" } as SessionSummary,
        ];
        expect(buildBatchCopyText(mixed, "ids")).toBe("s2");
    });

    it("builds resume commands through the shared helper", () => {
        const text = buildBatchCopyText([sessions[0]], "resumeCommands");
        expect(text.length).toBeGreaterThan(0);
        expect(text).toContain("s1");
    });
});

describe("countSubSessions", () => {
    it("counts rows whose parentKey points at a key in the set", () => {
        const sessions: SessionSummary[] = [
            { key: "p", id: "p", source: "pi" },
            { key: "c1", id: "c1", source: "pi", parentKey: "p" },
            { key: "c2", id: "c2", source: "pi", parentKey: "p" },
            { key: "orphan", id: "orphan", source: "pi", parentKey: "missing" },
            { key: "self", id: "self", source: "pi", parentKey: "self" },
        ] as SessionSummary[];
        expect([...countSubSessions(sessions).entries()]).toEqual([["p", 2]]);
    });

    it("ignores blank parentKey", () => {
        const sessions: SessionSummary[] = [{ key: "p", id: "p", source: "pi" }] as SessionSummary[];
        expect([...countSubSessions(sessions).entries()]).toEqual([]);
    });
});

describe("makeSessionComparator / sortSessions", () => {
    function s(key: string, over: Partial<SessionSummary> = {}): SessionSummary {
        return { key, id: key, source: "pi", updatedAt: 0, ...over } as SessionSummary;
    }

    it("sorts by message count descending", () => {
        const list = [s("a", { messageCount: 3 }), s("b", { messageCount: 100 }), s("c", { messageCount: 12 })];
        const sorted = sortSessions(list, [{ field: "messages", desc: true }]);
        expect(sorted.map((x) => x.key)).toEqual(["b", "c", "a"]);
    });

    it("sorts by message count ascending", () => {
        const list = [s("a", { messageCount: 3 }), s("b", { messageCount: 100 }), s("c", { messageCount: 12 })];
        const sorted = sortSessions(list, [{ field: "messages", desc: false }]);
        expect(sorted.map((x) => x.key)).toEqual(["a", "c", "b"]);
    });

    it("sorts by sub-session count descending using injected counts", () => {
        const list = [s("a"), s("b"), s("c")];
        const counts = new Map([
            ["a", 5],
            ["b", 0],
            ["c", 2],
        ]);
        const sorted = sortSessions(list, [{ field: "subagents", desc: true }], counts);
        expect(sorted.map((x) => x.key)).toEqual(["a", "c", "b"]);
    });

    it("falls through to the next chain key on ties", () => {
        const list = [
            s("a", { messageCount: 10, updatedAt: 1 }),
            s("b", { messageCount: 10, updatedAt: 2 }),
            s("c", { messageCount: 5, updatedAt: 9 }),
        ];
        const sorted = sortSessions(list, [
            { field: "messages", desc: true },
            { field: "time", desc: true },
        ]);
        expect(sorted.map((x) => x.key)).toEqual(["b", "a", "c"]);
    });

    it("uses implicit updatedAt desc + key asc when all chain keys tie", () => {
        const list = [
            s("a", { messageCount: 0, updatedAt: 30, parentKey: "" }),
            s("b", { messageCount: 0, updatedAt: 10, parentKey: "" }),
            s("c", { messageCount: 0, updatedAt: 20, parentKey: "" }),
        ];
        const sorted = sortSessions(list, [{ field: "subagents", desc: true }]);
        // 全 0 子会话 → 隐式 updatedAt 降序（不是原插入顺序）。
        expect(sorted.map((x) => x.key)).toEqual(["a", "c", "b"]);
    });

    it("is stable on fully identical rows (key asc)", () => {
        const list = [s("b", { updatedAt: 0 }), s("a", { updatedAt: 0 }), s("c", { updatedAt: 0 })];
        const sorted = sortSessions(list, [{ field: "messages", desc: true }]);
        expect(sorted.map((x) => x.key)).toEqual(["a", "b", "c"]);
    });
});

describe("sanitizeSortChain", () => {
    it("drops illegal fields", () => {
        const chain = sanitizeSortChain([{ field: "bogus", desc: true }, { field: "messages", desc: true }]);
        expect(chain).toEqual([{ field: "messages", desc: true }]);
    });

    it("dedupes by field keeping first", () => {
        const chain = sanitizeSortChain([
            { field: "messages", desc: true },
            { field: "messages", desc: false },
        ]);
        expect(chain).toEqual([{ field: "messages", desc: true }]);
    });

    it("truncates to MaxSortChainLength", () => {
        const chain = sanitizeSortChain([
            { field: "messages", desc: true },
            { field: "subagents", desc: true },
            { field: "time", desc: true },
            { field: "messages", desc: false },
        ]);
        expect(chain).toHaveLength(MaxSortChainLength);
        expect(chain[0].field).toBe("messages");
    });

    it("falls back to default on empty after filtering", () => {
        expect(sanitizeSortChain([])).toEqual(DefaultSortChain);
        expect(sanitizeSortChain([{ field: "bogus" }])).toEqual(DefaultSortChain);
    });
});

describe("groupSessionsByProject with sort chain", () => {
    function s(key: string, project: string, over: Partial<SessionSummary> = {}): SessionSummary {
        return { key, id: key, source: "pi", projectPath: project, updatedAt: 0, ...over } as SessionSummary;
    }

    it("orders groups by most recent activity, not sessions[0]", () => {
        // 组内先按消息数排（会把新会话排后面），但分组顺序仍看最近活跃时间。
        const list = [
            s("a-old", "/p/alpha", { messageCount: 99, updatedAt: 1000 }),
            s("a-new", "/p/alpha", { messageCount: 1, updatedAt: 5000 }),
            s("b-only", "/p/beta", { messageCount: 50, updatedAt: 3000 }),
        ];
        const groups = groupSessionsByProject(list, true, makeSessionComparator([{ field: "messages", desc: true }], new Map()));
        expect(groups.map((g) => g.name)).toEqual(["alpha", "beta"]);
    });

    it("sorts within a group by the supplied comparator", () => {
        const list = [
            s("small", "/p/x", { messageCount: 2, updatedAt: 1000 }),
            s("big", "/p/x", { messageCount: 200, updatedAt: 500 }),
        ];
        const groups = groupSessionsByProject(list, true, makeSessionComparator([{ field: "messages", desc: true }], new Map()));
        expect(groups[0].tree.map((n) => n.session.key)).toEqual(["big", "small"]);
    });
});
