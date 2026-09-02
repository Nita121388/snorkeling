// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { AISessionsServiceType } from "@/app/store/services";
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
import { resolveAgentSessionId } from "@/app/view/term/agent-session";
import { WOS } from "@/store/global";
import * as jotai from "jotai";
import * as React from "react";

type NoteSaveStatus = "idle" | "saving" | "saved" | "error";
const NoteAutoSaveDelayMs = 3000;
const NoteLoadMaxRetries = 10;
const NoteLoadRetryDelayMs = 3000;

function agentSessionConnection(blockData: Block | null): string | undefined {
    const connection = blockData?.meta?.connection;
    return typeof connection === "string" && connection.trim() !== "" ? connection.trim() : undefined;
}

function agentSessionIdFromBlockData(blockData: Block | null): string {
    if (blockData == null) {
        return "";
    }
    const meta = (blockData.meta ?? {}) as Record<string, unknown>;
    return resolveAgentSessionId(meta).sessionId;
}

/**
 * AgentHoverCard - GUI 专用 hover 卡片，只显示 note
 * TUI 的 TermSessionTopBar 保持原样（note + 用户会话列表）
 */
/**
 * 轻量 session outline 预览，不依赖 termWrap
 */
function useSessionOutline(blockId: string, blockData: Block | null) {
    const service = React.useMemo(() => new AISessionsServiceType(), []);
    const sessionId = React.useMemo(() => agentSessionIdFromBlockData(blockData), [blockData]);
    const connection = agentSessionConnection(blockData);
    const [outline, setOutline] = React.useState<AISessionsUserOutlineResponse | null>(null);
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState("");
    const [activeSeq, setActiveSeq] = React.useState<number | null>(null);
    const requestSeqRef = React.useRef(0);
    const [loadAttempts, setLoadAttempts] = React.useState(0);
    const retryTimerRef = React.useRef<number | null>(null);
    const retryCountRef = React.useRef(0);

    React.useEffect(() => {
        return () => {
            if (retryTimerRef.current != null) {
                window.clearTimeout(retryTimerRef.current);
                retryTimerRef.current = null;
            }
            requestSeqRef.current++;
        };
    }, [blockId]);

    React.useEffect(() => {
        requestSeqRef.current++;
        setActiveSeq(null);
        setOutline(null);
        setError("");
        setLoading(false);
        if (sessionId === "") {
            return;
        }
        const loadTimer = window.setTimeout(() => {
            requestSeqRef.current++;
            const requestSeq = requestSeqRef.current;
            setLoading(true);
            setError("");
            service
                .UserOutline({ id: sessionId, connection, limit: 20, refresh: false })
                .then((nextOutline) => {
                    if (requestSeq !== requestSeqRef.current) return;
                    setOutline(nextOutline);
                })
                .catch((e) => {
                    if (requestSeq !== requestSeqRef.current) return;
                    console.debug("[agent-hover-card] failed to load outline", { sessionId, error: e });
                    setError(e instanceof Error ? e.message : String(e));
                    if (retryTimerRef.current == null && retryCountRef.current < 10) {
                        retryCountRef.current++;
                        retryTimerRef.current = window.setTimeout(() => {
                            retryTimerRef.current = null;
                            setLoadAttempts((n) => n + 1);
                        }, 3000);
                    }
                })
                .finally(() => {
                    if (requestSeq !== requestSeqRef.current) return;
                    setLoading(false);
                });
        }, 300);
        return () => {
            window.clearTimeout(loadTimer);
            requestSeqRef.current++;
        };
    }, [blockId, connection, service, sessionId, loadAttempts]);

    React.useEffect(() => {
        setLoadAttempts(0);
        retryCountRef.current = 0;
        if (retryTimerRef.current != null) {
            window.clearTimeout(retryTimerRef.current);
            retryTimerRef.current = null;
        }
    }, [sessionId]);

    const userMessages = React.useMemo(() => {
        return (outline?.messages ?? []).filter(
            (message) => message.role === "user" && message.text?.trim() !== ""
        );
    }, [outline]);

    return {
        sessionId,
        outline,
        userMessages,
        userMessageCount: outline?.userMessageCount ?? userMessages.length,
        loading,
        error,
        activeSeq,
        setActiveSeq,
        title: outline?.summary?.title || outline?.summary?.id || sessionId,
    };
}

/**
 * AgentHoverCard - TUI: note + 用户会话列表 / GUI: 只显示 note
 */
export type AgentHoverCardProps = {
    blockId: string;
    blockData: Block | null;
    /**
     * gui: 只显示 note
     * tui: 显示 note + 用户会话列表
     */
    mode: "gui" | "tui";
};

/**
 * 轻量 session note 预览 + 编辑器，不依赖 termWrap
 */
function useSessionNote(blockId: string, blockData: Block | null) {
    const service = React.useMemo(() => new AISessionsServiceType(), []);
    const sessionId = React.useMemo(() => agentSessionIdFromBlockData(blockData), [blockData]);
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
    const [loadAttempts, setLoadAttempts] = React.useState(0);
    const retryTimerRef = React.useRef<number | null>(null);
    const retryCountRef = React.useRef(0);

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
                if (cancelled) return;
                setSummary(nextSummary);
                setNoteDraft(nextSummary.note ?? "");
            })
            .catch((e) => {
                if (cancelled) return;
                console.debug("[agent-hover-card] failed to load session note", { sessionId, error: e });
                setSummary(null);
                setError(e instanceof Error ? e.message : String(e));
                if (retryTimerRef.current == null && retryCountRef.current < NoteLoadMaxRetries) {
                    retryCountRef.current++;
                    retryTimerRef.current = window.setTimeout(() => {
                        retryTimerRef.current = null;
                        setLoadAttempts((n) => n + 1);
                    }, NoteLoadRetryDelayMs);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [blockId, connection, service, sessionId, loadAttempts]);

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
            if (event.detail.summary.id === sessionId || event.detail.summary.key === sessionId) {
                const shouldSyncDraft =
                    saveStatus !== "saving" && latestDraftRef.current.trim() === (summary?.note ?? "");
                setSummary(event.detail.summary);
                if (shouldSyncDraft) {
                    setNoteDraft(event.detail.summary.note ?? "");
                }
            }
        };
        window.addEventListener(AiSessionNoteUpdatedEvent, handleNoteUpdated);
        return () => window.removeEventListener(AiSessionNoteUpdatedEvent, handleNoteUpdated);
    }, [blockId, saveStatus, sessionId, summary?.note]);

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
                    console.debug("[agent-hover-card] failed to save session note", { sessionId, error: e });
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
        }, NoteAutoSaveDelayMs);
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
            if (retryTimerRef.current != null) {
                window.clearTimeout(retryTimerRef.current);
                retryTimerRef.current = null;
            }
            saveSeqRef.current++;
        };
    }, []);

    React.useEffect(() => {
        setLoadAttempts(0);
        retryCountRef.current = 0;
        if (retryTimerRef.current != null) {
            window.clearTimeout(retryTimerRef.current);
            retryTimerRef.current = null;
        }
    }, [sessionId]);

    return {
        sessionId,
        summary,
        noteDraft,
        setNoteDraft,
        isEditing,
        setIsEditing,
        saveStatus,
        error,
        inputRef,
        finishEditing,
        trimmedDraft: noteDraft.trim(),
        title: summary?.title || summary?.id || sessionId,
        previewText: noteDraft
            .trim()
            .split(/\r?\n/)
            .find((line) => line.trim() !== "")
            ?.trim() || sessionTagsLabel(summary?.tags) || "Note",
    };
}

const AgentHoverCard = React.memo(({ blockId, blockData, mode }: AgentHoverCardProps) => {
    const {
        sessionId,
        summary,
        noteDraft,
        setNoteDraft,
        isEditing,
        setIsEditing,
        saveStatus,
        error: noteError,
        inputRef,
        finishEditing,
        trimmedDraft,
        title,
        previewText,
    } = useSessionNote(blockId, blockData);

    const outlineData = useSessionOutline(blockId, blockData);

    if (sessionId === "" || summary == null) {
        return null;
    }

    const statusIcon =
        saveStatus === "saving"
            ? "fa-spinner animate-spin"
            : saveStatus === "saved"
              ? "fa-check"
              : saveStatus === "error"
                ? "fa-triangle-exclamation"
                : "fa-tag";

    return (
        <div className="agent-hover-card">
            {/* Note section */}
            <div className="agent-hover-card-section">
                <div className="agent-hover-card-head">
                    <i className={`fa-sharp fa-solid agent-hover-card-icon ${statusIcon}`} />
                    <span className="agent-hover-card-title">{title}</span>
                </div>
                {isEditing ? (
                    <textarea
                        ref={inputRef}
                        className="agent-hover-card-input"
                        value={noteDraft}
                        rows={4}
                        placeholder="Note"
                        aria-label="Session note"
                        spellCheck={false}
                        onChange={(event) => {
                            setNoteDraft(event.target.value);
                        }}
                        onBlur={finishEditing}
                        onKeyDown={(event) => {
                            event.stopPropagation();
                            if (event.key === "Escape") {
                                event.currentTarget.blur();
                            }
                        }}
                    />
                ) : (
                    <button
                        type="button"
                        className="agent-hover-card-preview"
                        onClick={() => {
                            setIsEditing(true);
                            window.setTimeout(() => {
                                inputRef.current?.focus();
                                inputRef.current?.setSelectionRange(noteDraft.length, noteDraft.length);
                            }, 0);
                        }}
                    >
                        {trimmedDraft === "" ? (
                            <span className="agent-hover-card-empty">Click to add a note...</span>
                        ) : (
                            <span className="agent-hover-card-text">{previewText}</span>
                        )}
                    </button>
                )}
                {noteError ? <div className="agent-hover-card-error">{noteError}</div> : null}
            </div>

            {/* TUI only: User outline section */}
            {mode === "tui" && outlineData.sessionId !== "" && (
                <div className="agent-hover-card-section agent-hover-card-outline">
                    <div className="agent-hover-card-head">
                        <i className="fa-sharp fa-solid fa-list-ul agent-hover-card-icon" />
                        <span className="agent-hover-card-title">
                            {outlineData.loading && outlineData.userMessages.length === 0
                                ? "..."
                                : outlineData.userMessageCount}
                        </span>
                        {outlineData.loading ? (
                            <i
                                className="fa-sharp fa-solid fa-spinner ml-auto animate-spin agent-hover-card-icon"
                                aria-hidden="true"
                            />
                        ) : null}
                    </div>
                    {outlineData.userMessages.length > 0 && (
                        <div className="agent-hover-card-outline-list">
                            {outlineData.userMessages.slice(-3).map((message) => (
                                <div
                                    key={message.seq}
                                    className="agent-hover-card-outline-item"
                                >
                                    <span className="agent-hover-card-outline-seq">
                                        #{message.seq}
                                    </span>
                                    <span className="agent-hover-card-outline-text">
                                        {message.text.length > 80
                                            ? message.text.slice(0, 80).trim() + "..."
                                            : message.text}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                    {outlineData.error ? (
                        <div className="agent-hover-card-error">{outlineData.error}</div>
                    ) : null}
                </div>
            )}
        </div>
    );
});

AgentHoverCard.displayName = "AgentHoverCard";

export { AgentHoverCard, useSessionNote, useSessionOutline, agentSessionIdFromBlockData };
