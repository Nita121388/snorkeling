// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { FlexDirection, type LayoutNode } from "@/layout/lib/types";
import {
    collectOpenSessionBlocks,
    collectRenderedBlockIds,
    EmptyOpenSessions,
    normalizeOpenConnection,
    openLevelSatisfies,
    openSessionKey,
    openSessionsEqual,
    openSessionMatches,
    projectOpenSessions,
    type OpenSessionsContext,
    type OpenSessionBlockSource,
} from "./open-sessions";

function blockSource(blockId: string, tabId: string, meta: Record<string, unknown>): OpenSessionBlockSource {
    return { blockId, tabId, meta };
}

function leafNode(blockId: string, activeBlockId = blockId): LayoutNode {
    return { id: `n_${blockId}`, data: { blockId: activeBlockId } as never, flexDirection: FlexDirection.Row, size: 1 };
}

const baseCtx: OpenSessionsContext = {
    activeTabId: "tab_main",
    // b_open 不在渲染集合里 → 级别 open；其余都在
    renderedBlockIds: new Set(["b_visible", "b_active", "b_focused"]),
    focusedBlockId: "b_focused",
};

describe("normalizeOpenConnection", () => {
    it("collapses local variants to empty", () => {
        expect(normalizeOpenConnection("")).toBe("");
        expect(normalizeOpenConnection("local")).toBe("");
        expect(normalizeOpenConnection("local:staging")).toBe("");
    });
    it("keeps remote names", () => {
        expect(normalizeOpenConnection("box1")).toBe("box1");
    });
});

describe("openSessionKey", () => {
    it("joins with a NUL separator", () => {
        expect(openSessionKey("box1", "abc")).toBe("box1\u0000abc");
    });
});

describe("collectOpenSessionBlocks", () => {
    it("reads aisessions:sessionid and skips newchat placeholders", () => {
        const sources: OpenSessionBlockSource[] = [
            blockSource("b1", "t1", { view: "aisessions", "aisessions:sessionid": " s1 " }),
            blockSource("b2", "t1", { view: "aisessions", "aisessions:newchat": true }),
            blockSource("b3", "t1", { view: "aisessions" }),
        ];
        const blocks = collectOpenSessionBlocks(sources);
        expect(blocks).toHaveLength(1);
        expect(blocks[0]).toMatchObject({ blockId: "b1", sessionId: "s1", source: "chat", connection: "" });
    });

    it("reads agent sessions via resolveAgentSessionIdFromMeta", () => {
        const sources: OpenSessionBlockSource[] = [
            blockSource("b1", "t1", { view: "term", "agent:sessionid": "agent-session-1", connection: " box " }),
        ];
        const blocks = collectOpenSessionBlocks(sources);
        expect(blocks).toHaveLength(1);
        expect(blocks[0]).toMatchObject({ sessionId: "agent-session-1", source: "agent", connection: "box" });
    });

    it("ignores blocks with no session", () => {
        expect(collectOpenSessionBlocks([blockSource("b1", "t1", { view: "term" })])).toHaveLength(0);
    });
});

describe("projectOpenSessions", () => {
    it("maps each block to its level", () => {
        const blocks = [
            { blockId: "b_open", tabId: "t_other", sessionId: "s", source: "chat" as const, connection: "", cwd: "" },
            { blockId: "b_visible", tabId: "t_other2", sessionId: "s2", source: "chat" as const, connection: "", cwd: "" },
            { blockId: "b_active", tabId: "tab_main", sessionId: "s3", source: "chat" as const, connection: "", cwd: "" },
            { blockId: "b_focused", tabId: "tab_main", sessionId: "s4", source: "chat" as const, connection: "", cwd: "" },
        ];
        const snap = projectOpenSessions(blocks, baseCtx, 1000);
        expect(snap.byKey.get(openSessionKey("", "s"))?.level).toBe("open");
        expect(snap.byKey.get(openSessionKey("", "s2"))?.level).toBe("visible");
        expect(snap.byKey.get(openSessionKey("", "s3"))?.level).toBe("active");
        expect(snap.byKey.get(openSessionKey("", "s4"))?.level).toBe("focused");
        expect(snap.at).toBe(1000);
    });

    it("merges duplicate blocks for one session, promoting the highest level", () => {
        const blocks = [
            { blockId: "b_low", tabId: "t_other", sessionId: "dup", source: "chat" as const, connection: "", cwd: "" },
            { blockId: "b_high", tabId: "tab_main", sessionId: "dup", source: "chat" as const, connection: "", cwd: "" },
        ];
        const snap = projectOpenSessions(
            blocks,
            { activeTabId: "tab_main", renderedBlockIds: new Set(["b_low", "b_high"]), focusedBlockId: null },
            1
        );
        const entry = snap.byKey.get(openSessionKey("", "dup"));
        expect(entry?.blockId).toBe("b_high");
        expect(entry?.level).toBe("active");
        expect(entry?.duplicateBlockIds).toEqual(["b_low"]);
        expect(snap.byBlockId.get("b_low")).toBe(entry);
        expect(snap.byBlockId.get("b_high")).toBe(entry);
    });

    it("keeps local and remote same-id sessions separate", () => {
        const blocks = [
            { blockId: "b1", tabId: "t1", sessionId: "same", source: "chat" as const, connection: "", cwd: "" },
            { blockId: "b2", tabId: "t1", sessionId: "same", source: "chat" as const, connection: "box", cwd: "" },
        ];
        const snap = projectOpenSessions(blocks, { ...baseCtx, activeTabId: "t1", renderedBlockIds: new Set(["b1", "b2"]) }, 1);
        // 两个 key：本地空连接 + 远程 box
        expect(snap.byKey.size).toBe(2);
        expect(snap.bySessionId.size).toBe(1);
        expect(snap.bySessionId.get("same")?.connection).toBe("");
    });

    it("returns an empty snapshot structure for no blocks", () => {
        const snap = projectOpenSessions([], baseCtx, 1);
        expect(snap.byKey.size).toBe(0);
        expect(openSessionsEqual(snap, EmptyOpenSessions)).toBe(true);
    });
});

describe("collectRenderedBlockIds", () => {
    it("only counts active leaf block and excludes hidden / minimized / non-leaf", () => {
        const root: LayoutNode = {
            id: "root",
            flexDirection: FlexDirection.Row,
            size: 1,
            children: [
                leafNode("b_a"),
                // InlineTab 组：只激活 b_b 渲染，b_c 不渲染
                { id: "group", flexDirection: FlexDirection.Row, size: 1, data: { blockIds: ["b_b", "b_c"], activeBlockId: "b_b" } as never },
            ],
        };
        const ids = collectRenderedBlockIds(root, new Set(["b_a"]), new Set(["b_b"]));
        expect(ids.has("b_a")).toBe(false); // hidden
        expect(ids.has("b_b")).toBe(false); // minimized
        expect(ids.has("b_c")).toBe(false); // not active inline tab
        expect(ids.size).toBe(0);
    });

    it("includes a plain visible leaf", () => {
        const root = leafNode("b_x");
        const ids = collectRenderedBlockIds(root, new Set(), new Set());
        expect(ids.has("b_x")).toBe(true);
    });
});

describe("open level / filter helpers", () => {
    it("openLevelSatisfies respects rank with any always true", () => {
        expect(openLevelSatisfies("open", "any")).toBe(true);
        expect(openLevelSatisfies("open", "visible")).toBe(false);
        expect(openLevelSatisfies("visible", "open")).toBe(true);
        expect(openLevelSatisfies("focused", "active")).toBe(true);
    });

    it("openSessionMatches filters by session id", () => {
        const snap = projectOpenSessions(
            [{ blockId: "b1", tabId: "tab_main", sessionId: "hit", source: "chat" as const, connection: "", cwd: "" }],
            { ...baseCtx, activeTabId: "tab_main", renderedBlockIds: new Set(["b1"]) },
            1
        );
        expect(openSessionMatches(snap, "hit", "any")).toBe(true);
        expect(openSessionMatches(snap, "hit", "active")).toBe(true);
        expect(openSessionMatches(snap, "miss", "open")).toBe(false);
    });
});

describe("openSessionsEqual", () => {
    const mk = (level: "open" | "visible" | "active" | "focused", blockId = "b1") => {
        const rendered = level !== "open";
        const tabId = level === "open" || level === "visible" ? "t_other" : "tab_main";
        const focused = level === "focused" ? blockId : null;
        return projectOpenSessions(
            [{ blockId, tabId, sessionId: "s", source: "chat" as const, connection: "", cwd: "" }],
            { activeTabId: "tab_main", renderedBlockIds: new Set(rendered ? [blockId] : []), focusedBlockId: focused },
            1
        );
    };

    it("treats same level as equal", () => {
        expect(openSessionsEqual(mk("active", "b1"), mk("active", "b1"))).toBe(true);
    });
    it("treats different level as not equal", () => {
        expect(openSessionsEqual(mk("active", "b1"), mk("open", "b1"))).toBe(false);
    });
    it("null handling", () => {
        expect(openSessionsEqual(null, null)).toBe(true);
        expect(openSessionsEqual(null, mk("active", "b1"))).toBe(false);
    });
});
