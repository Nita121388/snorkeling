// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { spawnSync } from "child_process";
import { app, dialog, autoUpdater as electronAutoUpdater, ipcMain, Notification, shell } from "electron";
import { autoUpdater } from "electron-updater";
import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { chmod, mkdir, mkdtemp, readdir, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { existsSync, readFileSync } from "fs";
import path from "path";
import YAML from "yaml";
import { RpcApi } from "../frontend/app/store/wshclientapi";
import { isDev } from "../frontend/util/isdev";
import { fireAndForget } from "../frontend/util/util";
import { setGlobalIsQuitting, setUserConfirmedQuit } from "./emain-activity";
import { delay } from "./emain-util";
import { focusedWaveWindow, getAllWaveWindows } from "./emain-window";
import { ElectronWshClient } from "./emain-wsh";
import { isOfflineError } from "./updater-shared";
import { installedAppBundle, scheduleSwap } from "./updater-installer";
import { pickAsset, type UpdaterAsset } from "./updater-asset";

export let updater: Updater;
const SnorkelingLatestReleaseUrl = "https://github.com/Nita121388/snorkeling/releases/latest";
let quittingForUpdate = false;

const execFileAsync = promisify(execFile);
const unzipZip = (archive: string, into: string) => execFileAsync("ditto", ["-x", "-k", archive, into]);

interface GitHubRelease {
    tag_name?: string;
    name?: string;
    body?: string;
    draft?: boolean;
    prerelease?: boolean;
    assets?: UpdaterAsset[];
}

async function fetchLatestRelease(opts?: { signal?: AbortSignal }): Promise<{
    version: string;
    name: string;
    body: string;
    assets: UpdaterAsset[];
}> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
        if (opts?.signal) {
            opts.signal.addEventListener("abort", () => controller.abort(), { once: true });
        }
        const res = await fetch("https://api.github.com/repos/Nita121388/snorkeling/releases/latest", {
            headers: { Accept: "application/vnd.github+json", "User-Agent": `Snorkeling/${app.getVersion()}` },
            signal: controller.signal,
        });
        if (!res.ok) throw new Error(`GitHub returned ${res.status}`);
        const release = (await res.json()) as GitHubRelease;
        if (release.draft || release.prerelease) {
            throw new Error("Latest release is not a stable published release.");
        }
        const version = (release.tag_name ?? release.name ?? "").replace(/^v/i, "");
        if (!version) throw new Error("Release payload carried no version.");
        return { version, name: release.name ?? version, body: release.body ?? "", assets: release.assets ?? [] };
    } finally {
        clearTimeout(timer);
    }
}

/** Prefix for per-version directories we stage downloads under inside os.tmpdir(). */
const STAGED_UPDATE_PREFIX = "snorkeling-update-";

/**
 * Delete prior-version download dirs under tmpdir. Best-effort: a stuck delete is a
 * signal for the OS to keep what it's holding, not a reason for the updater to throw.
 * We deliberately skip the version currently being downloaded/installed.
 */
export async function sweepStaleDownloadDirs(keepVersion?: string): Promise<void> {
    const base = tmpdir();
    const entries = await readdir(base).catch(() => [] as string[]);
    const currentPrefix = keepVersion ? `${STAGED_UPDATE_PREFIX}${keepVersion}-` : null;
    const stale = entries.filter(
        (name) => name.startsWith(STAGED_UPDATE_PREFIX) && (!currentPrefix || !name.startsWith(currentPrefix))
    );
    await Promise.all(stale.map((name) => rm(path.join(base, name), { recursive: true, force: true }).catch(() => {})));
}

export { isOfflineError };

type UpdateSupportState = {
    supported: boolean;
    reason?: string;
    manualInstallOnly?: boolean;
};

export function isQuittingForUpdate(): boolean {
    return quittingForUpdate;
}

function getWindowsUninstallerCandidates(): string[] {
    const exeDir = path.dirname(process.execPath);
    const exeName = path.basename(process.execPath, path.extname(process.execPath));
    const nameCandidates = new Set([app.getName(), exeName].map((name) => name?.trim()).filter(Boolean));
    return Array.from(nameCandidates).map((name) => path.join(exeDir, `Uninstall ${name}.exe`));
}

function getMacAppBundlePath(): string | null {
    const marker = ".app/Contents/MacOS/";
    const markerIndex = process.execPath.indexOf(marker);
    if (markerIndex === -1) {
        return null;
    }
    return process.execPath.slice(0, markerIndex + ".app".length);
}

function isAdhocSignedMacApp(): boolean {
    if (process.platform !== "darwin" || !app.isPackaged) {
        return false;
    }

    const appBundlePath = getMacAppBundlePath();
    if (!appBundlePath) {
        console.log("could not resolve macOS app bundle path for update signing check");
        return false;
    }

    const result = spawnSync("codesign", ["-dv", "--verbose=4", appBundlePath], {
        encoding: "utf8",
    });
    if (result.error || result.status !== 0) {
        console.log("could not inspect macOS app signature for update support", result.error ?? result.stderr);
        return false;
    }

    const codesignOutput = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    return codesignOutput.includes("Signature=adhoc");
}

function detectUpdateSupportState(): UpdateSupportState {
    if (isAdhocSignedMacApp()) {
        return {
            supported: false,
            manualInstallOnly: true,
            reason: "This macOS build is ad-hoc signed. Automatic in-place updates require a stable Developer ID signature, so please install the latest release manually.",
        };
    }

    if (process.platform !== "win32") {
        return { supported: true };
    }
    const uninstallerCandidates = getWindowsUninstallerCandidates();
    if (uninstallerCandidates.some((candidate) => existsSync(candidate))) {
        return { supported: true };
    }
    return {
        supported: false,
        reason: "This copy appears to be running from a ZIP/extracted directory. Automatic in-place updates are only supported for the Windows setup (.exe) installation.",
    };
}

function getUpdateChannel(settings: SettingsType): string {
    let updaterChannel = "latest";
    try {
        const updaterConfigPath = path.join(process.resourcesPath!, "app-update.yml");
        const updaterConfig = YAML.parse(readFileSync(updaterConfigPath, { encoding: "utf8" }).toString());
        console.log("Updater config from binary:", updaterConfig);
        updaterChannel = updaterConfig?.channel ?? "latest";
    } catch (e) {
        console.warn("could not read app-update.yml, defaulting to latest channel", e);
    }
    const settingsChannel = settings["autoupdate:channel"];
    let retVal = settingsChannel;

    // If the user setting doesn't exist yet, set it to the value of the updater config.
    // If the user was previously on the `latest` channel and has downloaded a `beta` version, update their configured channel to `beta` to prevent downgrading.
    if (!settingsChannel || (settingsChannel == "latest" && updaterChannel == "beta")) {
        console.log("Update channel setting does not exist, setting to value from updater config.");
        RpcApi.SetConfigCommand(ElectronWshClient, { "autoupdate:channel": updaterChannel });
        retVal = updaterChannel;
    }
    console.log("Update channel:", retVal);
    return retVal;
}

export class Updater {
    autoCheckInterval: NodeJS.Timeout | null;
    intervalms: number;
    autoCheckEnabled: boolean;
    availableUpdateReleaseName: string | null;
    availableUpdateReleaseNotes: string | null;
    /**
     * Where a manual-install download is, if one is underway.
     *
     * Used to keep exactly one in flight at a time, to know whether to offer
     * "Restart into update" versus "Open downloaded file", and to carry the
     * staged `.app` path if we've already unpacked it and are just waiting
     * for the user to say go.
     */
    private manualInstall: {
        phase: "idle" | "downloading" | "ready" | "installing" | "failed";
        version?: string;
        file?: string;
        stagedAppPath?: string;
        targetBundle?: string;
        received?: number;
        total?: number;
        error?: string;
    } | null = null;
    /** Abort controller for the currently running manual download (if any). */
    private currentAborter: AbortController | null = null;
    updateSupport: UpdateSupportState;
    lastUpdateErrorMessage: string | null;
    private _status: UpdaterStatus;
    /**
     * The last time we actually got an answer from the update server — whether the answer
     * was "there is an update" or "you are current". `null` means we have never successfully
     * checked.
     *
     * Kept separate from `lastUpdateCheck` (schedule bookkeeping) on purpose: a failed check
     * is not a check. Conflating them is how "offline" gets reported as "you are on the
     * latest version".
     */
    lastChecked: Date | null;
    lastUpdateCheck: Date;

    constructor(settings: SettingsType) {
        quittingForUpdate = false;
        this.intervalms = settings["autoupdate:intervalms"];
        console.log("Update check interval in milliseconds:", this.intervalms);
        this.autoCheckEnabled = settings["autoupdate:enabled"];
        console.log("Update check enabled:", this.autoCheckEnabled);

        this._status = "up-to-date";
        this.lastChecked = null;
        this.lastUpdateCheck = new Date(0);
        this.autoCheckInterval = null;
        this.availableUpdateReleaseName = null;
        this.lastUpdateErrorMessage = null;
        this.updateSupport = detectUpdateSupportState();

        autoUpdater.autoInstallOnAppQuit = settings["autoupdate:installonquit"];
        autoUpdater.autoDownload = !this.updateSupport.manualInstallOnly;
        console.log("Install update on quit:", settings["autoupdate:installonquit"]);
        if (!this.updateSupport.supported) {
            console.log("Automatic in-place updates are disabled for this installation:", this.updateSupport.reason);
        }

        // Only update the release channel if it's specified, otherwise use the one configured in the updater.
        autoUpdater.channel = getUpdateChannel(settings);
        autoUpdater.allowDowngrade = false;

        autoUpdater.removeAllListeners();
        electronAutoUpdater.removeAllListeners("before-quit-for-update");

        autoUpdater.on("error", (err) => {
            console.log("updater error");
            console.log(err);
            this.lastChecked = new Date();
            if (isOfflineError(err)) {
                // Offline or transient network failure while checking for updates in the background.
                // This is not an app problem and not a "known up-to-date" answer: leave the status
                // untouched so the UI doesn't claim we successfully checked, and so the next
                // interval retry isn't treated as a fresh error.
                return;
            }
            const errorMessage = err instanceof Error ? err.message : String(err);
            this.lastUpdateErrorMessage = errorMessage;
            this.status = "error";
        });

        autoUpdater.on("checking-for-update", () => {
            console.log("checking-for-update");
            this.status = "checking";
        });

        autoUpdater.on("update-available", (info) => {
            console.log("update-available; downloading...");
            this.lastChecked = new Date();
            if (this.updateSupport.manualInstallOnly) {
                this.availableUpdateReleaseName = info.releaseName ?? info.version ?? null;
                this.availableUpdateReleaseNotes = typeof info.releaseNotes === "string" ? info.releaseNotes : null;
                this.lastUpdateErrorMessage = null;
                this.status = "manual-update";

                const updateNotification = new Notification({
                    title: "Snorkeling",
                    body: "A new version of Snorkeling is available for manual installation.",
                });
                updateNotification.on("click", () => {
                    fireAndForget(this.promptToInstallUpdate.bind(this));
                });
                updateNotification.show();
                return;
            }
            this.status = "downloading";
        });

        autoUpdater.on("update-not-available", () => {
            console.log("update-not-available");
            this.lastUpdateErrorMessage = null;
            this.lastChecked = new Date();
            this.status = "up-to-date";
        });

        autoUpdater.on("update-downloaded", (event) => {
            console.log("update-downloaded", [event]);
            this.lastChecked = new Date();
            this.availableUpdateReleaseName = event.releaseName;
            this.availableUpdateReleaseNotes = event.releaseNotes as string | null;
            this.lastUpdateErrorMessage = null;

            // Display the update banner and create a system notification
            this.status = "ready";
            const updateNotification = new Notification({
                title: "Snorkeling",
                body: "A new version of Snorkeling is ready to install.",
            });
            updateNotification.on("click", () => {
                fireAndForget(this.promptToInstallUpdate.bind(this));
            });
            updateNotification.show();
        });

        electronAutoUpdater.on("before-quit-for-update", () => {
            console.log("before-quit-for-update");
            quittingForUpdate = true;
            setGlobalIsQuitting(true);
            setUserConfirmedQuit(true);
            this.status = "installing";
        });
    }

    /**
     * The status of the Updater.
     */
    get status(): UpdaterStatus {
        return this._status;
    }

    private set status(value: UpdaterStatus) {
        this._status = value;
        getAllWaveWindows().forEach((window) => {
            const allTabs = Array.from(window.allLoadedTabViews.values());
            allTabs.forEach((tab) => {
                tab.webContents.send("app-update-status", value);
            });
        });
    }

    /**
     * Check for updates and start the background update check, if configured.
     */
    async start() {
        if (!this.updateSupport.supported && !this.updateSupport.manualInstallOnly) {
            console.log("skipping updater start because this installation does not support in-place updates");
            return;
        }
        if (this.autoCheckEnabled) {
            console.log("starting updater");
            this.autoCheckInterval = setInterval(() => {
                fireAndForget(() => this.checkForUpdates(false));
            }, 600000); // intervals are unreliable when an app is suspended so we will check every 10 mins if the interval has passed.
            await this.checkForUpdates(false);
        }
    }

    /**
     * Stop the background update check, if configured.
     */
    stop() {
        console.log("stopping updater");
        if (this.autoCheckInterval) {
            clearInterval(this.autoCheckInterval);
            this.autoCheckInterval = null;
        }
    }

    /**
     * Checks if the configured interval time has passed since the last update check, and if so, checks for updates using the `autoUpdater` object
     * @param userInput Whether the user is requesting this. If so, an alert will report the result of the check.
     */
    async checkForUpdates(userInput: boolean) {
        const now = new Date();
        if (!this.updateSupport.supported && !this.updateSupport.manualInstallOnly) {
            if (userInput) {
                const dialogOpts: Electron.MessageBoxOptions = {
                    type: "info",
                    buttons: ["OK", "Open Latest Release"],
                    defaultId: 0,
                    cancelId: 0,
                    message: "Automatic updates are unavailable for this copy.",
                    detail:
                        this.updateSupport.reason ??
                        "This copy does not support automatic in-place updates. Please install the Windows setup package (.exe) to receive automatic updates.",
                };
                const dialogResult = focusedWaveWindow
                    ? await dialog.showMessageBox(focusedWaveWindow, dialogOpts)
                    : await dialog.showMessageBox(dialogOpts);
                if (dialogResult.response === 1) {
                    await shell.openExternal(SnorkelingLatestReleaseUrl);
                }
            }
            return;
        }

        // Run an update check always if the user requests it, otherwise only if there's an active update check interval and enough time has elapsed.
        if (
            userInput ||
            (this.autoCheckInterval &&
                (!this.lastUpdateCheck || Math.abs(now.getTime() - this.lastUpdateCheck.getTime()) > this.intervalms))
        ) {
            try {
                const result = await autoUpdater.checkForUpdates();
                this.lastChecked = now;

                // If the user requested this check and we do not have an available update, let them know with a popup dialog. No need to tell them if there is an update, because we show a banner once the update is ready to install.
                if (userInput && !result.downloadPromise && this.status !== "manual-update") {
                    const dialogOpts: Electron.MessageBoxOptions = {
                        type: "info",
                        message: "There are currently no updates available.",
                    };
                    if (focusedWaveWindow) {
                        await dialog.showMessageBox(focusedWaveWindow, dialogOpts);
                    } else {
                        await dialog.showMessageBox(dialogOpts);
                    }
                }

                // Only update the last check time if this is an automatic check. This ensures the interval remains consistent.
                if (!userInput) this.lastUpdateCheck = now;
            } catch (err) {
                if (isOfflineError(err)) {
                    // Background/periodic check while offline: keep quiet. User-initiated checks
                    // also stay silent here, matching the behaviour of the app's other network
                    // errors — there is no reachable update we could have told them about.
                    if (!userInput) this.lastUpdateCheck = now;
                    return;
                }
                if (userInput) {
                    const code = (err as any)?.code ?? "";
                    const detail =
                        code === "ERR_UPDATER_NO_PUBLISHED_VERSIONS"
                            ? "No published update versions were found. Please ensure releases are tagged with a valid semantic version (for example: v0.14.5-beta.4.snorkeling.0.0.6)."
                            : err instanceof Error
                              ? err.message
                              : String(err);
                    const dialogOpts: Electron.MessageBoxOptions = {
                        type: "error",
                        message: "Failed to check for updates.",
                        detail,
                    };
                    if (focusedWaveWindow) {
                        await dialog.showMessageBox(focusedWaveWindow, dialogOpts);
                    } else {
                        await dialog.showMessageBox(dialogOpts);
                    }
                }
                throw err;
            }
        }
    }

    /** True if we have never successfully completed an update check. */
    get hasEverChecked(): boolean {
        return this.lastChecked != null;
    }

    /**
     * Prompts the user to install the downloaded application update and restarts the application
     */
    async promptToInstallUpdate() {
        if (this.updateSupport.manualInstallOnly) {
            if (this.status === "manual-update") {
                // For ad-hoc/Mac-zip builds we own the download+swap rather than punting
                // to a browser: the user clicked because they want the new build, not a
                // search box on a web page that doesn't know what arch they're on.
                await this.startManualInstallFlow();
                return;
            }
            if (this.status === "error" && this.manualInstall?.phase === "failed") {
                // After a cancel or a network failure, offer retry via the same dialog.
                await this.showManualInstallDialog();
                return;
            }
        }

        if (this.status !== "ready") {
            await this.showInstallUnavailableDialog();
            return;
        }

        const dialogOpts: Electron.MessageBoxOptions = {
            type: "info",
            buttons: ["Restart", "Later"],
            title: "Application Update",
            message: process.platform === "win32" ? this.availableUpdateReleaseNotes : this.availableUpdateReleaseName,
            detail: "A new version has been downloaded. Restart the application to apply the updates.",
        };

        const allWindows = getAllWaveWindows();
        if (allWindows.length > 0) {
            await dialog.showMessageBox(focusedWaveWindow ?? allWindows[0], dialogOpts).then(({ response }) => {
                if (response === 0) {
                    fireAndForget(this.installUpdate.bind(this));
                }
            });
        }
    }

    /**
     * Restarts the app and installs an update if it is available.
     */
    async installUpdate() {
        if (this.updateSupport.manualInstallOnly) {
            await this.showManualInstallDialog();
            return;
        }

        if (this.status !== "ready") {
            await this.showInstallUnavailableDialog();
            return;
        }

        quittingForUpdate = true;
        setGlobalIsQuitting(true);
        setUserConfirmedQuit(true);
        this.status = "installing";
        await delay(1000);
        try {
            autoUpdater.quitAndInstall();
        } catch (e) {
            console.warn("failed to quit and install update", e);
            quittingForUpdate = false;
            setGlobalIsQuitting(false);
            this.lastUpdateErrorMessage = e instanceof Error ? e.message : String(e);
            this.status = "error";
        }
    }

    private async showInstallUnavailableDialog() {
        const detail = this.lastUpdateErrorMessage
            ? `The downloaded update could not be prepared for installation.\n\n${this.lastUpdateErrorMessage}\n\nPlease install the latest release manually.`
            : "The downloaded update is no longer ready to install. Please check for updates again or install the latest release manually.";
        const dialogOpts: Electron.MessageBoxOptions = {
            type: "error",
            buttons: ["OK", "Open Latest Release"],
            defaultId: 0,
            cancelId: 0,
            message: "Automatic update failed.",
            detail,
        };
        const allWindows = getAllWaveWindows();
        const dialogResult =
            allWindows.length > 0
                ? await dialog.showMessageBox(focusedWaveWindow ?? allWindows[0], dialogOpts)
                : await dialog.showMessageBox(dialogOpts);
        if (dialogResult.response === 1) {
            await shell.openExternal(SnorkelingLatestReleaseUrl);
        }
    }

    private setManualInstallPhase(
        next: NonNullable<Updater["manualInstall"]>,
        alsoStatus?: UpdaterStatus
    ) {
        this.manualInstall = next;
        if (alsoStatus) this.status = alsoStatus;
        // Broadcast the progress snapshot (received/total) even when the headline
        // status string hasn't changed — a "downloading" at 0 MB and at 180 MB
        // need to look different.
        const payload = {
            phase: next.phase,
            received: next.received,
            total: next.total,
            error: next.error,
            version: next.version,
        };
        getAllWaveWindows().forEach((window) => {
            for (const tabView of window.allLoadedTabViews.values()) {
                if (!tabView.webContents.isDestroyed()) {
                    tabView.webContents.send("app-update-manual-progress", payload);
                }
            }
        });
    }

    /**
     * In-app manual-install flow for `manualInstallOnly` builds (ad-hoc macOS).
     *
     * Picks the right asset by platform+arch, downloads it to a per-version
     * temp dir with a `.part` partial survive-crash convention, unpacks with
     * `ditto` (preserves xattrs and symlinks that generic zip libs quietly
     * drop), verifies the bundle, and waits for the user to say restart.
     *
     * Deliberately not part of `checkForUpdates`: we don't want a scheduled
     * check to start a multi-hundred-MB download in the background when the
     * user hasn't said they want to move yet.
     */
    async startManualInstallFlow() {
        if (this.manualInstall && (this.manualInstall.phase === "downloading" || this.manualInstall.phase === "installing")) {
            return;
        }
        if (process.platform !== "darwin") {
            await shell.openExternal(SnorkelingLatestReleaseUrl);
            return;
        }

        const doDownload = async () => {
            const aborter = new AbortController();
            this.currentAborter = aborter;
            this.setManualInstallPhase({ phase: "downloading", received: 0, total: 0 }, "downloading");
            void sweepStaleDownloadDirs(this.manualInstall?.version).catch(() => {});
            // If this download got cancelled before we finished, silently replace
            // the error path with a no-op so a stale pipeline doesn't mark itself failed.
            const throwIfAborted = () => {
                if (aborter.signal.aborted) {
                    const e: any = new Error("cancelled");
                    e.name = "AbortError";
                    throw e;
                }
            };
            try {
                const release = await fetchLatestRelease({ signal: aborter.signal });
                throwIfAborted();
                const asset = pickAsset(release.assets);
                if (!asset) {
                    throw new Error("No downloadable asset matches this machine (macOS / this CPU).");
                }

                const versionedDir = await mkdtemp(path.join(tmpdir(), `snorkeling-update-${release.version}-`));
                const file = path.join(versionedDir, asset.name);
                await this.downloadToFile(asset.url, asset.size, file, aborter);
                throwIfAborted();

                const stagedDir = path.join(versionedDir, "unpacked");
                await mkdir(stagedDir, { recursive: true });
                await unzipZip(file, stagedDir);

                const bundleName = `${app.getName()}.app`;
                const stagedApp = path.join(stagedDir, bundleName);
                if (!(await stat(stagedApp).catch(() => null))?.isDirectory()) {
                    throw new Error(`Downloaded archive did not contain ${bundleName}`);
                }

                const target = installedAppBundle(app.getPath("exe"));
                if (!target) {
                    throw new Error("This copy is not running from an installed .app bundle.");
                }

                this.setManualInstallPhase(
                    {
                        phase: "ready",
                        version: release.version,
                        file,
                        stagedAppPath: stagedApp,
                        targetBundle: target,
                    },
                    "ready"
                );
                this.availableUpdateReleaseName = release.name;
                this.availableUpdateReleaseNotes = release.body;

                const restart = await dialog.showMessageBox({
                    type: "info",
                    buttons: ["Restart & Install", "Later"],
                    defaultId: 0,
                    cancelId: 1,
                    message: `Snorkeling ${release.version} is ready.`,
                    detail: "The update has been downloaded and unpacked. Restart now to swap it in.",
                });
                if (restart.response === 0) {
                    await this.finishManualInstall();
                }
            } catch (e) {
                const isCancel = (e as any)?.name === "AbortError";
                const message = isCancel ? "cancelled" : e instanceof Error ? e.message : String(e);
                this.setManualInstallPhase(
                    { phase: "failed", error: message },
                    isCancel ? "manual-update" : "error"
                );
                if (!isCancel) {
                    this.lastUpdateErrorMessage = message;
                }
            } finally {
                if (this.currentAborter === aborter) this.currentAborter = null;
            }
        };

        void doDownload();
    }

    /**
     * Abort any in-flight manual download and roll its state back to a "you can
     * press download again" posture. The `.part` file is left on disk so the
     * retry can resume with Range.
     *
     * NOTE: we deliberately overwrite the in-flight phase via setManualInstallPhase
     * rather than letting the aborted pipeline write "failed" itself — the pipeline
     * still unwinds, but by the time its catch runs `this.manualInstall` has been
     * replaced and this record wins. Crucial for status to settle on manual-update.
     */
    cancelManualDownload() {
        if (this.manualInstall?.phase === "downloading" || this.manualInstall?.phase === "installing") {
            this.currentAborter?.abort();
            this.currentAborter = null;
            this.setManualInstallPhase({ phase: "failed", error: "cancelled" }, "manual-update");
        }
    }

    /**
     * Retry after a failed or cancelled manual download. Just calls startManualInstallFlow
     * again, which will pick up the `.part` partial via Range resume.
     */
    retryManualDownload() {
        if (this.manualInstall?.phase !== "failed") return;
        this.manualInstall = null;
        void this.startManualInstallFlow();
    }

    private async finishManualInstall() {
        const cur = this.manualInstall;
        if (!cur || cur.phase !== "ready" || !cur.stagedAppPath || !cur.targetBundle) {
            return;
        }
        this.setManualInstallPhase({ ...cur, phase: "installing" }, "installing");
        try {
            await scheduleSwap({ staged: cur.stagedAppPath, target: cur.targetBundle });
        } catch (e) {
            this.setManualInstallPhase(
                { ...cur, phase: "failed", error: e instanceof Error ? e.message : String(e) },
                "error"
            );
            return;
        }
        quittingForUpdate = true;
        setGlobalIsQuitting(true);
        setUserConfirmedQuit(true);
        // exit, not quit: quitting runs window-close handlers that keep the app resident
        // in the tray, which would leave the swap script waiting on a pid that never dies.
        setTimeout(() => app.exit(0), 50);
    }

    private async downloadToFile(url: string, expectedSize: number, filePath: string, aborter: AbortController) {
        const partPath = `${filePath}.part`;
        const have = await stat(partPath).then((s) => s.size).catch(() => 0);
        const headers: Record<string, string> = { "User-Agent": `Snorkeling/${app.getVersion()}` };
        if (have > 0) headers.Range = `bytes=${have}-`;
        const res = await fetch(url, { headers, redirect: "follow", signal: aborter.signal });
        if (!(res.status >= 200 && res.status < 300)) {
            throw new Error(`Download failed: HTTP ${res.status}`);
        }
        const append = res.status === 206;
        const out = createWriteStream(partPath, { flags: append ? "a" : "w" });
        let received = have;
        const markProgress = () => {
            const cur = this.manualInstall;
            if (cur?.phase === "downloading") {
                this.setManualInstallPhase({ ...cur, received, total: expectedSize });
            }
        };
        markProgress();
        await pipeline(
            Readable.fromWeb(res.body as any),
            async function* (source: AsyncIterable<Buffer>) {
                for await (const chunk of source) {
                    if (aborter.signal.aborted) {
                        const e: any = new Error("cancelled");
                        e.name = "AbortError";
                        throw e;
                    }
                    received += chunk.length;
                    markProgress();
                    yield chunk;
                }
            },
            out
        );
        const finalSize = await stat(partPath).then((s) => s.size);
        if (expectedSize > 0 && finalSize !== expectedSize) {
            // Don't trust the partial; a size mismatch at the end means the file we
            // have is not the file the release said it would be.
            throw new Error(`Download size mismatch: got ${finalSize}, expected ${expectedSize}`);
        }
        await rename(partPath, filePath);
    }

    private async showManualInstallDialog() {
        const releaseText = this.availableUpdateReleaseName
            ? `A new Snorkeling release is available: ${this.availableUpdateReleaseName}.`
            : "A new Snorkeling release is available.";
        const detail = this.updateSupport.reason ?? "Automatic installation is unavailable for this copy.";
        const offerDownload = process.platform === "darwin" && Boolean(this.updateSupport.manualInstallOnly);
        const dialogOpts: Electron.MessageBoxOptions = {
            type: "info",
            buttons: offerDownload ? ["Download & Install", "Open Release Page", "Later"] : ["Open Latest Release", "Later"],
            defaultId: 0,
            cancelId: offerDownload ? 2 : 1,
            message: "Manual update required.",
            detail: `${releaseText}\n\n${detail}`,
        };
        const allWindows = getAllWaveWindows();
        const dialogResult =
            allWindows.length > 0
                ? await dialog.showMessageBox(focusedWaveWindow ?? allWindows[0], dialogOpts)
                : await dialog.showMessageBox(dialogOpts);
        if (offerDownload && dialogResult.response === 0) {
            await this.startManualInstallFlow();
            return;
        }
        if (dialogResult.response === (offerDownload ? 1 : 0)) {
            await shell.openExternal(SnorkelingLatestReleaseUrl);
        }
    }
}

export function getResolvedUpdateChannel(): string {
    return isDev() ? "dev" : (autoUpdater.channel ?? "latest");
}

ipcMain.on("install-app-update", () => fireAndForget(updater?.promptToInstallUpdate.bind(updater)));
ipcMain.on("cancel-app-update-download", () => updater?.cancelManualDownload());
ipcMain.on("retry-app-update-download", () => updater?.retryManualDownload());
ipcMain.on("get-app-update-status", (event) => {
    event.returnValue = updater?.status;
});
ipcMain.on("get-app-update-manual-progress", (event) => {
    const cur = updater?.["manualInstall"] ?? null;
    event.returnValue = cur ? { ...cur } : null;
});
ipcMain.on("get-app-update-last-checked", (event) => {
    event.returnValue = updater?.lastChecked?.toISOString() ?? null;
});
ipcMain.on("get-updater-channel", (event) => {
    event.returnValue = getResolvedUpdateChannel();
});

let autoUpdateLock = false;

/**
 * Configures the auto-updater based on the user's preference
 */
export async function configureAutoUpdater() {
    if (isDev()) {
        console.log("skipping auto-updater in dev mode");
        return;
    }

    // simple lock to prevent multiple auto-update configuration attempts, this should be very rare
    if (autoUpdateLock) {
        console.log("auto-update configuration already in progress, skipping");
        return;
    }
    autoUpdateLock = true;

    try {
        console.log("Configuring updater");
        const settings = (await RpcApi.GetFullConfigCommand(ElectronWshClient)).settings;
        updater = new Updater(settings);
        await updater.start();
    } catch (e) {
        console.warn("error configuring updater", e.toString());
    }

    autoUpdateLock = false;
}
