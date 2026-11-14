import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/store/services", () => ({
    ClientService: {},
    ObjectService: {},
    WindowService: {},
    WorkspaceService: {},
}));
vi.mock("@/app/store/wps", () => ({ waveEventSubscribeSingle: vi.fn() }));
vi.mock("@/app/store/wshclientapi", () => ({ RpcApi: {} }));
vi.mock("@/util/util", () => ({ fireAndForget: vi.fn() }));
vi.mock("electron", () => ({
    BaseWindow: class {},
    dialog: {},
    globalShortcut: {},
    ipcMain: { handle: vi.fn(), on: vi.fn() },
    screen: {},
}));
vi.mock("emain/emain-events", () => ({ globalEvents: { emit: vi.fn() } }));
vi.mock("./emain-activity", () => ({
    getGlobalIsQuitting: vi.fn(),
    getGlobalIsRelaunching: vi.fn(),
    setGlobalIsRelaunching: vi.fn(),
    setWasActive: vi.fn(),
    setWasInFg: vi.fn(),
}));
vi.mock("./emain-log", () => ({ log: vi.fn() }));
vi.mock("./emain-platform", () => ({
    getElectronAppBasePath: vi.fn(),
    isDev: true,
    unamePlatform: "win32",
}));
vi.mock("./emain-tabview", () => ({
    getOrCreateWebViewForTab: vi.fn(),
    getWaveTabViewByWebContentsId: vi.fn(),
    WaveTabView: class {},
}));
vi.mock("./emain-util", () => ({
    delay: vi.fn(),
    ensureBoundsAreVisible: (bounds: unknown) => bounds,
    waveKeyToElectronKey: vi.fn(),
}));
vi.mock("./emain-wsh", () => ({ ElectronWshClient: {} }));
vi.mock("./updater", () => ({ updater: { status: "idle" } }));

import { getOpenedThisLaunchTabIds, markRestoredWorkspaceTabsOpened, WaveBrowserWindow } from "./emain-window";

describe("markRestoredWorkspaceTabsOpened (startup restore)", () => {
    it("marks every restored workspace tab id as opened this launch", () => {
        markRestoredWorkspaceTabsOpened(["restore-t1", "restore-t2", "restore-t3"]);
        const opened = getOpenedThisLaunchTabIds();
        expect(opened).toContain("restore-t1");
        expect(opened).toContain("restore-t2");
        expect(opened).toContain("restore-t3");
    });

    it("is idempotent and tolerates empty / null tab ids", () => {
        markRestoredWorkspaceTabsOpened(["restore-t1"]);
        const countBefore = getOpenedThisLaunchTabIds().filter((id) => id.startsWith("restore-")).length;
        markRestoredWorkspaceTabsOpened([]);
        markRestoredWorkspaceTabsOpened(null);
        markRestoredWorkspaceTabsOpened(undefined);
        const countAfter = getOpenedThisLaunchTabIds().filter((id) => id.startsWith("restore-")).length;
        expect(countAfter).toBe(countBefore);
    });
});

describe("WaveBrowserWindow.isTabSwitchInFlight (R9.2 broadcast dedupe)", () => {
    const isTabSwitchInFlight = (
        WaveBrowserWindow.prototype as unknown as {
            isTabSwitchInFlight: (this: { actionQueue: unknown[] }, tabId: string) => boolean;
        }
    ).isTabSwitchInFlight;

    it("detects the in-flight switchtab including the executing entry", () => {
        const win = {
            actionQueue: [
                { op: "switchtab", tabId: "t1", setInBackend: true },
                { op: "switchtab", tabId: "t2", setInBackend: false },
            ],
        };
        expect(isTabSwitchInFlight.call(win, "t1")).toBe(true);
        expect(isTabSwitchInFlight.call(win, "t2")).toBe(true);
        expect(isTabSwitchInFlight.call(win, "t3")).toBe(false);
    });

    it("ignores non-switchtab entries even when they carry the same tab id", () => {
        const win = { actionQueue: [{ op: "createtab" }, { op: "closetab", tabId: "t9" }] };
        expect(isTabSwitchInFlight.call(win, "t9")).toBe(false);
    });
});

describe("WaveBrowserWindow dev initialization timeout", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it("keeps waiting for renderer readiness after showing timeout diagnostics", async () => {
        vi.useFakeTimers();
        vi.spyOn(console, "log").mockImplementation(() => {});

        const show = vi.fn();
        const openDevTools = vi.fn();
        const windowStub = {
            activeTabView: {
                webContents: {
                    isDevToolsOpened: () => false,
                    openDevTools,
                },
            },
            isDestroyed: () => false,
            isVisible: () => false,
            show,
        };
        let resolveReady: (value: string) => void = () => {};
        const rendererReady = new Promise<string>((resolve) => {
            resolveReady = resolve;
        });

        const waitForReady = (
            WaveBrowserWindow.prototype as unknown as {
                awaitWithDevTimeout: (
                    this: typeof windowStub,
                    promise: Promise<string>,
                    name: string,
                    tabId: string
                ) => Promise<string>;
            }
        ).awaitWithDevTimeout.call(windowStub, rendererReady, "initPromise", "tab-1");
        let outcome: "resolved" | "rejected" | null = null;
        void waitForReady.then(
            () => {
                outcome = "resolved";
            },
            () => {
                outcome = "rejected";
            }
        );

        await vi.advanceTimersByTimeAsync(120_000);

        expect(show).toHaveBeenCalledOnce();
        expect(openDevTools).toHaveBeenCalledOnce();
        expect(outcome).toBeNull();

        resolveReady("ready");
        await expect(waitForReady).resolves.toBe("ready");
    });
});
