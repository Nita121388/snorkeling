// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { TabAgentStatusDot } from "@/app/agent-status/agent-status-tab-aggregate";

/**
 * Tab 栏「更多」下拉的行模型 (纯函数, 无 React / 无 DOM).
 *
 * 判定口径必须与两栏主栏的隐藏逻辑完全一致, 否则会出现
 * "下拉说这个 Tab 隐藏了, 主栏却明明显示着" 的撕裂.
 * 主栏口径见:
 *   - frontend/app/tab/vtabbar.tsx  renderOrderedTabIds / isHidden
 *   - frontend/app/tab/tabbar.tsx   visibleTabIds / layoutTabIds
 */

/** Tab 数量超过该阈值时, 「更多」面板顶部显示搜索框. */
export const TabMoreSearchThreshold = 12;

/** 构建一行所需的 Tab 视觉元信息 (与 VTabWrapper 同源). */
export interface TabMoreMeta {
    name: string;
    badges?: Badge[] | null;
    agentDots?: TabAgentStatusDot[] | null;
    flagColor?: string | null;
    /** 该 Tab 的顶层 block + inline 子 block id (悬浮卡解析 agent block 用). */
    blockIds?: string[];
    /** `blockIds` 里命中 agent block 的子集 (有值才挂悬浮卡). */
    agentBlockIds?: string[];
}

/** 一个 Tab 内命中的 agent block 引用 (悬浮卡渲染用). */
export interface TabAgentBlockRef {
    blockId: string;
    /** agent 状态 updatedAt (毫秒); 缺失按 0, 仅用于降序排列. */
    updatedAt: number;
}

/** 可见性判定上下文. */
export interface TabMoreVisibilityContext {
    activeTabId: string | null;
    /** 本次启动已经打开过的 tabId 集合. */
    openedThisLaunch: ReadonlySet<string>;
    /** 有未阅 agent 状态点的 tabId 集合. */
    unreadTabIds: ReadonlySet<string>;
    /** 用户手动「收起未使用的 Tab」产生的折叠集合. */
    collapsedTabIds?: ReadonlySet<string>;
}

export interface TabMoreRow extends TabMoreMeta {
    tabId: string;
    isActive: boolean;
    /** 当前在主栏不可见 (折叠隐藏 or 滚出视口). 与 hover 展开无关. */
    isHidden: boolean;
    /** 本次启动尚未打开过 → 弱化显示. */
    unopenedThisLaunch: boolean;
    /** 有未阅 agent 状态点 → 不弱化. */
    hasUnreadDot: boolean;
    /** 被用户手动收起. */
    isManuallyCollapsed: boolean;
}

/**
 * 该 Tab 是否从主栏隐藏 (与 hover 无关的"常态"判定).
 *
 * 优先级: 激活 > 未阅点 > 手动收起 > 本次启动是否打开过.
 * 有未阅状态点的 Tab 即使被手动收起也会重新露出 —— 否则用户永远发现不了它出新结果了.
 */
export function isTabHiddenFromBar(tabId: string, ctx: TabMoreVisibilityContext): boolean {
    if (tabId === ctx.activeTabId) {
        return false;
    }
    if (ctx.unreadTabIds.has(tabId)) {
        return false;
    }
    if (ctx.collapsedTabIds?.has(tabId)) {
        return true;
    }
    return !ctx.openedThisLaunch.has(tabId);
}

/**
 * 主栏 (水平 TabBar / 垂直 VTabBar) 实际应渲染的 tabId.
 *
 * 隐藏的 Tab (默认折叠 / 手动收起) 只存在于「更多」下拉里, 不再因为 hover /
 * 下拉展开 / 拖拽被捞回主栏 —— 否则鼠标一移上去又“冒出来”, 与“收进更多”的认知冲突.
 */
export function selectBarVisibleTabIds(tabIds: readonly string[], ctx: TabMoreVisibilityContext): string[] {
    return tabIds.filter((tabId) => !isTabHiddenFromBar(tabId, ctx));
}

/**
 * 按 tabIds 的物理顺序构建下拉行. 缺失 meta 的 tabId 会被跳过 (例如 Tab 刚被关闭).
 */
export function buildTabMoreRows(
    tabIds: readonly string[],
    meta: Readonly<Record<string, TabMoreMeta>>,
    ctx: TabMoreVisibilityContext
): TabMoreRow[] {
    const rows: TabMoreRow[] = [];
    for (const tabId of tabIds) {
        const tabMeta = meta[tabId];
        if (tabMeta == null) {
            continue;
        }
        const isActive = tabId === ctx.activeTabId;
        const hasUnreadDot = ctx.unreadTabIds.has(tabId);
        rows.push({
            ...tabMeta,
            tabId,
            isActive,
            isHidden: isTabHiddenFromBar(tabId, ctx),
            unopenedThisLaunch: !ctx.openedThisLaunch.has(tabId),
            hasUnreadDot,
            isManuallyCollapsed: ctx.collapsedTabIds?.has(tabId) ?? false,
        });
    }
    return rows;
}

/** 触发器上显示的计数: 当前不可见的 Tab 数. */
export function countHiddenRows(rows: readonly TabMoreRow[]): number {
    let count = 0;
    for (const row of rows) {
        if (row.isHidden) {
            count++;
        }
    }
    return count;
}

/** 按名称子串过滤 (大小写不敏感, 忽略首尾空白). */
export function filterTabMoreRows(rows: readonly TabMoreRow[], query: string): TabMoreRow[] {
    const needle = query.trim().toLowerCase();
    if (needle === "") {
        return [...rows];
    }
    return rows.filter((row) => row.name.toLowerCase().includes(needle));
}

/** 是否需要显示搜索框. */
export function shouldShowTabMoreSearch(rowCount: number): boolean {
    return rowCount > TabMoreSearchThreshold;
}

/** 「收起未使用的 Tab」目标: 除激活 Tab 外所有当前可见的 Tab. */
export function collectCollapseTargets(rows: readonly TabMoreRow[]): string[] {
    return rows.filter((row) => !row.isActive && !row.isHidden).map((row) => row.tabId);
}

/**
 * 从 blockIds 里挑出 agent block, 按 agent 状态 updatedAt 降序.
 *
 * 纯函数: block 读取与状态时间都通过入参注入, 便于单测.
 * - `getBlock` 返回 null 的 blockId 直接跳过 (block 已被销毁 / 尚未加载).
 * - `isAgentBlock` 之外的类型 (note / preview / session detail) 一律不进结果.
 * - 稳定排序: updatedAt 相同时保持 blockIds 原始顺序.
 */
export function collectTabAgentBlocks(
    blockIds: readonly string[] | null | undefined,
    getBlock: (blockId: string) => Block | null | undefined,
    getUpdatedAt: (blockId: string) => number,
    isAgentBlock: (block: Block) => boolean
): TabAgentBlockRef[] {
    if (blockIds == null || blockIds.length === 0) {
        return [];
    }
    const refs: TabAgentBlockRef[] = [];
    const seen = new Set<string>();
    for (const blockId of blockIds) {
        if (seen.has(blockId)) {
            continue;
        }
        seen.add(blockId);
        const block = getBlock(blockId);
        if (block == null || !isAgentBlock(block)) {
            continue;
        }
        const rawUpdatedAt = getUpdatedAt(blockId);
        refs.push({ blockId, updatedAt: Number.isFinite(rawUpdatedAt) ? rawUpdatedAt : 0 });
    }
    // Array.prototype.sort 是稳定排序: updatedAt 相同时保留 blockIds 顺序.
    return refs.sort((left, right) => right.updatedAt - left.updatedAt);
}
