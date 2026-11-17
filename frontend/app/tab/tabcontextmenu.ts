// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getOrefMetaKeyAtom, globalStore, recordTEvent } from "@/app/store/global";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { i18n } from "@/i18n/config";
import { fireAndForget } from "@/util/util";
import { makeORef } from "../store/wos";
import type { TabEnv } from "./tab";
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
    /** 该 Tab 是否为当前激活 Tab. 激活 Tab 永远在主栏可见, 收起无效 → 菜单项置灰. */
    active?: boolean;
    /** 该 Tab 是否有未阅 agent 状态点. 未读优先于手动收起 (见 isTabHiddenFromBar) → 菜单项置灰. */
    hasUnreadDot?: boolean;
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
    // 激活 Tab / 有未阅点的 Tab 收起会被 isTabHiddenFromBar 的优先级覆盖 (点了也不生效), 故置灰.
    const collapseDisabledHint =
        visibility?.active === true
            ? i18n.t("tab:contextMenu.collapseToMoreActiveDisabled")
            : visibility?.hasUnreadDot === true
              ? i18n.t("tab:contextMenu.collapseToMoreUnreadDisabled")
              : null;
    menu.push({
        label: i18n.t("tab:contextMenu.collapseToMore"),
        enabled: collapseDisabledHint == null,
        sublabel: collapseDisabledHint ?? undefined,
        click: () => {
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
