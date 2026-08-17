// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { BlockNodeModel } from "@/app/block/blocktypes";
import { setBadge } from "@/app/store/badge";
import { getFileSubject } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import {
    fetchWaveFile,
    getApi,
    getOverrideConfigAtom,
    getSettingsKeyAtom,
    globalStore,
    isDev,
    openTerminalLink,
    WOS,
} from "@/store/global";
import * as services from "@/store/services";
import { copyText } from "@/util/clipboard";
import { PLATFORM, PlatformMacOS } from "@/util/platformutil";
import { base64ToArray, fireAndForget } from "@/util/util";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { SerializeAddon } from "@xterm/addon-serialize";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import * as TermTypes from "@xterm/xterm";
import { Terminal } from "@xterm/xterm";
import debug from "debug";
import * as jotai from "jotai";
import { debounce } from "throttle-debounce";
import {
    handleOsc16162Command,
    handleOsc52Command,
    handleOsc7Command,
    isClaudeCodeCommand,
    type ShellIntegrationStatus,
} from "./osc-handlers";
import {
    bufferLinesToText,
    createTempFileFromBlob,
    extractAllClipboardData,
    normalizeCursorStyle,
    quoteForPosixShell,
    trimTerminalSelection,
} from "./termutil";

const dlog = debug("wave:termwrap");
const agentStatusLog = debug("wave:agentstatus");

const TermFileName = "term";
const TermCacheFileName = "cache:term:full";
const MinDataProcessedForCache = 100 * 1024;
export const SupportsImageInput = true;
const MaxRepaintTransactionMs = 2000;

function isNoControllerFoundError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error ?? "");
    return /no controller found for block/i.test(message);
}

function commandPreview(command: string | null | undefined): string | null {
    const normalized = command?.replace(/\s+/g, " ").trim() ?? "";
    if (!normalized) return null;
    if (normalized.length <= 80) return normalized;
    return `${normalized.slice(0, 77)}...`;
}

// detect webgl support
function detectWebGLSupport(): boolean {
    try {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("webgl2");
        return !!ctx;
    } catch (e) {
        return false;
    }
}

export const WebGLSupported = detectWebGLSupport();
let loggedWebGL = false;

// Convert #RRGGBB hex to xterm OSC 10/11 response format rgb:rrrr/gggg/bbbb (16-bit per channel).
// Mirrors xterm.js toRgbString(pad, 16) so TUI clients (Codex, etc.) parse the same as a native terminal.
export function hexToRgb16(hex: string): string {
    const m = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(hex.trim());
    if (!m) {
        return "rgb:0000/0000/0000";
    }
    const to16 = (s: string) => s + s; // 8-bit -> 16-bit (xterm pads by duplicating the byte)
    return `rgb:${to16(m[1])}/${to16(m[2])}/${to16(m[3])}`;
}

type TermWrapOptions = {
    keydownHandler?: (e: KeyboardEvent) => boolean;
    useWebGl?: boolean;
    sendDataHandler?: (data: string) => void;
    nodeModel?: BlockNodeModel;
};

export class TermWrap {
    tabId: string;
    blockId: string;
    ptyOffset: number;
    dataBytesProcessed: number;
    terminal: Terminal;
    connectElem: HTMLDivElement;
    fitAddon: FitAddon;
    searchAddon: SearchAddon;
    serializeAddon: SerializeAddon;
    mainFileSubject: SubjectWithRef<WSFileEventData>;
    loaded: boolean;
    heldData: Uint8Array[];
    handleResize_debounced: () => void;
    hasResized: boolean;
    multiInputCallback: (data: string) => void;
    sendDataHandler: (data: string) => void;
    onSearchResultsDidChange?: (result: { resultIndex: number; resultCount: number }) => void;
    toDispose: TermTypes.IDisposable[] = [];
    webglAddon: WebglAddon | null = null;
    webglContextLossDisposable: TermTypes.IDisposable | null = null;
    webglEnabledAtom: jotai.PrimitiveAtom<boolean>;
    pasteActive: boolean = false;
    lastUpdated: number;
    promptMarkers: TermTypes.IMarker[] = [];
    shellIntegrationStatusAtom: jotai.PrimitiveAtom<ShellIntegrationStatus | null>;
    shellIntegrationUpdatedAtAtom: jotai.PrimitiveAtom<number>;
    lastCommandAtom: jotai.PrimitiveAtom<string | null>;
    claudeCodeActiveAtom: jotai.PrimitiveAtom<boolean>;
    nodeModel: BlockNodeModel; // this can be null
    // OSC 10/11 颜色查询应答：Codex 等 TUI 启动时用它探测终端背景色来决定自身配色。
    // Snorkeling 的 xterm 主题背景被 computeTheme 强制为全透明（真实背景由 block CSS 透出），
    // 内置应答会回透明黑导致 Codex 永远按深色渲染；这里用真实主题色应答并短路内置 handler。
    // 默认兜底：浅色背景（避免未知状态下应答黑色）。
    oscReportFgColor: string = "#f0f0f0";
    oscReportBgColor: string = "#faf7f0";
    hoveredLinkUri: string | null = null;
    onLinkHover?: (uri: string | null, mouseX: number, mouseY: number) => void;
    onSelectionTextChange?: (selectionText: string | null) => void;
    lastResizeDebugTs: number = 0;

    // Paste deduplication
    // xterm.js paste() method triggers onData event, which can cause duplicate sends
    lastPasteData: string = "";
    lastPasteTime: number = 0;

    // dev only (for debugging)
    recentWrites: { idx: number; data: string; ts: number }[] = [];
    recentWritesCounter: number = 0;

    // for repaint transaction scrolling behavior
    lastClearScrollbackTs: number = 0;
    lastMode2026SetTs: number = 0;
    lastMode2026ResetTs: number = 0;
    inSyncTransaction: boolean = false;
    inRepaintTransaction: boolean = false;
    repaintScrollTimer: NodeJS.Timeout | null = null;

    constructor(
        tabId: string,
        blockId: string,
        connectElem: HTMLDivElement,
        options: TermTypes.ITerminalOptions & TermTypes.ITerminalInitOnlyOptions,
        waveOptions: TermWrapOptions
    ) {
        this.loaded = false;
        this.tabId = tabId;
        this.blockId = blockId;
        this.sendDataHandler = waveOptions.sendDataHandler;
        this.nodeModel = waveOptions.nodeModel;
        this.ptyOffset = 0;
        this.dataBytesProcessed = 0;
        this.hasResized = false;
        this.lastUpdated = Date.now();
        this.promptMarkers = [];
        this.shellIntegrationStatusAtom = jotai.atom(null) as jotai.PrimitiveAtom<ShellIntegrationStatus | null>;
        this.shellIntegrationUpdatedAtAtom = jotai.atom(0) as jotai.PrimitiveAtom<number>;
        this.lastCommandAtom = jotai.atom(null) as jotai.PrimitiveAtom<string | null>;
        this.claudeCodeActiveAtom = jotai.atom(false);
        this.webglEnabledAtom = jotai.atom(false) as jotai.PrimitiveAtom<boolean>;
        this.terminal = new Terminal(options);
        this.fitAddon = new FitAddon();
        this.serializeAddon = new SerializeAddon();
        this.searchAddon = new SearchAddon();
        this.terminal.loadAddon(this.searchAddon);
        this.terminal.loadAddon(this.fitAddon);
        this.terminal.loadAddon(this.serializeAddon);
        this.terminal.loadAddon(
            new WebLinksAddon(
                (e, uri) => {
                    e.preventDefault();
                    switch (PLATFORM) {
                        case PlatformMacOS:
                            if (e.metaKey) {
                                fireAndForget(() => openTerminalLink(uri));
                            }
                            break;
                        default:
                            if (e.ctrlKey) {
                                fireAndForget(() => openTerminalLink(uri));
                            }
                            break;
                    }
                },
                {
                    hover: (e, uri) => {
                        this.hoveredLinkUri = uri;
                        this.onLinkHover?.(uri, e.clientX, e.clientY);
                    },
                    leave: () => {
                        this.hoveredLinkUri = null;
                        this.onLinkHover?.(null, 0, 0);
                    },
                }
            )
        );
        this.setTermRenderer(WebGLSupported && waveOptions.useWebGl ? "webgl" : "dom");
        // Register OSC handlers
        this.terminal.parser.registerOscHandler(7, (data: string) => {
            try {
                return handleOsc7Command(data, this.blockId, this.loaded);
            } catch (e) {
                console.error("[termwrap] osc 7 handler error", this.blockId, e);
                return false;
            }
        });
        this.terminal.parser.registerOscHandler(52, (data: string) => {
            try {
                return handleOsc52Command(data, this.blockId, this.loaded, this);
            } catch (e) {
                console.error("[termwrap] osc 52 handler error", this.blockId, e);
                return false;
            }
        });
        this.terminal.parser.registerOscHandler(16162, (data: string) => {
            try {
                return handleOsc16162Command(data, this.blockId, this.loaded, this);
            } catch (e) {
                console.error("[termwrap] osc 16162 handler error", this.blockId, e);
                return false;
            }
        });
        // OSC 10/11 颜色查询应答覆盖：xterm 内置应答取自 options.theme（背景被 computeTheme 强制透明，
        // 会回透明黑），这里用真实主题色应答，并返回 true 短路内置 handler，避免 Codex 探测到深色背景。
        // 仅拦截查询（data 含 ?）；其余（颜色设置 OSC 10/11;<color>）放行给内置 handler 正常处理。
        this.terminal.parser.registerOscHandler(10, (data: string) => {
            if (data.includes("?")) {
                this.sendDataHandler?.(`\x1b]10;${hexToRgb16(this.oscReportFgColor)}\x1b\\`);
                return true;
            }
            return false;
        });
        this.terminal.parser.registerOscHandler(11, (data: string) => {
            if (data.includes("?")) {
                this.sendDataHandler?.(`\x1b]11;${hexToRgb16(this.oscReportBgColor)}\x1b\\`);
                return true;
            }
            return false;
        });
        this.toDispose.push(
            this.terminal.parser.registerCsiHandler({ final: "J" }, (params) => {
                if (params == null || params.length < 1) {
                    return false;
                }
                if (params[0] === 3) {
                    this.lastClearScrollbackTs = Date.now();
                    if (this.inSyncTransaction) {
                        console.log("[termwrap] repaint transaction starting");
                        this.inRepaintTransaction = true;
                    }
                }
                return false;
            })
        );
        this.toDispose.push(
            this.terminal.parser.registerCsiHandler({ prefix: "?", final: "h" }, (params) => {
                if (params == null || params.length < 1) {
                    return false;
                }
                if (params[0] === 2026) {
                    this.lastMode2026SetTs = Date.now();
                    this.inSyncTransaction = true;
                }
                return false;
            })
        );
        this.toDispose.push(
            this.terminal.parser.registerCsiHandler({ prefix: "?", final: "l" }, (params) => {
                if (params == null || params.length < 1) {
                    return false;
                }
                if (params[0] === 2026) {
                    this.lastMode2026ResetTs = Date.now();
                    this.inSyncTransaction = false;
                    const wasRepaint = this.inRepaintTransaction;
                    this.inRepaintTransaction = false;
                    if (wasRepaint && Date.now() - this.lastClearScrollbackTs <= MaxRepaintTransactionMs) {
                        // 切 tab/关 block 时 terminal 可能在 20ms 定时器触发前被 dispose；
                        // 对已销毁的 terminal 调 scrollToBottom 会在 xterm 内部抛未捕获异常，
                        // 破坏渲染器状态导致 TUI 内容错乱。定时器随 dispose 一并取消，并加 isDisposed 兜底。
                        if (this.repaintScrollTimer != null) {
                            clearTimeout(this.repaintScrollTimer);
                        }
                        this.repaintScrollTimer = setTimeout(() => {
                            this.repaintScrollTimer = null;
                            if (this.terminal.isDisposed) {
                                return;
                            }
                            console.log("[termwrap] repaint transaction complete, scrolling to bottom");
                            this.terminal.scrollToBottom();
                        }, 20);
                    }
                }
                return false;
            })
        );
        this.toDispose.push(
            this.terminal.onBell(() => {
                if (!this.loaded) {
                    return true;
                }
                console.log("BEL received in terminal", this.blockId);
                const bellSoundEnabled =
                    globalStore.get(getOverrideConfigAtom(this.blockId, "term:bellsound")) ?? false;
                if (bellSoundEnabled) {
                    fireAndForget(() => RpcApi.ElectronSystemBellCommand(TabRpcClient, { route: "electron" }));
                }
                const bellIndicatorEnabled =
                    globalStore.get(getOverrideConfigAtom(this.blockId, "term:bellindicator")) ?? false;
                if (bellIndicatorEnabled) {
                    setBadge(this.blockId, { icon: "bell", color: "#fbbf24", priority: 1 });
                }
                return true;
            })
        );
        this.terminal.attachCustomKeyEventHandler((e: KeyboardEvent) => {
            if (!waveOptions.keydownHandler) {
                return true;
            }
            return waveOptions.keydownHandler(e);
        });
        this.connectElem = connectElem;
        this.mainFileSubject = null;
        this.heldData = [];
        this.handleResize_debounced = debounce(50, this.handleResize.bind(this));
        this.terminal.open(this.connectElem);

        const dragoverHandler = (e: DragEvent) => {
            e.preventDefault();
            if (e.dataTransfer) {
                e.dataTransfer.dropEffect = "copy";
            }
        };
        const dropHandler = (e: DragEvent) => {
            e.preventDefault();
            if (!e.dataTransfer || e.dataTransfer.files.length === 0) {
                return;
            }
            const paths: string[] = [];
            for (let i = 0; i < e.dataTransfer.files.length; i++) {
                const file = e.dataTransfer.files[i];
                const filePath = getApi().getPathForFile(file);
                if (filePath) {
                    paths.push(quoteForPosixShell(filePath));
                }
            }
            if (paths.length > 0) {
                this.terminal.paste(paths.join(" ") + " ");
            }
        };
        this.connectElem.addEventListener("dragover", dragoverHandler);
        this.connectElem.addEventListener("drop", dropHandler);
        this.toDispose.push({
            dispose: () => {
                this.connectElem.removeEventListener("dragover", dragoverHandler);
                this.connectElem.removeEventListener("drop", dropHandler);
            },
        });
        this.handleResize();
        const pasteHandler = this.pasteHandler.bind(this);
        this.connectElem.addEventListener("paste", pasteHandler, true);
        this.toDispose.push({
            dispose: () => {
                this.connectElem.removeEventListener("paste", pasteHandler, true);
            },
        });
    }

    getZoneId(): string {
        return this.blockId;
    }

    setCursorStyle(cursorStyle: string) {
        this.terminal.options.cursorStyle = normalizeCursorStyle(cursorStyle);
    }

    setCursorBlink(cursorBlink: boolean) {
        this.terminal.options.cursorBlink = cursorBlink ?? false;
    }

    setTermRenderer(renderer: "webgl" | "dom") {
        if (renderer === "webgl") {
            if (this.webglAddon != null) {
                return;
            }
            if (!WebGLSupported) {
                renderer = "dom";
            }
        } else {
            if (this.webglAddon == null) {
                return;
            }
        }
        if (this.webglAddon != null) {
            this.webglContextLossDisposable?.dispose();
            this.webglContextLossDisposable = null;
            this.webglAddon.dispose();
            this.webglAddon = null;
            globalStore.set(this.webglEnabledAtom, false);
        }
        if (renderer === "webgl") {
            const addon = new WebglAddon();
            this.webglContextLossDisposable = addon.onContextLoss(() => {
                this.setTermRenderer("dom");
            });
            this.terminal.loadAddon(addon);
            this.webglAddon = addon;
            globalStore.set(this.webglEnabledAtom, true);
            if (!loggedWebGL) {
                console.log("loaded webgl!");
                loggedWebGL = true;
            }
        }
    }

    getTermRenderer(): "webgl" | "dom" {
        return this.webglAddon != null ? "webgl" : "dom";
    }

    isWebGlEnabled(): boolean {
        return this.webglAddon != null;
    }

    async initTerminal() {
        const copyOnSelectAtom = getSettingsKeyAtom("term:copyonselect");
        const trimTrailingWhitespaceAtom = getSettingsKeyAtom("term:trimtrailingwhitespace");
        this.toDispose.push(this.terminal.onData(this.handleTermData.bind(this)));
        this.toDispose.push(
            this.terminal.onSelectionChange(
                debounce(50, () => {
                    const active = document.activeElement;
                    if (active != null && active.closest(".search-container") != null) {
                        this.onSelectionTextChange?.(null);
                        return;
                    }
                    let selectedText = this.terminal.getSelection();
                    if (selectedText.length > 0 && globalStore.get(trimTrailingWhitespaceAtom) !== false) {
                        selectedText = trimTerminalSelection(selectedText);
                    }
                    this.onSelectionTextChange?.(selectedText.length > 0 ? selectedText : null);
                    if (!globalStore.get(copyOnSelectAtom)) {
                        return;
                    }
                    if (selectedText.length > 0) {
                        fireAndForget(() => copyText(selectedText));
                    }
                })
            )
        );
        if (this.onSearchResultsDidChange != null) {
            this.toDispose.push(this.searchAddon.onDidChangeResults(this.onSearchResultsDidChange.bind(this)));
        }

        this.mainFileSubject = getFileSubject(this.getZoneId(), TermFileName);
        this.mainFileSubject.subscribe(this.handleNewFileSubjectData.bind(this));

        try {
            const rtInfo = await RpcApi.GetRTInfoCommand(TabRpcClient, {
                oref: WOS.makeORef("block", this.blockId),
            });
            let shellState: ShellIntegrationStatus = null;

            if (rtInfo && (rtInfo["shell:integration"] || rtInfo["shell:state"] != null)) {
                shellState = rtInfo["shell:state"] as ShellIntegrationStatus;
                globalStore.set(this.shellIntegrationStatusAtom, shellState || null);
                globalStore.set(this.shellIntegrationUpdatedAtAtom, rtInfo["shell:lastupdated"] ?? 0);
            } else {
                globalStore.set(this.shellIntegrationStatusAtom, null);
                globalStore.set(this.shellIntegrationUpdatedAtAtom, 0);
            }

            const lastCmd = rtInfo ? rtInfo["shell:lastcmd"] : null;
            const isCC = shellState === "running-command" && isClaudeCodeCommand(lastCmd);
            globalStore.set(this.lastCommandAtom, lastCmd || null);
            globalStore.set(this.claudeCodeActiveAtom, isCC);
            agentStatusLog("termwrap initial rtinfo", {
                blockId: this.blockId,
                shellIntegration: rtInfo?.["shell:integration"] === true,
                shellState,
                shellLastUpdated: rtInfo?.["shell:lastupdated"] ?? null,
                shellLastCommand: commandPreview(lastCmd),
                shellLastCommandExitCode: rtInfo?.["shell:lastcmdexitcode"] ?? null,
                claudeCodeActive: isCC,
            });
        } catch (e) {
            agentStatusLog("termwrap initial rtinfo error", {
                blockId: this.blockId,
                error: e instanceof Error ? e.message : String(e),
            });
            console.log("Error loading runtime info:", e);
        }

        try {
            await this.loadInitialTerminalData();
        } finally {
            this.loaded = true;
        }
        this.runProcessIdleTimeout();
    }

    dispose() {
        if (this.repaintScrollTimer != null) {
            clearTimeout(this.repaintScrollTimer);
            this.repaintScrollTimer = null;
        }
        this.promptMarkers.forEach((marker) => {
            try {
                marker.dispose();
            } catch (_) {
                /* nothing */
            }
        });
        this.promptMarkers = [];
        this.webglContextLossDisposable?.dispose();
        this.webglContextLossDisposable = null;
        this.terminal.dispose();
        this.toDispose.forEach((d) => {
            try {
                d.dispose();
            } catch (_) {
                /* nothing */
            }
        });
        this.mainFileSubject.release();
    }

    handleTermData(data: string) {
        if (!this.loaded) {
            return;
        }

        this.sendDataHandler?.(data);
        this.multiInputCallback?.(data);
    }

    // 供 TermThemeUpdater 在主题变化时同步 OSC 10/11 查询应答色（真实主题色，非透明色）。
    // Codex 等 TUI 启动时查询终端背景色决定自身配色，必须回真实色才能正确适配浅色主题。
    setOscReportColors(fg: string | undefined, bg: string | undefined) {
        if (fg) this.oscReportFgColor = fg;
        if (bg) this.oscReportBgColor = bg;
    }

    addFocusListener(focusFn: () => void) {
        this.terminal.textarea.addEventListener("focus", focusFn);
    }

    handleNewFileSubjectData(msg: WSFileEventData) {
        if (msg.fileop == "truncate") {
            this.terminal.clear();
            this.heldData = [];
        } else if (msg.fileop == "append") {
            const decodedData = base64ToArray(msg.data64);
            if (this.loaded) {
                this.doTerminalWrite(decodedData, null);
            } else {
                this.heldData.push(decodedData);
            }
        } else {
            console.log("bad fileop for terminal", msg);
            return;
        }
    }

    doTerminalWrite(data: string | Uint8Array, setPtyOffset?: number): Promise<void> {
        if (isDev() && this.loaded) {
            const dataStr = data instanceof Uint8Array ? new TextDecoder().decode(data) : data;
            this.recentWrites.push({ idx: this.recentWritesCounter++, ts: Date.now(), data: dataStr });
            if (this.recentWrites.length > 50) {
                this.recentWrites.shift();
            }
        }
        let resolve: () => void = null;
        const prtn = new Promise<void>((presolve, _) => {
            resolve = presolve;
        });
        this.terminal.write(data, () => {
            if (setPtyOffset != null) {
                this.ptyOffset = setPtyOffset;
            } else {
                this.ptyOffset += data.length;
                this.dataBytesProcessed += data.length;
            }
            this.lastUpdated = Date.now();
            resolve();
        });
        return prtn;
    }

    async loadInitialTerminalData(): Promise<void> {
        const startTs = Date.now();
        const zoneId = this.getZoneId();
        const { data: cacheData, fileInfo: cacheFile } = await fetchWaveFile(zoneId, TermCacheFileName);
        let ptyOffset = 0;
        if (cacheFile != null) {
            ptyOffset = cacheFile.meta["ptyoffset"] ?? 0;
            if (cacheData.byteLength > 0) {
                const curTermSize: TermSize = { rows: this.terminal.rows, cols: this.terminal.cols };
                const fileTermSize: TermSize = cacheFile.meta["termsize"];
                let didResize = false;
                if (
                    fileTermSize != null &&
                    (fileTermSize.rows != curTermSize.rows || fileTermSize.cols != curTermSize.cols)
                ) {
                    console.log("[termwrap] restore size mismatch, temp resize", {
                        blockId: this.blockId,
                        nodeId: this.nodeModel?.nodeId,
                        fileTermSize,
                        curTermSize,
                    });
                    this.terminal.resize(fileTermSize.cols, fileTermSize.rows);
                    didResize = true;
                }
                this.doTerminalWrite(cacheData, ptyOffset);
                if (didResize) {
                    this.terminal.resize(curTermSize.cols, curTermSize.rows);
                }
            }
        }
        const { data: mainData, fileInfo: mainFile } = await fetchWaveFile(zoneId, TermFileName, ptyOffset);
        console.log("[termwrap] terminal loaded", {
            blockId: this.blockId,
            nodeId: this.nodeModel?.nodeId,
            zoneId,
            cacheBytes: cacheData?.byteLength ?? 0,
            mainBytes: mainData?.byteLength ?? 0,
            ptyOffset,
            elapsedMs: Date.now() - startTs,
            termSize: {
                rows: this.terminal.rows,
                cols: this.terminal.cols,
            },
        });
        if (mainFile != null) {
            await this.doTerminalWrite(mainData, null);
        }
    }

    async resyncController(reason: string) {
        dlog("resync controller", this.blockId, reason);
        const rtOpts: RuntimeOpts = { termsize: { rows: this.terminal.rows, cols: this.terminal.cols } };
        try {
            await RpcApi.ControllerResyncCommand(TabRpcClient, {
                tabid: this.tabId,
                blockid: this.blockId,
                rtopts: rtOpts,
            });
        } catch (e) {
            console.log(`error controller resync (${reason})`, this.blockId, e);
        }
    }

    handleResize() {
        const startTs = performance.now();
        const prevResizeDebugTs = this.lastResizeDebugTs;
        this.lastResizeDebugTs = startTs;
        const containerRect = this.connectElem.getBoundingClientRect();
        const oldRows = this.terminal.rows;
        const oldCols = this.terminal.cols;
        this.fitAddon.fit();
        const didChangeTermSize = oldRows !== this.terminal.rows || oldCols !== this.terminal.cols;
        const termSize: TermSize = { rows: this.terminal.rows, cols: this.terminal.cols };
        console.log("[termwrap-resize-debug]", {
            blockId: this.blockId,
            nodeId: this.nodeModel?.nodeId,
            renderer: this.getTermRenderer(),
            containerSize: {
                width: Math.round(containerRect.width),
                height: Math.round(containerRect.height),
            },
            oldSize: {
                rows: oldRows,
                cols: oldCols,
            },
            newSize: termSize,
            didChangeTermSize,
            hasResized: this.hasResized,
            elapsedMs: Math.round((performance.now() - startTs) * 100) / 100,
            sinceLastResizeMs: prevResizeDebugTs === 0 ? null : Math.round((startTs - prevResizeDebugTs) * 100) / 100,
            isFocused: document.activeElement != null && this.connectElem.contains(document.activeElement),
        });
        if (didChangeTermSize) {
            console.log("[termwrap] resize", {
                blockId: this.blockId,
                nodeId: this.nodeModel?.nodeId,
                oldSize: {
                    rows: oldRows,
                    cols: oldCols,
                },
                newSize: termSize,
                hasResized: this.hasResized,
                renderer: this.getTermRenderer(),
            });
            void RpcApi.ControllerInputCommand(TabRpcClient, { blockid: this.blockId, termsize: termSize }).catch(
                (error) => {
                    if (isNoControllerFoundError(error)) {
                        dlog("resize ignored before controller is ready", this.blockId);
                        return;
                    }
                    console.error("Failed to send terminal resize to controller:", error);
                }
            );
        }
        dlog("resize", `${this.terminal.rows}x${this.terminal.cols}`, `${oldRows}x${oldCols}`, this.hasResized);
        if (!this.hasResized) {
            this.hasResized = true;
            this.resyncController("initial resize");
        }
    }

    processAndCacheData() {
        if (this.dataBytesProcessed < MinDataProcessedForCache) {
            return;
        }
        const serializedOutput = this.serializeAddon.serialize();
        const termSize: TermSize = { rows: this.terminal.rows, cols: this.terminal.cols };
        console.log("[termwrap] idle save terminal state", {
            blockId: this.blockId,
            nodeId: this.nodeModel?.nodeId,
            dataBytesProcessed: this.dataBytesProcessed,
            serializedBytes: serializedOutput.length,
            termSize,
        });
        fireAndForget(() =>
            services.BlockService.SaveTerminalState(this.blockId, serializedOutput, "full", this.ptyOffset, termSize)
        );
        this.dataBytesProcessed = 0;
    }

    runProcessIdleTimeout() {
        setTimeout(() => {
            window.requestIdleCallback(() => {
                this.processAndCacheData();
                this.runProcessIdleTimeout();
            });
        }, 5000);
    }

    async pasteHandler(e?: ClipboardEvent): Promise<void> {
        this.pasteActive = true;
        e?.preventDefault();
        e?.stopPropagation();

        try {
            const clipboardData = await extractAllClipboardData(e);
            let firstImage = true;
            for (const data of clipboardData) {
                if (data.image && SupportsImageInput) {
                    if (!firstImage) {
                        await new Promise((r) => setTimeout(r, 150));
                    }
                    const tempPath = await createTempFileFromBlob(data.image);
                    this.terminal.paste(tempPath + " ");
                    firstImage = false;
                }
                if (data.text) {
                    this.terminal.paste(data.text);
                }
            }
        } catch (err) {
            console.error("Paste error:", err);
        } finally {
            setTimeout(() => {
                this.pasteActive = false;
            }, 30);
        }
    }

    getScrollbackContent(): string {
        if (!this.terminal) {
            return "";
        }
        const buffer = this.terminal.buffer.active;
        const lines = bufferLinesToText(buffer, 0, buffer.length);
        return lines.join("\n");
    }
}
