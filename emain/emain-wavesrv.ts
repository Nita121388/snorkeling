// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as electron from "electron";
import * as child_process from "node:child_process";
import * as readline from "readline";
import { WebServerEndpointVarName, WSServerEndpointVarName } from "../frontend/util/endpoints";
import { AuthKey, WaveAuthKeyEnv } from "./authkey";
import { getForceQuit, getGlobalIsQuitting, getUserConfirmedQuit, setForceQuit, setUserConfirmedQuit } from "./emain-activity";
import { getAllWaveWindows } from "./emain-window";
import {
    getElectronAppResourcesPath,
    getElectronAppUnpackedBasePath,
    getWaveConfigDir,
    getWaveDataDir,
    getWaveSrvCwd,
    getWaveSrvPath,
    getXdgCurrentDesktop,
    WaveConfigHomeVarName,
    WaveDataHomeVarName,
} from "./emain-platform";
import {
    getElectronExecPath,
    WaveAppElectronExecPath,
    WaveAppPathVarName,
    WaveAppResourcesPathVarName,
} from "./emain-util";
import { isQuittingForUpdate, updater } from "./updater";

let isWaveSrvDead = false;
let waveSrvProc: child_process.ChildProcessWithoutNullStreams | null = null;
let WaveVersion = "unknown"; // set by WAVESRV-ESTART
let WaveBuildTime = 0; // set by WAVESRV-ESTART

// D-A (wavesrv OOM 修复): respawn 限流。wavesrv 异常死亡后自动拉起新进程，
// 但用滑窗限流防止崩溃循环：RESPAWN_WINDOW_MS 内最多 RESPAWN_MAX_IN_WINDOW 次，
// 全生命周期最多 RESPAWN_MAX_TOTAL 次。超限弹窗告知并退出（凭据见
// .trellis/tasks/11-19-wavesrv-oom-flash-quit/design.md §2）。
const RESPAWN_WINDOW_MS = 60_000;
const RESPAWN_MAX_IN_WINDOW = 3;
const RESPAWN_MAX_TOTAL = 10;
const RESPAWN_DELAY_MS = 1000;
let respawnTimestamps: number[] = [];
let respawnTotal = 0;
let respawnInFlight = false;

export function getWaveVersion(): { version: string; buildTime: number } {
    return { version: WaveVersion, buildTime: WaveBuildTime };
}

let waveSrvReadyResolve = (value: boolean) => {};
const waveSrvReady: Promise<boolean> = new Promise((resolve, _) => {
    waveSrvReadyResolve = resolve;
});

export function getWaveSrvReady(): Promise<boolean> {
    return waveSrvReady;
}

export function getWaveSrvProc(): child_process.ChildProcessWithoutNullStreams | null {
    return waveSrvProc;
}

export function getIsWaveSrvDead(): boolean {
    return isWaveSrvDead;
}

// resolveSrvReadyBounce is a one-shot relay: the *first* successful start
// resolves the exported ready promise (used during app boot); respawns never
// touch it again (the promise can only resolve once), they only fire the
// onStart hook so windows reload with the new endpoint.
let srvReadyBounced = false;
let onSrvStartHook: (() => void) | null = null;

// handlesSrvExit decides between "normal quit path" and "abnormal death →
// respawn". Called from the child process exit event.
function handleSrvExit() {
    if (updater?.status == "installing" || isQuittingForUpdate()) {
        return;
    }
    // Normal quit: the app is shutting down (or already told us to quit).
    if (getGlobalIsQuitting() || getForceQuit() || getUserConfirmedQuit()) {
        console.log("wavesrv exited during app shutdown, quitting");
        setForceQuit(true);
        isWaveSrvDead = true;
        electron.app.quit();
        return;
    }
    // Abnormal death (e.g. `fatal error: out of memory` on a commit-starved
    // host). Before this task the whole app quit right here — that was the
    // "闪退" (window disappears with no dialog). Now: bound-rate respawn.
    const now = Date.now();
    respawnTimestamps = respawnTimestamps.filter((ts) => now - ts < RESPAWN_WINDOW_MS);
    if (respawnTimestamps.length >= RESPAWN_MAX_IN_WINDOW || respawnTotal >= RESPAWN_MAX_TOTAL) {
        console.log("wavesrv respawn limit exceeded, quitting");
        isWaveSrvDead = true;
        void electron.dialog
            .showMessageBox({
                type: "error",
                title: "天波 (Snorkeling)",
                message: "wavesrv 在短时间内异常退出多次，已停止自动恢复。",
                detail: "可能原因：系统内存不足。请尝试：关闭部分常驻程序、增大页面文件或重启。",
                buttons: ["退出"],
            })
            .then(() => {
                setForceQuit(true);
                electron.app.quit();
            });
        return;
    }
    respawnTimestamps.push(now);
    respawnTotal++;
    respawnInFlight = true;
    console.log("wavesrv exited unexpectedly, respawning in", RESPAWN_DELAY_MS, "ms");
    setTimeout(() => {
        // Re-check: the user may have started quitting during the delay.
        if (getGlobalIsQuitting() || getForceQuit() || getUserConfirmedQuit()) {
            console.log("wavesrv respawn cancelled: app is quitting");
            respawnInFlight = false;
            isWaveSrvDead = true;
            return;
        }
        void launchWaveSrv({
            isRespawn: true,
        })
            .then(() => {
                respawnInFlight = false;
                console.log("wavesrv respawned ok, reloading windows");
            })
            .catch((e) => {
                console.log("wavesrv respawn failed", e);
                respawnInFlight = false;
                setForceQuit(true);
                isWaveSrvDead = true;
                electron.app.quit();
            });
    }, RESPAWN_DELAY_MS);
}

// launchWaveSrv spawns the wavesrv backend and wires stdout/stderr routing.
// On the first successful WAVESRV-ESTART it resolves the exported ready
// promise; on respawns it fires the onStart hook instead (windows reload so
// the renderer's lazy endpoint cache picks up the new random port).
function launchWaveSrv(opts: { isRespawn?: boolean } = {}): Promise<boolean> {
    let pResolve: (value: boolean) => void;
    let pReject: (reason?: any) => void;
    const rtnPromise = new Promise<boolean>((argResolve, argReject) => {
        pResolve = argResolve;
        pReject = argReject;
    });
    const handleWSEvent = windowWSEventHandler;
    const envCopy = { ...process.env };
    const xdgCurrentDesktop = getXdgCurrentDesktop();
    if (xdgCurrentDesktop != null) {
        envCopy["XDG_CURRENT_DESKTOP"] = xdgCurrentDesktop;
    }
    envCopy[WaveAppPathVarName] = getElectronAppUnpackedBasePath();
    envCopy[WaveAppResourcesPathVarName] = getElectronAppResourcesPath();
    envCopy[WaveAppElectronExecPath] = getElectronExecPath();
    envCopy[WaveAuthKeyEnv] = AuthKey;
    envCopy[WaveDataHomeVarName] = getWaveDataDir();
    envCopy[WaveConfigHomeVarName] = getWaveConfigDir();
    // D-B (wavesrv OOM 修复): GOMEMLIMIT 让 Go GC 提前激进回收，避免 wavesrv 在
    // 系统 commit 内存紧张时把自身 heap 扩张到 GB 级（真机 OOM 闪退根因之一：
    // wavesrv 申请 8KB~1.8MB 失败 → fatal error: out of memory → 本进程曾直接
    // quit）。默认 1GiB（常态 WS 仅 ~123MB 的 8 倍余量，日常 GC 无感知）；
    // WAVE_SRV_MEM_LIMIT_MB 可覆盖（单位 MB）。
    const memLimitMB = parseInt(process.env["WAVE_SRV_MEM_LIMIT_MB"] ?? "", 10);
    const limitBytes = (Number.isFinite(memLimitMB) && memLimitMB > 0 ? memLimitMB : 1024) * 1024 * 1024;
    envCopy["GOMEMLIMIT"] = String(limitBytes);
    console.log("wavesrv GOMEMLIMIT:", limitBytes);
    const waveSrvCmd = getWaveSrvPath();
    console.log("trying to run local server", waveSrvCmd);
    const proc = child_process.spawn(getWaveSrvPath(), {
        cwd: getWaveSrvCwd(),
        env: envCopy,
    });
    proc.on("exit", (e) => {
        // The exit handler is registered per-launch; on respawns, let the
        // shared handleSrvExit decide (it distinguishes quit vs. another
        // abnormal death and applies the rate limit).
        handleSrvExit();
    });
    proc.on("spawn", (e) => {
        console.log("spawned wavesrv");
        waveSrvProc = proc;
        pResolve(true);
    });
    proc.on("error", (e) => {
        console.log("error running wavesrv", e);
        pReject(e);
    });
    const rlStdout = readline.createInterface({
        input: proc.stdout,
        terminal: false,
    });
    rlStdout.on("line", (line) => {
        console.log(line);
    });
    const rlStderr = readline.createInterface({
        input: proc.stderr,
        terminal: false,
    });
    rlStderr.on("line", (line) => {
        if (line.includes("WAVESRV-ESTART")) {
            const startParams = /ws:([a-z0-9.:]+) web:([a-z0-9.:]+) version:([a-z0-9.-]+) buildtime:(\d+)/gm.exec(
                line
            );
            if (startParams == null) {
                console.log("error parsing WAVESRV-ESTART line", line);
                setUserConfirmedQuit(true);
                electron.app.quit();
                return;
            }
            process.env[WSServerEndpointVarName] = startParams[1];
            process.env[WebServerEndpointVarName] = startParams[2];
            WaveVersion = startParams[3];
            WaveBuildTime = parseInt(startParams[4]);
            if (!srvReadyBounced) {
                srvReadyBounced = true;
                waveSrvReadyResolve(true);
            }
            if (opts.isRespawn) {
                isWaveSrvDead = false;
                console.log("wavesrv respawn ready; reloading windows");
                const hook = onSrvStartHook;
                onSrvStartHook = null;
                if (hook != null) {
                    hook();
                }
            }
            return;
        }
        if (line.startsWith("WAVESRV-EVENT:")) {
            const evtJson = line.slice("WAVESRV-EVENT:".length);
            try {
                const evtMsg: WSEventType = JSON.parse(evtJson);
                handleWSEvent(evtMsg);
            } catch (e) {
                console.log("error handling WAVESRV-EVENT", e);
            }
            return;
        }
        console.log(line);
    });
    return rtnPromise;
}

// windowWSEventHandler is the external event handler wired by runWaveSrv; it
// lives here (module scope) so respawned instances reuse the same handler.
let windowWSEventHandler: (evtMsg: WSEventType) => void = () => {};

/**
 * runWaveSrv is the app-boot entry point. It spawns the backend and resolves
 * the exported ready promise once the first WAVESRV-ESTART arrives.
 *
 * After boot, abnormal backend exits are handled by handleSrvExit (respawn
 * with rate limit). Use setRespawnReloadHook to reload all windows once a
 * respawned backend is up.
 */
export function runWaveSrv(handleWSEvent: (evtMsg: WSEventType) => void): Promise<boolean> {
    windowWSEventHandler = handleWSEvent;
    return launchWaveSrv({ isRespawn: false });
}

/**
 * setRespawnReloadHook registers a one-shot callback fired when a respawned
 * wavesrv becomes ready. emain.ts uses it to reload all windows so the
 * renderer's lazy endpoint cache picks up the new random port.
 */
export function setRespawnReloadHook(hook: () => void): void {
    onSrvStartHook = hook;
}

/** @internal testing hook: reset the respawn rate-limit state. */
export function resetRespawnStateForTest(): void {
    respawnTimestamps = [];
    respawnTotal = 0;
    respawnInFlight = false;
}

/** @internal testing hook: read the current respawn stats. */
export function getRespawnStatsForTest(): { inWindow: number; total: number; inFlight: boolean } {
    const now = Date.now();
    respawnTimestamps = respawnTimestamps.filter((ts) => now - ts < RESPAWN_WINDOW_MS);
    return {
        inWindow: respawnTimestamps.length,
        total: respawnTotal,
        inFlight: respawnInFlight,
    };
}

/** @internal testing hook: invoke the shared exit decision directly. */
export function triggerSrvExitForTest(): void {
    handleSrvExit();
}

/** @internal testing hook: expose the rate-limit constants. */
export function getRespawnLimitsForTest(): {
    windowMs: number;
    maxInWindow: number;
    maxTotal: number;
} {
    return { windowMs: RESPAWN_WINDOW_MS, maxInWindow: RESPAWN_MAX_IN_WINDOW, maxTotal: RESPAWN_MAX_TOTAL };
}

/** reloadAllWaveWindows refreshes every renderer so endpoint caches reset. */
export function reloadAllWaveWindows(): void {
    for (const w of getAllWaveWindows()) {
        if (w == null || w.isDestroyed()) {
            continue;
        }
        for (const tabView of w.allLoadedTabViews.values()) {
            if (!tabView.webContents.isDestroyed()) {
                tabView.webContents.reload();
            }
        }
    }
}