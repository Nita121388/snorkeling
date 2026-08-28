// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Tab grouping — store + actions layer.
//
// Reads groups from workspace meta (ws:tabgroups) and persists transforms back through the
// existing SetMetaCommand. Actions are thin wrappers over the pure model in tabgroup.ts: read
// current -> apply immutable transform -> write. Group membership drives render position via
// buildRenderSegments, so we deliberately do NOT rewrite workspace.tabids here (keeps this
// layer a single, recoverable write and avoids fighting the tab bar's drag-order logic).

import * as WOS from "@/app/store/wos";
import { globalStore } from "@/app/store/jotaiStore";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { makeORef } from "@/app/store/wos";
import { fireAndForget } from "@/util/util";
import { atom, type Atom, useAtomValue } from "jotai";
import {
    addTabToGroup as addTabToGroupPure,
    buildTabGroups,
    createGroup as createGroupPure,
    removeTabFromGroup as removeTabFromGroupPure,
    renameGroup as renameGroupPure,
    setGroupColor as setGroupColorPure,
    toggleGroupCollapsed as toggleGroupCollapsedPure,
    type TabGroup,
    type TabGroupId,
} from "./tabgroup";

const TabGroupsMetaKey = "ws:tabgroups";

const tabGroupsAtomCache = new Map<string, Atom<TabGroup[]>>();

/**
 * Reactive view of a workspace's tab groups, derived from workspace meta. Cached per workspace
 * id so all subscribers share one atom (mirrors getOrefMetaKeyAtom in store/global.ts).
 */
export function getTabGroupsAtom(workspaceId: string): Atom<TabGroup[]> {
    let a = tabGroupsAtomCache.get(workspaceId);
    if (a != null) {
        return a;
    }
    a = atom((get) => {
        const ws = get(WOS.getWaveObjectAtom<Workspace>(makeORef("workspace", workspaceId)));
        return buildTabGroups(ws?.meta?.[TabGroupsMetaKey]);
    });
    tabGroupsAtomCache.set(workspaceId, a);
    return a;
}

export function useTabGroups(workspaceId: string): TabGroup[] {
    return useAtomValue(getTabGroupsAtom(workspaceId));
}

function readGroups(workspaceId: string): TabGroup[] {
    const ws = globalStore.get(WOS.getWaveObjectAtom<Workspace>(makeORef("workspace", workspaceId)));
    return buildTabGroups(ws?.meta?.[TabGroupsMetaKey]);
}

function writeTabGroups(env: any, workspaceId: string, groups: TabGroup[]): void {
    fireAndForget(() =>
        env.rpc.SetMetaCommand(TabRpcClient, {
            oref: makeORef("workspace", workspaceId),
            meta: { [TabGroupsMetaKey]: groups } as Record<string, unknown>,
        })
    );
}

export function createTabGroup(
    env: any,
    workspaceId: string,
    opts: { name: string; color?: string; tabIds?: string[] }
): TabGroupId {
    const { groups, groupId } = createGroupPure(readGroups(workspaceId), opts);
    writeTabGroups(env, workspaceId, groups);
    return groupId;
}

export function addTabToGroup(env: any, workspaceId: string, groupId: TabGroupId, tabId: string): void {
    writeTabGroups(env, workspaceId, addTabToGroupPure(readGroups(workspaceId), groupId, tabId));
}

export function removeTabFromGroup(env: any, workspaceId: string, tabId: string): void {
    writeTabGroups(env, workspaceId, removeTabFromGroupPure(readGroups(workspaceId), tabId));
}

export function toggleGroupCollapsed(env: any, workspaceId: string, groupId: TabGroupId): void {
    writeTabGroups(env, workspaceId, toggleGroupCollapsedPure(readGroups(workspaceId), groupId));
}

export function renameTabGroup(env: any, workspaceId: string, groupId: TabGroupId, name: string): void {
    writeTabGroups(env, workspaceId, renameGroupPure(readGroups(workspaceId), groupId, name));
}

export function setTabGroupColor(env: any, workspaceId: string, groupId: TabGroupId, color: string): void {
    writeTabGroups(env, workspaceId, setGroupColorPure(readGroups(workspaceId), groupId, color));
}
