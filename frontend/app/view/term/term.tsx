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
import { AISessionsServiceType } from "@/app/store/services";
import { useTabModel } from "@/app/store/tab-model";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import {
    AiSessionNoteUpdatedEvent,
    dispatchAISessionNoteUpdated,
    isAISessionNoteUpdatedEvent,
} from "@/app/view/aisessions/session-note-events";
import {
    extractSessionTagsFromNote,
    mergeSessionTags,
    sessionTagsEqual,
    sessionTagsLabel,
} from "@/app/view/aisessions/session-tags";
import type { TermViewModel } from "@/app/view/term/term-model";
import { atoms, getOverrideConfigAtom, getSettingsPrefixAtom, WOS } from "@/store/global";
import { PLATFORM } from "@/util/platformutil";
import { fireAndForget, useAtomValueSafe } from "@/util/util";
import { computeBgStyleFromMeta } from "@/util/waveutil";
import { ISearchOptions } from "@xterm/addon-search";
import clsx from "clsx";
import debug from "debug";
import * as jotai from "jotai";
import * as React from "react";
import { extractAgentCommandFromTerminalText, resolveAgentSessionId } from "./agent-session";
import {
    isTermSelectionDrag,
    shouldRoutePlainTermGesture,
    shouldSuppressTermMouseMove,
} from "./term-selection-gesture";
import { TermLinkTooltip } from "./term-tooltip";
import { TermStickers } from "./termsticker";
import { TermThemeUpdater } from "./termtheme";
import { computeTheme, normalizeCursorStyle } from "./termutil";
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

function sessionSummaryMatchesId(summary: SessionSummary, sessionId: string): boolean {
    return summary.key === sessionId || summary.id === sessionId;
}

function useTerminalAgentSessionId(blockData: Block | null, termWrap: TermWrap | null): string {
    const shellLastCommand = useAtomValueSafe<string | null>(termWrap?.lastCommandAtom);
    const fallbackShellLastCommand = React.useMemo(() => {
        if (shellLastCommand || !termWrap) {
            return shellLastCommand;
        }
        const command = extractAgentCommandFromTerminalText(termWrap.getScrollbackContent());
        return command !== "" ? command : null;
    }, [shellLastCommand, termWrap]);
    const meta = (blockData?.meta ?? {}) as Record<string, unknown>;
    return React.useMemo(
        () => resolveAgentSessionId(meta, fallbackShellLastCommand).sessionId,
        [fallbackShellLastCommand, meta]
    );
}

function outlinePreviewText(text: string, maxLength = 120): string {
    const normalized = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line !== "")
        ?.replace(/\s+/g, " ")
        .trim();
    if (!normalized) {
        return "(empty)";
    }
    if (normalized.length <= maxLength) {
        return normalized;
    }
    return `${normalized.slice(0, maxLength).trim()}...`;
}

function userOutlineMessages(outline: AISessionsUserOutlineResponse | null): Message[] {
    return (outline?.messages ?? []).filter((message) => message.role === "user" && message.text?.trim() !== "");
}

function agentSessionConnection(blockData: Block | null): string | undefined {
    const connection = blockData?.meta?.connection;
    return typeof connection === "string" && connection.trim() !== "" ? connection.trim() : undefined;
}

type TermSessionTopBarMode = "expanded" | "collapsed" | "pinned-panel" | "pinned-sticky";

const TermSessionTopBar = React.memo(
    ({ blockData, dimmed, termWrap }: { blockData: Block | null; dimmed: boolean; termWrap: TermWrap | null }) => {
        const sessionId = useTerminalAgentSessionId(blockData, termWrap);
        const [mode, setMode] = React.useState<TermSessionTopBarMode>("pinned-sticky");
        const [isCollapsedRevealed, setIsCollapsedRevealed] = React.useState(false);
        const isCollapsed = mode === "collapsed";

        if (sessionId === "") {
            return null;
        }

        const toggleCollapsed = (event: React.MouseEvent<HTMLButtonElement>) => {
            event.currentTarget.blur();
            setIsCollapsedRevealed(false);
            setMode((current) => (current === "collapsed" ? "expanded" : "collapsed"));
        };
        const togglePanelPin = (event: React.MouseEvent<HTMLButtonElement>) => {
            event.currentTarget.blur();
            setIsCollapsedRevealed(false);
            setMode((current) => (current === "pinned-panel" ? "expanded" : "pinned-panel"));
        };
        const toggleStickyPin = (event: React.MouseEvent<HTMLButtonElement>) => {
            event.currentTarget.blur();
            setIsCollapsedRevealed(false);
            setMode((current) => (current === "pinned-sticky" ? "expanded" : "pinned-sticky"));
        };

        return (
            <div
                className={clsx(
                    "term-session-topbar",
                    `mode-${mode}`,
                    isCollapsed && "is-collapsed",
                    isCollapsed && isCollapsedRevealed && "is-revealed"
                )}
                onMouseLeave={() => setIsCollapsedRevealed(false)}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
            >
                <div className="term-session-topbar-content">
                    <div className="term-session-topbar-main">
                        <TermSessionNoteEditor blockData={blockData} termWrap={termWrap} />
                        <TermSessionUserOutlineOverlay blockData={blockData} dimmed={dimmed} termWrap={termWrap} />
                    </div>
                    <div className="term-session-topbar-actions">
                        <button
                            type="button"
                            className={clsx("term-session-topbar-action", mode === "pinned-panel" && "is-active")}
                            aria-label="Pin session header as panel"
                            aria-pressed={mode === "pinned-panel"}
                            title="Pin as panel"
                            onClick={togglePanelPin}
                        >
                            <i className="fa-sharp fa-solid fa-thumbtack" />
                        </button>
                        <button
                            type="button"
                            className={clsx("term-session-topbar-action", mode === "pinned-sticky" && "is-active")}
                            aria-label="Pin session header as transparent sticky"
                            aria-pressed={mode === "pinned-sticky"}
                            title="Pin as transparent sticky"
                            onClick={toggleStickyPin}
                        >
                            <i className="fa-sharp fa-solid fa-note-sticky" />
                        </button>
                    </div>
                </div>
                <button
                    type="button"
                    className="term-session-topbar-handle"
                    aria-label={isCollapsed ? "Expand session header" : "Collapse session header"}
                    title={isCollapsed ? "Expand session header" : "Collapse session header"}
                    onMouseEnter={() => {
                        if (isCollapsed) {
                            setIsCollapsedRevealed(true);
                        }
                    }}
                    onMouseMove={() => {
                        if (isCollapsed) {
                            setIsCollapsedRevealed(true);
                        }
                    }}
                    onClick={toggleCollapsed}
                >
                    <i className={clsx("fa-sharp fa-solid", isCollapsed ? "fa-chevron-right" : "fa-chevron-left")} />
                </button>
            </div>
        );
    }
);

TermSessionTopBar.displayName = "TermSessionTopBar";

const TermSessionUserOutlineOverlay = React.memo(
    ({ blockData, dimmed, termWrap }: { blockData: Block | null; dimmed: boolean; termWrap: TermWrap | null }) => {
        const service = React.useMemo(() => new AISessionsServiceType(), []);
        const sessionId = useTerminalAgentSessionId(blockData, termWrap);
        const connection = agentSessionConnection(blockData);
        const [isOpen, setIsOpen] = React.useState(false);
        const [outline, setOutline] = React.useState<AISessionsUserOutlineResponse | null>(null);
        const [loading, setLoading] = React.useState(false);
        const [error, setError] = React.useState("");
        const [activeSeq, setActiveSeq] = React.useState<number | null>(null);
        const requestSeqRef = React.useRef(0);

        React.useEffect(() => {
            return () => {
                requestSeqRef.current++;
            };
        }, []);

        const loadOutline = React.useCallback(
            (refresh = false, showLoading = true) => {
                requestSeqRef.current++;
                const requestSeq = requestSeqRef.current;
                if (sessionId === "") {
                    setOutline(null);
                    setError("");
                    setLoading(false);
                    return;
                }
                if (showLoading) {
                    setLoading(true);
                }
                setError("");
                service
                    .UserOutline({ id: sessionId, connection, limit: 20, refresh })
                    .then((nextOutline) => {
                        if (requestSeq !== requestSeqRef.current) {
                            return;
                        }
                        setOutline(nextOutline);
                    })
                    .catch((e) => {
                        if (requestSeq !== requestSeqRef.current) {
                            return;
                        }
                        console.debug("[term-session-outline] failed to load user outline", { sessionId, error: e });
                        setError(e instanceof Error ? e.message : String(e));
                    })
                    .finally(() => {
                        if (requestSeq !== requestSeqRef.current) {
                            return;
                        }
                        setLoading(false);
                    });
            },
            [connection, service, sessionId]
        );

        React.useEffect(() => {
            requestSeqRef.current++;
            setIsOpen(false);
            setActiveSeq(null);
            setOutline(null);
            setError("");
            setLoading(false);
            if (sessionId === "") {
                return;
            }
            const loadTimer = window.setTimeout(() => loadOutline(false, true), 300);
            return () => {
                window.clearTimeout(loadTimer);
                requestSeqRef.current++;
            };
        }, [loadOutline, sessionId]);

        React.useEffect(() => {
            if (!isOpen) {
                return;
            }
            const onKeyDown = (event: KeyboardEvent) => {
                if (event.key === "Escape") {
                    setIsOpen(false);
                    setActiveSeq(null);
                }
            };
            window.addEventListener("keydown", onKeyDown);
            return () => window.removeEventListener("keydown", onKeyDown);
        }, [isOpen]);

        if (sessionId === "") {
            return null;
        }

        const userMessages = userOutlineMessages(outline);
        const userMessageCount = outline?.userMessageCount ?? userMessages.length;
        if (!isOpen && userMessages.length === 0 && !loading) {
            return null;
        }

        const visibleMessages = userMessages.slice(-5);
        const latestMessage = userMessages[userMessages.length - 1] ?? null;
        const activeMessage =
            activeSeq == null ? null : (userMessages.find((message) => message.seq === activeSeq) ?? null);
        const hiddenCount = Math.max(0, userMessageCount - visibleMessages.length);
        const title = outline?.summary?.title || outline?.summary?.id || sessionId;

        const toggleOpen = () => {
            const nextOpen = !isOpen;
            setIsOpen(nextOpen);
            setActiveSeq(null);
            if (nextOpen && !loading) {
                loadOutline(true, true);
            }
        };

        return (
            <div
                className={clsx(
                    "term-session-outline",
                    isOpen ? "is-open" : "is-collapsed",
                    dimmed && !isOpen && "is-dimmed"
                )}
                title={isOpen ? title : latestMessage ? outlinePreviewText(latestMessage.text, 220) : title}
                aria-busy={loading}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
            >
                <button
                    type="button"
                    className="term-session-outline-toggle"
                    onClick={toggleOpen}
                    aria-label={isOpen ? "Collapse user outline" : "Expand user outline"}
                >
                    <i
                        className={clsx(
                            "fa-sharp fa-solid shrink-0 text-[10px]",
                            isOpen ? "fa-chevron-down" : "fa-chevron-right"
                        )}
                    />
                    <i className="fa-sharp fa-solid fa-list-ul term-session-outline-icon" aria-hidden="true" />
                    <span className="term-session-outline-count">
                        {loading && userMessages.length === 0 ? "..." : userMessageCount}
                    </span>
                    {!isOpen && latestMessage ? (
                        <span className="term-session-outline-latest">
                            {outlinePreviewText(latestMessage.text, 88)}
                        </span>
                    ) : null}
                    {loading ? (
                        <i
                            className="fa-sharp fa-solid fa-spinner ml-auto shrink-0 animate-spin text-[10px]"
                            aria-hidden="true"
                        />
                    ) : null}
                </button>
                {isOpen ? (
                    <div className="term-session-outline-body">
                        {error ? <div className="py-1 text-[11px] text-error">{error}</div> : null}
                        {visibleMessages.length === 0 && !error ? (
                            <div className="py-1 text-[11px] text-secondary">No user messages found.</div>
                        ) : null}
                        {hiddenCount > 0 ? (
                            <div className="mb-1 text-[10px] text-secondary">
                                Showing latest {visibleMessages.length}; {hiddenCount} older hidden
                            </div>
                        ) : null}
                        <div className="flex flex-col gap-1">
                            {visibleMessages.map((message) => (
                                <button
                                    key={message.seq}
                                    type="button"
                                    className={clsx(
                                        "flex min-w-0 items-start gap-2 rounded border border-transparent px-1.5 py-1 text-left hover:border-accent/25 hover:bg-accent/10",
                                        activeSeq === message.seq && "border-accent/35 bg-accent/10"
                                    )}
                                    title={message.text}
                                    onClick={() =>
                                        setActiveSeq((current) => (current === message.seq ? null : message.seq))
                                    }
                                >
                                    <span className="shrink-0 font-mono text-[10px] text-accent/80">
                                        #{message.seq}
                                    </span>
                                    <span className="min-w-0 flex-1 truncate text-secondary">
                                        {outlinePreviewText(message.text, 110)}
                                    </span>
                                </button>
                            ))}
                        </div>
                        {activeMessage ? (
                            <div className="term-session-outline-message">{activeMessage.text}</div>
                        ) : null}
                    </div>
                ) : null}
            </div>
        );
    }
);

TermSessionUserOutlineOverlay.displayName = "TermSessionUserOutlineOverlay";

type NoteSaveStatus = "idle" | "saving" | "saved" | "error";
const TermSessionNoteAutoSaveDelayMs = 3000;

const TermSessionNoteEditor = React.memo(
    ({ blockData, termWrap }: { blockData: Block | null; termWrap: TermWrap | null }) => {
        const service = React.useMemo(() => new AISessionsServiceType(), []);
        const sessionId = useTerminalAgentSessionId(blockData, termWrap);
        const connection = agentSessionConnection(blockData);
        const [summary, setSummary] = React.useState<SessionSummary | null>(null);
        const [noteDraft, setNoteDraft] = React.useState("");
        const [isEditing, setIsEditing] = React.useState(false);
        const [saveStatus, setSaveStatus] = React.useState<NoteSaveStatus>("idle");
        const [error, setError] = React.useState("");
        const inputRef = React.useRef<HTMLTextAreaElement | null>(null);
        const saveSeqRef = React.useRef(0);
        const saveTimerRef = React.useRef<number | null>(null);
        const latestDraftRef = React.useRef("");

        React.useEffect(() => {
            if (sessionId === "") {
                setSummary(null);
                setNoteDraft("");
                setIsEditing(false);
                setError("");
                setSaveStatus("idle");
                return;
            }
            let cancelled = false;
            setSummary(null);
            setNoteDraft("");
            setIsEditing(false);
            setError("");
            setSaveStatus("idle");
            service
                .Summary({ id: sessionId, connection })
                .then((nextSummary) => {
                    if (!cancelled) {
                        setSummary(nextSummary);
                        setNoteDraft(nextSummary.note ?? "");
                    }
                })
                .catch((e) => {
                    if (!cancelled) {
                        console.debug("[term-session-note] failed to load session note", { sessionId, error: e });
                        setSummary(null);
                        setError(e instanceof Error ? e.message : String(e));
                    }
                });
            return () => {
                cancelled = true;
            };
        }, [connection, service, sessionId]);

        React.useEffect(() => {
            latestDraftRef.current = noteDraft;
        }, [noteDraft]);

        React.useEffect(() => {
            if (saveStatus !== "saved" && saveStatus !== "error") {
                return;
            }
            const handle = window.setTimeout(() => setSaveStatus("idle"), saveStatus === "saved" ? 1200 : 1800);
            return () => window.clearTimeout(handle);
        }, [saveStatus]);

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
                    const nextNote = event.detail.summary.note ?? "";
                    if (saveStatus !== "saving" && latestDraftRef.current.trim() === (summary?.note ?? "")) {
                        setNoteDraft(nextNote);
                    }
                }
            };
            window.addEventListener(AiSessionNoteUpdatedEvent, handleNoteUpdated);
            return () => window.removeEventListener(AiSessionNoteUpdatedEvent, handleNoteUpdated);
        }, [saveStatus, sessionId, summary?.note]);

        const saveNote = React.useCallback(
            (nextNote: string) => {
                if (summary == null) {
                    return;
                }
                const parsed = extractSessionTagsFromNote(nextNote);
                const tags = mergeSessionTags(summary.tags ?? [], parsed.tags);
                if (parsed.note === (summary.note ?? "") && sessionTagsEqual(tags, summary.tags)) {
                    setError("");
                    return;
                }
                saveSeqRef.current++;
                const saveSeq = saveSeqRef.current;
                setSaveStatus("saving");
                setError("");
                service
                    .NoteAndTags({ id: summary.key, note: parsed.note, tags })
                    .then((updated) => {
                        if (saveSeq !== saveSeqRef.current) {
                            return;
                        }
                        setSummary(updated);
                        if (!isEditing) {
                            setNoteDraft(updated.note ?? "");
                        }
                        setSaveStatus("saved");
                        dispatchAISessionNoteUpdated(updated);
                    })
                    .catch((e) => {
                        if (saveSeq !== saveSeqRef.current) {
                            return;
                        }
                        console.debug("[term-session-note] failed to save session note", { sessionId, error: e });
                        setSaveStatus("error");
                        setError(e instanceof Error ? e.message : String(e));
                    });
            },
            [isEditing, service, sessionId, summary]
        );

        const finishEditing = React.useCallback(() => {
            setIsEditing(false);
            if (saveTimerRef.current != null) {
                window.clearTimeout(saveTimerRef.current);
                saveTimerRef.current = null;
            }
            saveNote(noteDraft);
        }, [noteDraft, saveNote]);

        React.useEffect(() => {
            if (
                summary == null ||
                (extractSessionTagsFromNote(noteDraft).note === (summary.note ?? "") &&
                    sessionTagsEqual(
                        mergeSessionTags(summary.tags ?? [], extractSessionTagsFromNote(noteDraft).tags),
                        summary.tags
                    ))
            ) {
                return;
            }
            saveTimerRef.current = window.setTimeout(() => {
                saveTimerRef.current = null;
                saveNote(noteDraft);
            }, TermSessionNoteAutoSaveDelayMs);
            return () => {
                if (saveTimerRef.current != null) {
                    window.clearTimeout(saveTimerRef.current);
                    saveTimerRef.current = null;
                }
            };
        }, [noteDraft, saveNote, summary]);

        React.useEffect(() => {
            return () => {
                if (saveTimerRef.current != null) {
                    window.clearTimeout(saveTimerRef.current);
                    saveTimerRef.current = null;
                }
                saveSeqRef.current++;
            };
        }, []);

        if (sessionId === "" || summary == null) {
            return null;
        }
        const title = summary?.title || summary?.id || sessionId;
        const trimmedDraft = noteDraft.trim();
        const tagText = sessionTagsLabel(summary.tags);
        const previewText =
            trimmedDraft
                .split(/\r?\n/)
                .find((line) => line.trim() !== "")
                ?.trim() ||
            tagText ||
            "Note";
        const statusIcon =
            saveStatus === "saving"
                ? "fa-spinner animate-spin"
                : saveStatus === "saved"
                  ? "fa-check"
                  : saveStatus === "error"
                    ? "fa-triangle-exclamation"
                    : "fa-tag";
        return (
            <div
                className={clsx(
                    "term-session-note-editor",
                    isEditing ? "is-editing" : "is-preview",
                    trimmedDraft === "" && "is-empty",
                    saveStatus === "saving" && "is-saving",
                    saveStatus === "saved" && "is-saved",
                    saveStatus === "error" && "is-error"
                )}
                title={error || title}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                    e.stopPropagation();
                }}
            >
                <button
                    type="button"
                    className="term-session-note-preview"
                    aria-label="Edit session note"
                    onClick={() => {
                        setIsEditing(true);
                        window.setTimeout(() => {
                            inputRef.current?.focus();
                            inputRef.current?.setSelectionRange(noteDraft.length, noteDraft.length);
                        }, 0);
                    }}
                >
                    <i className={clsx("fa-sharp fa-solid term-session-note-icon", statusIcon)} />
                    <span className="term-session-note-preview-text">{previewText}</span>
                </button>
                {isEditing ? (
                    <div className="term-session-note-popover">
                        <div className="term-session-note-popover-head">
                            <i className={clsx("fa-sharp fa-solid term-session-note-icon", statusIcon)} />
                            <span className="term-session-note-popover-title">{title}</span>
                        </div>
                        <textarea
                            ref={inputRef}
                            className="term-session-note-input"
                            value={noteDraft}
                            rows={4}
                            placeholder="Note"
                            aria-label="Session note"
                            spellCheck={false}
                            onChange={(event) => {
                                setNoteDraft(event.target.value);
                                setError("");
                                if (saveStatus !== "saving") {
                                    setSaveStatus("idle");
                                }
                            }}
                            onBlur={finishEditing}
                            onKeyDown={(event) => {
                                event.stopPropagation();
                                if (event.key === "Escape") {
                                    event.currentTarget.blur();
                                }
                            }}
                        />
                    </div>
                ) : null}
            </div>
        );
    }
);

TermSessionNoteEditor.displayName = "TermSessionNoteEditor";

const TerminalView = ({ blockId, model }: ViewComponentProps<TermViewModel>) => {
    const viewRef = React.useRef<HTMLDivElement>(null);
    const connectElemRef = React.useRef<HTMLDivElement>(null);
    const [termWrapInst, setTermWrapInst] = React.useState<TermWrap | null>(null);
    const [selectionCopyOverlay, setSelectionCopyOverlay] = React.useState<SelectionCopyOverlayState | null>(null);
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
        const fontFamily = termSettings?.["term:fontfamily"] ?? connFontFamily ?? "Hack";
        const useWebGl = !termSettings?.["term:disablewebgl"];
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
            console.log("[termwrap-lifecycle-debug] dispose", {
                blockId,
                nodeId: model.nodeModel.nodeId,
                tabId: tabModel.tabId,
            });
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
            <TermSessionTopBar
                blockData={blockData ?? null}
                dimmed={selectionCopyOverlay != null || searchIsOpen}
                termWrap={termWrapInst}
            />
            <TermVDomNode key="vdom" blockId={blockId} model={model} />
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
            <SelectionCopyOverlay overlay={selectionCopyOverlay} onHide={hideSelectionCopyOverlay} />
        </div>
    );
};

export { TermClaudeIcon, TerminalView };
