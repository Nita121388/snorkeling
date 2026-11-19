// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { atom } from "jotai";

/**
 * 「收起到更多」状态（renderer 侧投影）。
 *
 * 真源在主进程（emain/emain-window.ts 的 collapsedTabIds）—— 每个 Tab 是独立
 * WebContentsView / renderer，Tab 栏在各 renderer 各渲染一份，状态放在 renderer 本地
 * 会出现「在当前 Tab 收起，切到别的 Tab 又冒出来」的撕裂。因此这里与
 * openedThisLaunchTabIdsAtom 同构：初值同步读 + 订阅广播同步。
 *
 * 写路径：本地乐观更新（即时视觉反馈）→ IPC 写穿到主进程 → 主进程广播回写各视图。
 *
 * 清除时机: 任何 tab 被真正打开（markTabOpenedThisLaunch）时主进程会把它从集合移除并广播。
 */
function getApi(): ElectronApi | null {
    return typeof window === "undefined" ? null : ((window as any).api ?? null);
}

function readCollapsedTabIdsFromApi(): Set<string> {
    try {
        return new Set(getApi()?.getCollapsedTabIds?.() ?? []);
    } catch {
        return new Set<string>();
    }
}

export const collapsedTabIdsAtom = atom<Set<string>>(readCollapsedTabIdsFromApi());

let didInstallCollapsedTabIdsSync = false;

/** 安装主进程广播 → atom 的同步（幂等；在 wave init 中调用一次即可）。 */
export function initCollapsedTabIdsSync(): void {
    if (didInstallCollapsedTabIdsSync) {
        return;
    }
    didInstallCollapsedTabIdsSync = true;
    const api = getApi();
    globalStore.set(collapsedTabIdsAtom, readCollapsedTabIdsFromApi());
    api?.onCollapsedTabIdsChange?.((tabIds) => {
        globalStore.set(collapsedTabIdsAtom, new Set(tabIds));
    });
}

/**
 * 本地乐观更新 + 写穿到主进程。
 * `updater` 返回与 prev 相同的对象即视为无变更 → 不渲染、不发 IPC。
 */
function applyLocalCollapsedTabIds(updater: (prev: ReadonlySet<string>) => Set<string> | null): boolean {
    const prev = globalStore.get(collapsedTabIdsAtom);
    const next = updater(prev);
    if (next == null) {
        return false;
    }
    globalStore.set(collapsedTabIdsAtom, next);
    return true;
}

export function collapseTabIds(tabIds: readonly string[]): void {
    const usable = tabIds.filter((tabId) => !!tabId);
    if (usable.length === 0) {
        return;
    }
    let added: string[] = [];
    const changed = applyLocalCollapsedTabIds((prev) => {
        const deduped = Array.from(new Set(usable)).filter((tabId) => !prev.has(tabId));
        added = deduped;
        if (deduped.length === 0) {
            return null;
        }
        const next = new Set(prev);
        for (const tabId of deduped) {
            next.add(tabId);
        }
        return next;
    });
    if (changed) {
        // 只把净新增的 id 写穿到主进程（去重、幂等），主进程广播回写后各视图自然对齐。
        getApi()?.collapseTabIds?.(added);
    }
}

export function expandCollapsedTabId(tabId: string): void {
    if (!tabId) {
        return;
    }
    const changed = applyLocalCollapsedTabIds((prev) => {
        if (!prev.has(tabId)) {
            return null;
        }
        const next = new Set(prev);
        next.delete(tabId);
        return next;
    });
    if (changed) {
        getApi()?.expandCollapsedTabId?.(tabId);
    }
}

export function clearCollapsedTabIds(): void {
    const changed = applyLocalCollapsedTabIds((prev) => (prev.size === 0 ? null : new Set<string>()));
    if (changed) {
        getApi()?.clearCollapsedTabIds?.();
    }
}
