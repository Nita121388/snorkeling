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
} from "@/app/element/selection-copy-overlay";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { globalStore } from "@/app/store/jotaiStore";
import { modalsModel } from "@/app/store/modalmodel";
import { AISessionsServiceType } from "@/app/store/services";
import { useTabModel } from "@/app/store/tab-model";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { AiSessionNoteUpdatedEvent, isAISessionNoteUpdatedEvent } from "@/app/view/aisessions/session-note-events";
import { shortSessionId } from "@/app/view/aisessions/utils";
import type { TermViewModel } from "@/app/view/term/term-model";
import { atoms, getOverrideConfigAtom, getSettingsKeyAtom, getSettingsPrefixAtom, WOS } from "@/store/global";
import { fireAndForget, useAtomValueSafe } from "@/util/util";
import { computeBgStyleFromMeta } from "@/util/waveutil";
import { ISearchOptions } from "@xterm/addon-search";
import clsx from "clsx";
import debug from "debug";
import * as jotai from "jotai";
import * as React from "react";
import { resolveAgentSessionId } from "./agent-session";
import { TermLinkTooltip } from "./term-tooltip";
import { TermStickers } from "./termsticker";
import { TermThemeUpdater } from "./termtheme";
import { computeTheme, normalizeCursorStyle } from "./termutil";
import { TermWrap } from "./termwrap";
import "./xterm.css";

const dlog = debug("wave:term");

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

function sessionSummaryMatchesId(summary: SessionSummary, sessionId: string): boolean {
    return summary.key === sessionId || summary.id === sessionId;
}

const TermSessionNoteButton = React.memo(
    ({ blockData, termWrap }: { blockData: Block | null; termWrap: TermWrap | null }) => {
        const service = React.useMemo(() => new AISessionsServiceType(), []);
        const shellLastCommand = useAtomValueSafe<string | null>(termWrap?.lastCommandAtom);
        const meta = (blockData?.meta ?? {}) as Record<string, unknown>;
        const sessionId = React.useMemo(
            () => resolveAgentSessionId(meta, shellLastCommand).sessionId,
            [meta, shellLastCommand]
        );
        const [summary, setSummary] = React.useState<SessionSummary | null>(null);

        React.useEffect(() => {
            if (sessionId === "") {
                setSummary(null);
                return;
            }
            let cancelled = false;
            service
                .Summary({ id: sessionId })
                .then((nextSummary) => {
                    if (!cancelled) {
                        setSummary(nextSummary);
                    }
                })
                .catch((e) => {
                    if (!cancelled) {
                        console.debug("[term-session-note] failed to load session note", { sessionId, error: e });
                        setSummary(null);
                    }
                });
            return () => {
                cancelled = true;
            };
        }, [service, sessionId]);

        React.useEffect(() => {
            if (sessionId === "") {
                return;
            }
            const handleNoteUpdated = (event: Event) => {
                if (!isAISessionNoteUpdatedEvent(event)) {
                    return;
                }
                if (sessionSummaryMatchesId(event.detail.summary, sessionId)) {
                    setSummary(event.detail.summary);
                }
            };
            window.addEventListener(AiSessionNoteUpdatedEvent, handleNoteUpdated);
            return () => window.removeEventListener(AiSessionNoteUpdatedEvent, handleNoteUpdated);
        }, [sessionId]);

        const note = summary?.note?.trim() ?? "";
        if (sessionId === "" || note === "") {
            return null;
        }
        const title = summary?.title || summary?.id || sessionId;
        return (
            <button
                className="absolute right-2 top-2 z-20 flex max-w-[min(360px,calc(100%-16px))] items-center gap-2 rounded border border-accent/40 bg-bg/70 px-2 py-1 text-xs text-primary opacity-45 shadow-sm backdrop-blur transition-opacity hover:opacity-100 focus:opacity-100"
                title={`${title}\n\n${note}`}
                aria-label="Show agent session note"
                onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    modalsModel.pushModal("AISessionNoteModal", { sessionId });
                }}
            >
                <i className="fa-sharp fa-solid fa-tag shrink-0 text-accent" />
                <span className="min-w-0 truncate">{note}</span>
                <span className="shrink-0 text-[10px] text-secondary">{shortSessionId(summary?.id ?? sessionId)}</span>
            </button>
        );
    }
);

TermSessionNoteButton.displayName = "TermSessionNoteButton";

const TerminalView = ({ blockId, model }: ViewComponentProps<TermViewModel>) => {
    const viewRef = React.useRef<HTMLDivElement>(null);
    const connectElemRef = React.useRef<HTMLDivElement>(null);
    const [termWrapInst, setTermWrapInst] = React.useState<TermWrap | null>(null);
    const [selectionCopyOverlay, setSelectionCopyOverlay] = React.useState<SelectionCopyOverlayState | null>(null);
    const lastSelectionPointerRef = React.useRef<{ x: number; y: number } | null>(null);
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
        const termWrap = new TermWrap(
            tabModel.tabId,
            blockId,
            connectElemRef.current,
            {
                theme: termTheme,
                fontSize: termFontSize,
                fontFamily: termSettings?.["term:fontfamily"] ?? connFontFamily ?? "Hack",
                drawBoldTextInBrightColors: false,
                fontWeight: "normal",
                fontWeightBold: "bold",
                allowTransparency: true,
                scrollback: termScrollback,
                allowProposedApi: true, // Required by @xterm/addon-search to enable search functionality and decorations
                ignoreBracketedPasteMode: !termAllowBPM,
                macOptionIsMeta: termMacOptionIsMeta,
                cursorStyle: termCursorStyle,
                cursorBlink: termCursorBlink,
                overviewRuler: { width: 6 },
            },
            {
                keydownHandler: model.handleTerminalKeydown.bind(model),
                useWebGl: !termSettings?.["term:disablewebgl"],
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
                return;
            }
            if (globalStore.get(getSettingsKeyAtom("term:copyonselect"))) {
                setSelectionCopyOverlay(null);
                return;
            }
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
        if (wasFocused) {
            setTimeout(() => {
                model.giveFocus();
            }, 10);
        }
        return () => {
            termWrap.onSelectionTextChange = null;
            termWrap.dispose();
            rszObs.disconnect();
            setTermWrapInst(null);
            setSelectionCopyOverlay(null);
        };
    }, [blockId, termSettings, termFontSize, connFontFamily]);

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
    }, []);

    const handleTermMouseDown = React.useCallback(() => {
        setSelectionCopyOverlay(null);
        window.requestAnimationFrame(() => {
            model.giveFocus();
        });
    }, [model]);

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
            <TermVDomNode key="vdom" blockId={blockId} model={model} />
            <TermSessionNoteButton blockData={blockData ?? null} termWrap={termWrapInst} />
            <div
                key="connect-elem"
                className="term-connectelem"
                ref={connectElemRef}
                onMouseDown={handleTermMouseDown}
                onMouseUp={handleTermMouseUp}
                onWheel={handleTermWheel}
            />
            <NullErrorBoundary debugName="TermLinkTooltip">
                <TermLinkTooltip termWrap={termWrapInst} />
            </NullErrorBoundary>
            <Search {...searchProps} />
            <SelectionCopyOverlay overlay={selectionCopyOverlay} onHide={hideSelectionCopyOverlay} />
        </div>
    );
};

export { TermClaudeIcon, TerminalView };
