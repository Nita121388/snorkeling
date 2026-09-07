// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import ClaudeColorSvg from "@/app/asset/claude-color.svg";
import { SubBlock } from "@/app/block/block";
import { appendBlockMoveMenuItems, useBlockMoveMenuItems } from "@/app/block/block-move-menu";
import type { BlockNodeModel } from "@/app/block/blocktypes";
import { NullErrorBoundary } from "@/app/element/errorboundary";
import { Search, useSearch } from "@/app/element/search";
import {
    clampSelectionCopyOverlayPosition,
    SelectionCopyOverlay,
    type SelectionCopyOverlayState,
    type SelectionQuickActionItem,
} from "@/app/element/selection-copy-overlay";
import { ScrollToBottomButton } from "@/app/element/scroll-to-bottom-button";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { globalStore } from "@/app/store/jotaiStore";
import { AISessionsServiceType } from "@/app/store/services";
import { useTabModel } from "@/app/store/tab-model";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { TermAgentMessageRail } from "@/app/view/term/term-agent-message-rail";
import type { TermViewModel } from "@/app/view/term/term-model";
import { atoms, getOverrideConfigAtom, getSettingsPrefixAtom, WOS } from "@/store/global";
import { copyText } from "@/util/clipboard";
import { PLATFORM } from "@/util/platformutil";
import { fireAndForget, useAtomValueSafe } from "@/util/util";
import { computeBgStyleFromMeta } from "@/util/waveutil";
import { ISearchOptions } from "@xterm/addon-search";
import clsx from "clsx";
import debug from "debug";
import * as jotai from "jotai";
import * as React from "react";
import {
    isTermSelectionDrag,
    shouldRoutePlainTermGesture,
    shouldSuppressTermMouseMove,
} from "./term-selection-gesture";
import { TermLinkTooltip } from "./term-tooltip";
import { TermStickers } from "./termsticker";
import { TermThemeUpdater } from "./termtheme";
import {
    computeTheme,
    normalizeCursorStyle,
    terminalLogicalLinesForSelection,
    terminalSelectionToSingleLine,
} from "./termutil";
import { TermWrap } from "./termwrap";
import "./xterm.css";

const dlog = debug("wave:term");

function cloneTermMouseEvent(type: string, event: MouseEvent, overrides: MouseEventInit = {}): MouseEvent {
    return new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        detail: event.detail,
        screenX: event.screenX,
        screenY: event.screenY,
        clientX: event.clientX,
        clientY: event.clientY,
        button: event.button,
        buttons: event.buttons,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
        metaKey: event.metaKey,
        ...overrides,
    });
}

interface TerminalViewProps {
    blockId: string;
    model: TermViewModel;
}

const TermClaudeIcon = React.memo(() => {
    return (
        <div className="[&_svg]:w-[15px] [&_svg]:h-[15px]" aria-hidden="true">
            <ClaudeColorSvg />
        </div>
    );
});

TermClaudeIcon.displayName = "TermClaudeIcon";

const TermResyncHandler = React.memo(({ blockId: _blockId, model }: TerminalViewProps) => {
    const connStatus = jotai.useAtomValue(model.connStatus);
    const [lastConnStatus, setLastConnStatus] = React.useState<ConnStatus>(connStatus);

    React.useEffect(() => {
        if (!model.termRef.current?.hasResized) {
            return;
        }
        const isConnected = connStatus?.status == "connected";
        const wasConnected = lastConnStatus?.status == "connected";
        const curConnName = connStatus?.connection;
        const lastConnName = lastConnStatus?.connection;
        if (isConnected == wasConnected && curConnName == lastConnName) {
            return;
        }
        model.termRef.current?.resyncController("resync handler");
        setLastConnStatus(connStatus);
    }, [connStatus]);

    return null;
});

const TermVDomToolbarNode = ({ vdomBlockId, blockId, model }: TerminalViewProps & { vdomBlockId: string }) => {
    React.useEffect(() => {
        const unsub = waveEventSubscribeSingle({
            eventType: "blockclose",
            scope: WOS.makeORef("block", vdomBlockId),
            handler: (_event) => {
                RpcApi.SetMetaCommand(TabRpcClient, {
                    oref: WOS.makeORef("block", blockId),
                    meta: {
                        "term:mode": null,
                        "term:vdomtoolbarblockid": null,
                    },
                });
            },
        });
        return () => {
            unsub();
        };
    }, []);
    const vdomNodeModel: BlockNodeModel = React.useMemo(
        () => ({
            blockId: vdomBlockId,
            isFocused: jotai.atom(false),
            isMagnified: jotai.atom(false),
            focusNode: () => {},
            toggleMagnify: () => {},
            onClose: () => {
                if (vdomBlockId != null) {
                    RpcApi.DeleteSubBlockCommand(TabRpcClient, { blockid: vdomBlockId });
                }
            },
        }),
        [vdomBlockId]
    );
    const toolbarTarget = jotai.useAtomValue(model.vdomToolbarTarget);
    const heightStr = toolbarTarget?.height ?? "1.5em";
    return (
        <div key="vdomToolbar" className="term-toolbar" style={{ height: heightStr }}>
            <SubBlock key="vdom" nodeModel={vdomNodeModel} />
        </div>
    );
};

const TermVDomNodeSingleId = ({ vdomBlockId, blockId, model }: TerminalViewProps & { vdomBlockId: string }) => {
    React.useEffect(() => {
        const unsub = waveEventSubscribeSingle({
            eventType: "blockclose",
            scope: WOS.makeORef("block", vdomBlockId),
            handler: (_event) => {
                RpcApi.SetMetaCommand(TabRpcClient, {
                    oref: WOS.makeORef("block", blockId),
                    meta: {
                        "term:mode": null,
                        "term:vdomblockid": null,
                    },
                });
            },
        });
        return () => {
            unsub();
        };
    }, []);
    const vdomNodeModel: BlockNodeModel = React.useMemo(() => {
        const isFocusedAtom = jotai.atom((get) => {
            return get(model.nodeModel.isFocused) && get(model.termMode) == "vdom";
        });
        return {
            blockId: vdomBlockId,
            isFocused: isFocusedAtom,
            isMagnified: jotai.atom(false),
            focusNode: () => {
                model.nodeModel.focusNode();
            },
            toggleMagnify: () => {},
            onClose: () => {
                if (vdomBlockId != null) {
                    RpcApi.DeleteSubBlockCommand(TabRpcClient, { blockid: vdomBlockId });
                }
            },
        };
    }, [vdomBlockId, model]);
    return (
        <div key="htmlElem" className="term-htmlelem">
            <SubBlock key="vdom" nodeModel={vdomNodeModel} />
        </div>
    );
};

const TermVDomNode = ({ blockId, model }: TerminalViewProps) => {
    const vdomBlockId = jotai.useAtomValue(model.vdomBlockId);
    if (vdomBlockId == null) {
        return null;
    }
    return <TermVDomNodeSingleId key={vdomBlockId} vdomBlockId={vdomBlockId} blockId={blockId} model={model} />;
};

const TermToolbarVDomNode = ({ blockId, model }: TerminalViewProps) => {
    const vdomToolbarBlockId = jotai.useAtomValue(model.vdomToolbarBlockId);
    if (vdomToolbarBlockId == null) {
        return null;
    }
    return (
        <TermVDomToolbarNode
            key={vdomToolbarBlockId}
            vdomBlockId={vdomToolbarBlockId}
            blockId={blockId}
            model={model}
        />
    );
};

// Lightweight one-shot hint: Claude Code classic (modal) renderer has no mouse
// support in its prompt input; fullscreen renderer adds click-to-position the
// cursor (+ select-to-copy). Surf a dismissible pill until the user either
// dismisses it or Claude enables mouse reporting (fullscreen) itself.
export function shouldShowClaudeFullscreenHint(
    claudeActive: boolean,
    dismissed: boolean,
    mouseEnabled: boolean
): boolean {
    return claudeActive && !dismissed && !mouseEnabled;
}

const TermClaudeFullscreenHint = React.memo(
    ({ model, termWrap }: { model: TermViewModel; termWrap: TermWrap | null }) => {
        const claudeActive = useAtomValueSafe<boolean>(termWrap?.claudeCodeActiveAtom);
        const [dismissed, setDismissed] = React.useState(false);
        const [mouseEnabled, setMouseEnabled] = React.useState(false);

        // Poll xterm's mouse tracking mode: Claude enables it when the fullscreen
        // renderer kicks in, which auto-hides the hint even without dismissal.
        React.useEffect(() => {
            if (!claudeActive) {
                return;
            }
            const iv = window.setInterval(() => {
                const m = model.termRef.current?.terminal.modes.mouseTrackingMode;
                setMouseEnabled(m != null && m !== "none");
            }, 1500);
            return () => window.clearInterval(iv);
        }, [model, claudeActive]);

        if (!shouldShowClaudeFullscreenHint(claudeActive, dismissed, mouseEnabled)) {
            return null;
        }
        return (
            <div className="absolute top-1.5 right-1.5 z-30 flex items-center gap-2 max-w-[70%] px-2.5 py-1 rounded-md bg-surface-strong border border-border text-[11px] leading-tight text-primary shadow-sm">
                <span className="truncate">
                    Claude Code fullscreen adds mouse editing (click anywhere in the prompt to move
                    the cursor): type{" "}
                    <span className="font-mono text-accent">/tui fullscreen</span>
                </span>
                <button
                    onClick={() => setDismissed(true)}
                    aria-label="Dismiss"
                    className="text-secondary hover:text-primary cursor-pointer shrink-0"
                >
                    <i className="fa fa-xmark" />
                </button>
            </div>
        );
    }
);

TermClaudeFullscreenHint.displayName = "TermClaudeFullscreenHint";

const TerminalView = ({ blockId, model }: ViewComponentProps<TermViewModel>) => {
    const viewRef = React.useRef<HTMLDivElement>(null);
    const connectElemRef = React.useRef<HTMLDivElement>(null);
    const [termWrapInst, setTermWrapInst] = React.useState<TermWrap | null>(null);
    const [isTermAtBottom, setIsTermAtBottom] = React.useState(true);
    const [selectionCopyOverlay, setSelectionCopyOverlay] = React.useState<SelectionCopyOverlayState | null>(null);
    const [selectionLogicalLineText, setSelectionLogicalLineText] = React.useState<string | null>(null);
    const lastSelectionPointerRef = React.useRef<{ x: number; y: number } | null>(null);
    const pendingTermMouseGestureRef = React.useRef<{
        startEvent: MouseEvent;
        target: EventTarget;
        selecting: boolean;
        activationOnly: boolean;
        cleanup: () => void;
    } | null>(null);
    const routedTermMouseEventsRef = React.useRef(new WeakSet<MouseEvent>());
    const [blockData] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", blockId));
    const termSettingsAtom = getSettingsPrefixAtom("term");
    const termSettings = jotai.useAtomValue(termSettingsAtom);
    let termMode = blockData?.meta?.["term:mode"] ?? "term";
    if (termMode != "term" && termMode != "vdom") {
        termMode = "term";
    }
    const termModeRef = React.useRef(termMode);

    const tabModel = useTabModel();
    const termFontSize = jotai.useAtomValue(model.fontSizeAtom);
    const fullConfig = globalStore.get(atoms.fullConfigAtom);
    const connFontFamily = fullConfig.connections?.[blockData?.meta?.connection]?.["term:fontfamily"];
    // Fully-resolved terminal font: block override > global setting > connection > default.
    const resolvedFontFamily =
        blockData?.meta?.["term:fontfamily"] ?? termSettings?.["term:fontfamily"] ?? connFontFamily ?? "Hack";
    const isFocused = jotai.useAtomValue(model.nodeModel.isFocused);
    const isMI = jotai.useAtomValue(tabModel.isTermMultiInput);
    const isBasicTerm = termMode != "vdom" && blockData?.meta?.controller != "cmd"; // needs to match isBasicTerm

    // search
    const searchProps = useSearch({
        anchorRef: viewRef,
        viewModel: model,
        caseSensitive: false,
        wholeWord: false,
        regex: false,
    });
    const searchIsOpen = jotai.useAtomValue<boolean>(searchProps.isOpen);
    const caseSensitive = useAtomValueSafe<boolean>(searchProps.caseSensitive);
    const wholeWord = useAtomValueSafe<boolean>(searchProps.wholeWord);
    const regex = useAtomValueSafe<boolean>(searchProps.regex);
    const searchVal = jotai.useAtomValue<string>(searchProps.searchValue);
    const searchDecorations = React.useMemo(
        () => ({
            matchOverviewRuler: "#000000",
            activeMatchColorOverviewRuler: "#000000",
            activeMatchBorder: "#FF9632",
            matchBorder: "#FFFF00",
        }),
        []
    );
    const searchOpts = React.useMemo<ISearchOptions>(
        () => ({
            regex,
            wholeWord,
            caseSensitive,
            decorations: searchDecorations,
        }),
        [regex, wholeWord, caseSensitive]
    );
    const handleSearchError = React.useCallback((e: Error) => {
        console.warn("search error:", e);
    }, []);
    const executeSearch = React.useCallback(
        (searchText: string, direction: "next" | "previous") => {
            if (searchText === "") {
                model.termRef.current?.searchAddon.clearDecorations();
                return;
            }
            try {
                model.termRef.current?.searchAddon[direction === "next" ? "findNext" : "findPrevious"](
                    searchText,
                    searchOpts
                );
            } catch (e) {
                handleSearchError(e);
            }
        },
        [searchOpts, handleSearchError]
    );
    searchProps.onSearch = React.useCallback(
        (searchText: string) => executeSearch(searchText, "previous"),
        [executeSearch]
    );
    searchProps.onPrev = React.useCallback(() => executeSearch(searchVal, "previous"), [executeSearch, searchVal]);
    searchProps.onNext = React.useCallback(() => executeSearch(searchVal, "next"), [executeSearch, searchVal]);
    // Return input focus to the terminal when the search is closed
    React.useEffect(() => {
        if (!searchIsOpen) {
            model.giveFocus();
        }
    }, [searchIsOpen]);
    // rerun search when the searchOpts change
    React.useEffect(() => {
        model.termRef.current?.searchAddon.clearDecorations();
        searchProps.onSearch(searchVal);
    }, [searchOpts]);
    // end search

    React.useEffect(() => {
        const fullConfig = globalStore.get(atoms.fullConfigAtom);
        const termThemeName = globalStore.get(model.termThemeNameAtom);
        const termTransparency = globalStore.get(model.termTransparencyAtom);
        const termMacOptionIsMetaAtom = getOverrideConfigAtom(blockId, "term:macoptionismeta");
        const [termTheme, _] = computeTheme(fullConfig, termThemeName, termTransparency);
        let termScrollback = 2000;
        if (termSettings?.["term:scrollback"]) {
            termScrollback = Math.floor(termSettings["term:scrollback"]);
        }
        if (blockData?.meta?.["term:scrollback"]) {
            termScrollback = Math.floor(blockData.meta["term:scrollback"]);
        }
        if (termScrollback < 0) {
            termScrollback = 0;
        }
        if (termScrollback > 50000) {
            termScrollback = 50000;
        }
        const termAllowBPM = globalStore.get(model.termBPMAtom) ?? true;
        const termMacOptionIsMeta = globalStore.get(termMacOptionIsMetaAtom) ?? false;
        const termCursorStyle = normalizeCursorStyle(globalStore.get(getOverrideConfigAtom(blockId, "term:cursor")));
        const termCursorBlink = globalStore.get(getOverrideConfigAtom(blockId, "term:cursorblink")) ?? false;
        const wasFocused = globalStore.get(model.nodeModel.isFocused);
        const fontFamily = blockData?.meta?.["term:fontfamily"] ?? termSettings?.["term:fontfamily"] ?? connFontFamily ?? "Hack";
        // Light theme forces the Canvas renderer: xterm's WebGL renderer produces faint/thin
        // glyphs on a light background (poor sub-pixel coverage), so disable it under light.
        const useWebGl =
            globalStore.get(atoms.resolvedAppThemeAtom) !== "light" && !termSettings?.["term:disablewebgl"];
        console.log("[termwrap-lifecycle-debug] create", {
            blockId,
            nodeId: model.nodeModel.nodeId,
            tabId: tabModel.tabId,
            termFontSize,
            fontFamily,
            scrollback: termScrollback,
            useWebGl,
        });
        const termWrap = new TermWrap(
            tabModel.tabId,
            blockId,
            connectElemRef.current,
            {
                theme: termTheme,
                fontSize: termFontSize,
                fontFamily,
                drawBoldTextInBrightColors: false,
                fontWeight: "normal",
                fontWeightBold: "bold",
                allowTransparency: true,
                scrollback: termScrollback,
                allowProposedApi: true, // Required by @xterm/addon-search to enable search functionality and decorations
                ignoreBracketedPasteMode: !termAllowBPM,
                macOptionIsMeta: termMacOptionIsMeta,
                macOptionClickForcesSelection: true,
                cursorStyle: termCursorStyle,
                cursorBlink: termCursorBlink,
                overviewRuler: { width: 6 },
            },
            {
                keydownHandler: model.handleTerminalKeydown.bind(model),
                useWebGl,
                sendDataHandler: model.sendDataToController.bind(model),
                nodeModel: model.nodeModel,
            }
        );
        (window as any).term = termWrap;
        model.termRef.current = termWrap;
        termWrap.onSelectionTextChange = (selectionText) => {
            const container = viewRef.current;
            if (selectionText == null || container == null) {
                setSelectionCopyOverlay(null);
                setSelectionLogicalLineText(null);
                return;
            }
            setSelectionLogicalLineText(
                terminalLogicalLinesForSelection(
                    termWrap.terminal.buffer.active,
                    termWrap.terminal.getSelectionPosition()
                )
            );
            const pointer = lastSelectionPointerRef.current;
            const position = clampSelectionCopyOverlayPosition(
                container.clientWidth,
                container.clientHeight,
                (pointer?.x ?? 12) + 8,
                (pointer?.y ?? 12) + 8
            );
            setSelectionCopyOverlay({
                ...position,
                text: selectionText,
            });
        };
        setTermWrapInst(termWrap);
        const rszObs = new ResizeObserver(() => {
            termWrap.handleResize_debounced();
            setSelectionCopyOverlay(null);
        });
        rszObs.observe(connectElemRef.current);
        termWrap.onSearchResultsDidChange = (results) => {
            globalStore.set(searchProps.resultsIndex, results.resultIndex);
            globalStore.set(searchProps.resultsCount, results.resultCount);
        };
        fireAndForget(termWrap.initTerminal.bind(termWrap));
        // Track xterm viewport scroll position for the scroll-to-bottom FAB.
        const scrollDisposable = termWrap.terminal.onScroll(() => {
            // xterm 语义：baseY 是「完全滚到底时 viewport 顶部所在行」，viewportY ∈ [0, baseY]。
            // 在底部 ⇔ viewportY >= baseY。旧公式 (viewportY + rows >= baseY + length - 1)
            // 在 scrollback > 1 行时数学上永不成立，导致滚到底按钮仍显示。
            const buf = termWrap.terminal.buffer.active;
            const atBottom = buf.viewportY >= buf.baseY;
            setIsTermAtBottom(atBottom);
        });
        if (wasFocused) {
            setTimeout(() => {
                model.giveFocus();
            }, 10);
        }
        return () => {
            console.log("[termwrap-lifecycle-debug] dispose", {
                blockId,
                nodeId: model.nodeModel.nodeId,
                tabId: tabModel.tabId,
            });
            termWrap.onSelectionTextChange = null;
            scrollDisposable.dispose();
            termWrap.dispose();
            rszObs.disconnect();
            setTermWrapInst(null);
            setSelectionCopyOverlay(null);
            setSelectionLogicalLineText(null);
        };
    }, [blockId, termSettings, termFontSize, connFontFamily]);

    // Live-update the xterm font family when it changes, without recreating the
    // terminal/PTY (which would drop the session). xterm applies fontFamily at runtime.
    React.useEffect(() => {
        if (termWrapInst == null) {
            return;
        }
        termWrapInst.terminal.options.fontFamily = resolvedFontFamily;
        termWrapInst.fitAddon?.fit();
    }, [resolvedFontFamily, termWrapInst]);

    React.useEffect(() => {
        if (termModeRef.current == "vdom" && termMode == "term") {
            // focus the terminal
            model.giveFocus();
        }
        termModeRef.current = termMode;
        setSelectionCopyOverlay(null);
    }, [termMode]);

    React.useEffect(() => {
        if (!isFocused || termMode != "term" || searchIsOpen || termWrapInst == null) {
            return;
        }
        const timeoutId = window.setTimeout(() => {
            model.giveFocus();
        }, 0);
        const rafId = window.requestAnimationFrame(() => {
            model.giveFocus();
        });
        return () => {
            window.clearTimeout(timeoutId);
            window.cancelAnimationFrame(rafId);
        };
    }, [isFocused, model, searchIsOpen, termMode, termWrapInst]);

    React.useEffect(() => {
        if (searchIsOpen) {
            setSelectionCopyOverlay(null);
        }
    }, [searchIsOpen]);

    React.useEffect(() => {
        if (isMI && isBasicTerm && isFocused && model.termRef.current != null) {
            model.termRef.current.multiInputCallback = (data: string) => {
                model.multiInputHandler(data);
            };
        } else {
            if (model.termRef.current != null) {
                model.termRef.current.multiInputCallback = null;
            }
        }
    }, [isMI, isBasicTerm, isFocused]);

    const stickerConfig = {
        charWidth: 8,
        charHeight: 16,
        rows: model.termRef.current?.terminal.rows ?? 24,
        cols: model.termRef.current?.terminal.cols ?? 80,
        blockId: blockId,
    };

    const termBg = computeBgStyleFromMeta(blockData?.meta);
    const blockMoveMenuItems = useBlockMoveMenuItems();

    const handleContextMenu = React.useCallback(
        (e: React.MouseEvent<HTMLDivElement>) => {
            e.preventDefault();
            e.stopPropagation();
            const menuItems = appendBlockMoveMenuItems(model.getContextMenuItems(), blockMoveMenuItems);
            ContextMenuModel.getInstance().showContextMenu(menuItems, e);
        },
        [model, blockMoveMenuItems]
    );

    const hideSelectionCopyOverlay = React.useCallback(() => {
        setSelectionCopyOverlay(null);
        setSelectionLogicalLineText(null);
    }, []);

    const terminalCopyMenuItems = React.useMemo<SelectionQuickActionItem[]>(() => {
        const selectionText = selectionCopyOverlay?.text;
        if (selectionText == null) {
            return [];
        }
        return [
            {
                label: "Copy Logical Line",
                enabled: !!selectionLogicalLineText,
                click: () => {
                    fireAndForget(async () => {
                        await copyText(selectionLogicalLineText);
                        hideSelectionCopyOverlay();
                    });
                },
            },
            {
                label: "Copy Selection as One Line",
                click: () => {
                    fireAndForget(async () => {
                        await copyText(terminalSelectionToSingleLine(selectionText));
                        hideSelectionCopyOverlay();
                    });
                },
            },
        ];
    }, [hideSelectionCopyOverlay, selectionCopyOverlay?.text, selectionLogicalLineText]);

    const handleTermMouseDown = React.useCallback(() => {
        setSelectionCopyOverlay(null);
        window.requestAnimationFrame(() => {
            model.giveFocus();
        });
    }, [model]);

    // ponytail: xterm has no mouse-routing hook; plain TUI drag yields to selection. Patch xterm if both need separate gestures.
    const handleTermMouseDownCapture = React.useCallback(
        (e: React.MouseEvent<HTMLDivElement>) => {
            const nativeEvent = e.nativeEvent;
            if (routedTermMouseEventsRef.current.has(nativeEvent)) {
                return;
            }
            const terminal = model.termRef.current?.terminal;
            if (
                terminal == null ||
                !shouldRoutePlainTermGesture(
                    PLATFORM,
                    terminal.modes.mouseTrackingMode,
                    e.button,
                    e.altKey,
                    e.ctrlKey,
                    e.metaKey,
                    e.shiftKey
                )
            ) {
                return;
            }

            const target = e.target;
            const activationOnly = nativeEvent.defaultPrevented;
            pendingTermMouseGestureRef.current?.cleanup();
            handleTermMouseDown();
            e.preventDefault();
            e.stopPropagation();
            nativeEvent.stopImmediatePropagation();

            const startSelection = (gesture: NonNullable<typeof pendingTermMouseGestureRef.current>) => {
                gesture.selecting = true;
                const selectionMouseDown = cloneTermMouseEvent("mousedown", gesture.startEvent, {
                    altKey: true,
                    button: 0,
                    buttons: 1,
                });
                routedTermMouseEventsRef.current.add(selectionMouseDown);
                gesture.target.dispatchEvent(selectionMouseDown);
            };
            const handleMouseMove = (moveEvent: MouseEvent) => {
                if (routedTermMouseEventsRef.current.has(moveEvent)) {
                    return;
                }
                const gesture = pendingTermMouseGestureRef.current;
                if (gesture == null) {
                    return;
                }
                if (
                    !gesture.selecting &&
                    isTermSelectionDrag(
                        gesture.startEvent.clientX,
                        gesture.startEvent.clientY,
                        moveEvent.clientX,
                        moveEvent.clientY
                    )
                ) {
                    startSelection(gesture);
                }
                if (gesture.selecting) {
                    moveEvent.preventDefault();
                    moveEvent.stopPropagation();
                    moveEvent.stopImmediatePropagation();
                    const selectionMouseMove = cloneTermMouseEvent("mousemove", moveEvent, {
                        altKey: true,
                        button: 0,
                        buttons: 1,
                    });
                    routedTermMouseEventsRef.current.add(selectionMouseMove);
                    document.dispatchEvent(selectionMouseMove);
                    return;
                }
                moveEvent.preventDefault();
                moveEvent.stopPropagation();
                moveEvent.stopImmediatePropagation();
            };
            const handleMouseUp = (upEvent: MouseEvent) => {
                const gesture = pendingTermMouseGestureRef.current;
                if (gesture == null) {
                    return;
                }
                pendingTermMouseGestureRef.current = null;
                gesture.cleanup();
                if (gesture.selecting) {
                    const view = viewRef.current;
                    if (view != null) {
                        const rect = view.getBoundingClientRect();
                        lastSelectionPointerRef.current = {
                            x: upEvent.clientX - rect.left,
                            y: upEvent.clientY - rect.top,
                        };
                    }
                    upEvent.preventDefault();
                    upEvent.stopPropagation();
                    upEvent.stopImmediatePropagation();
                    const selectionMouseUp = cloneTermMouseEvent("mouseup", upEvent, {
                        altKey: true,
                        button: 0,
                        buttons: 0,
                    });
                    routedTermMouseEventsRef.current.add(selectionMouseUp);
                    document.dispatchEvent(selectionMouseUp);
                    return;
                }

                upEvent.preventDefault();
                upEvent.stopPropagation();
                upEvent.stopImmediatePropagation();
                if (gesture.activationOnly) {
                    return;
                }
                window.queueMicrotask(() => {
                    const mouseDown = cloneTermMouseEvent("mousedown", gesture.startEvent, {
                        button: 0,
                        buttons: 1,
                    });
                    const mouseUp = cloneTermMouseEvent("mouseup", upEvent, {
                        button: 0,
                        buttons: 0,
                    });
                    routedTermMouseEventsRef.current.add(mouseDown);
                    routedTermMouseEventsRef.current.add(mouseUp);
                    gesture.target.dispatchEvent(mouseDown);
                    gesture.target.dispatchEvent(mouseUp);
                });
            };
            const handleWindowBlur = () => {
                if (pendingTermMouseGestureRef.current?.startEvent !== nativeEvent) {
                    return;
                }
                pendingTermMouseGestureRef.current = null;
                cleanup();
            };
            const cleanup = () => {
                document.removeEventListener("mousemove", handleMouseMove, true);
                document.removeEventListener("mouseup", handleMouseUp, true);
                window.removeEventListener("blur", handleWindowBlur);
            };
            const gesture = {
                startEvent: nativeEvent,
                target,
                selecting: false,
                activationOnly,
                cleanup,
            };
            pendingTermMouseGestureRef.current = gesture;
            document.addEventListener("mousemove", handleMouseMove, true);
            document.addEventListener("mouseup", handleMouseUp, true);
            window.addEventListener("blur", handleWindowBlur);
            if (nativeEvent.detail > 1) {
                startSelection(gesture);
            }
        },
        [handleTermMouseDown, model]
    );

    const handleTermMouseMoveCapture = React.useCallback(
        (e: React.MouseEvent<HTMLDivElement>) => {
            if (!shouldSuppressTermMouseMove(model.termRef.current?.terminal.hasSelection() ?? false, e.buttons)) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            e.nativeEvent.stopImmediatePropagation();
        },
        [model]
    );

    React.useEffect(() => {
        return () => pendingTermMouseGestureRef.current?.cleanup();
    }, []);

    const handleTermMouseUp = React.useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        const view = viewRef.current;
        if (view == null) {
            return;
        }
        const rect = view.getBoundingClientRect();
        lastSelectionPointerRef.current = {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
        };
    }, []);

    const handleTermWheel = React.useCallback(() => {
        setSelectionCopyOverlay(null);
    }, []);

    return (
        <div className={clsx("view-term", "term-mode-" + termMode)} ref={viewRef} onContextMenu={handleContextMenu}>
            {termBg && <div key="term-bg" className="absolute inset-0 z-0 pointer-events-none" style={termBg} />}
            <TermResyncHandler blockId={blockId} model={model} />
            <TermThemeUpdater blockId={blockId} model={model} termRef={model.termRef} />
            <TermStickers config={stickerConfig} />
            <TermToolbarVDomNode key="vdom-toolbar" blockId={blockId} model={model} />
            <TermAgentMessageRail
                blockId={blockId}
                blockData={blockData ?? null}
                termWrap={termWrapInst}
            />
            <TermVDomNode key="vdom" blockId={blockId} model={model} />
            <TermClaudeFullscreenHint model={model} termWrap={termWrapInst} />
            <div
                key="connect-elem"
                className="term-connectelem"
                ref={connectElemRef}
                onMouseDownCapture={handleTermMouseDownCapture}
                onMouseMoveCapture={handleTermMouseMoveCapture}
                onMouseDown={handleTermMouseDown}
                onMouseUp={handleTermMouseUp}
                onWheel={handleTermWheel}
            />
            <NullErrorBoundary debugName="TermLinkTooltip">
                <TermLinkTooltip termWrap={termWrapInst} />
            </NullErrorBoundary>
            <Search {...searchProps} />
            <SelectionCopyOverlay
                overlay={selectionCopyOverlay}
                onHide={hideSelectionCopyOverlay}
                copyMenuItems={terminalCopyMenuItems}
            />
            <ScrollToBottomButton
                isAtBottom={isTermAtBottom}
                onClick={() => {
                    model.termRef.current?.terminal.scrollToBottom();
                    setIsTermAtBottom(true);
                }}
            />
        </div>
    );
};

export { TermClaudeIcon, TerminalView };
