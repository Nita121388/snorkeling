// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { i18n } from "@/i18n/config";
import { getOrefMetaKeyAtom, globalStore, recordTEvent } from "@/app/store/global";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { fireAndForget } from "@/util/util";
import { makeORef } from "../store/wos";
import type { TabEnv } from "./tab";

const TabReturnWorkspaceIdMetaKey = "tab:returnworkspaceid";

const FlagColors = [
    { labelKey: "tab:flagColor.green", value: "#58C142" },
    { labelKey: "tab:flagColor.teal", value: "#00FFDB" },
    { labelKey: "tab:flagColor.blue", value: "#429DFF" },
    { labelKey: "tab:flagColor.purple", value: "#BF55EC" },
    { labelKey: "tab:flagColor.red", value: "#FF453A" },
    { labelKey: "tab:flagColor.orange", value: "#FF9500" },
    { labelKey: "tab:flagColor.yellow", value: "#FFE900" },
] as const;

export function buildTabBarContextMenu(env: TabEnv): ContextMenuItem[] {
    const currentTabBar = globalStore.get(env.getSettingsKeyAtom("app:tabbar")) ?? "top";
    const tabBarSubmenu: ContextMenuItem[] = [
        {
            label: i18n.t("tab:tabBar.top"),
            type: "checkbox",
            checked: currentTabBar === "top",
            click: () => fireAndForget(() => env.rpc.SetConfigCommand(TabRpcClient, { "app:tabbar": "top" })),
        },
        {
            label: i18n.t("tab:tabBar.left"),
            type: "checkbox",
            checked: currentTabBar === "left",
            click: () => fireAndForget(() => env.rpc.SetConfigCommand(TabRpcClient, { "app:tabbar": "left" })),
        },
    ];
    return [{ label: i18n.t("tab:tabBar.position"), type: "submenu", submenu: tabBarSubmenu }];
}

export function buildTabContextMenu(
    id: string,
    renameRef: React.RefObject<(() => void) | null>,
    onClose: (event: React.MouseEvent<HTMLButtonElement, MouseEvent> | null) => void,
    env: TabEnv
): ContextMenuItem[] {
    const menu: ContextMenuItem[] = [];
    menu.push(
        { label: i18n.t("tab:tab.rename"), click: () => renameRef.current?.() },
        {
            label: i18n.t("tab:tab.copyTabId"),
            click: () => fireAndForget(() => navigator.clipboard.writeText(id)),
        },
        { type: "separator" }
    );
    const tabORef = makeORef("tab", id);
    const returnWorkspaceId = globalStore.get(getOrefMetaKeyAtom(tabORef, TabReturnWorkspaceIdMetaKey)) ?? null;
    const currentFlagColor = globalStore.get(getOrefMetaKeyAtom(tabORef, "tab:flagcolor")) ?? null;
    const flagSubmenu: ContextMenuItem[] = [
        {
            label: i18n.t("tab:tab.flagNone"),
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
    menu.push({ label: i18n.t("tab:tab.flagTab"), type: "submenu", submenu: flagSubmenu }, { type: "separator" });
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
            label: i18n.t("tab:tab.backgroundDefault"),
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
        menu.push({ label: i18n.t("tab:tab.backgrounds"), type: "submenu", submenu }, { type: "separator" });
    }
    menu.push(...buildTabBarContextMenu(env), { type: "separator" });
    menu.push({
        label: i18n.t("tab:tab.moveToNewWindow"),
        click: () =>
            fireAndForget(async () => {
                await env.electron.moveTabToNewWindow(id);
            }),
    });
    if (returnWorkspaceId != null && returnWorkspaceId !== "") {
        menu.push({
            label: i18n.t("tab:tab.moveTabBack"),
            click: () =>
                fireAndForget(async () => {
                    await env.electron.moveTabBack(id);
                }),
        });
    }
    menu.push({ type: "separator" });
    menu.push({ label: i18n.t("tab:tab.closeTab"), click: () => onClose(null) });
    return menu;
}
