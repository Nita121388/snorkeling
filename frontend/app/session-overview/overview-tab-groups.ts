// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Overview 列表视图 Tab 分组的纯逻辑（tab-first 契约）。
//
// 为什么单独成模块：三个历史缺陷（2026-11-22）全在"组被删掉"这一层 ——
// 空组被 `blocks.length > 0` 过滤、块未加载时组为空同样被删、`agentsOnly`
// 先过滤组内行再删空组。这里把判定规则锁成纯函数（不依赖 React/jotai），
// 用 vitest 锁"什么条件下不允许减少组头"，渲染层只消费 `OverviewTabGroup[]`。
//
// 判定顺序（每 Tab，先到先得）：
//   1. tab 未解析 → `loading`（骨架，对两个过滤器都免疫）
//   2. 可展示块数 === 0（blockids 空或仅含 Overview 块）→ `empty`
//   3. 本次启动未打开 且 非当前 Tab → `unopened`
//   4. 其余 → `live`
// 过滤器的删组权力：只有 `hideUnopenedTabs` 可以删组（且只删 `unopened` 组）；
// `agentsOnly` 永远不删组，只过滤组内行。

import { i18n } from "@/i18n/config";
import type { OverviewBlock } from "./session-overview-model";

export type OverviewTabGroupStatus = "live" | "empty" | "unopened" | "loading";

export interface OverviewTabGroup {
    tabId: string;
    tabName: string;
    status: OverviewTabGroupStatus;
    /** 仅 `live` / `unopened` 填（已按 agentsOnly 过滤）；`loading` / `empty` 恒为空。 */
    blocks: OverviewBlock[];
    /** `tab.blockids` 去掉 Overview 块后的数量（徽章/汇总行用）。 */
    blockCount: number;
    /** 组内 agent-like 块数（agentsOnly 过滤后）。 */
    agentCount: number;
    /** 本次启动未激活过 且 非当前 Tab。 */
    unopened: boolean;
}

export type BuildTabGroupsArgs = {
    tabIds: string[];
    /** `null` = tab 对象还没解析（prime/单件拉取在路上）→ `loading`。 */
    tabById: Map<string, Tab | null>;
    /** `useOverviewBlocks` 的输出（不含 sessionoverview 块）。 */
    blocks: OverviewBlock[];
    /** meta view === "sessionoverview" 的块 id（这些块不算"可展示块"）。 */
    overviewBlockIds?: ReadonlySet<string>;
    openedThisLaunch: ReadonlySet<string>;
    activeTabId: string | null;
    hideUnopenedTabs: boolean;
    agentsOnly: boolean;
};

function countDisplayableBlockIds(tab: Tab, overviewBlockIds: ReadonlySet<string>): number {
    let count = 0;
    for (const blockId of tab.blockids ?? []) {
        if (overviewBlockIds.has(blockId)) continue;
        count++;
    }
    return count;
}

/**
 * 构建 Tab 分组。组头常驻：只要 Tab 在 `tabIds` 里就会产出一个组
 * （唯一例外：`hideUnopenedTabs` 删 `unopened` 组 —— 这是它唯一的删组权力）。
 */
export function buildTabGroups(args: BuildTabGroupsArgs): OverviewTabGroup[] {
    const overviewBlockIds = args.overviewBlockIds ?? new Set<string>();
    const groups: OverviewTabGroup[] = [];
    for (const tabId of args.tabIds) {
        const tab = args.tabById.get(tabId) ?? null;
        if (tab == null) {
            // 历史缺陷 2：块/tab 未解析时不能让组消失，也不能参与过滤判定。
            groups.push({
                tabId,
                tabName: i18n.t("session-overview:dialog.untitled"),
                status: "loading",
                blocks: [],
                blockCount: 0,
                agentCount: 0,
                unopened: false,
            });
            continue;
        }
        const tabName = tab.name ?? i18n.t("session-overview:dialog.untitled");
        const blockCount = countDisplayableBlockIds(tab, overviewBlockIds);
        if (blockCount === 0) {
            // 历史缺陷 1：只有 Overview 块的 Tab 不能自我消失。
            groups.push({
                tabId,
                tabName,
                status: "empty",
                blocks: [],
                blockCount: 0,
                agentCount: 0,
                unopened: false,
            });
            continue;
        }
        const unopened = !args.openedThisLaunch.has(tabId) && tabId !== args.activeTabId;
        // agentsOnly 只过滤组内行，不删组（历史缺陷 3）。
        const groupBlocks = args.blocks.filter((block) => block.tabId === tabId);
        const visibleBlocks = args.agentsOnly ? groupBlocks.filter((block) => block.isAgentLike) : groupBlocks;
        groups.push({
            tabId,
            tabName,
            status: unopened ? "unopened" : "live",
            blocks: visibleBlocks,
            blockCount,
            agentCount: visibleBlocks.filter((block) => block.isAgentLike).length,
            unopened,
        });
    }
    if (args.hideUnopenedTabs) {
        return groups.filter((group) => group.status !== "unopened");
    }
    return groups;
}
