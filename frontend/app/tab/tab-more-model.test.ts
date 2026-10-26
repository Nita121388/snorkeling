// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    buildTabMoreRows,
    collectTabAgentBlocks,
    collectCollapseTargets,
    countHiddenRows,
    filterTabMoreRows,
    isTabHiddenFromBar,
    shouldShowTabMoreSearch,
    TabMoreMeta,
    TabMoreVisibilityContext,
} from "./tab-more-model";

function makeCtx(overrides?: Partial<TabMoreVisibilityContext>): TabMoreVisibilityContext {
    return {
        activeTabId: "t1",
        openedThisLaunch: new Set(["t1", "t2"]),
        unreadTabIds: new Set<string>(),
        collapsedTabIds: new Set<string>(),
        ...overrides,
    };
}

const Meta: Record<string, TabMoreMeta> = {
    t1: { name: "AISessions" },
    t2: { name: "Terminal" },
    t3: { name: "Files" },
    t4: { name: "Preview" },
};

const TabIds = ["t1", "t2", "t3", "t4"];

describe("isTabHiddenFromBar", () => {
    it("never hides the active tab", () => {
        expect(isTabHiddenFromBar("t1", makeCtx())).toBe(false);
    });

    it("shows tabs opened this launch", () => {
        expect(isTabHiddenFromBar("t2", makeCtx())).toBe(false);
    });

    it("hides tabs not opened this launch", () => {
        expect(isTabHiddenFromBar("t3", makeCtx())).toBe(true);
    });

    it("lets unread dots resurface a tab", () => {
        const ctx = makeCtx({ unreadTabIds: new Set(["t3"]) });
        expect(isTabHiddenFromBar("t3", ctx)).toBe(false);
    });

    it("manual collapse overrides opened-this-launch", () => {
        const ctx = makeCtx({ collapsedTabIds: new Set(["t2"]) });
        expect(isTabHiddenFromBar("t2", ctx)).toBe(true);
    });

    it("manual collapse still yields to unread dots", () => {
        const ctx = makeCtx({ collapsedTabIds: new Set(["t2"]), unreadTabIds: new Set(["t2"]) });
        expect(isTabHiddenFromBar("t2", ctx)).toBe(false);
    });
});

describe("buildTabMoreRows", () => {
    it("keeps physical tabIds order", () => {
        const rows = buildTabMoreRows(TabIds, Meta, makeCtx());
        expect(rows.map((row) => row.tabId)).toEqual(TabIds);
    });

    it("skips tabs without meta", () => {
        const rows = buildTabMoreRows([...TabIds, "ghost"], Meta, makeCtx());
        expect(rows.map((row) => row.tabId)).toEqual(TabIds);
    });

    it("marks active / hidden / unopened flags", () => {
        const rows = buildTabMoreRows(TabIds, Meta, makeCtx());
        expect(rows[0]).toMatchObject({ isActive: true, isHidden: false, unopenedThisLaunch: false });
        expect(rows[1]).toMatchObject({ isActive: false, isHidden: false, unopenedThisLaunch: false });
        expect(rows[2]).toMatchObject({ isActive: false, isHidden: true, unopenedThisLaunch: true });
    });

    it("marks manual collapse", () => {
        const rows = buildTabMoreRows(TabIds, Meta, makeCtx({ collapsedTabIds: new Set(["t2"]) }));
        expect(rows[1].isManuallyCollapsed).toBe(true);
        expect(rows[1].isHidden).toBe(true);
    });
});

describe("countHiddenRows", () => {
    it("counts hidden rows only", () => {
        const rows = buildTabMoreRows(TabIds, Meta, makeCtx());
        expect(countHiddenRows(rows)).toBe(2);
    });

    it("returns 0 when everything is visible", () => {
        const rows = buildTabMoreRows(TabIds, Meta, makeCtx({ openedThisLaunch: new Set(TabIds) }));
        expect(countHiddenRows(rows)).toBe(0);
    });
});

describe("filterTabMoreRows", () => {
    const rows = buildTabMoreRows(TabIds, Meta, makeCtx());

    it("returns everything for an empty query", () => {
        expect(filterTabMoreRows(rows, "   ")).toHaveLength(rows.length);
    });

    it("matches case-insensitively", () => {
        expect(filterTabMoreRows(rows, "term").map((row) => row.tabId)).toEqual(["t2"]);
        expect(filterTabMoreRows(rows, "TERM").map((row) => row.tabId)).toEqual(["t2"]);
    });

    it("returns empty array when nothing matches", () => {
        expect(filterTabMoreRows(rows, "zzz")).toEqual([]);
    });
});

describe("shouldShowTabMoreSearch", () => {
    it("is off at the threshold", () => {
        expect(shouldShowTabMoreSearch(12)).toBe(false);
    });

    it("is on above the threshold", () => {
        expect(shouldShowTabMoreSearch(13)).toBe(true);
    });
});

describe("collectCollapseTargets", () => {
    it("collects visible non-active tabs only", () => {
        const rows = buildTabMoreRows(TabIds, Meta, makeCtx());
        expect(collectCollapseTargets(rows)).toEqual(["t2"]);
    });
});

describe("collectTabAgentBlocks", () => {
    const agentMeta = { "agent:sessionid": "s1", "agent:provider": "codex" } as Record<string, unknown>;
    const noteMeta = { "snorkeling:kind": "note", file: "a.md" } as Record<string, unknown>;
    const previewMeta = { view: "preview", file: "a.md" } as Record<string, unknown>;

    function block(blockId: string, meta: Record<string, unknown>): Block {
        return {
            otype: "block",
            oid: blockId,
            version: 1,
            meta,
            subblockids: [],
        } as unknown as Block;
    }

    const isAgent = (b: Block) => b.meta?.["agent:sessionid"] != null;
    const getBlock = (map: Record<string, Block>) => (blockId: string) => map[blockId] ?? null;
    const getUpdatedAt = (map: Record<string, number>) => (blockId: string) => map[blockId] ?? 0;

    it("returns empty for empty blockIds", () => {
        expect(collectTabAgentBlocks([], getBlock({}), getUpdatedAt({}), isAgent)).toEqual([]);
        expect(collectTabAgentBlocks(null, getBlock({}), getUpdatedAt({}), isAgent)).toEqual([]);
    });

    it("filters out non-agent blocks", () => {
        const blocks = {
            "block:note": block("block:note", noteMeta),
            "block:preview": block("block:preview", previewMeta),
        };
        expect(collectTabAgentBlocks(["block:note", "block:preview"], getBlock(blocks), getUpdatedAt({}), isAgent)).toEqual([]);
    });

    it("keeps only agent blocks and dedupes", () => {
        const blocks = {
            "block:a": block("block:a", agentMeta),
        };
        const refs = collectTabAgentBlocks(
            ["block:a", "block:a", "block:missing"],
            getBlock(blocks),
            getUpdatedAt({}),
            isAgent
        );
        expect(refs).toHaveLength(1);
        expect(refs[0].blockId).toBe("block:a");
    });

    it("sorts by updatedAt descending, stable on ties", () => {
        const blocks = {
            "block:old": block("block:old", agentMeta),
            "block:new": block("block:new", agentMeta),
            "block:mid": block("block:mid", agentMeta),
        };
        const times = { "block:old": 100, "block:new": 300, "block:mid": 200 };
        const refs = collectTabAgentBlocks(
            ["block:old", "block:new", "block:mid"],
            getBlock(blocks),
            getUpdatedAt(times),
            isAgent
        );
        expect(refs.map((r) => r.blockId)).toEqual(["block:new", "block:mid", "block:old"]);
    });

    it("falls back to 0 for missing updatedAt", () => {
        const blocks = { "block:a": block("block:a", agentMeta) };
        const refs = collectTabAgentBlocks(["block:a"], getBlock(blocks), getUpdatedAt({}), isAgent);
        expect(refs[0].updatedAt).toBe(0);
    });
});
