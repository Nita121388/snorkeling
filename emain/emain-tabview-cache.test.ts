// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from "vitest";

const removeTabViewMock = vi.fn();

vi.mock("@/app/store/wshclientapi", () => ({ RpcApi: {} }));
vi.mock("@/util/keyutil", () => ({ adaptFromElectronKeyEvent: vi.fn(), checkKeyPressed: vi.fn(() => false) }));
vi.mock("@/util/sharedconst", () => ({ CHORD_TIMEOUT: 1000 }));
vi.mock("electron", () => ({
    shell: { openExternal: vi.fn() },
    WebContentsView: class MockWebContentsView {
        private bounds = { x: 0, y: 0, width: 800, height: 600 };
        setBoundsSpy = vi.fn((b: { x: number; y: number; width: number; height: number }) => {
            this.bounds = { ...b };
        });
        setBackgroundColor = vi.fn();
        webContents = {
            on: vi.fn(),
            send: vi.fn(),
            loadURL: vi.fn(),
            loadFile: vi.fn(),
            close: vi.fn(),
            setZoomFactor: vi.fn(),
            setWindowOpenHandler: vi.fn(),
            isDestroyed: vi.fn(() => false),
            session: {},
            id: Math.floor(Math.random() * 100000),
        };
        getBounds() {
            return { ...this.bounds };
        }
        setBounds(b: { x: number; y: number; width: number; height: number }) {
            this.setBoundsSpy(b);
        }
    },
}));
vi.mock("emain/emain-window", () => ({
    createNewWaveWindow: vi.fn(),
    getWaveWindowById: vi.fn(() => ({
        removeTabView: (tabId: string) => {
            removeTabViewMock(tabId);
        },
    })),
}));
vi.mock("./authkey", () => ({ configureAuthKeyRequestInjection: vi.fn() }));
vi.mock("./emain-activity", () => ({ setWasActive: vi.fn() }));
vi.mock("./emain-platform", () => ({
    getElectronAppBasePath: vi.fn(() => "/app"),
    isDevVite: false,
    unamePlatform: "win32",
}));
vi.mock("./emain-util", () => ({
    decreaseZoomLevel: vi.fn(),
    handleCtrlShiftFocus: vi.fn(),
    handleCtrlShiftState: vi.fn(),
    increaseZoomLevel: vi.fn(),
    resetZoomLevel: vi.fn(),
    shFrameNavHandler: vi.fn(),
    shNavHandler: vi.fn(),
}));
vi.mock("./emain-wsh", () => ({ ElectronWshClient: {} }));

import {
    clearTabCache,
    getWaveTabView,
    setMaxTabCacheSize,
    setWaveTabView,
    WaveTabView,
} from "./emain-tabview";

function makeFakeTab(tabId: string, opts: { active?: boolean; lastUsedTs: number }): WaveTabView {
    const view = new WaveTabView({ settings: {} } as unknown as FullConfigType);
    view.waveTabId = tabId;
    view.waveWindowId = "win-1";
    view.isActiveTab = !!opts.active;
    view.lastUsedTs = opts.lastUsedTs;
    return view;
}

describe("emain-tabview cache eviction and offscreen positioning", () => {
    afterEach(() => {
        removeTabViewMock.mockReset();
        setMaxTabCacheSize(10);
        clearTabCache();
    });

    it("evicts the oldest inactive tab even when an active tab is most recently used and inserted later", () => {
        setMaxTabCacheSize(2);
        const now = Date.now();
        const oldestInactive = makeFakeTab("tab-old", { active: false, lastUsedTs: now - 10_000 });
        const activeTab = makeFakeTab("tab-active", { active: true, lastUsedTs: now - 2_000 });
        const newerInactive = makeFakeTab("tab-new", { active: false, lastUsedTs: now - 3_000 });

        setWaveTabView(oldestInactive.waveTabId, oldestInactive);
        setWaveTabView(activeTab.waveTabId, activeTab);
        // Adding a 3rd entry exceeds MaxCacheSize=2; must evict tab-old, NOT try tab-active and evict 0.
        setWaveTabView(newerInactive.waveTabId, newerInactive);

        expect(removeTabViewMock).toHaveBeenCalledTimes(1);
        expect(removeTabViewMock).toHaveBeenCalledWith("tab-old");
        expect(getWaveTabView("tab-active")).toBeDefined();
    });

    it("short-circuits positionTabOffScreen when bounds already match offscreen target", () => {
        const view = makeFakeTab("tab-off", { active: false, lastUsedTs: Date.now() }) as WaveTabView & {
            setBoundsSpy: ReturnType<typeof vi.fn>;
        };
        const winBounds = { x: 0, y: 0, width: 1200, height: 800 };

        view.positionTabOffScreen(winBounds);
        view.positionTabOffScreen(winBounds);
        view.positionTabOffScreen(winBounds);

        expect(view.setBoundsSpy).toHaveBeenCalledTimes(1);
        expect(view.setBoundsSpy).toHaveBeenCalledWith({ x: -15000, y: -15000, width: 1200, height: 800 });

        // Changing window size must still update offscreen bounds once.
        view.positionTabOffScreen({ x: 0, y: 0, width: 1400, height: 900 });
        expect(view.setBoundsSpy).toHaveBeenCalledTimes(2);
    });
});
