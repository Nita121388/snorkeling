// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 共享 pinned 判定 + 时序排序. 横向 tabbar.tsx 与竖向 vtabbar.tsx 必须共用同一份,
// 否则两栏 hover 排序会漂移.
//
// pinned 判定:
//   - activeTabId 永远 pinned.
//   - openedThisLaunchTabIds (本启动点过的) 算 pinned.
//   - tabRecencyStore 7 天窗口内点过的也算 pinned (跨重启续命).
//
// pinned 子集排序: active 永远第一, 其余按 lastOpenedAt 降序 (最近点的最前).
// hoverRevealed 子集: 保持 orderedTabIds 原序.

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

export function orderPinnedByRecency(
    pinnedTabIds: string[],
    activeTabId: string | null
): string[] {
    const map = tabRecencyStore.getRecencyMap();
    return [...pinnedTabIds].sort((a, b) => {
        if (a === activeTabId) return -1;
        if (b === activeTabId) return 1;
        return (map[b] ?? -Infinity) - (map[a] ?? -Infinity);
    });
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
    return {
        pinnedTabIds: orderPinnedByRecency(pinnedTabIds, activeTabId),
        hoverRevealedTabIds,
    };
}
