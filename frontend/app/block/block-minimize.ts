// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import * as WOS from "@/app/store/wos";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { getLayoutModelForTabById, LayoutTreeActionType, newLayoutNode } from "@/layout/index";
import {
    getMinimizedBlockIdsFromTab,
    MinimizedBlocksMetaKey,
    normalizeMinimizedBlockIds,
} from "@/layout/lib/minimizedBlocks";
import { LayoutTreeInsertNodeAction, LayoutTreeRemoveNodeFromLayoutAction } from "@/layout/lib/types";

export { MinimizedBlocksMetaKey, normalizeMinimizedBlockIds };

export function getMinimizedBlockIds(tab: Tab | null | undefined): string[] {
    return getMinimizedBlockIdsFromTab(tab);
}

function persistMinimizedBlockIds(tabId: string, blockIds: string[]): void {
    const meta = {
        [MinimizedBlocksMetaKey]: blockIds.length === 0 ? null : blockIds,
    } as unknown as MetaType;
    RpcApi.SetMetaCommand(TabRpcClient, {
        oref: WOS.makeORef("tab", tabId),
        meta,
    }).catch((e) => {
        console.warn("Failed to persist minimized blocks:", e);
    });
}

export function setMinimizedBlockIds(tabId: string, blockIds: string[]): void {
    const tabAtom = WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", tabId));
    const tab = globalStore.get(tabAtom);
    if (!tab) {
        return;
    }
    const normalizedBlockIds = normalizeMinimizedBlockIds(blockIds).filter((blockId) =>
        (tab.blockids ?? []).includes(blockId)
    );
    const nextTab: Tab = {
        ...tab,
        meta: {
            ...(tab.meta ?? {}),
            [MinimizedBlocksMetaKey]: normalizedBlockIds.length === 0 ? undefined : normalizedBlockIds,
        } as MetaType,
    };
    if (normalizedBlockIds.length === 0) {
        delete (nextTab.meta as Record<string, unknown>)[MinimizedBlocksMetaKey];
    }
    WOS.setObjectValue(nextTab, globalStore.set);
    persistMinimizedBlockIds(tabId, normalizedBlockIds);
}

export function addMinimizedBlockId(tabId: string, blockId: string): void {
    const tab = globalStore.get(WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", tabId)));
    if (!tab || !(tab.blockids ?? []).includes(blockId)) {
        return;
    }
    const blockIds = getMinimizedBlockIds(tab);
    if (!blockIds.includes(blockId)) {
        setMinimizedBlockIds(tabId, [...blockIds, blockId]);
    }
}

export function removeMinimizedBlockId(tabId: string, blockId: string): void {
    const tab = globalStore.get(WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", tabId)));
    if (!tab) {
        return;
    }
    setMinimizedBlockIds(
        tabId,
        getMinimizedBlockIds(tab).filter((id) => id !== blockId)
    );
}

export function minimizeBlockToFloat(tabId: string | null | undefined, blockId: string): boolean {
    if (!tabId) {
        return false;
    }
    const layoutModel = getLayoutModelForTabById(tabId);
    const node = layoutModel?.getNodeByBlockId(blockId);
    if (!node) {
        addMinimizedBlockId(tabId, blockId);
        return false;
    }
    layoutModel.closeEphemeralNodeForBlock(blockId);
    // Removing the node preserves the Block object and backend state, but the frontend view remounts on preview/restore.
    layoutModel.treeReducer({
        type: LayoutTreeActionType.RemoveNodeFromLayout,
        nodeId: node.id,
    } as LayoutTreeRemoveNodeFromLayoutAction);
    addMinimizedBlockId(tabId, blockId);
    return true;
}

export function restoreMinimizedBlockToLayout(tabId: string | null | undefined, blockId: string): boolean {
    if (!tabId) {
        return false;
    }
    const layoutModel = getLayoutModelForTabById(tabId);
    if (!layoutModel) {
        return false;
    }
    removeMinimizedBlockId(tabId, blockId);
    const existingNode = layoutModel.getNodeByBlockId(blockId);
    const ephemeralNode = globalStore.get(layoutModel.ephemeralNode);
    const existingNodeIsEphemeralPreview = existingNode?.id === ephemeralNode?.id;
    layoutModel.closeEphemeralNodeForBlock(blockId);
    if (existingNode && !existingNodeIsEphemeralPreview) {
        return true;
    }
    layoutModel.treeReducer({
        type: LayoutTreeActionType.InsertNode,
        node: newLayoutNode(undefined, undefined, undefined, { blockId }),
        magnified: false,
        focused: true,
    } as LayoutTreeInsertNodeAction);
    return true;
}
