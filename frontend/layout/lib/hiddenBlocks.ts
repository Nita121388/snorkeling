// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import * as WOS from "@/app/store/wos";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";

export const HiddenBlocksMetaKey = "layout:hiddenblocks";

export function normalizeHiddenBlockIds(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    const seen = new Set<string>();
    const blockIds: string[] = [];
    value.forEach((item) => {
        if (typeof item !== "string" || item === "" || seen.has(item)) {
            return;
        }
        seen.add(item);
        blockIds.push(item);
    });
    return blockIds;
}

export function getHiddenBlockIdsFromTab(tab: Tab | null | undefined): string[] {
    const tabBlockIds = new Set(tab?.blockids ?? []);
    return normalizeHiddenBlockIds((tab?.meta as Record<string, unknown>)?.[HiddenBlocksMetaKey]).filter((blockId) =>
        tabBlockIds.has(blockId)
    );
}

function persistHiddenBlockIds(tabId: string, blockIds: string[]): void {
    const meta = {
        [HiddenBlocksMetaKey]: blockIds.length === 0 ? null : blockIds,
    } as unknown as MetaType;
    RpcApi.SetMetaCommand(TabRpcClient, {
        oref: WOS.makeORef("tab", tabId),
        meta,
    }).catch((e) => {
        console.warn("Failed to persist hidden blocks:", e);
    });
}

export function setHiddenBlockIds(tabId: string, blockIds: string[]): void {
    const tabAtom = WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", tabId));
    const tab = globalStore.get(tabAtom);
    if (!tab) {
        return;
    }
    const normalizedBlockIds = normalizeHiddenBlockIds(blockIds).filter((blockId) =>
        (tab.blockids ?? []).includes(blockId)
    );
    const nextTab: Tab = {
        ...tab,
        meta: {
            ...(tab.meta ?? {}),
            [HiddenBlocksMetaKey]: normalizedBlockIds.length === 0 ? undefined : normalizedBlockIds,
        } as MetaType,
    };
    if (normalizedBlockIds.length === 0) {
        delete (nextTab.meta as Record<string, unknown>)[HiddenBlocksMetaKey];
    }
    WOS.setObjectValue(nextTab, globalStore.set);
    persistHiddenBlockIds(tabId, normalizedBlockIds);
}

export function addHiddenBlockId(tabId: string, blockId: string): void {
    const tab = globalStore.get(WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", tabId)));
    if (!tab || !(tab.blockids ?? []).includes(blockId)) {
        return;
    }
    const blockIds = getHiddenBlockIdsFromTab(tab);
    if (!blockIds.includes(blockId)) {
        setHiddenBlockIds(tabId, [...blockIds, blockId]);
    }
}

export function removeHiddenBlockId(tabId: string, blockId: string): void {
    const tab = globalStore.get(WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", tabId)));
    if (!tab) {
        return;
    }
    setHiddenBlockIds(
        tabId,
        getHiddenBlockIdsFromTab(tab).filter((id) => id !== blockId)
    );
}
