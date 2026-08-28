// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Tab grouping — menu builder + hover trigger.
//
// buildTabGroupMenu produces the level-1/level-2 MenuItem tree consumed by FlyoutMenu's
// hoverMode. Level-2 submenus (existing groups, color palette) open on hover and, thanks to the
// SubMenu hoverHandlers fix in flyoutmenu.tsx, keep the level-1 menu open while you dwell on them.

import { FlyoutMenu } from "@/app/element/flyoutmenu";
import type { WaveEnvSubset } from "@/app/waveenv/waveenv";
import { useMemo, type ReactNode } from "react";
import { useAtomValue } from "jotai";
import {
    addTabToGroup as addTabToGroupAction,
    createTabGroup,
    removeTabFromGroup as removeTabFromGroupAction,
    setTabGroupColor as setTabGroupColorAction,
    useTabGroups,
} from "./tabgroup-store";
import { getGroupOfTab, TabGroupColorPalette, type TabGroup } from "./tabgroup";

export function buildTabGroupMenu(params: {
    env: WaveEnvSubset<{ atoms: { workspaceId: any }; rpc: any }>;
    workspaceId: string;
    tabId: string;
    groups: TabGroup[];
}): MenuItem[] {
    const { env, workspaceId, tabId, groups } = params;
    const current = getGroupOfTab(groups, tabId);
    const items: MenuItem[] = [];

    items.push({
        label: "New Group",
        onClick: () => createTabGroup(env, workspaceId, { name: "Group", tabIds: [tabId] }),
    });

    if (groups.length > 0) {
        items.push({
            label: "Add to Group",
            subItems: groups.map((grp) => ({
                label: grp.name || "Group",
                onClick: () => addTabToGroupAction(env, workspaceId, grp.id, tabId),
            })),
        });
    }

    if (current != null) {
        items.push({
            label: "Remove from Group",
            onClick: () => removeTabFromGroupAction(env, workspaceId, tabId),
        });
        items.push({
            label: "Group Color",
            subItems: TabGroupColorPalette.map((c) => ({
                label: c.label,
                onClick: () => setTabGroupColorAction(env, workspaceId, current.id, c.value),
            })),
        });
    }

    return items;
}

type TabGroupMenuProps = {
    env: WaveEnvSubset<{ atoms: { workspaceId: any }; rpc: any }>;
    workspaceId: string;
    tabId: string;
    children: ReactNode;
};

/**
 * Hover-triggered "add to group" menu. Wrap any affordance (e.g. a tab's group icon) as children;
 * the menu opens on pointer enter and closes `hoverCloseDelayMs` after the pointer leaves the
 * whole menu tree, including any expanded level-2 submenu.
 */
export function TabGroupMenu({ env, workspaceId, tabId, children }: TabGroupMenuProps) {
    const groups = useTabGroups(workspaceId);
    const items = useMemo(
        () => buildTabGroupMenu({ env, workspaceId, tabId, groups }),
        [env, workspaceId, tabId, groups]
    );
    return (
        <FlyoutMenu items={items} hoverMode hoverCloseDelayMs={600} placement="bottom-start">
            {children}
        </FlyoutMenu>
    );
}
