// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { waveEventSubscribeSingle } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import * as electron from "electron";
import { fireAndForget } from "../frontend/util/util";
import { focusedBuilderWindow, getBuilderWindowById } from "./emain-builder";
import { tmew } from "./emain-i18n";
import { openBuilderWindow } from "./emain-ipc";
import { isDev, unamePlatform } from "./emain-platform";
import { clearTabCache } from "./emain-tabview";
import { decreaseZoomLevel, increaseZoomLevel, resetZoomLevel } from "./emain-util";
import {
    createNewWaveWindow,
    createWorkspace,
    focusedWaveWindow,
    getAllWaveWindows,
    getWaveWindowByWorkspaceId,
    moveWaveWindowToRelativeDisplay,
    relaunchBrowserWindows,
    WaveBrowserWindow,
} from "./emain-window";
import { ElectronWshClient } from "./emain-wsh";
import { updater } from "./updater";

type AppMenuCallbacks = {
    createNewWaveWindow: () => Promise<void>;
    relaunchBrowserWindows: () => Promise<void>;
};

function getWindowWebContents(window: electron.BaseWindow): electron.WebContents {
    if (window == null) {
        return null;
    }
    // Check BrowserWindow first (for Tsunami Builder windows)
    if (window instanceof electron.BrowserWindow) {
        return window.webContents;
    }
    // Check WaveBrowserWindow (for main Wave windows with tab views)
    if (window instanceof WaveBrowserWindow) {
        if (window.activeTabView) {
            return window.activeTabView.webContents;
        }
        return null;
    }
    return null;
}

async function getWorkspaceMenu(ww?: WaveBrowserWindow): Promise<Electron.MenuItemConstructorOptions[]> {
    const workspaceList = await RpcApi.WorkspaceListCommand(ElectronWshClient);
    const workspaceMenu: Electron.MenuItemConstructorOptions[] = [
        {
            label: tmew("common:menu.workspace.createWorkspace"),
            click: (_, window) => fireAndForget(() => createWorkspace((window as WaveBrowserWindow) ?? ww)),
        },
    ];
    function getWorkspaceSwitchAccelerator(i: number): string {
        if (i < 9) {
            return unamePlatform == "darwin" ? `Command+Control+${i + 1}` : `Alt+Control+${i + 1}`;
        }
    }
    if (workspaceList?.length) {
        workspaceMenu.push(
            { type: "separator" },
            ...workspaceList.map<Electron.MenuItemConstructorOptions>((workspace, i) => {
                return {
                    label: `${workspace.workspacedata.name}`,
                    click: (_, window) => {
                        ((window as WaveBrowserWindow) ?? ww)?.switchWorkspace(workspace.workspacedata.oid);
                    },
                    accelerator: getWorkspaceSwitchAccelerator(i),
                };
            })
        );
    }
    return workspaceMenu;
}

function makeEditMenu(fullConfig?: FullConfigType): Electron.MenuItemConstructorOptions[] {
    let pasteAccelerator: string;
    if (unamePlatform === "darwin") {
        pasteAccelerator = "Command+V";
    } else {
        const ctrlVPaste = fullConfig?.settings?.["app:ctrlvpaste"];
        if (ctrlVPaste == null) {
            pasteAccelerator = unamePlatform === "win32" ? "Control+V" : "";
        } else if (ctrlVPaste) {
            pasteAccelerator = "Control+V";
        } else {
            pasteAccelerator = "";
        }
    }
    return [
        {
            role: "undo",
            accelerator: unamePlatform === "darwin" ? "Command+Z" : "",
        },
        {
            role: "redo",
            accelerator: unamePlatform === "darwin" ? "Command+Shift+Z" : "",
        },
        { type: "separator" },
        {
            role: "cut",
            accelerator: unamePlatform === "darwin" ? "Command+X" : "",
        },
        {
            role: "copy",
            accelerator: unamePlatform === "darwin" ? "Command+C" : "",
        },
        {
            role: "paste",
            accelerator: pasteAccelerator,
        },
        {
            role: "pasteAndMatchStyle",
            accelerator: unamePlatform === "darwin" ? "Command+Shift+V" : "",
        },
        {
            role: "delete",
        },
        {
            role: "selectAll",
            accelerator: unamePlatform === "darwin" ? "Command+A" : "",
        },
    ];
}

function makeFileMenu(
    numWaveWindows: number,
    callbacks: AppMenuCallbacks,
    fullConfig: FullConfigType
): Electron.MenuItemConstructorOptions[] {
    const fileMenu: Electron.MenuItemConstructorOptions[] = [
        {
            label: tmew("common:menu.file.newWindow"),
            accelerator: "CommandOrControl+Shift+N",
            click: () => fireAndForget(callbacks.createNewWaveWindow),
        },
        {
            role: "close",
            accelerator: "",
            click: () => {
                focusedWaveWindow?.close();
            },
        },
    ];
    const featureWaveAppBuilder = fullConfig?.settings?.["feature:waveappbuilder"];
    if (isDev || featureWaveAppBuilder) {
        fileMenu.splice(1, 0, {
            label: tmew("common:menu.file.newBuilderWindow"),
            accelerator: unamePlatform === "darwin" ? "Command+Shift+B" : "Alt+Shift+B",
            click: () => openBuilderWindow(""),
        });
    }
    if (numWaveWindows == 0) {
        fileMenu.push({
            // Hidden accelerator-only item: reuses the visible "New Window" label.
            label: tmew("common:menu.file.newWindow"),
            accelerator: unamePlatform === "darwin" ? "Command+N" : "Alt+N",
            acceleratorWorksWhenHidden: true,
            visible: false,
            click: () => fireAndForget(callbacks.createNewWaveWindow),
        });
        fileMenu.push({
            // Hidden accelerator-only item: reuses the visible "New Window" label.
            label: tmew("common:menu.file.newWindow"),
            accelerator: unamePlatform === "darwin" ? "Command+T" : "Alt+T",
            acceleratorWorksWhenHidden: true,
            visible: false,
            click: () => fireAndForget(callbacks.createNewWaveWindow),
        });
    }
    return fileMenu;
}

function getLoginItemSettings(): Electron.LoginItemSettings {
    if (unamePlatform === "win32") {
        return electron.app.getLoginItemSettings({
            path: electron.app.getPath("exe"),
        });
    }
    return electron.app.getLoginItemSettings();
}

function setLaunchAtLogin(openAtLogin: boolean) {
    if (unamePlatform === "win32") {
        electron.app.setLoginItemSettings({
            openAtLogin,
            enabled: openAtLogin,
            path: electron.app.getPath("exe"),
            name: electron.app.name,
        });
        return;
    }
    electron.app.setLoginItemSettings({
        openAtLogin,
    });
}

function makeAppMenuItems(webContents: electron.WebContents): Electron.MenuItemConstructorOptions[] {
    const launchAtLogin = getLoginItemSettings().openAtLogin;
    const appMenuItems: Electron.MenuItemConstructorOptions[] = [
        {
            label: tmew("common:menu.app.about"),
            click: (_, window) => {
                (getWindowWebContents(window) ?? webContents)?.send("menu-item-about");
            },
        },
        {
            label: tmew("common:menu.app.checkForUpdates"),
            click: () => {
                fireAndForget(() => updater?.checkForUpdates(true));
            },
        },
        {
            label: tmew("common:menu.app.launchAtLogin"),
            type: "checkbox",
            checked: launchAtLogin,
            click: (menuItem) => {
                setLaunchAtLogin(menuItem.checked);
                makeAndSetAppMenu();
            },
        },
        { type: "separator" },
    ];
    if (unamePlatform === "darwin") {
        appMenuItems.push(
            { role: "services" },
            { type: "separator" },
            { role: "hide" },
            { role: "hideOthers" },
            { type: "separator" }
        );
    }
    appMenuItems.push({ role: "quit" });
    return appMenuItems;
}

function makeViewMenu(
    webContents: electron.WebContents,
    callbacks: AppMenuCallbacks,
    isBuilderWindowFocused: boolean,
    fullscreenOnLaunch: boolean
): Electron.MenuItemConstructorOptions[] {
    const devToolsAccel = unamePlatform === "darwin" ? "Option+Command+I" : "Alt+Shift+I";
    return [
        {
            label: isBuilderWindowFocused ? tmew("common:menu.view.reloadWindow") : tmew("common:menu.view.reloadTab"),
            accelerator: "Shift+CommandOrControl+R",
            click: (_, window) => {
                (getWindowWebContents(window) ?? webContents)?.reloadIgnoringCache();
            },
        },
        {
            label: tmew("common:menu.view.relaunchAllWindows"),
            click: () => callbacks.relaunchBrowserWindows(),
        },
        {
            label: tmew("common:menu.view.clearTabCache"),
            click: () => clearTabCache(),
        },
        {
            label: tmew("common:menu.view.toggleDevTools"),
            accelerator: devToolsAccel,
            click: (_, window) => {
                const wc = getWindowWebContents(window) ?? webContents;
                wc?.toggleDevTools();
            },
        },
        { type: "separator" },
        {
            label: tmew("common:menu.view.resetZoom"),
            accelerator: "CommandOrControl+0",
            click: (_, window) => {
                const wc = getWindowWebContents(window) ?? webContents;
                if (wc) {
                    resetZoomLevel(wc);
                }
            },
        },
        {
            label: tmew("common:menu.view.zoomIn"),
            accelerator: "CommandOrControl+=",
            click: (_, window) => {
                const wc = getWindowWebContents(window) ?? webContents;
                if (wc) {
                    increaseZoomLevel(wc);
                }
            },
        },
        {
            // Hidden accelerator-only item (Shift+= is not reachable from a menu bar).
            label: tmew("common:menu.view.zoomIn"),
            accelerator: "CommandOrControl+Shift+=",
            click: (_, window) => {
                const wc = getWindowWebContents(window) ?? webContents;
                if (wc) {
                    increaseZoomLevel(wc);
                }
            },
            visible: false,
            acceleratorWorksWhenHidden: true,
        },
        {
            label: tmew("common:menu.view.zoomOut"),
            accelerator: "CommandOrControl+-",
            click: (_, window) => {
                const wc = getWindowWebContents(window) ?? webContents;
                if (wc) {
                    decreaseZoomLevel(wc);
                }
            },
        },
        {
            // Hidden accelerator-only item (Shift+- is not reachable from a menu bar).
            label: tmew("common:menu.view.zoomOut"),
            accelerator: "CommandOrControl+Shift+-",
            click: (_, window) => {
                const wc = getWindowWebContents(window) ?? webContents;
                if (wc) {
                    decreaseZoomLevel(wc);
                }
            },
            visible: false,
            acceleratorWorksWhenHidden: true,
        },
        {
            label: tmew("common:menu.view.launchOnFullScreen"),
            submenu: [
                {
                    label: tmew("common:menu.view.on"),
                    type: "radio",
                    checked: fullscreenOnLaunch,
                    click: () => {
                        RpcApi.SetConfigCommand(ElectronWshClient, { "window:fullscreenonlaunch": true });
                    },
                },
                {
                    label: tmew("common:menu.view.off"),
                    type: "radio",
                    checked: !fullscreenOnLaunch,
                    click: () => {
                        RpcApi.SetConfigCommand(ElectronWshClient, { "window:fullscreenonlaunch": false });
                    },
                },
            ],
        },
        { type: "separator" },
        {
            role: "togglefullscreen",
        },
        { type: "separator" },
        {
            label: tmew("common:menu.view.toggleWidgetsBar"),
            click: () => {
                fireAndForget(async () => {
                    const workspaceId = focusedWaveWindow?.workspaceId;
                    if (!workspaceId) return;
                    const oref = `workspace:${workspaceId}`;
                    const meta = await RpcApi.GetMetaCommand(ElectronWshClient, { oref });
                    const current = meta?.["layout:widgetsvisible"] ?? true;
                    await RpcApi.SetMetaCommand(ElectronWshClient, { oref, meta: { "layout:widgetsvisible": !current } });
                });
            },
        },
    ];
}

async function makeFullAppMenu(callbacks: AppMenuCallbacks, workspaceOrBuilderId?: string): Promise<Electron.Menu> {
    const numWaveWindows = getAllWaveWindows().length;
    const webContents = workspaceOrBuilderId && getWebContentsByWorkspaceOrBuilderId(workspaceOrBuilderId);
    const appMenuItems = makeAppMenuItems(webContents);

    const isBuilderWindowFocused = focusedBuilderWindow != null;
    let fullscreenOnLaunch = false;
    let fullConfig: FullConfigType = null;
    try {
        fullConfig = await RpcApi.GetFullConfigCommand(ElectronWshClient);
        fullscreenOnLaunch = fullConfig?.settings["window:fullscreenonlaunch"];
    } catch (e) {
        console.error("Error fetching config:", e);
    }
    const editMenu = makeEditMenu(fullConfig);
    const fileMenu = makeFileMenu(numWaveWindows, callbacks, fullConfig);
    const viewMenu = makeViewMenu(webContents, callbacks, isBuilderWindowFocused, fullscreenOnLaunch);
    let workspaceMenu: Electron.MenuItemConstructorOptions[] = null;
    try {
        workspaceMenu = await getWorkspaceMenu();
    } catch (e) {
        console.error("getWorkspaceMenu error:", e);
    }
    const windowMenu: Electron.MenuItemConstructorOptions[] = [
        { role: "minimize", accelerator: "" },
        { role: "zoom" },
        { type: "separator" },
        {
            label: tmew("common:menu.window.moveToNextDisplay"),
            accelerator: "CmdOrControl+Alt+Right",
            click: () => {
                const ww = focusedWaveWindow ?? getAllWaveWindows()[0];
                moveWaveWindowToRelativeDisplay(ww, 1);
            },
        },
        {
            label: tmew("common:menu.window.moveToPreviousDisplay"),
            accelerator: "CmdOrControl+Alt+Left",
            click: () => {
                const ww = focusedWaveWindow ?? getAllWaveWindows()[0];
                moveWaveWindowToRelativeDisplay(ww, -1);
            },
        },
        { type: "separator" },
        { role: "front" },
    ];
    const menuTemplate: Electron.MenuItemConstructorOptions[] = [
        { role: "appMenu", submenu: appMenuItems },
        { role: "fileMenu", submenu: fileMenu },
        { role: "editMenu", submenu: editMenu },
        { role: "viewMenu", submenu: viewMenu },
    ];
    if (workspaceMenu != null && !isBuilderWindowFocused) {
        menuTemplate.push({
            label: tmew("common:menu.workspace.label"),
            id: "workspace-menu",
            submenu: workspaceMenu,
        });
    }
    menuTemplate.push({
        role: "windowMenu",
        submenu: windowMenu,
    });
    return electron.Menu.buildFromTemplate(menuTemplate);
}

export function instantiateAppMenu(workspaceOrBuilderId?: string): Promise<electron.Menu> {
    return makeFullAppMenu(
        {
            createNewWaveWindow,
            relaunchBrowserWindows,
        },
        workspaceOrBuilderId
    );
}

// does not a set a menu on windows
export function makeAndSetAppMenu() {
    if (unamePlatform === "win32") {
        return;
    }
    fireAndForget(async () => {
        const menu = await instantiateAppMenu();
        electron.Menu.setApplicationMenu(menu);
    });
}

function initMenuEventSubscriptions() {
    waveEventSubscribeSingle({
        eventType: "workspace:update",
        handler: makeAndSetAppMenu,
    });
}

function getWebContentsByWorkspaceOrBuilderId(workspaceOrBuilderId: string): electron.WebContents {
    const ww = getWaveWindowByWorkspaceId(workspaceOrBuilderId);
    if (ww) {
        return ww.activeTabView?.webContents;
    }

    const bw = getBuilderWindowById(workspaceOrBuilderId);
    if (bw) {
        return bw.webContents;
    }

    return null;
}

function convertMenuDefArrToMenu(
    webContents: electron.WebContents,
    menuDefArr: ElectronContextMenuItem[],
    menuState: { hasClick: boolean }
): electron.Menu {
    const menuItems: electron.MenuItem[] = [];
    for (const menuDef of menuDefArr) {
        const menuItemTemplate: electron.MenuItemConstructorOptions = {
            role: menuDef.role as any,
            label: menuDef.label,
            type: menuDef.type,
            click: () => {
                menuState.hasClick = true;
                webContents.send("contextmenu-click", menuDef.id);
            },
            checked: menuDef.checked,
            enabled: menuDef.enabled,
        };
        if (menuDef.submenu != null) {
            menuItemTemplate.submenu = convertMenuDefArrToMenu(webContents, menuDef.submenu, menuState);
        }
        const menuItem = new electron.MenuItem(menuItemTemplate);
        menuItems.push(menuItem);
    }
    return electron.Menu.buildFromTemplate(menuItems);
}

electron.ipcMain.on(
    "contextmenu-show",
    (event, workspaceOrBuilderId: string, menuDefArr: ElectronContextMenuItem[]) => {
        const webContents = getWebContentsByWorkspaceOrBuilderId(workspaceOrBuilderId);
        if (!webContents) {
            console.error("invalid window for context menu:", workspaceOrBuilderId);
            event.returnValue = true;
            return;
        }
        if (menuDefArr.length === 0) {
            webContents.send("contextmenu-click", null);
            event.returnValue = true;
            return;
        }
        fireAndForget(async () => {
            const menuState = { hasClick: false };
            const menu = convertMenuDefArrToMenu(webContents, menuDefArr, menuState);
            menu.popup({
                callback: () => {
                    if (!menuState.hasClick) {
                        webContents.send("contextmenu-click", null);
                    }
                },
            });
        });
        event.returnValue = true;
    }
);

electron.ipcMain.on("workspace-appmenu-show", (event, workspaceId: string) => {
    fireAndForget(async () => {
        const webContents = getWebContentsByWorkspaceOrBuilderId(workspaceId);
        if (!webContents) {
            console.error("invalid window for workspace app menu:", workspaceId);
            return;
        }
        const menu = await instantiateAppMenu(workspaceId);
        menu.popup();
    });
    event.returnValue = true;
});

electron.ipcMain.on("builder-appmenu-show", (event, builderId: string) => {
    fireAndForget(async () => {
        const webContents = getWebContentsByWorkspaceOrBuilderId(builderId);
        if (!webContents) {
            console.error("invalid window for builder app menu:", builderId);
            return;
        }
        const menu = await instantiateAppMenu(builderId);
        menu.popup();
    });
    event.returnValue = true;
});

// Built lazily on every call: the dock label must use the *current* locale, and a
// module-level template would evaluate tmew() before initI18nMain() has run (throw)
// and then stay frozen after a locale switch.
function makeDockMenu(): electron.Menu {
    return electron.Menu.buildFromTemplate([
        {
            label: tmew("common:menu.file.newWindow"),
            click() {
                fireAndForget(createNewWaveWindow);
            },
        },
    ]);
}

function makeDockTaskbar() {
    if (unamePlatform == "darwin") {
        electron.app.dock.setMenu(makeDockMenu());
    }
}

export { initMenuEventSubscriptions, makeDockTaskbar };
