// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import * as WOS from "@/app/store/wos";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { getLayoutModelForTabById, LayoutTreeActionType, newLayoutNode } from "@/layout/index";
import { getLayoutDataBlockIds } from "@/layout/lib/inlineTabs";
import {
    getMinimizedBlockIdsFromTab,
    getMinimizedGroupsFromTab,
    MinimizedBlocksMetaKey,
    MinimizedGroups,
    MinimizedGroupsMetaKey,
    normalizeMinimizedBlockIds,
} from "@/layout/lib/minimizedBlocks";
import { LayoutTreeInsertNodeAction, LayoutTreeRemoveNodeFromLayoutAction } from "@/layout/lib/types";

export { MinimizedBlocksMetaKey, normalizeMinimizedBlockIds };
export type { MinimizedGroups };

export function getMinimizedBlockIds(tab: Tab | null | undefined): string[] {
    return getMinimizedBlockIdsFromTab(tab);
}

export function getMinimizedGroups(tab: Tab | null | undefined): MinimizedGroups {
    return getMinimizedGroupsFromTab(tab);
}

// ── Persistence ──

function persistMinimizedMeta(tabId: string, blockIds: string[], groups: MinimizedGroups): void {
    const meta = {
        [MinimizedBlocksMetaKey]: blockIds.length === 0 ? null : blockIds,
        [MinimizedGroupsMetaKey]: Object.keys(groups).length === 0 ? null : groups,
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
    const groups = getMinimizedGroupsFromTab(tab);

    // Clean up groups that reference blockIds no longer in the minimized list.
    const blockIdSet = new Set(normalizedBlockIds);
    const cleanedGroups: MinimizedGroups = {};
    for (const [groupId, memberIds] of Object.entries(groups)) {
        const filtered = memberIds.filter((id) => blockIdSet.has(id));
        if (filtered.length > 0) {
            cleanedGroups[groupId] = filtered;
        }
    }

    const nextTab: Tab = {
        ...tab,
        meta: {
            ...(tab.meta ?? {}),
            [MinimizedBlocksMetaKey]: normalizedBlockIds.length === 0 ? undefined : normalizedBlockIds,
            [MinimizedGroupsMetaKey]: Object.keys(cleanedGroups).length === 0 ? undefined : cleanedGroups,
        } as MetaType,
    };
    if (normalizedBlockIds.length === 0) {
        delete (nextTab.meta as Record<string, unknown>)[MinimizedBlocksMetaKey];
    }
    if (Object.keys(cleanedGroups).length === 0) {
        delete (nextTab.meta as Record<string, unknown>)[MinimizedGroupsMetaKey];
    }
    WOS.setObjectValue(nextTab, globalStore.set);
    persistMinimizedMeta(tabId, normalizedBlockIds, cleanedGroups);
}

function persistGroups(tabId: string, groups: MinimizedGroups): void {
    const tabAtom = WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", tabId));
    const tab = globalStore.get(tabAtom);
    if (!tab) {
        return;
    }
    const blockIds = getMinimizedBlockIdsFromTab(tab);
    const nextTab: Tab = {
        ...tab,
        meta: {
            ...(tab.meta ?? {}),
            [MinimizedGroupsMetaKey]: Object.keys(groups).length === 0 ? undefined : groups,
        } as MetaType,
    };
    if (Object.keys(groups).length === 0) {
        delete (nextTab.meta as Record<string, unknown>)[MinimizedGroupsMetaKey];
    }
    WOS.setObjectValue(nextTab, globalStore.set);
    persistMinimizedMeta(tabId, blockIds, groups);
}

// ── Block-level CRUD ──

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

// ── Group-level CRUD ──

export function addMinimizedGroup(tabId: string, groupId: string, memberBlockIds: string[]): void {
    const tab = globalStore.get(WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", tabId)));
    if (!tab) {
        return;
    }
    const groups = getMinimizedGroupsFromTab(tab);
    groups[groupId] = [...memberBlockIds];
    persistGroups(tabId, groups);
}

export function removeMinimizedGroup(tabId: string, groupId: string): void {
    const tab = globalStore.get(WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", tabId)));
    if (!tab) {
        return;
    }
    const groups = getMinimizedGroupsFromTab(tab);
    delete groups[groupId];
    persistGroups(tabId, groups);
}

// ── Minimize single block ──

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

    const nodeBlockIds = getLayoutDataBlockIds(node.data);
    const isInlineTabGroup = nodeBlockIds.length > 1;

    if (isInlineTabGroup) {
        // Only extract the target block from the inline tab group instead of
        // removing the entire node, which would cause all sibling blocks to vanish.
        layoutModel.removeBlockFromInlineTab(node.id, blockId);
    } else {
        // Removing the node preserves the Block object and backend state, but the frontend view remounts on preview/restore.
        layoutModel.treeReducer({
            type: LayoutTreeActionType.RemoveNodeFromLayout,
            nodeId: node.id,
        } as LayoutTreeRemoveNodeFromLayoutAction);
    }
    addMinimizedBlockId(tabId, blockId);
    return true;
}

// ── Restore single block ──

export function restoreMinimizedBlockToLayout(tabId: string | null | undefined, blockId: string): boolean {
    if (!tabId) {
        return false;
    }
    const layoutModel = getLayoutModelForTabById(tabId);
    if (!layoutModel) {
        return false;
    }
    removeMinimizedBlockId(tabId, blockId);
    layoutModel.closeEphemeralNodeForBlock(blockId);
    const existingNode = layoutModel.getNodeByBlockId(blockId);
    if (existingNode) {
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

// ── Minimize entire group ──

/**
 * Minimize an entire inline-tab group (or a single standalone block) to the
 * BlockBar. Every blockId in the group is removed from the layout, added to
 * the minimized list, and registered as a group so the sidebar can render
 * a collapsible folder icon.
 *
 * @param groupId  Stable identifier for the group. Typically the layout node id.
 */
export function minimizeGroupToFloat(
    tabId: string | null | undefined,
    groupBlockIds: string[],
    groupId?: string
): boolean {
    if (!tabId || groupBlockIds.length === 0) {
        return false;
    }
    const layoutModel = getLayoutModelForTabById(tabId);
    if (!layoutModel) {
        return false;
    }

    // Find the node that contains the first block of the group.
    const node = layoutModel.getNodeByBlockId(groupBlockIds[0]);
    const effectiveGroupId = groupId ?? node?.id ?? `grp-${groupBlockIds[0]}`;

    if (node) {
        layoutModel.closeEphemeralNodeForBlock(groupBlockIds[0]);
        // Remove the whole node from layout.
        layoutModel.treeReducer({
            type: LayoutTreeActionType.RemoveNodeFromLayout,
            nodeId: node.id,
        } as LayoutTreeRemoveNodeFromLayoutAction);
    }

    // Add every block in the group to the minimized list.
    for (const blockId of groupBlockIds) {
        addMinimizedBlockId(tabId, blockId);
    }

    // Record the group structure so the sidebar can render a collapsible folder.
    if (groupBlockIds.length > 1) {
        addMinimizedGroup(tabId, effectiveGroupId, groupBlockIds);
    }

    return true;
}

// ── Restore entire group ──

/**
 * Restore every block in a minimized group back to the layout.
 * Each block becomes a standalone layout node.
 */
export function restoreMinimizedGroupToLayout(tabId: string | null | undefined, groupId: string): boolean {
    if (!tabId) {
        return false;
    }
    const tab = globalStore.get(WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", tabId)));
    if (!tab) {
        return false;
    }
    const groups = getMinimizedGroupsFromTab(tab);
    const memberIds = groups[groupId];
    if (!memberIds || memberIds.length === 0) {
        return false;
    }

    // Remove the group record first so sidebar re-renders cleanly.
    removeMinimizedGroup(tabId, groupId);

    // Restore each block individually.
    for (const blockId of memberIds) {
        restoreMinimizedBlockToLayout(tabId, blockId);
    }
    return true;
}

/**
 * Dissolve a group: remove the group record but keep the blockIds as
 * independent entries in the minimized list.
 */
export function dissolveMinimizedGroup(tabId: string | null | undefined, groupId: string): void {
    if (!tabId) {
        return;
    }
    removeMinimizedGroup(tabId, groupId);
}

/**
 * Delete every block in a minimized group (and remove the group record).
 */
export function deleteMinimizedGroup(tabId: string | null | undefined, groupId: string): void {
    if (!tabId) {
        return;
    }
    const tab = globalStore.get(WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", tabId)));
    if (!tab) {
        return;
    }
    const groups = getMinimizedGroupsFromTab(tab);
    const memberIds = groups[groupId];
    if (!memberIds) {
        return;
    }

    removeMinimizedGroup(tabId, groupId);

    for (const blockId of memberIds) {
        removeMinimizedBlockId(tabId, blockId);
    }
}
