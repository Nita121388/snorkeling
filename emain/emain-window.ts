// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ClientService, ObjectService, WindowService, WorkspaceService } from "@/app/store/services";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { fireAndForget } from "@/util/util";
import { BaseWindow, BaseWindowConstructorOptions, dialog, globalShortcut, ipcMain, screen } from "electron";
import { globalEvents } from "emain/emain-events";
import path from "path";
import { debounce } from "throttle-debounce";
import {
    getGlobalIsQuitting,
    getGlobalIsRelaunching,
    setGlobalIsRelaunching,
    setWasActive,
    setWasInFg,
} from "./emain-activity";
import { tmew } from "./emain-i18n";
import { log } from "./emain-log";
import { getElectronAppBasePath, isDev, unamePlatform } from "./emain-platform";
import { getOrCreateWebViewForTab, getWaveTabViewByWebContentsId, WaveTabView } from "./emain-tabview";
import { delay, ensureBoundsAreVisible, waveKeyToElectronKey } from "./emain-util";
import { ElectronWshClient } from "./emain-wsh";
import { createTabCollapseFileStore, TabCollapseStore } from "./tab-collapse-store";
import { updater } from "./updater";

const DevInitTimeoutMs = 120000;

export type WindowOpts = {
    unamePlatform: NodeJS.Platform;
    isPrimaryStartupWindow?: boolean;
    foregroundWindow?: boolean;
};

export const MinWindowWidth = 800;
export const MinWindowHeight = 500;
const openedThisLaunchTabIds = new Set<string>();

export function getOpenedThisLaunchTabIds(): string[] {
    return Array.from(openedThisLaunchTabIds);
}

/**
 * 用户手动「收起到更多」的 Tab 集合（真源在主进程）。
 *
 * 必须放在主进程而不是 renderer: 每个 Tab 是独立 WebContentsView / renderer，Tab 栏在各
 * renderer 各渲染一份，renderer 本地的集合互不相通 —— 结果就是「在当前 Tab 收起，切到别的
 * Tab 又冒出来」。这里比照 openedThisLaunchTabIds 走 IPC + 广播，所有 Tab 栏视图口径一致。
 *
 * 语义: **跨重启保留**（用户主动收起是一个持久偏好），与 openedThisLaunchTabIds 不同。
 * 落盘由 `initCollapsedTabIdsStore` 注入的文件 store 负责，任何变更都写穿一次；
 * 启动时先读回，再在首个 Tab renderer 初始化前即可被同步 IPC 读到。
 */
const collapsedTabIds = new Set<string>();

let collapsedTabStore: TabCollapseStore | null = null;

/**
 * 启动时注入落盘路径并读回已有收起集合（必须在创建任何窗口之前调用）。
 *
 * 文件缺失/损坏时退化为空集合（见 tab-collapse-store.ts），不影响启动。
 * 重复调用会先清空内存集合再重新读取 —— 便于测试与热重载。
 */
export function initCollapsedTabIdsStore(filePath: string): void {
    collapsedTabStore = createTabCollapseFileStore(filePath);
    collapsedTabIds.clear();
    for (const tabId of collapsedTabStore.read()) {
        collapsedTabIds.add(tabId);
    }
}

function persistCollapsedTabIds(): void {
    collapsedTabStore?.write(getCollapsedTabIds());
}

export function getCollapsedTabIds(): string[] {
    return Array.from(collapsedTabIds);
}

/**
 * 启动/开窗恢复：把 workspace 里已存在的 Tab 全部标记为「本次启动已打开」。
 *
 * 必须在首个 Tab renderer 初始化之前调用 —— renderer 通过同步 IPC
 * (`getOpenedThisLaunchTabIds`) 在 atom 创建时读集合；若不提前标记，重启后
 * `openedThisLaunchTabIds` 只含激活 Tab，渲染层会把其余全部藏进「更多」且灰化。
 * 悬空 id / 会话概览 tab 被标记无副作用（仅进 Set）。
 */
export function markRestoredWorkspaceTabsOpened(tabIds: readonly string[] | null | undefined): void {
    if (tabIds == null) {
        return;
    }
    for (const tabId of tabIds) {
        markTabOpenedThisLaunch(tabId);
    }
}

function broadcastOpenedThisLaunchTabIds() {
    const tabIds = getOpenedThisLaunchTabIds();
    for (const waveWindow of waveWindowMap.values()) {
        for (const tabView of waveWindow.allLoadedTabViews.values()) {
            if (!tabView.webContents.isDestroyed()) {
                tabView.webContents.send("opened-this-launch-tab-ids-change", tabIds);
            }
        }
    }
}

function broadcastCollapsedTabIds() {
    const tabIds = getCollapsedTabIds();
    for (const waveWindow of waveWindowMap.values()) {
        for (const tabView of waveWindow.allLoadedTabViews.values()) {
            if (!tabView.webContents.isDestroyed()) {
                tabView.webContents.send("collapsed-tab-ids-change", tabIds);
            }
        }
    }
}

/** 收起一批 Tab（幂等；无实际变更不广播）。 */
export function collapseTabIdsMain(tabIds: readonly string[] | null | undefined): void {
    if (tabIds == null || tabIds.length === 0) {
        return;
    }
    let changed = false;
    for (const tabId of tabIds) {
        if (!tabId || collapsedTabIds.has(tabId)) {
            continue;
        }
        collapsedTabIds.add(tabId);
        changed = true;
    }
    if (changed) {
        broadcastCollapsedTabIds();
        persistCollapsedTabIds();
    }
}

/** 展开单个被收起的 Tab（例如从「更多」下拉点开）。 */
export function expandCollapsedTabIdMain(tabId: string): void {
    if (!tabId || !collapsedTabIds.has(tabId)) {
        return;
    }
    collapsedTabIds.delete(tabId);
    broadcastCollapsedTabIds();
    persistCollapsedTabIds();
}

/** 清空全部收起状态。 */
export function clearCollapsedTabIdsMain(): void {
    if (collapsedTabIds.size === 0) {
        return;
    }
    collapsedTabIds.clear();
    broadcastCollapsedTabIds();
    persistCollapsedTabIds();
}

/**
 * 标记「本次启动已打开过」。
 *
 * **不再**在此解除收起状态：启动还原路径（markRestoredWorkspaceTabsOpened）会对 workspace
 * 里全部 Tab 调到这里，如果仍在这里清收起集合，落盘的收起选择一启动就被抹掉。
 * 「真正被打开即解除收起」由 renderer 侧 tab-open-state.ts 的 markTabOpenedThisLaunch
 * 显式调用 expandCollapsedTabId 完成（点 Tab / 从「更多」点开都会走到）。
 */
function markTabOpenedThisLaunch(tabId: string): boolean {
    if (!tabId) {
        return false;
    }
    let changed = false;
    if (!openedThisLaunchTabIds.has(tabId)) {
        openedThisLaunchTabIds.add(tabId);
        broadcastOpenedThisLaunchTabIds();
        changed = true;
    }
    return changed;
}

/**
 * 窗口回焦时是否该给当前 Tab 视图补 webContents focus（纯函数，便于单测）。
 *
 * 不补的三种情况：窗口已销毁 / 正在 relaunch（此时视图在重建，抢焦点会打架）/
 * 当前视图本来就 focused（无谓补拍会抢走 DevTools、输入法候选窗等子视图的焦点）。
 */
export function shouldRefocusActiveView(opts: {
    windowDestroyed: boolean;
    relaunching: boolean;
    hasActiveView: boolean;
    activeIsFocused: boolean;
}): boolean {
    if (opts.windowDestroyed || opts.relaunching) return false;
    if (!opts.hasActiveView) return false;
    return !opts.activeIsFocused;
}

export function calculateWindowBounds(
    winSize?: { width?: number; height?: number },
    pos?: { x?: number; y?: number },
    settings?: any
): { x: number; y: number; width: number; height: number } {
    let winWidth = winSize?.width;
    let winHeight = winSize?.height;
    const winPosX = pos?.x ?? 100;
    const winPosY = pos?.y ?? 100;

    if (
        (winWidth == null || winWidth === 0 || winHeight == null || winHeight === 0) &&
        settings?.["window:dimensions"]
    ) {
        const dimensions = settings["window:dimensions"];
        const match = dimensions.match(/^(\d+)[xX](\d+)$/);

        if (match) {
            const [, dimensionWidth, dimensionHeight] = match;
            const parsedWidth = parseInt(dimensionWidth, 10);
            const parsedHeight = parseInt(dimensionHeight, 10);

            if ((!winWidth || winWidth === 0) && Number.isFinite(parsedWidth) && parsedWidth > 0) {
                winWidth = parsedWidth;
            }
            if ((!winHeight || winHeight === 0) && Number.isFinite(parsedHeight) && parsedHeight > 0) {
                winHeight = parsedHeight;
            }
        } else {
            console.warn('Invalid window:dimensions format. Expected "widthxheight".');
        }
    }

    if (winWidth == null || winWidth == 0) {
        const primaryDisplay = screen.getPrimaryDisplay();
        const { width } = primaryDisplay.workAreaSize;
        winWidth = width - winPosX - 100;
        if (winWidth > 2000) {
            winWidth = 2000;
        }
    }
    if (winHeight == null || winHeight == 0) {
        const primaryDisplay = screen.getPrimaryDisplay();
        const { height } = primaryDisplay.workAreaSize;
        winHeight = height - winPosY - 100;
        if (winHeight > 1200) {
            winHeight = 1200;
        }
    }

    winWidth = Math.max(winWidth, MinWindowWidth);
    winHeight = Math.max(winHeight, MinWindowHeight);

    const winBounds = {
        x: winPosX,
        y: winPosY,
        width: winWidth,
        height: winHeight,
    };
    return ensureBoundsAreVisible(winBounds);
}

export const waveWindowMap = new Map<string, WaveBrowserWindow>(); // waveWindowId -> WaveBrowserWindow

// on blur we do not set this to null (but on destroy we do), so this tracks the *last* focused window
// e.g. it persists when the app itself is not focused
export let focusedWaveWindow: WaveBrowserWindow = null;

// quake window for toggle hotkey (show/hide behavior)
let quakeWindow: WaveBrowserWindow | null = null;

export function getQuakeWindow(): WaveBrowserWindow | null {
    return quakeWindow;
}

let cachedClientId: string = null;
let hasCompletedFirstRelaunch = false;

async function getClientId() {
    if (cachedClientId != null) {
        return cachedClientId;
    }
    const clientData = await ClientService.GetClientData();
    cachedClientId = clientData?.oid;
    return cachedClientId;
}

// W2-1（性能，启动去重）：GetFullConfigCommand 在启动路径上被主进程连发 ——
// 主启动（emain.ts）+ relaunchBrowserWindows + 每个新 Tab 的
// getOrCreateWebViewForTab + configureAutoUpdater，同一次启动里全是同一份配置。
// 这里做一次带 TTL 的主进程缓存：新窗口/新 Tab 优先复用启动期取回的 fullConfig，
// TTL 过期才回源（settings 变更的完整失效跟随现有重启/relaunch 流程，另造第二套
// 失效机制反而不可靠）。
const FullConfigCacheTtlMs = 30_000;

let cachedFullConfig: FullConfigType | null = null;
let cachedFullConfigTs = 0;

export function primeFullConfigCache(fullConfig: FullConfigType): void {
    cachedFullConfig = fullConfig;
    cachedFullConfigTs = Date.now();
}

export async function getFullConfigCached(): Promise<FullConfigType> {
    if (cachedFullConfig != null && Date.now() - cachedFullConfigTs < FullConfigCacheTtlMs) {
        return cachedFullConfig;
    }
    const fullConfig = await RpcApi.GetFullConfigCommand(ElectronWshClient);
    primeFullConfigCache(fullConfig);
    return fullConfig;
}

type WindowActionQueueEntry =
    | {
          op: "switchtab";
          tabId: string;
          setInBackend: boolean;
          primaryStartupTab?: boolean;
      }
    | {
          op: "createtab";
      }
    | {
          op: "closetab";
          tabId: string;
      }
    | {
          op: "switchworkspace";
          workspaceId: string;
      };

function isNonEmptyUnsavedWorkspace(workspace: Workspace): boolean {
    return !workspace.name && !workspace.icon && workspace.tabids?.length > 1;
}

export class WaveBrowserWindow extends BaseWindow {
    waveWindowId: string;
    workspaceId: string;
    allLoadedTabViews: Map<string, WaveTabView>;
    activeTabView: WaveTabView;
    private canClose: boolean;
    private deleteAllowed: boolean;
    private actionQueue: WindowActionQueueEntry[];

    constructor(waveWindow: WaveWindow, fullConfig: FullConfigType, opts: WindowOpts) {
        const settings = fullConfig?.settings;

        console.log("create win", waveWindow.oid);
        const winBounds = calculateWindowBounds(waveWindow.winsize, waveWindow.pos, settings);
        const winOpts: BaseWindowConstructorOptions = {
            x: winBounds.x,
            y: winBounds.y,
            width: winBounds.width,
            height: winBounds.height,
            minWidth: MinWindowWidth,
            minHeight: MinWindowHeight,
            show: false,
        };

        const isTransparent = settings?.["window:transparent"] ?? false;
        const isBlur = !isTransparent && (settings?.["window:blur"] ?? false);

        if (opts.unamePlatform === "darwin") {
            winOpts.titleBarStyle = "hiddenInset";
            winOpts.titleBarOverlay = false;
            winOpts.autoHideMenuBar = !settings?.["window:showmenubar"];
            winOpts.acceptFirstMouse = true;
            if (isTransparent) {
                winOpts.transparent = true;
            } else if (isBlur) {
                winOpts.vibrancy = "fullscreen-ui";
            } else {
                winOpts.backgroundColor = "#222222";
            }
        } else if (opts.unamePlatform === "linux") {
            winOpts.titleBarStyle = settings["window:nativetitlebar"] ? "default" : "hidden";
            winOpts.titleBarOverlay = {
                symbolColor: "white",
                color: "#00000000",
            };
            winOpts.icon = path.join(getElectronAppBasePath(), "public/logos/snorkeling-logo-dark.png");
            winOpts.autoHideMenuBar = !settings?.["window:showmenubar"];
            if (isTransparent) {
                winOpts.transparent = true;
            } else {
                winOpts.backgroundColor = "#222222";
            }
        } else if (opts.unamePlatform === "win32") {
            winOpts.titleBarStyle = "hidden";
            winOpts.titleBarOverlay = {
                color: "#222222",
                symbolColor: "#c3c8c2",
                height: 32,
            };
            if (isTransparent) {
                winOpts.transparent = true;
            } else if (isBlur) {
                winOpts.backgroundMaterial = "acrylic";
            } else {
                winOpts.backgroundColor = "#222222";
            }
        }

        super(winOpts);

        if (opts.unamePlatform === "win32") {
            this.setMenu(null);
        }

        const fullscreenOnLaunch = fullConfig?.settings["window:fullscreenonlaunch"];
        if (fullscreenOnLaunch && opts.foregroundWindow) {
            this.once("show", () => {
                this.setFullScreen(true);
            });
        }
        this.actionQueue = [];
        this.waveWindowId = waveWindow.oid;
        this.workspaceId = waveWindow.workspaceid;
        this.allLoadedTabViews = new Map<string, WaveTabView>();
        const winBoundsPoller = setInterval(() => {
            if (this.isDestroyed()) {
                clearInterval(winBoundsPoller);
                return;
            }
            if (this.actionQueue.length > 0) {
                return;
            }
            this.finalizePositioning();
        }, 1000);
        this.on(
            // @ts-expect-error -- "resize" event with debounce handler not in Electron type definitions
            "resize",
            debounce(400, (e) => this.mainResizeHandler(e))
        );
        this.on("resize", () => {
            if (this.isDestroyed()) {
                return;
            }
            this.activeTabView?.positionTabOnScreen(this.getContentBounds());
        });
        this.on(
            // @ts-expect-error -- "move" event with debounce handler not in Electron type definitions
            "move",
            debounce(400, (e) => this.mainResizeHandler(e))
        );
        this.on("enter-full-screen", async () => {
            if (this.isDestroyed()) {
                return;
            }
            console.log("enter-full-screen event", this.getContentBounds());
            const tabView = this.activeTabView;
            if (tabView) {
                tabView.webContents.send("fullscreen-change", true);
            }
            this.activeTabView?.positionTabOnScreen(this.getContentBounds());
        });
        this.on("leave-full-screen", async () => {
            if (this.isDestroyed()) {
                return;
            }
            const tabView = this.activeTabView;
            if (tabView) {
                tabView.webContents.send("fullscreen-change", false);
            }
            this.activeTabView?.positionTabOnScreen(this.getContentBounds());
        });
        this.on("focus", () => {
            if (this.isDestroyed()) {
                return;
            }
            if (getGlobalIsRelaunching()) {
                return;
            }
            focusedWaveWindow = this; // eslint-disable-line @typescript-eslint/no-this-alias
            console.log("focus win", this.waveWindowId);
            fireAndForget(() => ClientService.FocusWindow(this.waveWindowId));
            setWasInFg(true);
            setWasActive(true);
            setTimeout(() => globalEvents.emit("windows-updated"), 50);
            // 窗口回焦后，活动 Tab 视图可能仍停在 webContents 失焦状态：DOM 的
            // activeElement 还显示在输入框上，但键入收不到（Electron WebContentsView 的
            // 已知抖动）。用户侧表现为"编辑时焦点没了、点也点不进去，切 Tab 再切回来才好"，
            // 因为只有切 Tab 会走 setActiveTab 的补 focus（任务 11-23-commontext-modal-focus）。
            if (
                shouldRefocusActiveView({
                    windowDestroyed: this.isDestroyed(),
                    relaunching: getGlobalIsRelaunching(),
                    hasActiveView: this.activeTabView != null,
                    activeIsFocused: this.activeTabView?.webContents?.isFocused() ?? false,
                })
            ) {
                this.refocusActiveTabWebContents();
            }
        });
        this.on("blur", () => {
            setTimeout(() => globalEvents.emit("windows-updated"), 50);
        });
        this.on("close", (e) => {
            if (this.canClose) {
                return;
            }
            if (this.isDestroyed()) {
                return;
            }
            console.log("win 'close' handler fired", this.waveWindowId);
            if (getGlobalIsQuitting() || updater?.status == "installing" || getGlobalIsRelaunching()) {
                return;
            }
            e.preventDefault();
            fireAndForget(async () => {
                const numWindows = waveWindowMap.size;
                const fullConfig = await RpcApi.GetFullConfigCommand(ElectronWshClient);
                if (numWindows > 1 || !fullConfig.settings["window:savelastwindow"]) {
                    if (fullConfig.settings["window:confirmclose"]) {
                        const workspace = await WorkspaceService.GetWorkspace(this.workspaceId);
                        if (isNonEmptyUnsavedWorkspace(workspace)) {
                            const choice = dialog.showMessageBoxSync(this, {
                                type: "question",
                                buttons: [
                                    tmew("common:common.cancel"),
                                    tmew("common:dialog.confirmCloseWindow.closeWindow"),
                                ],
                                title: tmew("common:dialog.confirm"),
                                message: tmew("common:dialog.confirmCloseWindow.message"),
                            });
                            if (choice === 0) {
                                return;
                            }
                        }
                    }
                    this.deleteAllowed = true;
                }
                this.canClose = true;
                this.close();
            });
        });
        this.on("closed", () => {
            console.log("win 'closed' handler fired", this.waveWindowId);
            if (getGlobalIsQuitting() || updater?.status == "installing") {
                console.log("win quitting or updating", this.waveWindowId);
                return;
            }
            setTimeout(() => globalEvents.emit("windows-updated"), 50);
            waveWindowMap.delete(this.waveWindowId);
            if (focusedWaveWindow == this) {
                focusedWaveWindow = null;
            }
            if (quakeWindow == this) {
                quakeWindow = null;
            }
            this.removeAllChildViews();
            if (getGlobalIsRelaunching()) {
                console.log("win relaunching", this.waveWindowId);
                this.destroy();
                return;
            }
            if (this.deleteAllowed) {
                console.log("win removing window from backend DB", this.waveWindowId);
                fireAndForget(() => WindowService.CloseWindow(this.waveWindowId, true));
            }
        });
        waveWindowMap.set(waveWindow.oid, this);
        setTimeout(() => globalEvents.emit("windows-updated"), 50);
    }

    private removeAllChildViews() {
        for (const tabView of this.allLoadedTabViews.values()) {
            if (!this.isDestroyed()) {
                this.contentView.removeChildView(tabView);
            }
            tabView?.destroy();
        }
    }

    async switchWorkspace(workspaceId: string) {
        console.log("switchWorkspace", workspaceId, this.waveWindowId);
        if (workspaceId == this.workspaceId) {
            console.log("switchWorkspace already on this workspace", this.waveWindowId);
            return;
        }

        // If the workspace is already owned by a window, then we can just call SwitchWorkspace without first prompting the user, since it'll just focus to the other window.
        const workspaceList = await WorkspaceService.ListWorkspaces();
        if (!workspaceList?.find((wse) => wse.workspaceid === workspaceId)?.windowid) {
            const curWorkspace = await WorkspaceService.GetWorkspace(this.workspaceId);

            if (curWorkspace && isNonEmptyUnsavedWorkspace(curWorkspace)) {
                console.log(
                    `existing unsaved workspace ${this.workspaceId} has content, opening workspace ${workspaceId} in new window`
                );
                await createWindowForWorkspace(workspaceId);
                return;
            }
        }
        await this._queueActionInternal({ op: "switchworkspace", workspaceId });
    }

    async setActiveTab(tabId: string, setInBackend: boolean, primaryStartupTab = false) {
        console.log(
            "setActiveTab",
            tabId,
            this.waveWindowId,
            this.workspaceId,
            setInBackend,
            primaryStartupTab ? "(primary startup)" : ""
        );
        await this._queueActionInternal({ op: "switchtab", tabId, setInBackend, primaryStartupTab });
    }

    private async initializeTab(tabView: WaveTabView, primaryStartupTab: boolean) {
        const clientId = await getClientId();
        await this.awaitWithDevTimeout(tabView.initPromise, "initPromise", tabView.waveTabId);
        const winBounds = this.getContentBounds();
        tabView.setBounds({ x: 0, y: 0, width: winBounds.width, height: winBounds.height });
        this.contentView.addChildView(tabView);
        const initOpts: WaveInitOpts = {
            tabId: tabView.waveTabId,
            clientId: clientId,
            windowId: this.waveWindowId,
            activate: true,
        };
        if (primaryStartupTab) {
            initOpts.primaryTabStartup = true;
        }
        tabView.savedInitOpts = { ...initOpts };
        tabView.savedInitOpts.activate = false;
        delete tabView.savedInitOpts.primaryTabStartup;
        const startTime = Date.now();
        console.log(
            "before wave ready, init tab, sending wave-init",
            tabView.waveTabId,
            primaryStartupTab ? "(primary startup)" : ""
        );
        tabView.webContents.send("wave-init", initOpts);
        await this.awaitWithDevTimeout(tabView.waveReadyPromise, "waveReadyPromise", tabView.waveTabId);
        // The fullscreen listener is registered during wave initialization. Sending
        // the event before wave-init/wave-ready can be lost for a newly created tab.
        tabView.webContents.send("fullscreen-change", this.isFullScreen());
        console.log("wave-ready init time", Date.now() - startTime + "ms");
    }

    private async awaitWithDevTimeout<T>(promise: Promise<T>, name: string, tabId: string): Promise<T> {
        if (!isDev) {
            return promise;
        }
        const timeoutHandle = setTimeout(() => {
            console.log(
                `[dev] ${name} timed out after ${DevInitTimeoutMs}ms for tab ${tabId}, showing window for devtools`
            );
            if (!this.isDestroyed() && !this.isVisible()) {
                this.show();
            }
            if (this.activeTabView?.webContents && !this.activeTabView.webContents.isDevToolsOpened()) {
                this.activeTabView.webContents.openDevTools();
            }
        }, DevInitTimeoutMs);
        try {
            return await promise;
        } finally {
            clearTimeout(timeoutHandle);
        }
    }

    private async setTabViewIntoWindow(tabView: WaveTabView, tabInitialized: boolean, primaryStartupTab = false) {
        if (this.activeTabView == tabView) {
            return;
        }
        markTabOpenedThisLaunch(tabView.waveTabId);
        const oldActiveView = this.activeTabView;
        tabView.isActiveTab = true;
        if (oldActiveView != null) {
            oldActiveView.isActiveTab = false;
        }
        this.activeTabView = tabView;
        this.allLoadedTabViews.set(tabView.waveTabId, tabView);
        // A tab view can be activated after the window entered fullscreen. Fullscreen
        // events are sent only to the active view, so synchronize the current window
        // state when switching to any tab view.
        tabView.webContents.send("fullscreen-change", this.isFullScreen());
        if (!tabInitialized) {
            console.log("initializing a new tab", primaryStartupTab ? "(primary startup)" : "");
            await this.initializeTab(tabView, primaryStartupTab);
            this.finalizePositioning();
        } else {
            console.log("reusing an existing tab, calling wave-init", tabView.waveTabId);
            tabView.webContents.send("wave-init", tabView.savedInitOpts); // reinit
            tabView.webContents.send("opened-this-launch-tab-ids-change", getOpenedThisLaunchTabIds());
            tabView.webContents.send("collapsed-tab-ids-change", getCollapsedTabIds());
            this.finalizePositioning();
        }

        // something is causing the new tab to lose focus so it requires manual refocusing
        this.refocusActiveTabWebContents();
    }

    /**
     * 给当前 Tab 的 webContents 补 focus（0/10/30ms 三拍）。
     *
     * 历史经验：切 Tab 后新视图会莫名丢掉 webContents 焦点，必须手工补拍。
     * 同一抖动也会在"窗口回焦"时发生（见 on("focus")），所以把节拍收成一处。
     */
    private refocusActiveTabWebContents(): void {
        const view = this.activeTabView;
        if (view == null) return;
        const tryFocus = () => {
            if (this.isDestroyed() || this.activeTabView !== view) return;
            if (view.webContents == null || view.webContents.isFocused()) return;
            view.webContents.focus();
        };
        tryFocus();
        for (const delay of [10, 30]) {
            setTimeout(tryFocus, delay);
        }
    }

    private finalizePositioning() {
        if (this.isDestroyed()) {
            return;
        }
        const curBounds = this.getContentBounds();
        this.activeTabView?.positionTabOnScreen(curBounds);
        for (const tabView of this.allLoadedTabViews.values()) {
            if (tabView == this.activeTabView) {
                continue;
            }
            tabView?.positionTabOffScreen(curBounds);
        }
    }

    async queueCreateTab() {
        await this._queueActionInternal({ op: "createtab" });
    }

    /**
     * 该窗口的动作队列（含正在执行的 [0]，shift 在 finally）里是否已有切到 tabId 的 switchtab。
     *
     * R9.2：点击路径已经入队一次 switchtab（setInBackend=true）；后端 activetabid 广播
     * 回来时（emain.ts 的 electron:updateactivetab）不必再入一次 —— 同目标的重复入队只会
     * 占满串行队列槽位，放大其他点击的排队时间。
     */
    isTabSwitchInFlight(tabId: string): boolean {
        return this.actionQueue.some((entry) => entry.op === "switchtab" && entry.tabId === tabId);
    }

    async queueCloseTab(tabId: string) {
        await this._queueActionInternal({ op: "closetab", tabId });
    }

    private async _queueActionInternal(entry: WindowActionQueueEntry) {
        if (this.actionQueue.length >= 2) {
            this.actionQueue[1] = entry;
            return;
        }
        const wasEmpty = this.actionQueue.length === 0;
        this.actionQueue.push(entry);
        if (wasEmpty) {
            await this.processActionQueue();
        }
    }

    private removeTabViewLater(tabId: string, delayMs: number) {
        setTimeout(() => {
            this.removeTabView(tabId, false);
        }, delayMs);
    }

    // the queue and this function are used to serialize operations that update the window contents view
    // processActionQueue will replace [1] if it is already set
    // we don't mess with [0] because it is "in process"
    // we replace [1] because there is no point to run an action that is going to be overwritten
    private async processActionQueue() {
        while (this.actionQueue.length > 0) {
            try {
                if (this.isDestroyed()) {
                    break;
                }
                const entry = this.actionQueue[0];
                let tabId: string = null;
                const entryStart = Date.now();
                let backendMs = 0;
                let webviewMs = 0;
                let cacheHit = true;
                // have to use "===" here to get the typechecker to work :/
                switch (entry.op) {
                    case "createtab":
                        tabId = await WorkspaceService.CreateTab(this.workspaceId, null, true);
                        break;
                    case "switchtab":
                        tabId = entry.tabId;
                        if (this.activeTabView?.waveTabId == tabId) {
                            continue;
                        }
                        if (entry.setInBackend) {
                            const backendStart = Date.now();
                            await WorkspaceService.SetActiveTab(this.workspaceId, tabId);
                            backendMs = Date.now() - backendStart;
                            if (backendMs > 100) {
                                console.log(
                                    `[tabswitch][SLOW-backend] WorkspaceService.SetActiveTab took ${backendMs}ms, tab=${tabId}`
                                );
                            }
                        }
                        break;
                    case "closetab": {
                        tabId = entry.tabId;
                        const rtn = await WorkspaceService.CloseTab(this.workspaceId, tabId, true);
                        if (rtn == null) {
                            console.log(
                                "[error] closeTab: no return value",
                                tabId,
                                this.workspaceId,
                                this.waveWindowId
                            );
                            return;
                        }
                        this.removeTabViewLater(tabId, 1000);
                        // Tab 已真正关闭：把它从持久化的收起集合里移除，避免堆积悬空 id。
                        expandCollapsedTabIdMain(tabId);
                        if (rtn.closewindow) {
                            this.close();
                            return;
                        }
                        if (!rtn.newactivetabid) {
                            return;
                        }
                        tabId = rtn.newactivetabid;
                        break;
                    }
                    case "switchworkspace": {
                        const newWs = await WindowService.SwitchWorkspace(this.waveWindowId, entry.workspaceId);
                        if (!newWs) {
                            return;
                        }
                        console.log("processActionQueue switchworkspace newWs", newWs);
                        this.removeAllChildViews();
                        console.log("destroyed all tabs", this.waveWindowId);
                        this.workspaceId = entry.workspaceId;
                        this.allLoadedTabViews = new Map();
                        tabId = newWs.activetabid;
                        break;
                    }
                }
                if (tabId == null) {
                    return;
                }
                const webviewStart = Date.now();
                const [tabView, tabInitialized] = await getOrCreateWebViewForTab(this.waveWindowId, tabId);
                cacheHit = tabInitialized;
                webviewMs = Date.now() - webviewStart;
                const primaryStartupTabFlag = entry.op === "switchtab" ? (entry.primaryStartupTab ?? false) : false;
                const setViewStart = Date.now();
                await this.setTabViewIntoWindow(tabView, tabInitialized, primaryStartupTabFlag);
                if (entry.op === "switchtab") {
                    const totalMs = Date.now() - entryStart;
                    const slowMark = totalMs > 150 ? "[SLOW] " : "";
                    console.log(
                        `[tabswitch] ${slowMark}total=${totalMs}ms backend=${backendMs}ms webview=${webviewMs}ms(cache=${cacheHit ? "hit" : "miss"}) setview=${Date.now() - setViewStart}ms tab=${tabId}`
                    );
                }
            } catch (e) {
                console.log("error caught in processActionQueue", e);
            } finally {
                this.actionQueue.shift();
            }
        }
    }

    private async mainResizeHandler(_: any) {
        if (this == null || this.isDestroyed() || this.fullScreen) {
            return;
        }
        const bounds = this.getBounds();
        try {
            await WindowService.SetWindowPosAndSize(
                this.waveWindowId,
                { x: bounds.x, y: bounds.y },
                { width: bounds.width, height: bounds.height }
            );
        } catch (e) {
            console.log("error sending new window bounds to backend", e);
        }
    }

    removeTabView(tabId: string, force: boolean) {
        if (!force && this.activeTabView?.waveTabId == tabId) {
            console.log("cannot remove active tab", tabId, this.waveWindowId);
            return;
        }
        const tabView = this.allLoadedTabViews.get(tabId);
        if (tabView == null) {
            console.log("removeTabView -- tabView not found", tabId, this.waveWindowId);
            // the tab was never loaded, so just return
            return;
        }
        this.contentView.removeChildView(tabView);
        this.allLoadedTabViews.delete(tabId);
        tabView.destroy();
    }

    destroy() {
        console.log("destroy win", this.waveWindowId);
        this.deleteAllowed = true;
        super.destroy();
    }
}

export function getWaveWindowByTabId(tabId: string): WaveBrowserWindow {
    for (const ww of waveWindowMap.values()) {
        if (ww.allLoadedTabViews.has(tabId)) {
            return ww;
        }
    }
}

export function getWaveWindowByWebContentsId(webContentsId: number): WaveBrowserWindow {
    if (webContentsId == null) {
        return null;
    }
    const tabView = getWaveTabViewByWebContentsId(webContentsId);
    if (tabView == null) {
        return null;
    }
    return getWaveWindowByTabId(tabView.waveTabId);
}

export function getWaveWindowById(windowId: string): WaveBrowserWindow {
    return waveWindowMap.get(windowId);
}

export function getWaveWindowByWorkspaceId(workspaceId: string): WaveBrowserWindow {
    for (const waveWindow of waveWindowMap.values()) {
        if (waveWindow.workspaceId === workspaceId) {
            return waveWindow;
        }
    }
}

export function getAllWaveWindows(): WaveBrowserWindow[] {
    return Array.from(waveWindowMap.values());
}

const TabReturnWorkspaceIdMetaKey = "tab:returnworkspaceid";

function computeFallbackActiveTabId(tabIds: string[], removedTabId: string, currentActiveTabId: string): string {
    if (tabIds.length === 0) {
        return "";
    }
    if (currentActiveTabId && currentActiveTabId !== removedTabId && tabIds.includes(currentActiveTabId)) {
        return currentActiveTabId;
    }
    const removedTabIdx = tabIds.indexOf(removedTabId);
    if (removedTabIdx === -1) {
        return tabIds[0];
    }
    const fallbackIdx = Math.max(0, Math.min(removedTabIdx, tabIds.length - 2));
    return tabIds[fallbackIdx];
}

function makeTabORef(tabId: string): string {
    return `tab:${tabId}`;
}

async function setTabReturnWorkspaceId(tabId: string, workspaceId: string | null): Promise<void> {
    await RpcApi.SetMetaCommand(ElectronWshClient, {
        oref: makeTabORef(tabId),
        meta: { [TabReturnWorkspaceIdMetaKey]: workspaceId },
    });
}

async function ensureWaveWindowForWorkspace(workspaceId: string): Promise<WaveBrowserWindow | null> {
    let waveWindow = getWaveWindowByWorkspaceId(workspaceId);
    if (waveWindow != null) {
        return waveWindow;
    }
    await createWindowForWorkspace(workspaceId);
    waveWindow = getWaveWindowByWorkspaceId(workspaceId);
    return waveWindow ?? null;
}

async function moveTabToNewWindow(sourceWaveWindow: WaveBrowserWindow, tabId: string): Promise<boolean> {
    if (sourceWaveWindow == null || !tabId) {
        return false;
    }
    const sourceWorkspaceId = sourceWaveWindow.workspaceId;
    let sourceWorkspace = await WorkspaceService.GetWorkspace(sourceWorkspaceId);
    if (sourceWorkspace == null) {
        console.log("moveTabToNewWindow: source workspace not found", sourceWorkspaceId);
        return false;
    }
    if (!sourceWorkspace.tabids?.includes(tabId)) {
        console.log("moveTabToNewWindow: tab not found in source workspace", tabId, sourceWorkspaceId);
        return false;
    }

    if ((sourceWorkspace.tabids?.length ?? 0) <= 1) {
        // Keep the source window alive by creating a replacement tab before moving the last existing one.
        await WorkspaceService.CreateTab(sourceWorkspaceId, null, true);
        sourceWorkspace = await WorkspaceService.GetWorkspace(sourceWorkspaceId);
        if (sourceWorkspace == null || !sourceWorkspace.tabids?.includes(tabId)) {
            console.log("moveTabToNewWindow: source workspace invalid after replacement tab create", sourceWorkspaceId);
            return false;
        }
    }

    const sourceTabIds = [...(sourceWorkspace.tabids ?? [])];
    const sourceNextTabIds = sourceTabIds.filter((id) => id !== tabId);
    if (sourceNextTabIds.length === 0) {
        console.log("moveTabToNewWindow: source would become empty, aborting", sourceWorkspaceId, tabId);
        return false;
    }
    const sourceNextActiveTabId = computeFallbackActiveTabId(sourceTabIds, tabId, sourceWorkspace.activetabid);
    if (sourceNextActiveTabId === "") {
        console.log("moveTabToNewWindow: unable to determine source fallback active tab", sourceWorkspaceId, tabId);
        return false;
    }

    const newWaveWindow = await WindowService.CreateWindow(null, "");
    if (newWaveWindow == null) {
        console.log("moveTabToNewWindow: failed to create target window");
        return false;
    }
    const targetWorkspaceId = newWaveWindow.workspaceid;
    const targetWorkspace = await WorkspaceService.GetWorkspace(targetWorkspaceId);
    if (targetWorkspace == null) {
        console.log("moveTabToNewWindow: target workspace not found", targetWorkspaceId);
        return false;
    }
    const placeholderTabId = targetWorkspace.activetabid || targetWorkspace.tabids?.[0] || "";
    const targetNextTabIds = [...(targetWorkspace.tabids ?? [])].filter((id) => id !== tabId);
    targetNextTabIds.push(tabId);

    await RpcApi.UpdateWorkspaceTabIdsCommand(ElectronWshClient, sourceWorkspaceId, sourceNextTabIds);
    await RpcApi.UpdateWorkspaceTabIdsCommand(ElectronWshClient, targetWorkspaceId, targetNextTabIds);
    await setTabReturnWorkspaceId(tabId, sourceWorkspaceId);
    await WorkspaceService.SetActiveTab(sourceWorkspaceId, sourceNextActiveTabId);
    await WorkspaceService.SetActiveTab(targetWorkspaceId, tabId);
    if (placeholderTabId && placeholderTabId !== tabId) {
        await WorkspaceService.CloseTab(targetWorkspaceId, placeholderTabId, true);
    }

    await sourceWaveWindow.setActiveTab(sourceNextActiveTabId, false);
    sourceWaveWindow.removeTabView(tabId, true);

    const fullConfig = await RpcApi.GetFullConfigCommand(ElectronWshClient);
    const newBrowserWindow = await createBrowserWindow(newWaveWindow, fullConfig, {
        unamePlatform,
        isPrimaryStartupWindow: false,
    });
    newBrowserWindow.show();
    return true;
}

async function moveTabBack(sourceWaveWindow: WaveBrowserWindow, tabId: string): Promise<boolean> {
    if (sourceWaveWindow == null || !tabId) {
        return false;
    }
    const sourceWorkspaceId = sourceWaveWindow.workspaceId;
    const sourceWorkspace = await WorkspaceService.GetWorkspace(sourceWorkspaceId);
    if (sourceWorkspace == null) {
        console.log("moveTabBack: source workspace not found", sourceWorkspaceId);
        return false;
    }
    if (!sourceWorkspace.tabids?.includes(tabId)) {
        console.log("moveTabBack: tab not found in source workspace", tabId, sourceWorkspaceId);
        return false;
    }

    const tab = await ClientService.GetTab(tabId);
    const targetWorkspaceId = tab?.meta?.[TabReturnWorkspaceIdMetaKey];
    if (targetWorkspaceId == null || targetWorkspaceId === "") {
        console.log("moveTabBack: missing return workspace", tabId);
        return false;
    }
    if (targetWorkspaceId === sourceWorkspaceId) {
        console.log("moveTabBack: source and target workspace are identical", tabId, sourceWorkspaceId);
        await setTabReturnWorkspaceId(tabId, null);
        return false;
    }

    const targetWorkspace = await WorkspaceService.GetWorkspace(targetWorkspaceId).catch(() => null);
    if (targetWorkspace == null) {
        console.log("moveTabBack: target workspace not found", tabId, targetWorkspaceId);
        await setTabReturnWorkspaceId(tabId, null);
        return false;
    }
    const targetWaveWindow = await ensureWaveWindowForWorkspace(targetWorkspaceId);
    if (targetWaveWindow == null) {
        console.log("moveTabBack: target window not found", tabId, targetWorkspaceId);
        return false;
    }

    const sourceTabIds = [...(sourceWorkspace.tabids ?? [])];
    const sourceNextTabIds = sourceTabIds.filter((id) => id !== tabId);
    const sourceNextActiveTabId =
        sourceNextTabIds.length > 0 ? computeFallbackActiveTabId(sourceTabIds, tabId, sourceWorkspace.activetabid) : "";
    if (sourceNextTabIds.length > 0 && sourceNextActiveTabId === "") {
        console.log("moveTabBack: unable to determine source fallback active tab", sourceWorkspaceId, tabId);
        return false;
    }

    const targetNextTabIds = [...(targetWorkspace.tabids ?? [])].filter((id) => id !== tabId);
    targetNextTabIds.push(tabId);

    await RpcApi.UpdateWorkspaceTabIdsCommand(ElectronWshClient, sourceWorkspaceId, sourceNextTabIds);
    await RpcApi.UpdateWorkspaceTabIdsCommand(ElectronWshClient, targetWorkspaceId, targetNextTabIds);
    if (sourceNextActiveTabId !== "") {
        await WorkspaceService.SetActiveTab(sourceWorkspaceId, sourceNextActiveTabId);
    }
    await WorkspaceService.SetActiveTab(targetWorkspaceId, tabId);

    await targetWaveWindow.setActiveTab(tabId, false);
    targetWaveWindow.show();
    targetWaveWindow.focus();

    if (sourceNextActiveTabId === "") {
        sourceWaveWindow.destroy();
    } else {
        await sourceWaveWindow.setActiveTab(sourceNextActiveTabId, false);
        sourceWaveWindow.removeTabView(tabId, true);
    }
    await setTabReturnWorkspaceId(tabId, null);
    return true;
}

export async function createWindowForWorkspace(workspaceId: string) {
    const newWin = await WindowService.CreateWindow(null, workspaceId);
    if (!newWin) {
        console.log("error creating new window", this.waveWindowId);
    }
    const newBwin = await createBrowserWindow(newWin, await RpcApi.GetFullConfigCommand(ElectronWshClient), {
        unamePlatform,
        isPrimaryStartupWindow: false,
    });
    newBwin.show();
}

// note, this does not *show* the window.
// to show, await win.readyPromise and then win.show()
export async function createBrowserWindow(
    waveWindow: WaveWindow,
    fullConfig: FullConfigType,
    opts: WindowOpts
): Promise<WaveBrowserWindow> {
    if (!waveWindow) {
        console.log("createBrowserWindow: no waveWindow");
        waveWindow = await WindowService.CreateWindow(null, "");
    }
    let workspace = await WorkspaceService.GetWorkspace(waveWindow.workspaceid);
    if (!workspace) {
        console.log("createBrowserWindow: no workspace, creating new window");
        await WindowService.CloseWindow(waveWindow.oid, true);
        waveWindow = await WindowService.CreateWindow(null, "");
        workspace = await WorkspaceService.GetWorkspace(waveWindow.workspaceid);
    }
    console.log("createBrowserWindow", waveWindow.oid, workspace.oid, workspace);
    // 启动/开窗恢复：先于首个 renderer 读集合（同步 IPC）把已存 Tab 全部标记为已打开，
    // 否则重启后主栏只剩激活 Tab，其余全部藏进「更多」且灰化。
    markRestoredWorkspaceTabsOpened(workspace.tabids);
    const bwin = new WaveBrowserWindow(waveWindow, fullConfig, opts);

    if (workspace.activetabid) {
        await bwin.setActiveTab(workspace.activetabid, false, opts.isPrimaryStartupWindow ?? false);
    }
    return bwin;
}

ipcMain.on("set-active-tab", async (event, tabId) => {
    const ww = getWaveWindowByWebContentsId(event.sender.id);
    console.log("set-active-tab", tabId, ww?.waveWindowId);
    await ww?.setActiveTab(tabId, true);
});

ipcMain.on("get-opened-this-launch-tab-ids", (event) => {
    event.returnValue = getOpenedThisLaunchTabIds();
});

ipcMain.on("mark-tab-opened-this-launch", (_event, tabId: string) => {
    markTabOpenedThisLaunch(tabId);
});

ipcMain.on("get-collapsed-tab-ids", (event) => {
    event.returnValue = getCollapsedTabIds();
});

ipcMain.on("collapse-tab-ids", (_event, tabIds: string[]) => {
    collapseTabIdsMain(tabIds);
});

ipcMain.on("expand-collapsed-tab-id", (_event, tabId: string) => {
    expandCollapsedTabIdMain(tabId);
});

ipcMain.on("clear-collapsed-tab-ids", () => {
    clearCollapsedTabIdsMain();
});

ipcMain.on("create-tab", async (event, _opts) => {
    const senderWc = event.sender;
    const ww = getWaveWindowByWebContentsId(senderWc.id);
    if (ww != null) {
        await ww.queueCreateTab();
    }
    event.returnValue = true;
    return null;
});

ipcMain.on("set-waveai-open", (event, isOpen: boolean) => {
    const tabView = getWaveTabViewByWebContentsId(event.sender.id);
    if (tabView) {
        tabView.isWaveAIOpen = isOpen;
    }
});

ipcMain.handle("close-tab", async (event, workspaceId: string, tabId: string, confirmClose: boolean) => {
    const ww = getWaveWindowByWorkspaceId(workspaceId);
    if (ww == null) {
        console.log(`close-tab: no window found for workspace ws=${workspaceId} tab=${tabId}`);
        return false;
    }
    if (confirmClose) {
        const choice = dialog.showMessageBoxSync(ww, {
            type: "question",
            defaultId: 1, // Enter activates "Close Tab"
            cancelId: 0, // Esc activates "Cancel"
            buttons: [tmew("common:common.cancel"), tmew("common:dialog.confirmCloseTab.closeTab")],
            title: tmew("common:dialog.confirm"),
            message: tmew("common:dialog.confirmCloseTab.message"),
        });
        if (choice === 0) {
            return false;
        }
    }
    await ww.queueCloseTab(tabId);
    return true;
});

ipcMain.handle("move-tab-to-new-window", async (event, tabId: string) => {
    const senderWindow = getWaveWindowByWebContentsId(event.sender.id);
    const sourceWindow = senderWindow ?? getWaveWindowByTabId(tabId);
    if (sourceWindow == null) {
        console.log("move-tab-to-new-window: source window not found", tabId);
        return false;
    }
    try {
        return await moveTabToNewWindow(sourceWindow, tabId);
    } catch (e) {
        console.log("move-tab-to-new-window failed", tabId, e);
        return false;
    }
});

ipcMain.handle("move-tab-back", async (event, tabId: string) => {
    const senderWindow = getWaveWindowByWebContentsId(event.sender.id);
    const sourceWindow = senderWindow ?? getWaveWindowByTabId(tabId);
    if (sourceWindow == null) {
        console.log("move-tab-back: source window not found", tabId);
        return false;
    }
    try {
        return await moveTabBack(sourceWindow, tabId);
    } catch (e) {
        console.log("move-tab-back failed", tabId, e);
        return false;
    }
});

// Window drag via IPC.
// The tab bar is rendered inside a <webview>, where CSS `-webkit-app-region: drag` cannot move the
// outer window. Instead the frontend sends start/stop events and we drive setBounds from the main
// process using absolute screen coordinates (which natively cross displays).
let activeWindowDrag: {
    win: WaveBrowserWindow;
    timer: ReturnType<typeof setInterval>;
    startCursor: Electron.Point;
    startBounds: Electron.Rectangle;
} | null = null;

function stopWindowDrag(win?: WaveBrowserWindow) {
    if (activeWindowDrag && (!win || activeWindowDrag.win === win)) {
        clearInterval(activeWindowDrag.timer);
        activeWindowDrag = null;
    }
}

ipcMain.on("window-start-drag", (event) => {
    const ww = getWaveWindowByWebContentsId(event.sender.id);
    if (!ww || ww.isDestroyed()) {
        return;
    }
    if (ww.isFullScreen()) {
        return;
    }
    if (ww.isMaximized()) {
        ww.unmaximize();
    }
    if (activeWindowDrag?.win === ww) {
        return;
    }
    stopWindowDrag();
    const startCursor = screen.getCursorScreenPoint();
    const startBounds = ww.getBounds();
    const timer = setInterval(() => {
        if (!ww || ww.isDestroyed()) {
            stopWindowDrag(ww);
            return;
        }
        const cur = screen.getCursorScreenPoint();
        const dx = cur.x - startCursor.x;
        const dy = cur.y - startCursor.y;
        ww.setBounds({ ...startBounds, x: startBounds.x + dx, y: startBounds.y + dy });
    }, 16);
    activeWindowDrag = { win: ww, timer, startCursor, startBounds };
});

ipcMain.on("window-end-drag", () => {
    stopWindowDrag();
});

ipcMain.on("switch-workspace", (event, workspaceId) => {
    fireAndForget(async () => {
        const ww = getWaveWindowByWebContentsId(event.sender.id);
        console.log("switch-workspace", workspaceId, ww?.waveWindowId);
        await ww?.switchWorkspace(workspaceId);
    });
});

export async function createWorkspace(window: WaveBrowserWindow) {
    const newWsId = await WorkspaceService.CreateWorkspace("", "", "", true);
    if (newWsId) {
        if (window) {
            await window.switchWorkspace(newWsId);
        } else {
            await createWindowForWorkspace(newWsId);
        }
    }
}

ipcMain.on("create-workspace", (event) => {
    fireAndForget(async () => {
        const ww = getWaveWindowByWebContentsId(event.sender.id);
        console.log("create-workspace", ww?.waveWindowId);
        await createWorkspace(ww);
    });
});

ipcMain.on("delete-workspace", (event, workspaceId) => {
    fireAndForget(async () => {
        const ww = getWaveWindowByWebContentsId(event.sender.id);
        console.log("delete-workspace", workspaceId, ww?.waveWindowId);

        const workspaceList = await WorkspaceService.ListWorkspaces();

        const _workspaceHasWindow = !!workspaceList.find((wse) => wse.workspaceid === workspaceId)?.windowid;

        const choice = dialog.showMessageBoxSync(this, {
            type: "question",
            buttons: [tmew("common:common.cancel"), tmew("common:dialog.confirmDeleteWorkspace.deleteWorkspace")],
            title: tmew("common:dialog.confirm"),
            message: tmew("common:dialog.confirmDeleteWorkspace.message"),
        });
        if (choice === 0) {
            console.log("user cancelled workspace delete", workspaceId, ww?.waveWindowId);
            return;
        }

        const newWorkspaceId = await WorkspaceService.DeleteWorkspace(workspaceId);
        console.log("delete-workspace done", workspaceId, ww?.waveWindowId);
        if (ww?.workspaceId == workspaceId) {
            if (newWorkspaceId) {
                await ww.switchWorkspace(newWorkspaceId);
            } else {
                console.log("delete-workspace closing window", workspaceId, ww?.waveWindowId);
                ww.destroy();
            }
        }
    });
});

export async function createNewWaveWindow() {
    log("createNewWaveWindow");
    const clientData = await ClientService.GetClientData();
    const fullConfig = await RpcApi.GetFullConfigCommand(ElectronWshClient);
    let recreatedWindow = false;
    const allWindows = getAllWaveWindows();
    if (allWindows.length === 0 && clientData?.windowids?.length >= 1) {
        console.log("no windows, but clientData has windowids, recreating first window");
        // reopen the first window
        const existingWindowId = clientData.windowids[0];
        const existingWindowData = (await ObjectService.GetObject("window:" + existingWindowId)) as WaveWindow;
        if (existingWindowData != null) {
            const win = await createBrowserWindow(existingWindowData, fullConfig, {
                unamePlatform,
                isPrimaryStartupWindow: false,
            });
            if (quakeWindow == null) {
                quakeWindow = win;
            }
            win.show();
            recreatedWindow = true;
        }
    }
    if (recreatedWindow) {
        console.log("recreated window, returning");
        return;
    }
    console.log("creating new window");
    const newBrowserWindow = await createBrowserWindow(null, fullConfig, {
        unamePlatform,
        isPrimaryStartupWindow: false,
    });
    if (quakeWindow == null) {
        quakeWindow = newBrowserWindow;
    }
    newBrowserWindow.show();
}

export async function relaunchBrowserWindows(fullConfig?: FullConfigType) {
    console.log("relaunchBrowserWindows");
    setGlobalIsRelaunching(true);
    const windows = getAllWaveWindows();
    if (windows.length > 0) {
        for (const window of windows) {
            console.log("relaunch -- closing window", window.waveWindowId);
            window.close();
        }
        await delay(1200);
    }
    setGlobalIsRelaunching(false);

    const clientData = await ClientService.GetClientData();
    // W2-1：主启动路径传入已取回的 fullConfig，免掉启动期第二次 GetFullConfigCommand；
    // 其它调用方（菜单 relaunch 等）走带 TTL 的缓存。
    const configToUse = fullConfig ?? (await getFullConfigCached());
    const windowIds = clientData.windowids ?? [];
    const wins: WaveBrowserWindow[] = [];
    const isFirstRelaunch = !hasCompletedFirstRelaunch;
    const primaryWindowId = windowIds.length > 0 ? windowIds[0] : null;
    for (const windowId of windowIds.slice().reverse()) {
        const windowData: WaveWindow = await WindowService.GetWindow(windowId);
        if (windowData == null) {
            console.log("relaunch -- window data not found, closing window", windowId);
            await WindowService.CloseWindow(windowId, true);
            continue;
        }
        const isPrimaryStartupWindow = isFirstRelaunch && windowId === primaryWindowId;
        console.log(
            "relaunch -- creating window",
            windowId,
            windowData,
            isPrimaryStartupWindow ? "(primary startup)" : ""
        );
        const win = await createBrowserWindow(windowData, configToUse, {
            unamePlatform,
            isPrimaryStartupWindow,
            foregroundWindow: windowId === primaryWindowId,
        });
        wins.push(win);
        if (windowId === primaryWindowId) {
            quakeWindow = win;
            console.log("designated quake window", win.waveWindowId);
        }
    }
    hasCompletedFirstRelaunch = true;
    for (const win of wins) {
        console.log("show window", win.waveWindowId);
        win.show();
    }
}

function getDisplayForQuakeToggle() {
    // We cannot reliably query the OS-wide active window in Electron.
    // Cursor position is the best cross-platform proxy for the user's active display.
    const cursorPoint = screen.getCursorScreenPoint();
    const displayAtCursor = screen
        .getAllDisplays()
        .find(
            (display) =>
                cursorPoint.x >= display.bounds.x &&
                cursorPoint.x < display.bounds.x + display.bounds.width &&
                cursorPoint.y >= display.bounds.y &&
                cursorPoint.y < display.bounds.y + display.bounds.height
        );
    return displayAtCursor ?? screen.getDisplayNearestPoint(cursorPoint);
}

function moveWindowToDisplay(win: WaveBrowserWindow, targetDisplay: Electron.Display) {
    if (!win || !targetDisplay || win.isDestroyed()) {
        return;
    }
    const curBounds = win.getBounds();
    const sourceDisplay = screen.getDisplayMatching(curBounds);
    if (sourceDisplay.id === targetDisplay.id) {
        return;
    }

    const sourceArea = sourceDisplay.workArea;
    const targetArea = targetDisplay.workArea;
    const nextHeight = Math.min(curBounds.height, targetArea.height);
    const nextWidth = Math.min(curBounds.width, targetArea.width);
    const maxXOffset = Math.max(0, targetArea.width - nextWidth);
    const maxYOffset = Math.max(0, targetArea.height - nextHeight);
    const sourceXOffset = curBounds.x - sourceArea.x;
    const sourceYOffset = curBounds.y - sourceArea.y;
    const nextX = targetArea.x + Math.min(Math.max(sourceXOffset, 0), maxXOffset);
    const nextY = targetArea.y + Math.min(Math.max(sourceYOffset, 0), maxYOffset);

    win.setBounds({ ...curBounds, x: nextX, y: nextY, width: nextWidth, height: nextHeight });
}

export function moveWaveWindowToRelativeDisplay(win: WaveBrowserWindow | null, dir: 1 | -1): void {
    if (!win || win.isDestroyed()) {
        return;
    }
    const displays = screen.getAllDisplays();
    if (displays.length < 2) {
        return;
    }
    const current = screen.getDisplayMatching(win.getBounds());
    const idx = displays.findIndex((d) => d.id === current.id);
    if (idx === -1) {
        return;
    }
    const nextIdx = (idx + dir + displays.length) % displays.length;
    moveWindowToDisplay(win, displays[nextIdx]);
}

const FullscreenTransitionTimeoutMs = 2000;

// handles a theoretical race condition where the user spams the hotkey before the toggle finishes
let quakeToggleInProgress = false;
let quakeRestoreFullscreenOnShow = false;

function waitForFullscreenLeave(window: WaveBrowserWindow): Promise<void> {
    if (!window.isFullScreen()) {
        return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
        // eslint-disable-next-line prefer-const
        let timeout: ReturnType<typeof setTimeout>;
        const onLeave = () => {
            clearTimeout(timeout);
            resolve();
        };
        timeout = setTimeout(() => {
            window.removeListener("leave-full-screen", onLeave);
            reject(new Error("fullscreen transition timeout"));
        }, FullscreenTransitionTimeoutMs);
        window.once("leave-full-screen", onLeave);
    });
}

function waitForFullscreenEnter(window: WaveBrowserWindow): Promise<void> {
    if (window.isFullScreen()) {
        return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
        // eslint-disable-next-line prefer-const
        let timeout: ReturnType<typeof setTimeout>;
        const onEnter = () => {
            clearTimeout(timeout);
            resolve();
        };
        timeout = setTimeout(() => {
            window.removeListener("enter-full-screen", onEnter);
            reject(new Error("fullscreen transition timeout"));
        }, FullscreenTransitionTimeoutMs);
        window.once("enter-full-screen", onEnter);
    });
}

async function quakeToggle() {
    if (quakeToggleInProgress) {
        return;
    }
    quakeToggleInProgress = true;
    try {
        let window = quakeWindow;
        if (window?.isDestroyed()) {
            quakeWindow = null;
            window = null;
        }
        if (window == null) {
            await createNewWaveWindow();
            return;
        }
        // Some environments don't hide or move the window if it's fullscreen (even when hidden), so leave fullscreen first
        if (window.isFullScreen()) {
            // macos has a really long fullscreen animation and can have issues restoring from fullscreen, so we skip on macos
            quakeRestoreFullscreenOnShow = process.platform !== "darwin";
            const leavePromise = waitForFullscreenLeave(window);
            window.setFullScreen(false);
            try {
                await leavePromise;
            } catch {
                // timeout — proceed anyway
            }
            if (window.isDestroyed()) {
                return;
            }
        }
        if (window.isVisible()) {
            window.hide();
        } else {
            const targetDisplay = getDisplayForQuakeToggle();
            moveWindowToDisplay(window, targetDisplay);
            window.show();
            if (quakeRestoreFullscreenOnShow) {
                const enterPromise = waitForFullscreenEnter(window);
                window.setFullScreen(true);
                try {
                    await enterPromise;
                } catch {
                    // timeout — proceed anyway
                }
            }
            quakeRestoreFullscreenOnShow = false;
            window.focus();
            if (window.activeTabView?.webContents) {
                window.activeTabView.webContents.focus();
            }
        }
    } finally {
        quakeToggleInProgress = false;
    }
}

let currentRawGlobalHotKey: string = null;
let currentGlobalHotKey: string = null;

export function registerGlobalHotkey(rawGlobalHotKey: string) {
    if (rawGlobalHotKey === currentRawGlobalHotKey) {
        return;
    }
    if (currentGlobalHotKey != null) {
        globalShortcut.unregister(currentGlobalHotKey);
        currentGlobalHotKey = null;
        currentRawGlobalHotKey = null;
    }
    if (!rawGlobalHotKey) {
        return;
    }
    try {
        const electronHotKey = waveKeyToElectronKey(rawGlobalHotKey);
        const ok = globalShortcut.register(electronHotKey, () => {
            fireAndForget(quakeToggle);
        });
        currentRawGlobalHotKey = rawGlobalHotKey;
        currentGlobalHotKey = electronHotKey;
        console.log("registered globalhotkey", rawGlobalHotKey, "=>", electronHotKey, "ok=", ok);
    } catch (e) {
        console.log("error registering global hotkey", rawGlobalHotKey, ":", e);
    }
}

export function initGlobalHotkeyEventSubscription() {
    waveEventSubscribeSingle({
        eventType: "config",
        handler: (event) => {
            try {
                const hotkey = event?.data?.fullconfig?.settings?.["app:globalhotkey"];
                registerGlobalHotkey(hotkey ?? null);
            } catch (e) {
                console.log("error handling config event for globalhotkey", e);
            }
        },
    });
}
