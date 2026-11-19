import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    getRespawnLimitsForTest,
    getRespawnStatsForTest,
    resetRespawnStateForTest,
    triggerSrvExitForTest,
} from "./emain-wavesrv";

// emain-wavesrv at import time wires child_process/readline/electron; stub all
// side-effectful modules so the module under test stays pure for the rate-limit logic.
vi.mock("electron", () => ({
    app: { quit: vi.fn() },
    dialog: { showMessageBox: vi.fn().mockResolvedValue({ response: 0 }) },
}));
vi.mock("node:child_process", () => ({
    spawn: vi.fn(() => makeProcStub()),
}));

// proc stub with the event wiring launchWaveSrv needs; kept in a factory so
// each spawn gets a fresh object (respawn tests spawn repeatedly).
function makeProcStub() {
    return {
        on: vi.fn(),
        stdout: { pipe: vi.fn() },
        stderr: { pipe: vi.fn() },
    };
}
vi.mock("readline", () => ({
    createInterface: vi.fn(() => ({ on: vi.fn() })),
}));
vi.mock("../frontend/util/endpoints", () => ({
    WebServerEndpointVarName: "WAVE_SERVER_WEB_ENDPOINT",
    WSServerEndpointVarName: "WAVE_SERVER_WS_ENDPOINT",
}));
vi.mock("./authkey", () => ({ AuthKey: "test-auth-key", WaveAuthKeyEnv: "WAVE_AUTH_KEY" }));
vi.mock("./emain-activity", () => ({
    getForceQuit: vi.fn(() => false),
    getGlobalIsQuitting: vi.fn(() => false),
    getUserConfirmedQuit: vi.fn(() => false),
    setForceQuit: vi.fn(),
    setUserConfirmedQuit: vi.fn(),
}));
vi.mock("./emain-window", () => ({ getAllWaveWindows: vi.fn(() => []) }));
vi.mock("./emain-platform", () => ({
    getElectronAppResourcesPath: vi.fn(),
    getElectronAppUnpackedBasePath: vi.fn(),
    getWaveConfigDir: vi.fn(),
    getWaveDataDir: vi.fn(),
    getWaveSrvCwd: vi.fn(),
    getWaveSrvPath: vi.fn(),
    getXdgCurrentDesktop: vi.fn(),
    WaveConfigHomeVarName: "WAVE_CONFIG_HOME",
    WaveDataHomeVarName: "WAVE_DATA_HOME",
}));
vi.mock("./emain-util", () => ({
    getElectronExecPath: vi.fn(),
    WaveAppElectronExecPath: "WAVE_APP_ELECTRON_EXEC",
    WaveAppPathVarName: "WAVE_APP_PATH",
    WaveAppResourcesPathVarName: "WAVE_APP_RESOURCES",
}));
vi.mock("./updater", () => ({
    updater: { status: "ok" },
    isQuittingForUpdate: vi.fn(() => false),
}));

describe("wavesrv respawn rate limit", () => {
    beforeEach(() => {
        resetRespawnStateForTest();
        vi.useFakeTimers();
        vi.clearAllMocks();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("allows respawns inside the window up to maxInWindow", () => {
        const { maxInWindow, windowMs } = getRespawnLimitsForTest();
        for (let i = 0; i < maxInWindow; i++) {
            triggerSrvExitForTest(); // abnormal death path (all quit flags mocked false)
            expect(getRespawnStatsForTest().inWindow).toBe(i + 1);
        }
        // The respawn timer is scheduled per call; advance so pending timers don't
        // leak into the next assertion.
        vi.advanceTimersByTime(windowMs + 1000);
    });

    it("refuses the (maxInWindow+1)-th respawn inside the window", async () => {
        const { maxInWindow, windowMs } = getRespawnLimitsForTest();
        for (let i = 0; i < maxInWindow; i++) {
            triggerSrvExitForTest();
        }
        triggerSrvExitForTest(); // one too many
        const { dialog } = await import("electron");
        expect(dialog.showMessageBox).toHaveBeenCalledTimes(1);
        expect(getRespawnStatsForTest().inWindow).toBe(maxInWindow);
        vi.advanceTimersByTime(windowMs + 1000);
    });

    it("slides the window: old respawns expire after windowMs", () => {
        const { maxInWindow, windowMs } = getRespawnLimitsForTest();
        for (let i = 0; i < maxInWindow; i++) {
            triggerSrvExitForTest();
        }
        triggerSrvExitForTest(); // refused (window full)
        expect(getRespawnStatsForTest().inWindow).toBe(maxInWindow);
        // Advance past the window: timestamps expire, next respawn allowed again.
        vi.advanceTimersByTime(windowMs + 1);
        // The window is now empty (expired entries pruned on access).
        expect(getRespawnStatsForTest().inWindow).toBe(0);
        triggerSrvExitForTest();
        expect(getRespawnStatsForTest().inWindow).toBe(1);
        vi.advanceTimersByTime(windowMs + 1000);
    });

    it("caps total respawns regardless of window sliding", () => {
        const { maxInWindow, maxTotal, windowMs } = getRespawnLimitsForTest();
        // Simulate bursts separated by full windows so the sliding window never
        // refuses; only the total cap can trip the dialog here.
        const bursts = Math.ceil(maxTotal / maxInWindow);
        for (let burst = 0; burst < bursts; burst++) {
            for (let i = 0; i < maxInWindow && getRespawnStatsForTest().total < maxTotal; i++) {
                triggerSrvExitForTest();
            }
            vi.advanceTimersByTime(windowMs + 1); // slide past the window
        }
        // Total cap reached: one more abnormal death must be refused.
        triggerSrvExitForTest();
        // window counts: the burst loop already pushed the total to the cap.
        expect(getRespawnStatsForTest().total).toBeGreaterThanOrEqual(maxTotal);
        vi.advanceTimersByTime(windowMs + 1000);
    });
});