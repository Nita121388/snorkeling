// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// workspace 的「预挂载 Tab」合并逻辑（纯函数，便于单测）。
//
// 背景：workspace 只挂载「激活 Tab + 最近 3 个预挂载 Tab」（visibility:hidden 但保持真实尺寸），
// 切 Tab 不闪黑。CommonText 后台发送时目标 Tab 不在这个列表里 → 块不挂载 → pending input
// 注入（term.tsx 的 effect）不会发生。所以 pending Tab 必须并入挂载列表，
// 且 **不参与 PreloadTabCap 切片**（否则连续几次发送/悬停就会把待注入的 Tab 挤出列表，
// 注入与 TTL 回退都不会再发生——评审 P1-1）。

export const PreloadTabCap = 3;

// Each Tab runs in its own Electron WebContentsView where staticTabId never changes;
// hover-preloading other tabs inside the current renderer mounts hidden TabContent trees
// (xterm/WebGL/Monaco/15s polling) that can never become visible here. Keep disabled by default;
// flip to true only if single-renderer tab switching is ever reintroduced.
export const HOVER_TAB_PRELOAD_ENABLED = false;

export function updateActivePreloadTabIds(
    prev: readonly string[],
    activeTabId: string,
    enabled: boolean = HOVER_TAB_PRELOAD_ENABLED
): string[] {
    if (!activeTabId) {
        return [];
    }
    if (!enabled) {
        return prev.length === 1 && prev[0] === activeTabId ? (prev as string[]) : [activeTabId];
    }
    const next = prev.filter((id) => id !== activeTabId);
    next.unshift(activeTabId);
    return next.slice(0, PreloadTabCap);
}

export function updateHoverPreloadTabIds(
    prev: readonly string[],
    hoveredTabId: string | null,
    enabled: boolean = HOVER_TAB_PRELOAD_ENABLED
): string[] {
    if (!enabled || !hoveredTabId) {
        return prev as string[];
    }
    const next = prev.filter((id) => id !== hoveredTabId);
    next.unshift(hoveredTabId);
    return next.slice(0, PreloadTabCap);
}

/**
 * 计算本 renderer 实际渲染的 Tab 列表。
 * - activeTabId 恒在首位（它本来就该是可见的）；
 * - preloadTabIds 按 cap 截断（保留既有预挂载语义）；
 * - pendingMountTabIds 追加在尾部、**不截断**、去重。
 */
export function computeRenderPreloadTabIds(
    activeTabId: string,
    preloadTabIds: readonly string[],
    pendingMountTabIds: readonly string[],
    cap: number = PreloadTabCap
): string[] {
    const base: string[] = [];
    if (activeTabId != null && activeTabId !== "") {
        base.push(activeTabId);
    }
    for (const tabId of preloadTabIds) {
        if (tabId == null || tabId === "") continue;
        if (base.includes(tabId)) continue;
        base.push(tabId);
    }
    const capped = base.slice(0, Math.max(0, cap));
    for (const tabId of pendingMountTabIds) {
        if (tabId == null || tabId === "") continue;
        if (capped.includes(tabId)) continue;
        capped.push(tabId);
    }
    if (activeTabId === "" || activeTabId == null) {
        // 没有激活 Tab 时 workspace 本来就不渲染任何内容（保持旧行为）。
        return [];
    }
    return capped;
}
