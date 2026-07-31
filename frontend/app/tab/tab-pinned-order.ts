// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 共享 pinned 判定 + 物理顺序分段. 横向 tabbar.tsx 与竖向 vtabbar.tsx 必须共用同一份,
// 否则两栏 hover 排序会漂移.
//
// 排序规则 (A 方案, 物理顺序优先):
//   - 段内顺序 = workspace.tabids 的物理顺序. 不做 active 提顶, 不按 lastOpenedAt 排,
//     不引入排序键.
//   - 用户在 hover 段点一个 tab → 该 tab 从 hover 段"升入" pinned 段, 相对顺序按物理
//     位置决定, 不会跳位. 已经 pinned 的 tab 永远不动.
//   - 拖动 tab → workspace.tabids 落盘, 段内顺序自动跟着新物理顺序走.
//
// pinned 判定 (三路叠加, 任一为真即 pinned):
//   1. activeTabId (当前激活的)
//   2. openedThisLaunchTabIds (本启动内点过的)
//   3. tabRecencyStore 7 天窗口内点过的 (跨重启续命)

import { tabRecencyStore, TabRecencyAgeWindowMs } from "./tab-recency-store";

export function isPinnedTab(
    tabId: string,
    activeTabId: string | null,
    openedThisLaunchTabIds: Set<string>
): boolean {
    if (tabId === activeTabId) return true;
    if (openedThisLaunchTabIds.has(tabId)) return true;
    const lastOpenedAt = tabRecencyStore.getRecencyMap()[tabId];
    if (lastOpenedAt == null) return false;
    return Date.now() - lastOpenedAt < TabRecencyAgeWindowMs;
}

export function partitionAndOrderTabs(
    orderedTabIds: string[],
    activeTabId: string | null,
    openedThisLaunchTabIds: Set<string>
): { pinnedTabIds: string[]; hoverRevealedTabIds: string[] } {
    const pinnedTabIds: string[] = [];
    const hoverRevealedTabIds: string[] = [];
    for (const tabId of orderedTabIds) {
        if (isPinnedTab(tabId, activeTabId, openedThisLaunchTabIds)) {
            pinnedTabIds.push(tabId);
        } else {
            hoverRevealedTabIds.push(tabId);
        }
    }
    return { pinnedTabIds, hoverRevealedTabIds };
}
