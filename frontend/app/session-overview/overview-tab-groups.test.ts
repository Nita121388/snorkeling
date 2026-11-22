// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// `buildTabGroups` 的锁：Tab 组常驻规则。
//
// 为什么值得单独锁：Overview 列表是"扫一眼"的界面，组头少几个用户会以为那些 Tab
// 不存在（真机症状 2026-11-22：没打开过的 Tab 完全不显示）。三个历史缺陷都在
// "组被删掉"这一层：
//   1. 空组被 `blocks.length > 0` 过滤 → 只有 Overview 块的 Tab 自我消失；
//   2. 块未加载时组为空 → 同样被删（而且没有骨架，用户看不出是在加载）；
//   3. `agentsOnly` 先过滤组内行再删空组 → 没有 agent 的 Tab 整组消失。
// 所以断言的核心不是"能显示"，而是"什么条件下不允许减少组头"。

import { describe, expect, it } from "vitest";
import type { OverviewBlock } from "./session-overview-model";
import { buildTabGroups } from "./overview-tab-groups";

const OverviewBlockMeta = { "snorkeling:block-kind": "overview" };

function makeBlock(over: Partial<OverviewBlock> & { blockId: string; tabId: string }): OverviewBlock {
    return {
        tabName: "tab",
        block: { oid: over.blockId, otype: "block", version: 1, meta: {} } as any,
        view: "term",
        title: over.blockId,
        isAgentLike: false,
        agentProvider: null,
        sessionId: "",
        ...over,
    } as OverviewBlock;
}

function makeTab(blockids: string[]) {
    return { oid: "t", otype: "tab", version: 1, blockids, meta: {} } as any;
}

describe("buildTabGroups", () => {
    it("有内容的 Tab → live，blocks 与 agentCount 正确", () => {
        const groups = buildTabGroups({
            tabIds: ["t1"],
            tabById: new Map([["t1", makeTab(["b1", "b2"])]]),
            blocks: [
                makeBlock({ blockId: "b1", tabId: "t1", isAgentLike: true }),
                makeBlock({ blockId: "b2", tabId: "t1" }),
            ],
            openedThisLaunch: new Set(["t1"]),
            activeTabId: "t1",
            hideUnopenedTabs: false,
            agentsOnly: false,
        });
        expect(groups).toHaveLength(1);
        expect(groups[0].status).toBe("live");
        expect(groups[0].blockCount).toBe(2);
        expect(groups[0].agentCount).toBe(1);
    });

    it("只有 Overview 块的 Tab → empty 且组存在（历史缺陷 1）", () => {
        const groups = buildTabGroups({
            tabIds: ["t1"],
            tabById: new Map([["t1", makeTab(["ov1"])]]),
            // useOverviewBlocks 会主动跳过 sessionoverview 块，所以这里是空数组
            blocks: [],
            overviewBlockIds: new Set(["ov1"]),
            openedThisLaunch: new Set(["t1"]),
            activeTabId: "other",
            hideUnopenedTabs: false,
            agentsOnly: false,
        });
        expect(groups).toHaveLength(1);
        expect(groups[0].status).toBe("empty");
        expect(groups[0].blockCount).toBe(0);
    });

    it("块 tag 未解析 → loading，且骨架组不被过滤（历史缺陷 2）", () => {
        const groups = buildTabGroups({
            tabIds: ["t1"],
            tabById: new Map([["t1", null]]),
            blocks: [],
            openedThisLaunch: new Set<string>(),
            activeTabId: null,
            hideUnopenedTabs: false,
            agentsOnly: false,
        });
        expect(groups).toHaveLength(1);
        expect(groups[0].status).toBe("loading");
    });

    it("本次启动未打开且非当前 Tab → unopened，但组仍在", () => {
        const groups = buildTabGroups({
            tabIds: ["t1"],
            tabById: new Map([["t1", makeTab(["b1"])]]),
            blocks: [makeBlock({ blockId: "b1", tabId: "t1" })],
            openedThisLaunch: new Set<string>(),
            activeTabId: "other",
            hideUnopenedTabs: false,
            agentsOnly: false,
        });
        expect(groups).toHaveLength(1);
        expect(groups[0].status).toBe("unopened");
        expect(groups[0].unopened).toBe(true);
    });

    it("agentsOnly 开关前后组数相等（历史缺陷 3）", () => {
        const args = {
            tabIds: ["t1", "t2", "t3"],
            tabById: new Map([
                ["t1", makeTab(["b1"])],
                ["t2", makeTab(["b2"])],
                ["t3", makeTab([])],
            ]),
            blocks: [makeBlock({ blockId: "b1", tabId: "t1", isAgentLike: true }), makeBlock({ blockId: "b2", tabId: "t2" })],
            openedThisLaunch: new Set(["t1", "t2", "t3"]),
            activeTabId: "t1",
            hideUnopenedTabs: false,
        };
        const off = buildTabGroups({ ...args, agentsOnly: false });
        const on = buildTabGroups({ ...args, agentsOnly: true });
        expect(on.length).toBe(off.length);
        expect(on.length).toBe(3);
        // 过滤只影响组内行
        expect(on.find((g) => g.tabId === "t2")?.blocks).toHaveLength(0);
        expect(on.find((g) => g.tabId === "t2")?.agentCount).toBe(0);
    });

    it("hideUnopenedTabs 只删 unopened 组，empty/loading 组照旧", () => {
        const groups = buildTabGroups({
            tabIds: ["t1", "t2", "t3"],
            tabById: new Map([
                ["t1", makeTab(["b1"])],
                ["t2", makeTab([])],
                ["t3", makeTab(["b3"])],
            ]),
            blocks: [makeBlock({ blockId: "b1", tabId: "t1" }), makeBlock({ blockId: "b3", tabId: "t3" })],
            openedThisLaunch: new Set(["t1"]),
            activeTabId: "t1",
            hideUnopenedTabs: true,
            agentsOnly: false,
        });
        expect(groups.map((g) => g.tabId)).toEqual(["t1", "t2"]);
    });

    it("当前 Tab 即使本次启动未激活过也不算 unopened", () => {
        const groups = buildTabGroups({
            tabIds: ["t1"],
            tabById: new Map([["t1", makeTab(["b1"])]]),
            blocks: [makeBlock({ blockId: "b1", tabId: "t1" })],
            openedThisLaunch: new Set<string>(),
            activeTabId: "t1",
            hideUnopenedTabs: false,
            agentsOnly: false,
        });
        expect(groups[0].status).toBe("live");
        expect(groups[0].unopened).toBe(false);
    });
});

// 保底：OverviewBlockMeta 常量被上面 fake 使用过，避免 lint 报未使用
void OverviewBlockMeta;
