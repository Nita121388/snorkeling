// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { atom } from "jotai";
import { tabRecencyStore } from "./tab-recency-store";

function getApi(): ElectronApi | null {
    return typeof window === "undefined" ? null : ((window as any).api ?? null);
}

function readOpenedThisLaunchTabIds(): Set<string> {
    try {
        return new Set(getApi()?.getOpenedThisLaunchTabIds?.() ?? []);
    } catch {
        return new Set<string>();
    }
}

export const openedThisLaunchTabIdsAtom = atom<Set<string>>(readOpenedThisLaunchTabIds());

let didInstallOpenedThisLaunchSync = false;

export function initOpenedThisLaunchTabIdsSync() {
    if (didInstallOpenedThisLaunchSync) {
        return;
    }
    didInstallOpenedThisLaunchSync = true;
    const api = getApi();
    globalStore.set(openedThisLaunchTabIdsAtom, readOpenedThisLaunchTabIds());
    api?.onOpenedThisLaunchTabIdsChange?.((tabIds) => {
        globalStore.set(openedThisLaunchTabIdsAtom, new Set(tabIds));
    });
}

export function wasTabOpenedThisLaunch(openedTabIds: Set<string>, tabId: string): boolean {
    return openedTabIds.has(tabId);
}

export function markTabOpenedThisLaunch(tabId: string) {
    if (!tabId) {
        return;
    }
    getApi()?.markTabOpenedThisLaunch?.(tabId);
    // 双写持久化时序: 跨重启保留 "上次打开过的顺序" (按 lastOpenedAt 降序排前).
    // openedThisLaunch 仅本启动有效, 重启即失; recencyStore 走 localStorage 跨重启续命.
    tabRecencyStore.markTabOpened(tabId);
    globalStore.set(openedThisLaunchTabIdsAtom, (openedTabIds) => {
        if (openedTabIds.has(tabId)) {
            return openedTabIds;
        }
        const nextOpenedTabIds = new Set(openedTabIds);
        nextOpenedTabIds.add(tabId);
        return nextOpenedTabIds;
    });
}
