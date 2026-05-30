// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atom } from "jotai";

export const openedThisLaunchTabIdsAtom = atom<Set<string>>(new Set<string>());

export function wasTabOpenedThisLaunch(openedTabIds: Set<string>, tabId: string): boolean {
    return openedTabIds.has(tabId);
}

export function markTabOpenedThisLaunch(openedTabIds: Set<string>, tabId: string): Set<string> {
    if (openedTabIds.has(tabId)) {
        return openedTabIds;
    }
    const nextOpenedTabIds = new Set(openedTabIds);
    nextOpenedTabIds.add(tabId);
    return nextOpenedTabIds;
}
