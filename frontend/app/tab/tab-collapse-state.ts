// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { atom } from "jotai";

/**
 * 「收起未使用的 Tab」状态.
 *
 * 与被折叠 Tab 的 opened-this-launch (emain 侧持久化、跨窗口广播) 不同, 这是一次
 * 用户显式的手动收敛动作: 只想在 Tab 栏上留住当前 Tab, 其余全部折叠到「更多」下拉里.
 * 因此纯 renderer 侧状态, 重启即失效, 也不需要改 IPC.
 *
 * 清除时机: 任何 tab 被真正打开 (markTabOpenedThisLaunch) 时会自动从集合移除,
 * 见 tab-open-state.ts.
 */
export const collapsedTabIdsAtom = atom<Set<string>>(new Set<string>());

export function collapseTabIds(tabIds: readonly string[]): void {
    if (tabIds.length === 0) {
        return;
    }
    globalStore.set(collapsedTabIdsAtom, (prev) => {
        const next = new Set(prev);
        for (const tabId of tabIds) {
            if (tabId) {
                next.add(tabId);
            }
        }
        return next;
    });
}

export function expandCollapsedTabId(tabId: string): void {
    if (!tabId) {
        return;
    }
    globalStore.set(collapsedTabIdsAtom, (prev) => {
        if (!prev.has(tabId)) {
            return prev;
        }
        const next = new Set(prev);
        next.delete(tabId);
        return next;
    });
}

export function clearCollapsedTabIds(): void {
    globalStore.set(collapsedTabIdsAtom, (prev) => (prev.size === 0 ? prev : new Set<string>()));
}
