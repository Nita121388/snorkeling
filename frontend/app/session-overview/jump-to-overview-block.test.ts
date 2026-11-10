// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// jumpToOverviewBlock 同 tab / 跨 tab 分支的回归（2026-11-10，任务 11-09-overview-card-jump 修复）。
//
// 根因：每个 tab 是独立渲染进程（staticTabId 每 renderer 固定），发起方的
// setBlockHighlight / refocusNode 对目标 tab 无效 → 只切 tab 不落块。
// 锁定行为：
//   1. 同 tab：高亮 + 两次 refocus（80/220ms）+ 1.2s 撤高亮，不发跨 tab 信号；
//   2. 跨 tab：先操作目标 tab 的 layout model（restore 最小化 / showBlock / focusNode），
//      再广播 storage 信号，最后 setActiveTab；
//   3. 跨 tab 且块已在目标 layout：不重复 restore；
//   4. tabId 为空：不切换、不报错。

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => {
    const staticTabIdAtom = { __atom: "staticTabId" };
    const fakeBlockModel = {
        setBlockHighlight: (highlight: unknown) => mockState.highlights.push(highlight),
    };
    return {
        staticTabIdAtom,
        staticTabId: "tab-current",
        highlights: [] as unknown[],
        refocused: [] as string[],
        activeTabs: [] as string[],
        broadcasts: [] as Array<{ tabId: string; blockId: string }>,
        restores: [] as Array<{ tabId: string; blockId: string }>,
        shownBlocks: [] as string[],
        focusedNodes: [] as string[],
        fakeBlockModel,
        // 目标 tab 的 layout model 形态：默认块已在 layout、未隐藏
        layoutByTab: new Map<
            string,
            { nodeId: string | null; hidden: boolean }
        >(),
    };
});

vi.mock("@/app/store/global", () => ({
    atoms: { staticTabId: mockState.staticTabIdAtom },
    globalStore: {
        get: (atom: unknown) => (atom === mockState.staticTabIdAtom ? mockState.staticTabId : undefined),
    },
    refocusNode: (blockId: string) => mockState.refocused.push(blockId),
    setActiveTab: (tabId: string) => mockState.activeTabs.push(tabId),
    WOS: {
        makeORef: (type: string, oid: string) => `${type}:${oid}`,
        getWaveObjectAtom: () => ({ __atom: "waveobj" }),
    },
}));

vi.mock("@/app/block/block-model", () => ({
    BlockModel: { getInstance: () => mockState.fakeBlockModel },
}));

vi.mock("@/app/block/block-jump-signal", () => ({
    broadcastBlockJumpSignal: (tabId: string, blockId: string) => mockState.broadcasts.push({ tabId, blockId }),
}));

vi.mock("@/app/block/block-minimize", () => ({
    restoreMinimizedBlockToLayout: (tabId: string, blockId: string) => {
        mockState.restores.push({ tabId, blockId });
        return true;
    },
}));

vi.mock("@/layout/index", () => ({
    getHiddenBlockIdsFromTab: () => [],
    getLayoutModelForStaticTab: () => ({
        getNodeByBlockId: () => null,
    }),
    getLayoutModelForTabById: (tabId: string) => {
        const entry = mockState.layoutByTab.get(tabId);
        if (entry == null) return null;
        return {
            getNodeByBlockId: () => (entry.nodeId == null ? null : { id: entry.nodeId }),
            isBlockHidden: () => entry.hidden,
            showBlock: (blockId: string) => {
                mockState.shownBlocks.push(blockId);
                return true;
            },
            focusNode: (nodeId: string) => mockState.focusedNodes.push(nodeId),
        };
    },
}));

vi.mock("@/app/store/pslog-trace", () => ({
    pslogEvent: () => {},
    makeAgentTraceId: () => "",
}));

vi.mock("@/app/agent-status/agent-status-done-ack-store", () => ({
    ackBumpAtom: { __atom: "ackBump" },
}));

vi.mock("@/app/agent-status/agent-status-unread", () => ({
    statusFingerprint: () => "",
}));

vi.mock("@/app/workspace/toggle-block", () => ({
    SnorkelingBlockKindMetaKey: "snorkeling:block-kind",
    SnorkelingBlockKindOverview: "overview",
    toggleCurrentTabBlockByKind: async () => {},
}));

import { jumpToOverviewBlock } from "./session-overview-model";

describe("jumpToOverviewBlock", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        mockState.staticTabId = "tab-current";
        mockState.highlights = [];
        mockState.refocused = [];
        mockState.activeTabs = [];
        mockState.broadcasts = [];
        mockState.restores = [];
        mockState.shownBlocks = [];
        mockState.focusedNodes = [];
        mockState.layoutByTab.clear();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("同 tab：高亮 + 两次 refocus + 1.2s 撤高亮，不发跨 tab 信号", () => {
        jumpToOverviewBlock("tab-current", "block-1");
        expect(mockState.highlights[0]).toEqual({ blockId: "block-1", icon: "location-crosshairs" });
        expect(mockState.broadcasts).toHaveLength(0);
        vi.advanceTimersByTime(300);
        expect(mockState.refocused).toEqual(["block-1", "block-1"]);
        vi.advanceTimersByTime(1000);
        expect(mockState.highlights[mockState.highlights.length - 1]).toBeNull();
    });

    it("跨 tab：目标 layout 聚焦 + 广播信号 + 切 tab（不在本 renderer 做高亮）", () => {
        mockState.layoutByTab.set("tab-other", { nodeId: "node-9", hidden: false });
        jumpToOverviewBlock("tab-other", "block-2");

        // 目标 layout model 上聚焦该节点（focusednodeid 落库）
        expect(mockState.focusedNodes).toEqual(["node-9"]);
        // 广播给目标 renderer 自己执行高亮 + refocus
        expect(mockState.broadcasts).toEqual([{ tabId: "tab-other", blockId: "block-2" }]);
        // 本 renderer 不做高亮（对目标 tab 无效，避免误导）
        expect(mockState.highlights).toHaveLength(0);
        // 最后切 view
        expect(mockState.activeTabs).toEqual(["tab-other"]);
    });

    it("跨 tab：隐藏的块先 showBlock 再聚焦", () => {
        mockState.layoutByTab.set("tab-other", { nodeId: "node-9", hidden: true });
        jumpToOverviewBlock("tab-other", "block-2");
        expect(mockState.shownBlocks).toEqual(["block-2"]);
        expect(mockState.focusedNodes).toEqual(["node-9"]);
    });

    it("跨 tab：块不在 layout（已最小化）→ 先 restore 再聚焦", () => {
        mockState.layoutByTab.set("tab-other", { nodeId: null, hidden: false });
        jumpToOverviewBlock("tab-other", "block-2");
        expect(mockState.restores).toEqual([{ tabId: "tab-other", blockId: "block-2" }]);
        // restore 后测试桩的 node 仍为 null → 不聚焦，但信号与切 tab 照常
        expect(mockState.focusedNodes).toHaveLength(0);
        expect(mockState.broadcasts).toHaveLength(1);
        expect(mockState.activeTabs).toEqual(["tab-other"]);
    });

    it("跨 tab 但拿不到目标 layout model → 仍切 tab", () => {
        jumpToOverviewBlock("tab-other", "block-2");
        expect(mockState.activeTabs).toEqual(["tab-other"]);
        expect(mockState.broadcasts).toHaveLength(0);
    });

    it("tabId 为空：不发信号、不切 tab、不报错", () => {
        expect(() => jumpToOverviewBlock("", "block-3")).not.toThrow();
        expect(mockState.activeTabs).toHaveLength(0);
        expect(mockState.broadcasts).toHaveLength(0);
    });
});
