// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { atom } from "jotai";

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
    globalStore.set(openedThisLaunchTabIdsAtom, (openedTabIds) => {
        if (openedTabIds.has(tabId)) {
            return openedTabIds;
        }
        const nextOpenedTabIds = new Set(openedTabIds);
        nextOpenedTabIds.add(tabId);
        return nextOpenedTabIds;
    });
}
