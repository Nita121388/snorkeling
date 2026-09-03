// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as electron from "electron";
import { FastAverageColor } from "fast-average-color";
import fs from "fs";
import * as child_process from "node:child_process";
import { pathToFileURL } from "node:url";
import * as path from "path";
import { PNG } from "pngjs";
import { Readable } from "stream";
import { RpcApi } from "../frontend/app/store/wshclientapi";
import { getWebServerEndpoint } from "../frontend/util/endpoints";
import * as keyutil from "../frontend/util/keyutil";
import { fireAndForget, parseDataUrl } from "../frontend/util/util";
import { resolveGitBranch } from "./dev-git";
import {
    incrementTermCommandsDurable,
    incrementTermCommandsRemote,
    incrementTermCommandsRun,
    incrementTermCommandsWsl,
    setWasActive,
} from "./emain-activity";
import { createBuilderWindow, getAllBuilderWindows, getBuilderWindowByWebContentsId } from "./emain-builder";
import {
    callWithOriginalXdgCurrentDesktopAsync,
    getWaveConfigDir,
    getWaveDataDir,
    isDev,
    unameArch,
    unamePlatform,
} from "./emain-platform";
import { getWaveTabViewByWebContentsId } from "./emain-tabview";
import { handleCtrlShiftState } from "./emain-util";
import { getWaveVersion } from "./emain-wavesrv";
import { createNewWaveWindow, getWaveWindowByWebContentsId } from "./emain-window";
import { ElectronWshClient } from "./emain-wsh";
import { getResolvedUpdateChannel, updater } from "./updater";
import { encodeFilePathsBplist, encodeFileUrlsBplist } from "./encode-clipboard";

const electronApp = electron.app;

let webviewFocusId: number = null;
let webviewKeys: string[] = [];

export function openBuilderWindow(appId?: string) {
    const normalizedAppId = appId || "";
    const existingBuilderWindows = getAllBuilderWindows();
    const existingWindow = existingBuilderWindows.find((win) => win.builderAppId === normalizedAppId);
    if (existingWindow) {
        existingWindow.focus();
        return;
    }
    fireAndForget(() => createBuilderWindow(normalizedAppId));
}

type UrlInSessionResult = {
    stream: Readable;
    mimeType: string;
    fileName: string;
};

function getSingleHeaderVal(headers: Record<string, string | string[]>, key: string): string {
    const val = headers[key];
    if (val == null) {
        return null;
    }
    if (Array.isArray(val)) {
        return val[0];
    }
    return val;
}

function cleanMimeType(mimeType: string): string {
    if (mimeType == null) {
        return null;
    }
    const parts = mimeType.split(";");
    return parts[0].trim();
}

function getFileNameFromUrl(url: string): string {
    try {
        const pathname = new URL(url).pathname;
        const filename = pathname.substring(pathname.lastIndexOf("/") + 1);
        return filename;
    } catch (e) {
        return null;
    }
}

function execFilePromise(cmd: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
        child_process.execFile(cmd, args, (err) => {
            if (err != null) {
                reject(err);
                return;
            }
            resolve();
        });
    });
}

function normalizeUserPath(rawPath: string): string {
    const expandedPath = rawPath.replace(/^~(?=$|[\\/])/, electronApp.getPath("home"));
    return path.resolve(expandedPath);
}

function normalizeNativePath(rawPath: string): string {
    if (typeof rawPath !== "string" || rawPath === "") {
        return "";
    }
    let expandedPath = rawPath.replace(/^~(?=$|[\\/])/, electronApp.getPath("home"));
    if (process.platform === "win32" && /^[A-Za-z]:(?![\\/])/.test(expandedPath)) {
        expandedPath = `${expandedPath.slice(0, 2)}\\${expandedPath.slice(2)}`;
    }
    return path.normalize(expandedPath);
}

function makeVSCodeFileUri(localPath: string): string {
    const fileUri = pathToFileURL(localPath).toString();
    return `vscode://file${fileUri.slice("file://".length)}`;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function redactHomePath(value: string): string {
    if (typeof value !== "string" || value === "") {
        return value;
    }
    const homeDir = electronApp.getPath("home");
    if (!homeDir) {
        return value;
    }
    return value.replace(new RegExp(escapeRegExp(homeDir), "g"), "~");
}

function redactSensitiveText(value: string): string {
    if (typeof value !== "string" || value === "") {
        return value;
    }
    return redactHomePath(value)
        .replace(
            /\b([A-Za-z_][A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASS|PWD)[A-Za-z0-9_]*)(\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;]+)/gi,
            "$1$2<redacted>"
        )
        .replace(/\b(authkey|auth_key|apikey|api_key)(\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;]+)/gi, "$1$2<redacted>");
}

function readTextFileTail(filePath: string, maxBytes = 128 * 1024, maxLines = 200): AppDebugInfoLog {
    const redactedPath = redactHomePath(filePath);
    try {
        if (!fs.existsSync(filePath)) {
            return { path: redactedPath, exists: false };
        }
        const stats = fs.statSync(filePath);
        const length = Math.min(stats.size, maxBytes);
        const buffer = Buffer.alloc(length);
        const fd = fs.openSync(filePath, "r");
        try {
            fs.readSync(fd, buffer, 0, length, Math.max(0, stats.size - length));
        } finally {
            fs.closeSync(fd);
        }
        const tail = buffer.toString("utf8").split(/\r?\n/).slice(-maxLines).join("\n").trim();
        return {
            path: redactedPath,
            exists: true,
            size: stats.size,
            modifiedAt: stats.mtime.toISOString(),
            tail: redactSensitiveText(tail),
        };
    } catch (e) {
        return {
            path: redactedPath,
            exists: fs.existsSync(filePath),
            error: redactSensitiveText(e instanceof Error ? e.message : String(e)),
        };
    }
}

function parseDevPort(value: string | undefined): number | null {
    const port = Number(value);
    return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

function parseRendererPort(value: string | undefined): number | null {
    if (!value) {
        return null;
    }
    try {
        return parseDevPort(new URL(value).port);
    } catch {
        return null;
    }
}

function makeDevEndpoint(port: number | null, requestedPort: number | null): DevRuntimeEndpoint | null {
    if (port == null) {
        return null;
    }
    return {
        port,
        requestedPort: requestedPort ?? port,
        url: `http://127.0.0.1:${port}`,
    };
}

function makeDevRuntimeInfo(): DevRuntimeInfo | null {
    if (!isDev) {
        return null;
    }
    const vitePort =
        parseDevPort(process.env.SNORKELING_VITE_PORT) ?? parseRendererPort(process.env.ELECTRON_RENDERER_URL);
    const cdpPort = parseDevPort(process.env.SNORKELING_CDP_PORT);
    const cdp = makeDevEndpoint(cdpPort, parseDevPort(process.env.SNORKELING_CDP_REQUESTED_PORT));
    const gitBranch = resolveGitBranch(process.cwd()) ?? resolveGitBranch(electronApp.getAppPath());
    const cdpJsonUrl = cdp == null ? null : `${cdp.url}/json/version`;
    const version = getWaveVersion();
    const dataDir = getWaveDataDir();
    const configDir = getWaveConfigDir();
    return {
        profile: process.env.SNORKELING_DEV_PROFILE || "default",
        gitBranch,
        portMode: process.env.SNORKELING_PORT_MODE === "strict" ? "strict" : "auto",
        vite: makeDevEndpoint(vitePort, parseDevPort(process.env.SNORKELING_VITE_REQUESTED_PORT)),
        cdp,
        cdpJsonUrl,
        inspectCommand: cdp == null ? null : `node scripts/inspect-electron-ui.mjs --endpoint ${cdp.url} state`,
        appVersion: version?.version ?? null,
        electronVersion: process.versions?.electron ?? null,
        nodeVersion: process.versions?.node ?? null,
        dirs: {
            data: dataDir,
            config: configDir,
            logFile: path.join(dataDir, "waveapp.log"),
        },
    };
}

function makeAppDebugInfo(): AppDebugInfo {
    const version = getWaveVersion();
    const dataDir = getWaveDataDir();
    const configDir = getWaveConfigDir();
    const logFile = path.join(dataDir, "waveapp.log");
    return {
        generatedAt: new Date().toISOString(),
        devRuntime: makeDevRuntimeInfo(),
        app: {
            name: electronApp.getName(),
            version: version.version,
            buildTime: version.buildTime,
            isPackaged: electronApp.isPackaged,
            isDev,
        },
        runtime: {
            platform: unamePlatform,
            arch: unameArch,
            electron: process.versions.electron,
            chrome: process.versions.chrome,
            node: process.versions.node,
            v8: process.versions.v8,
        },
        updater: {
            status: updater?.status ?? null,
            channel: getResolvedUpdateChannel(),
            autoCheckEnabled: updater?.autoCheckEnabled ?? null,
            intervalms: updater?.intervalms ?? null,
            lastUpdateCheck: updater?.lastUpdateCheck?.toISOString?.() ?? null,
            updateSupport: updater?.updateSupport ?? null,
            availableUpdateReleaseName: updater?.availableUpdateReleaseName ?? null,
        },
        paths: {
            home: redactHomePath(electronApp.getPath("home")),
            data: redactHomePath(dataDir),
            config: redactHomePath(configDir),
            logFile: redactHomePath(logFile),
        },
        logs: {
            waveapp: readTextFileTail(logFile),
        },
    };
}

async function openPathInVSCode(filePath: string): Promise<void> {
    const normalizedPath = normalizeUserPath(filePath);
    const codeCmd = process.platform === "win32" ? "code.cmd" : "code";

    try {
        await execFilePromise(codeCmd, ["--new-window", normalizedPath]);
        return;
    } catch (err) {
        console.log("open-in-vscode: code CLI unavailable, fallback", err);
    }

    if (unamePlatform === "darwin") {
        try {
            await execFilePromise("open", ["-a", "Visual Studio Code", normalizedPath]);
            return;
        } catch (err) {
            console.log("open-in-vscode: macOS open fallback failed", err);
        }
    }

    const vscodeUri = makeVSCodeFileUri(normalizedPath);
    await callWithOriginalXdgCurrentDesktopAsync(() => electron.shell.openExternal(vscodeUri));
}

function getUrlInSession(session: Electron.Session, url: string): Promise<UrlInSessionResult> {
    return new Promise((resolve, reject) => {
        if (url.startsWith("data:")) {
            try {
                const parsed = parseDataUrl(url);
                const buffer = Buffer.from(parsed.buffer);
                const readable = Readable.from(buffer);
                resolve({ stream: readable, mimeType: parsed.mimeType, fileName: "image" });
            } catch (err) {
                return reject(err);
            }
            return;
        }
        const request = electron.net.request({
            url,
            method: "GET",
            session,
        });
        const readable = new Readable({
            read() {},
        });
        request.on("response", (response) => {
            const statusCode = response.statusCode;
            if (statusCode < 200 || statusCode >= 300) {
                readable.destroy();
                request.abort();
                reject(new Error(`HTTP request failed with status ${statusCode}: ${response.statusMessage || ""}`));
                return;
            }

            const mimeType = cleanMimeType(getSingleHeaderVal(response.headers, "content-type"));
            const fileName = getFileNameFromUrl(url) || "image";
            response.on("data", (chunk) => {
                readable.push(chunk);
            });
            response.on("end", () => {
                readable.push(null);
                resolve({ stream: readable, mimeType, fileName });
            });
            response.on("error", (err) => {
                readable.destroy(err);
                reject(err);
            });
        });
        request.on("error", (err) => {
            readable.destroy(err);
            reject(err);
        });
        request.end();
    });
}

function saveImageFileWithNativeDialog(
    sender: electron.WebContents,
    defaultFileName: string,
    mimeType: string,
    readStream: Readable
) {
    if (defaultFileName == null || defaultFileName == "") {
        defaultFileName = "image";
    }
    const ww = electron.BrowserWindow.fromWebContents(sender);
    if (ww == null) {
        readStream.destroy();
        return;
    }
    const mimeToExtension: { [key: string]: string } = {
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/gif": "gif",
        "image/webp": "webp",
        "image/bmp": "bmp",
        "image/tiff": "tiff",
        "image/heic": "heic",
        "image/svg+xml": "svg",
    };
    function addExtensionIfNeeded(fileName: string, mimeType: string): string {
        const extension = mimeToExtension[mimeType];
        if (!path.extname(fileName) && extension) {
            return `${fileName}.${extension}`;
        }
        return fileName;
    }
    defaultFileName = addExtensionIfNeeded(defaultFileName, mimeType);
    electron.dialog
        .showSaveDialog(ww, {
            title: "Save Image",
            defaultPath: defaultFileName,
            filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "tiff", "heic"] }],
        })
        .then((file) => {
            if (file.canceled) {
                readStream.destroy();
                return;
            }
            const writeStream = fs.createWriteStream(file.filePath);
            readStream.pipe(writeStream);
            writeStream.on("finish", () => {
                console.log("saved file", file.filePath);
            });
            writeStream.on("error", (err) => {
                console.log("error saving file (writeStream)", err);
                readStream.destroy();
            });
            readStream.on("error", (err) => {
                console.error("error saving file (readStream)", err);
                writeStream.destroy();
            });
        })
        .catch((err) => {
            console.log("error trying to save file", err);
        });
}

export function initIpcHandlers() {
    electron.ipcMain.on("open-external", (event, url) => {
        if (url && typeof url === "string") {
            fireAndForget(() =>
                callWithOriginalXdgCurrentDesktopAsync(() =>
                    electron.shell.openExternal(url).catch((err) => {
                        console.error(`Failed to open URL ${url}:`, err);
                    })
                )
            );
        } else {
            console.error("Invalid URL received in open-external event:", url);
        }
    });

    electron.ipcMain.on("webview-image-contextmenu", (event: electron.IpcMainEvent, payload: { src: string }) => {
        const menu = new electron.Menu();
        const win = getWaveWindowByWebContentsId(event.sender.hostWebContents?.id);
        if (win == null) {
            return;
        }
        menu.append(
            new electron.MenuItem({
                label: "Save Image",
                click: () => {
                    const resultP = getUrlInSession(event.sender.session, payload.src);
                    resultP
                        .then((result) => {
                            saveImageFileWithNativeDialog(
                                event.sender.hostWebContents,
                                result.fileName,
                                result.mimeType,
                                result.stream
                            );
                        })
                        .catch((e) => {
                            console.log("error getting image", e);
                        });
                },
            })
        );
        menu.popup();
    });

    electron.ipcMain.on("webview-mouse-navigate", (event: electron.IpcMainEvent, direction: string) => {
        if (direction === "back") {
            event.sender.navigationHistory.goBack();
        } else if (direction === "forward") {
            event.sender.navigationHistory.goForward();
        }
    });

    electron.ipcMain.on("download", (event, payload) => {
        const baseName = encodeURIComponent(path.basename(payload.filePath));
        const streamingUrl =
            getWebServerEndpoint() + "/wave/stream-file/" + baseName + "?path=" + encodeURIComponent(payload.filePath);
        event.sender.downloadURL(streamingUrl);
    });

    electron.ipcMain.on("get-cursor-point", (event) => {
        const tabView = getWaveTabViewByWebContentsId(event.sender.id);
        if (tabView == null) {
            event.returnValue = null;
            return;
        }
        const screenPoint = electron.screen.getCursorScreenPoint();
        const windowRect = tabView.getBounds();
        const retVal: Electron.Point = {
            x: screenPoint.x - windowRect.x,
            y: screenPoint.y - windowRect.y,
        };
        event.returnValue = retVal;
    });

    electron.ipcMain.handle("capture-screenshot", async (event, rect) => {
        const tabView = getWaveTabViewByWebContentsId(event.sender.id);
        if (!tabView) {
            throw new Error("No tab view found for the given webContents id");
        }
        const image = await tabView.webContents.capturePage(rect);
        const base64String = image.toPNG().toString("base64");
        return `data:image/png;base64,${base64String}`;
    });

    electron.ipcMain.on("get-env", (event, varName) => {
        event.returnValue = process.env[varName] ?? null;
    });

    electron.ipcMain.on("get-dev-runtime-info", (event) => {
        event.returnValue = makeDevRuntimeInfo();
    });

    electron.ipcMain.on("get-about-modal-details", (event) => {
        event.returnValue = getWaveVersion() as AboutModalDetails;
    });

    electron.ipcMain.handle("get-app-debug-info", async () => {
        return makeAppDebugInfo();
    });

    electron.ipcMain.on("get-zoom-factor", (event) => {
        event.returnValue = event.sender.getZoomFactor();
    });

    const hasBeforeInputRegisteredMap = new Map<number, boolean>();

    electron.ipcMain.on("webview-focus", (event: Electron.IpcMainEvent, focusedId: number) => {
        webviewFocusId = focusedId;
        console.log("webview-focus", focusedId);
        if (focusedId == null) {
            return;
        }
        const parentWc = event.sender;
        const webviewWc = electron.webContents.fromId(focusedId);
        if (webviewWc == null) {
            webviewFocusId = null;
            return;
        }
        if (!hasBeforeInputRegisteredMap.get(focusedId)) {
            hasBeforeInputRegisteredMap.set(focusedId, true);
            webviewWc.on("before-input-event", (e, input) => {
                let waveEvent = keyutil.adaptFromElectronKeyEvent(input);
                handleCtrlShiftState(parentWc, waveEvent);
                if (webviewFocusId != focusedId) {
                    return;
                }
                if (input.type != "keyDown") {
                    return;
                }
                for (let keyDesc of webviewKeys) {
                    if (keyutil.checkKeyPressed(waveEvent, keyDesc)) {
                        e.preventDefault();
                        parentWc.send("reinject-key", waveEvent);
                        console.log("webview reinject-key", keyDesc);
                        return;
                    }
                }
            });
            webviewWc.on("destroyed", () => {
                hasBeforeInputRegisteredMap.delete(focusedId);
            });
        }
    });

    electron.ipcMain.on("register-global-webview-keys", (event, keys: string[]) => {
        webviewKeys = keys ?? [];
    });

    electron.ipcMain.on("set-keyboard-chord-mode", (event) => {
        event.returnValue = null;
        const tabView = getWaveTabViewByWebContentsId(event.sender.id);
        tabView?.setKeyboardChordMode(true);
    });

    electron.ipcMain.handle("set-is-active", () => {
        setWasActive(true);
    });

    const fac = new FastAverageColor();
    electron.ipcMain.on("update-window-controls-overlay", async (event, rect: Dimensions) => {
        if (unamePlatform === "darwin") return;
        try {
            const fullConfig = await RpcApi.GetFullConfigCommand(ElectronWshClient);
            if (fullConfig?.settings?.["window:nativetitlebar"] && unamePlatform !== "win32") return;

            const zoomFactor = event.sender.getZoomFactor();
            const electronRect: Electron.Rectangle = {
                x: rect.left * zoomFactor,
                y: rect.top * zoomFactor,
                height: rect.height * zoomFactor,
                width: rect.width * zoomFactor,
            };
            const overlay = await event.sender.capturePage(electronRect);
            const overlayBuffer = overlay.toPNG();
            const png = PNG.sync.read(overlayBuffer);
            const color = fac.prepareResult(fac.getColorFromArray4(png.data));
            const ww = getWaveWindowByWebContentsId(event.sender.id);
            if (ww == null) return;
            ww.setTitleBarOverlay({
                color: unamePlatform === "linux" ? color.rgba : "#00000000",
                symbolColor: color.isDark ? "white" : "black",
            });
        } catch (e) {
            console.error("Error updating window controls overlay:", e);
        }
    });

    electron.ipcMain.on("quicklook", (event, filePath: string) => {
        if (unamePlatform !== "darwin") return;
        child_process.execFile("/usr/bin/qlmanage", ["-p", filePath], (error, stdout, stderr) => {
            if (error) {
                console.error(`Error opening Quick Look: ${error}`);
            }
        });
    });

    electron.ipcMain.handle("clear-webview-storage", async (event, webContentsId: number) => {
        try {
            const wc = electron.webContents.fromId(webContentsId);
            if (wc && wc.session) {
                await wc.session.clearStorageData();
                console.log("Cleared cookies and storage for webContentsId:", webContentsId);
            }
        } catch (e) {
            console.error("Failed to clear cookies and storage:", e);
            throw e;
        }
    });

    electron.ipcMain.on("open-native-path", (event, filePath: string) => {
        console.log("open-native-path", filePath);
        filePath = normalizeNativePath(filePath);
        if (filePath === "") {
            console.error("open-native-path: invalid file path", filePath);
            return;
        }
        fireAndForget(() =>
            callWithOriginalXdgCurrentDesktopAsync(() =>
                electron.shell.openPath(filePath).then((excuse) => {
                    if (excuse) console.error(`Failed to open ${filePath} in native application: ${excuse}`);
                })
            )
        );
    });

    electron.ipcMain.on("reveal-native-path", (event, filePath: string) => {
        console.log("reveal-native-path", filePath);
        filePath = normalizeNativePath(filePath);
        if (filePath === "") {
            console.error("reveal-native-path: invalid file path", filePath);
            return;
        }
        electron.shell.showItemInFolder(filePath);
    });

    electron.ipcMain.handle("pick-directory", async (event) => {
        const win = getWaveWindowByWebContentsId(event.sender.id);
        if (win == null) {
            console.error("pick-directory: no parent window for webContents", event.sender.id);
            return null;
        }
        const result = await electron.dialog.showOpenDialog(win, {
            properties: ["openDirectory"],
        });
        if (result.canceled || result.filePaths.length === 0) {
            return null;
        }
        return result.filePaths[0];
    });

    electron.ipcMain.handle("obsidian-read-vaults", async () => {
        try {
            const platform = process.platform;
            let baseDir: string;
            if (platform === "win32") {
                const appData = process.env.APPDATA;
                if (!appData) return [];
                baseDir = appData;
            } else if (platform === "darwin") {
                const home = process.env.HOME || electron.app.getPath("home");
                if (!home) return [];
                baseDir = path.join(home, "Library", "Application Support");
            } else {
                const home = process.env.HOME || electron.app.getPath("home");
                if (!home) return [];
                baseDir = path.join(home, ".config");
            }
            const configPath = path.join(baseDir, "obsidian", "obsidian.json");
            const text = await fs.promises.readFile(configPath, "utf8");
            const json = JSON.parse(text);
            if (json == null || typeof json !== "object") return [];
            const vaults = (json as { vaults?: Record<string, { path?: string }> }).vaults;
            if (vaults == null) return [];
            const out: string[] = [];
            for (const id of Object.keys(vaults)) {
                const v = vaults[id];
                if (v == null) continue;
                const p = v.path;
                if (typeof p !== "string" || p.trim() === "") continue;
                out.push(p);
            }
            return out;
        } catch (e) {
            // obsidian.json missing or unreadable — Obsidian likely not installed/not configured
            return [];
        }
    });

    electron.ipcMain.handle("open-in-vscode", async (event, filePath: string) => {
        if (typeof filePath !== "string" || filePath === "") {
            console.error("open-in-vscode: invalid file path", filePath);
            return false;
        }
        try {
            await openPathInVSCode(filePath);
            return true;
        } catch (err) {
            console.error("open-in-vscode: failed to open path", filePath, err);
            return false;
        }
    });

    electron.ipcMain.on("set-window-init-status", (event, status: "ready" | "wave-ready") => {
        const tabView = getWaveTabViewByWebContentsId(event.sender.id);
        if (tabView != null && tabView.initResolve != null) {
            if (status === "ready") {
                tabView.initResolve();
                if (tabView.savedInitOpts) {
                    console.log("savedInitOpts calling wave-init", tabView.waveTabId);
                    tabView.webContents.send("wave-init", tabView.savedInitOpts);
                }
            } else if (status === "wave-ready") {
                tabView.waveReadyResolve();
            }
            return;
        }

        const builderWindow = getBuilderWindowByWebContentsId(event.sender.id);
        if (builderWindow != null) {
            if (status === "ready") {
                if (builderWindow.savedInitOpts) {
                    console.log("savedInitOpts calling builder-init", builderWindow.savedInitOpts.builderId);
                    builderWindow.webContents.send("builder-init", builderWindow.savedInitOpts);
                }
            }
            return;
        }

        console.log("set-window-init-status: no window found for webContentsId", event.sender.id);
    });

    electron.ipcMain.on("fe-log", (event, logStr: string) => {
        console.log("fe-log", logStr);
    });

    electron.ipcMain.on(
        "increment-term-commands",
        (event, opts?: { isRemote?: boolean; isWsl?: boolean; isDurable?: boolean }) => {
            incrementTermCommandsRun();
            if (opts?.isRemote) {
                incrementTermCommandsRemote();
            }
            if (opts?.isWsl) {
                incrementTermCommandsWsl();
            }
            if (opts?.isDurable) {
                incrementTermCommandsDurable();
            }
        }
    );

    electron.ipcMain.on("native-paste", (event) => {
        event.sender.paste();
    });

    electron.ipcMain.handle("write-clipboard-text", async (_event, text: string) => {
        if (typeof text !== "string" || text === "") {
            return false;
        }
        electron.clipboard.writeText(text);
        return true;
    });

    electron.ipcMain.handle("write-clipboard-files", async (_event, filePaths: string[], fallbackText?: string) => {
        const validFilePaths = (Array.isArray(filePaths) ? filePaths : []).filter((filePath) => {
            return typeof filePath === "string" && filePath !== "" && fs.existsSync(filePath);
        });
        const text = typeof fallbackText === "string" && fallbackText !== "" ? fallbackText : validFilePaths.join("\n");
        if (validFilePaths.length === 0) {
            if (text !== "") {
                electron.clipboard.writeText(text);
            }
            return false;
        }
        if (process.platform === "darwin") {
            electron.clipboard.write({
                text,
            });
            electron.clipboard.writeBuffer("NSFilenamesPboardType", encodeFilePathsBplist(validFilePaths));
            electron.clipboard.writeBuffer("public.file-url", encodeFileUrlsBplist(validFilePaths));
            return true;
        }
        electron.clipboard.writeText(text);
        return false;
    });

    electron.ipcMain.on("open-builder", (event, appId?: string) => {
        openBuilderWindow(appId);
    });

    electron.ipcMain.on("set-builder-window-appid", (event, appId: string) => {
        const bw = getBuilderWindowByWebContentsId(event.sender.id);
        if (bw == null) {
            return;
        }
        bw.builderAppId = appId;
        console.log("set-builder-window-appid", bw.builderId, appId);
    });

    electron.ipcMain.on("open-new-window", () => fireAndForget(createNewWaveWindow));

    electron.ipcMain.on("close-builder-window", async (event) => {
        const bw = getBuilderWindowByWebContentsId(event.sender.id);
        if (bw == null) {
            return;
        }
        const builderId = bw.builderId;
        if (builderId) {
            try {
                await RpcApi.SetRTInfoCommand(ElectronWshClient, {
                    oref: `builder:${builderId}`,
                    data: {} as ObjRTInfo,
                    delete: true,
                });
            } catch (e) {
                console.error("Error deleting builder rtinfo:", e);
            }
        }
        bw.destroy();
    });

    electron.ipcMain.on("do-refresh", (event) => {
        event.sender.reloadIgnoringCache();
    });

    electron.ipcMain.handle("save-text-file", async (event, fileName: string, content: string) => {
        const ww = electron.BrowserWindow.fromWebContents(event.sender);
        if (ww == null) {
            return false;
        }
        const result = await electron.dialog.showSaveDialog(ww, {
            title: "Save Scrollback",
            defaultPath: fileName || "session.log",
            filters: [{ name: "Text Files", extensions: ["txt", "log"] }],
        });
        if (result.canceled || !result.filePath) {
            return false;
        }
        try {
            await fs.promises.writeFile(result.filePath, content, "utf-8");
            console.log("saved scrollback to", result.filePath);
            return true;
        } catch (err) {
            console.error("error saving scrollback file", err);
            return false;
        }
    });

    // markdown 导出插件：把渲染好的 HTML 落盘（.html）。
    // 返回结构化结果 { ok, canceled, filePath, error }，供前端做成功/失败反馈。
    electron.ipcMain.handle("export-html", async (event, fileName: string, html: string) => {
        const ww = electron.BrowserWindow.fromWebContents(event.sender);
        if (ww == null) {
            return { ok: false, canceled: false, filePath: null, error: "export window unavailable" };
        }
        const result = await electron.dialog.showSaveDialog(ww, {
            title: "Export HTML",
            defaultPath: fileName || "export.html",
            filters: [{ name: "HTML", extensions: ["html"] }],
        });
        if (result.canceled || !result.filePath) {
            return { ok: false, canceled: true, filePath: null, error: null };
        }
        try {
            await fs.promises.writeFile(result.filePath, html, "utf-8");
            console.log("exported html to", result.filePath);
            return { ok: true, canceled: false, filePath: result.filePath, error: null };
        } catch (err) {
            console.error("error exporting html file", err);
            return { ok: false, canceled: false, filePath: null, error: String(err) };
        }
    });

    // markdown 导出插件：离屏窗口渲染 HTML 后打印为 PDF。
    electron.ipcMain.handle("export-pdf", async (event, fileName: string, html: string, pdfOptions: any) => {
        const ww = electron.BrowserWindow.fromWebContents(event.sender);
        if (ww == null) {
            return { ok: false, canceled: false, filePath: null, error: "export window unavailable" };
        }
        const printWin = new electron.BrowserWindow({
            show: false,
            webPreferences: {
                offscreen: true,
                sandbox: false,
                nodeIntegration: false,
                contextIsolation: true,
            },
        });
        try {
            await printWin.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
            const data = await printWin.webContents.printToPDF({
                printBackground: true,
                pageSize: pdfOptions?.pageSize ?? "A4",
                margins: pdfOptions?.margins ?? { marginType: "default" },
            });
            if (data == null || data.length === 0) {
                return { ok: false, canceled: false, filePath: null, error: "printToPDF returned empty data" };
            }
            const result = await electron.dialog.showSaveDialog(ww, {
                title: "Export PDF",
                defaultPath: fileName || "export.pdf",
                filters: [{ name: "PDF", extensions: ["pdf"] }],
            });
            if (result.canceled || !result.filePath) {
                return { ok: false, canceled: true, filePath: null, error: null };
            }
            await fs.promises.writeFile(result.filePath, data);
            console.log("exported pdf to", result.filePath);
            return { ok: true, canceled: false, filePath: result.filePath, error: null };
        } catch (err) {
            console.error("error exporting pdf file", err);
            return { ok: false, canceled: false, filePath: null, error: String(err) };
        } finally {
            printWin.destroy();
        }
    });
}
