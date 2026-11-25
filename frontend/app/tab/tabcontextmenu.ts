// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getOrefMetaKeyAtom, globalStore, recordTEvent } from "@/app/store/global";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { i18n } from "@/i18n/config";
import { fireAndForget } from "@/util/util";
import { makeORef } from "../store/wos";
import type { TabEnv } from "./tab";
import { normalizeTabAgentStatusMode, TabAgentStatusModeConfigKey, type TabAgentStatusMode } from "./tab-agent-status-mode";
import { collapseTabIds } from "./tab-collapse-state";

const TabReturnWorkspaceIdMetaKey = "tab:returnworkspaceid";

const FlagColors = [
    { labelKey: "tab:contextMenu.flagColor.green", value: "#58C142" },
    { labelKey: "tab:contextMenu.flagColor.teal", value: "#00FFDB" },
    { labelKey: "tab:contextMenu.flagColor.blue", value: "#429DFF" },
    { labelKey: "tab:contextMenu.flagColor.purple", value: "#BF55EC" },
    { labelKey: "tab:contextMenu.flagColor.red", value: "#FF453A" },
    { labelKey: "tab:contextMenu.flagColor.orange", value: "#FF9500" },
    { labelKey: "tab:contextMenu.flagColor.yellow", value: "#FFE900" },
] as const;

export function buildTabBarContextMenu(env: TabEnv): ContextMenuItem[] {
    const currentTabBar = globalStore.get(env.getSettingsKeyAtom("app:tabbar")) ?? "top";
    const tabBarSubmenu: ContextMenuItem[] = [
        {
            label: i18n.t("tab:contextMenu.top"),
            type: "checkbox",
            checked: currentTabBar === "top",
            click: () => fireAndForget(() => env.rpc.SetConfigCommand(TabRpcClient, { "app:tabbar": "top" })),
        },
        {
            label: i18n.t("tab:contextMenu.left"),
            type: "checkbox",
            checked: currentTabBar === "left",
            click: () => fireAndForget(() => env.rpc.SetConfigCommand(TabRpcClient, { "app:tabbar": "left" })),
        },
    ];
    return [{ label: i18n.t("tab:contextMenu.tabBarPosition"), type: "submenu", submenu: tabBarSubmenu }];
}

/** `buildTabContextMenu` 的可见性判定入参 (由调用方组件注入, 不读 atom). */
export interface TabContextMenuVisibility {
    /** 该 Tab 是否为当前激活 Tab. 仍需要: 决定收起时要不要先切走激活态. */
    active?: boolean;
    /** 该 Tab 是否有未阅 agent 状态点. 未读优先于手动收起 (见 isTabHiddenFromBar) → 菜单项置灰. */
    hasUnreadDot?: boolean;
    /**
     * 收起激活 Tab 后应切到的 Tab (由调用方按物理顺序用 `pickCollapseSwitchTarget` 解析).
     * null/undefined 表示无可切目标 (仅剩一个 Tab) → 菜单项置灰.
     */
    switchTargetTabId?: string | null;
}

export function buildTabContextMenu(
    id: string,
    renameRef: React.RefObject<(() => void) | null>,
    onClose: (event: React.MouseEvent<HTMLButtonElement, MouseEvent> | null) => void,
    env: TabEnv,
    visibility?: TabContextMenuVisibility
): ContextMenuItem[] {
    const menu: ContextMenuItem[] = [];
    menu.push(
        { label: i18n.t("tab:contextMenu.renameTab"), click: () => renameRef.current?.() },
        {
            label: i18n.t("tab:contextMenu.copyTabId"),
            click: () => fireAndForget(() => navigator.clipboard.writeText(id)),
        },
        { type: "separator" }
    );
    const tabORef = makeORef("tab", id);
    const returnWorkspaceId = globalStore.get(getOrefMetaKeyAtom(tabORef, TabReturnWorkspaceIdMetaKey)) ?? null;
    const currentFlagColor = globalStore.get(getOrefMetaKeyAtom(tabORef, "tab:flagcolor")) ?? null;
    const flagSubmenu: ContextMenuItem[] = [
        {
            label: i18n.t("tab:contextMenu.none"),
            type: "checkbox",
            checked: currentFlagColor == null,
            click: () =>
                fireAndForget(() =>
                    env.rpc.SetMetaCommand(TabRpcClient, { oref: tabORef, meta: { "tab:flagcolor": null } })
                ),
        },
        ...FlagColors.map((fc) => ({
            label: i18n.t(fc.labelKey),
            type: "checkbox" as const,
            checked: currentFlagColor === fc.value,
            click: () =>
                fireAndForget(() =>
                    env.rpc.SetMetaCommand(TabRpcClient, { oref: tabORef, meta: { "tab:flagcolor": fc.value } })
                ),
        })),
    ];
    menu.push({ label: i18n.t("tab:contextMenu.flagTab"), type: "submenu", submenu: flagSubmenu }, { type: "separator" });
    const currentAgentStatusMode = normalizeTabAgentStatusMode(
        globalStore.get(env.getSettingsKeyAtom(TabAgentStatusModeConfigKey))
    );
    const setAgentStatusMode = (mode: TabAgentStatusMode) => {
        fireAndForget(() => env.rpc.SetConfigCommand(TabRpcClient, { [TabAgentStatusModeConfigKey]: mode }));
        recordTEvent("action:settabagentstatusmode");
    };
    const agentStatusModeSubmenu: ContextMenuItem[] = [
        {
            label: i18n.t("tab:contextMenu.agentStatusAvatars"),
            type: "checkbox",
            checked: currentAgentStatusMode === "avatars",
            click: () => setAgentStatusMode("avatars"),
        },
        {
            label: i18n.t("tab:contextMenu.agentStatusRail"),
            type: "checkbox",
            checked: currentAgentStatusMode === "rail",
            click: () => setAgentStatusMode("rail"),
        },
        {
            label: i18n.t("tab:contextMenu.agentStatusHybrid"),
            type: "checkbox",
            checked: currentAgentStatusMode === "hybrid",
            click: () => setAgentStatusMode("hybrid"),
        },
    ];
    menu.push(
        {
            label: i18n.t("tab:contextMenu.agentStatusDisplay"),
            type: "submenu",
            sublabel: i18n.t("tab:contextMenu.agentStatusAllTabs"),
            submenu: agentStatusModeSubmenu,
        },
        { type: "separator" }
    );
    const fullConfig = globalStore.get(env.atoms.fullConfigAtom);
    const backgrounds = fullConfig?.backgrounds ?? {};
    const bgKeys = Object.keys(backgrounds).filter((k) => backgrounds[k] != null);
    bgKeys.sort((a, b) => {
        const aOrder = backgrounds[a]["display:order"] ?? 0;
        const bOrder = backgrounds[b]["display:order"] ?? 0;
        return aOrder - bOrder;
    });
    if (bgKeys.length > 0) {
        const submenu: ContextMenuItem[] = [];
        const oref = makeORef("tab", id);
        submenu.push({
            label: i18n.t("tab:contextMenu.default"),
            click: () =>
                fireAndForget(async () => {
                    await env.rpc.SetMetaCommand(TabRpcClient, {
                        oref,
                        meta: { "bg:*": true, "tab:background": null },
                    });
                    env.rpc.ActivityCommand(TabRpcClient, { settabtheme: 1 }, { noresponse: true });
                    recordTEvent("action:settabtheme");
                }),
        });
        for (const bgKey of bgKeys) {
            const bg = backgrounds[bgKey];
            submenu.push({
                label: bg["display:name"] ?? bgKey,
                click: () =>
                    fireAndForget(async () => {
                        await env.rpc.SetMetaCommand(TabRpcClient, {
                            oref,
                            meta: { "bg:*": true, "tab:background": bgKey },
                        });
                        env.rpc.ActivityCommand(TabRpcClient, { settabtheme: 1 }, { noresponse: true });
                        recordTEvent("action:settabtheme");
                    }),
            });
        }
        menu.push({ label: i18n.t("tab:contextMenu.backgrounds"), type: "submenu", submenu }, { type: "separator" });
    }
    menu.push(...buildTabBarContextMenu(env), { type: "separator" });
    // 「收起到更多」: 与「更多」下拉共用 collapsedTabIdsAtom, 收起后该 Tab 只存在于下拉里且置灰
    // (dimmed 语义见 tab-more-menu.tsx 的 TabMoreRowItem).
    // 有未阅点的 Tab 收起会被 isTabHiddenFromBar 的优先级覆盖 (点了也不生效), 故置灰.
    // 激活 Tab 不再置灰: 改为「收起并切走」—— 先激活相邻 Tab 再收起, 优先级冲突自然消解.
    const switchTarget = visibility?.switchTargetTabId;
    const collapseDisabledHint =
        visibility?.hasUnreadDot === true
            ? i18n.t("tab:contextMenu.collapseToMoreUnreadDisabled")
            : visibility?.active === true && (switchTarget == null || switchTarget === "")
              ? i18n.t("tab:contextMenu.collapseToMoreLastTabDisabled")
              : null;
    menu.push({
        label: i18n.t("tab:contextMenu.collapseToMore"),
        enabled: collapseDisabledHint == null,
        sublabel: collapseDisabledHint ?? undefined,
        click: () => {
            // 顺序不变量: 先切走激活态, 再收起。反了会出现「激活 Tab 被收起但仍 active」的中间帧,
            // isTabHiddenFromBar 会因「激活 > 收起」把它立刻放回主栏 (视觉上像没收起).
            if (visibility?.active === true && switchTarget != null && switchTarget !== "") {
                env.electron.setActiveTab(switchTarget);
            }
            collapseTabIds([id]);
            recordTEvent("action:collapsetab");
        },
    });
    menu.push({ type: "separator" });
    menu.push({
        label: i18n.t("tab:contextMenu.moveTabToNewWindow"),
        click: () =>
            fireAndForget(async () => {
                await env.electron.moveTabToNewWindow(id);
            }),
    });
    if (returnWorkspaceId != null && returnWorkspaceId !== "") {
        menu.push({
            label: i18n.t("tab:contextMenu.moveTabBack"),
            click: () =>
                fireAndForget(async () => {
                    await env.electron.moveTabBack(id);
                }),
        });
    }
    menu.push({ type: "separator" });
    menu.push({ label: i18n.t("tab:contextMenu.closeTab"), click: () => onClose(null) });
    return menu;
}
