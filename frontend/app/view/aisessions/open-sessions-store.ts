// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 打开的会话：状态层。
//
// 从 wos（workspace / tab / block）+ layoutModel（rootNode / hidden / minimized / focused）
// 取数，订阅变化，合并成一份 identity 稳定的 OpenSessionsSnapshot。
// 纯逻辑投影在 open-sessions.ts；这里只负责「读实时状态 + 节流 + 缓存」。

import { atoms, globalStore, WOS } from "@/app/store/global";
import { getLayoutModelForStaticTab } from "@/layout/lib/layoutModelHooks";
import { getMinimizedBlockIdsFromTab } from "@/layout/lib/minimizedBlocks";
import { getLayoutDataActiveBlockId } from "@/layout/lib/inlineTabs";
import { useSyncExternalStore } from "react";
import {
    collectOpenSessionBlocks,
    collectRenderedBlockIds,
    EmptyOpenSessions,
    openSessionsEqual,
    projectOpenSessions,
    type OpenSessionBlockSource,
    type OpenSessionEntry,
    type OpenSessionsContext,
    type OpenSessionsSnapshot,
} from "./open-sessions";
import type { OpenLevel } from "./open-sessions";

const RecomputeDebounceMs = 100;

function readBlockSources(tabIds: readonly string[]): OpenSessionBlockSource[] {
    const out: OpenSessionBlockSource[] = [];
    for (const tabId of tabIds) {
        const tab = globalStore.get(WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", tabId)));
        if (tab == null) continue;
        for (const blockId of tab.blockids ?? []) {
            const block = globalStore.get(WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId)));
            if (block == null) continue;
            out.push({ blockId, tabId, meta: block.meta });
        }
    }
    return out;
}

function buildContext(activeTabId: string): OpenSessionsContext {
    const layoutModel = getLayoutModelForStaticTab();
    const hidden = new Set(globalStore.get(layoutModel?.hiddenBlockIds) ?? []);
    const activeTab = globalStore.get(WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", activeTabId)));
    const minimized = new Set(getMinimizedBlockIdsFromTab(activeTab));
    const renderedBlockIds = collectRenderedBlockIds(layoutModel?.treeState?.rootNode, hidden, minimized);
    let focusedBlockId: string | null = null;
    if (layoutModel != null) {
        const focusedNode = globalStore.get(layoutModel.focusedNode);
        focusedBlockId = focusedNode == null ? null : getLayoutDataActiveBlockId(focusedNode.data);
    }
    return { activeTabId, renderedBlockIds, focusedBlockId };
}

function computeSnapshot(): OpenSessionsSnapshot {
    const workspace = globalStore.get(atoms.workspace);
    const tabIds = workspace?.tabids ?? [];
    const activeTabId = workspace?.activetabid ?? "";
    const blocks = collectOpenSessionBlocks(readBlockSources(tabIds));
    return projectOpenSessions(blocks, buildContext(activeTabId));
}

let cachedSnapshot: OpenSessionsSnapshot = EmptyOpenSessions;
let recomputeTimer: ReturnType<typeof setTimeout> | null = null;
const snapshotListeners = new Set<() => void>();

function flush(): void {
    recomputeTimer = null;
    const next = computeSnapshot();
    if (openSessionsEqual(cachedSnapshot, next)) {
        // 内容相同也刷新 at？不必：保持旧对象，避免下游无意义重渲。
        return;
    }
    cachedSnapshot = next;
    for (const listener of snapshotListeners) listener();
}

function scheduleRecompute(): void {
    if (recomputeTimer != null) return;
    recomputeTimer = setTimeout(flush, RecomputeDebounceMs);
}

// ── 订阅管理 ──────────────────────────────────────────────────────────
// wos atom 的订阅会随 workspace/tab 变化重建，用一张 unsub 表统一回收。
let activeUnsubs: (() => void)[] = [];
let reboundWorkspaceId: string | null = null;
let installed = false;

function bindSourceSubscriptions(): void {
    for (const unsubscribe of activeUnsubs) unsubscribe();
    activeUnsubs = [];

    const sub = (atomValue: Parameters<typeof globalStore.sub>[0]): void => {
        activeUnsubs.push(globalStore.sub(atomValue, scheduleRecompute));
    };

    const workspace = globalStore.get(atoms.workspace);
    reboundWorkspaceId = workspace?.oid ?? null;
    sub(atoms.workspace);
    for (const tabId of workspace?.tabids ?? []) {
        const tabAtom = WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", tabId));
        sub(tabAtom);
        const tab = globalStore.get(tabAtom);
        for (const blockId of tab?.blockids ?? []) {
            sub(WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId)));
        }
        // 布局持久化（split / close / inline tab 切换）随 layout 对象更新。
        if (tab?.layoutstate != null && tab.layoutstate !== "") {
            sub(WOS.getWaveObjectAtom<LayoutState>(WOS.makeORef("layout", tab.layoutstate)));
        }
    }

    const layoutModel = getLayoutModelForStaticTab();
    if (layoutModel != null) {
        sub(layoutModel.hiddenBlockIds);
        sub(layoutModel.focusedNode);
    }
}

function installSubscriptions(): void {
    if (installed) return;
    installed = true;
    bindSourceSubscriptions();
    // workspace 切换 / tab 增删时，block 与 layout 订阅集合要重绑。
    globalStore.sub(atoms.workspace, () => {
        const workspace = globalStore.get(atoms.workspace);
        if (workspace?.oid !== reboundWorkspaceId) bindSourceSubscriptions();
        scheduleRecompute();
    });
    flush();
}

function ensureFresh(): void {
    installSubscriptions();
}

/** 命令式取最新快照（事件处理 / 非 React 代码用）。 */
export function queryOpenSessions(): OpenSessionsSnapshot {
    ensureFresh();
    return cachedSnapshot;
}

/** 订阅快照变化。返回退订函数。 */
export function subscribeOpenSessions(listener: () => void): () => void {
    ensureFresh();
    snapshotListeners.add(listener);
    return () => {
        snapshotListeners.delete(listener);
    };
}

/**
 * React 订阅入口。useSyncExternalStore 保证 cachedSnapshot 换新对象时才重渲。
 */
export function useOpenSessions(): OpenSessionsSnapshot {
    return useSyncExternalStore(subscribeOpenSessions, queryOpenSessions, queryOpenSessions);
}

/** 当前会话的打开项（行内标记 / 详情头栏多块提示用）。无则 null。 */
export function useSessionOpenEntry(sessionId: string): OpenSessionEntry | null {
    const snapshot = useOpenSessions();
    return snapshot.bySessionId.get(sessionId) ?? null;
}

/** 当前会话的打开级别（行内标记用）。无则 null。 */
export function useSessionOpenLevel(sessionId: string): OpenLevel | null {
    return useSessionOpenEntry(sessionId)?.level ?? null;
}
