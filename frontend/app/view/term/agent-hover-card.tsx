// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import {
    ensureSessionNote,
    getSessionNoteSnapshot,
    saveSessionNote,
    subscribeSessionNote,
} from "@/app/store/session-note-cache";
import { AISessionsServiceType } from "@/app/store/services";
import {
    AiSessionNoteUpdatedEvent,
    isAISessionNoteUpdatedEvent,
} from "@/app/view/aisessions/session-note-events";
import {
    extractSessionTagsFromNote,
    mergeSessionTags,
    sessionTagsEqual,
    sessionTagsLabel,
} from "@/app/view/aisessions/session-tags";
import { AgentStatusStore } from "@/app/agent-status/agent-status-store";
import type { AgentStatus } from "@/app/agent-status/agent-status-types";
import { agentStatusPresentation, formatAgentProvider } from "@/app/agent-status/agent-status-derive";
import { normalizeAgentProvider } from "@/app/view/term/agent-meta";
import { useAtomValueSafe } from "@/util/util";
import { resolveAgentSessionId } from "@/app/view/term/agent-session";
import * as React from "react";

type NoteSaveStatus = "idle" | "saving" | "saved" | "error";
const NoteAutoSaveDelayMs = 3000;

function agentSessionConnection(blockData: Block | null): string | undefined {
    const connection = blockData?.meta?.connection;
    return typeof connection === "string" && connection.trim() !== "" ? connection.trim() : undefined;
}

function useAgentStatusForCard(blockId: string): AgentStatus | null {
    const store = AgentStatusStore.getInstance();
    const [statusAtom, setStatusAtom] = React.useState<ReturnType<AgentStatusStore["acquire"]> | null>(null);
    React.useEffect(() => {
        const atom = store.acquire(blockId);
        setStatusAtom(atom);
        return () => store.release(blockId);
    }, [store, blockId]);
    return useAtomValueSafe(statusAtom);
}

function agentSessionIdFromBlockData(blockData: Block | null): string {
    if (blockData == null) {
        return "";
    }
    const meta = (blockData.meta ?? {}) as Record<string, unknown>;
    return resolveAgentSessionId(meta).sessionId;
}

/**
 * AgentHoverCard - 统一的 agent 会话卡片 (note + TUI 模式下的用户消息列表)
 * 消费方: Block Header hover (gui) / TermAgentSessionRail 弹出层 (tui)
 */
/**
 * 轻量 session outline 预览，不依赖 termWrap
 */
/**
 * 轻量 session note 预览 + 编辑器，不依赖 termWrap。
 * 数据来自模块级 session-note-cache：加载/重试与组件挂载解耦，
 * 悬浮期间即使 summary 尚未就绪，后台重试也会继续，下次悬浮直接命中缓存。
 */
function useSessionNote(blockId: string, blockData: Block | null) {
    const service = React.useMemo(() => new AISessionsServiceType(), []);
    const sessionId = React.useMemo(() => agentSessionIdFromBlockData(blockData), [blockData]);
    const connection = agentSessionConnection(blockData);
    const [noteDraft, setNoteDraft] = React.useState("");
    const [isEditing, setIsEditing] = React.useState(false);
    const [saveStatus, setSaveStatus] = React.useState<NoteSaveStatus>("idle");
    const [error, setError] = React.useState("");
    const inputRef = React.useRef<HTMLTextAreaElement | null>(null);
    const saveSeqRef = React.useRef(0);
    const saveTimerRef = React.useRef<number | null>(null);
    const latestDraftRef = React.useRef("");

    // 触发后台加载（幂等）；快照通过 useSyncExternalStore 订阅。
    React.useEffect(() => {
        ensureSessionNote(service, sessionId, connection);
    }, [connection, service, sessionId]);

    const subscribe = React.useCallback(
        (listener: () => void) => subscribeSessionNote(sessionId, connection, listener),
        [connection, sessionId]
    );
    const getSnapshot = React.useCallback(
        () => getSessionNoteSnapshot(sessionId, connection),
        [connection, sessionId]
    );
    const snapshot = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    const summary = snapshot?.summary ?? null;

    // 切换会话时重置本地编辑态，并同步草稿为最新 note。
    React.useEffect(() => {
        setNoteDraft(summary?.note ?? "");
        setIsEditing(false);
        setSaveStatus("idle");
        setError("");
        // 仅在 sessionId 变化时重置；summary 后续更新不打断正在编辑的草稿。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionId]);

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
            saveSessionNote(service, sessionId, connection, parsed.note, tags).then((result) => {
                if (saveSeq !== saveSeqRef.current) {
                    return;
                }
                if (result.status === "ok") {
                    // 缓存已由 saveSessionNote 更新并广播；这里只需同步本地草稿。
                    if (!isEditing) {
                        setNoteDraft(result.summary.note ?? "");
                    }
                    setSaveStatus("saved");
                } else {
                    console.debug("[agent-hover-card] failed to save session note", { sessionId, error: result.error });
                    setSaveStatus("error");
                    setError(result.error);
                }
            });
        },
        [connection, isEditing, service, sessionId, summary]
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
            saveSeqRef.current++;
        };
    }, []);

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

export type AgentHoverCardProps = {
    blockId: string;
    blockData: Block | null;
    /**
     * gui/tui 语义标记；当前渲染一致（只显示 note），
     * TUI 的用户消息列表由 TermAgentMessageRail 的 SessionOutlineRail 承载。
     */
    mode: "gui" | "tui";
};

const AgentHoverCard = React.memo(({ blockId, blockData, mode }: AgentHoverCardProps) => {
    const {
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

    // 模型 + 状态信息（来自 block meta 与 AgentStatusStore）
    const agentStatus = useAgentStatusForCard(blockId);
    const provider =
        agentStatus?.provider != null && agentStatus.provider.trim() !== ""
            ? formatAgentProvider(agentStatus.provider)
            : formatAgentProvider(normalizeAgentProvider(blockData?.meta?.["agent:provider"]));
    const model =
        (blockData?.meta?.["agent:requestedmodel"] as string)?.trim() ||
        (blockData?.meta?.["model"] as string)?.trim() ||
        "";
    const statusPres = agentStatus != null ? agentStatusPresentation(agentStatus) : null;
    const showMetaRow = provider !== "" && provider !== "Agent" || model !== "" || statusPres != null;

    // mode 保留用于语义区分（gui 与 tui 当前渲染一致），TUI 的消息列表由 TermAgentMessageRail 承载。
    void mode;

    // 会话摘要未就绪时也允许渲染（只要 agent 模型/状态信息可用）；Note 段仅在摘要就绪后显示。
    if (!showMetaRow && summary == null) {
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
            {/* 模型 + 状态 section */}
            {showMetaRow && (
                <div className="agent-hover-card-section">
                    <div className="agent-hover-card-head">
                        <i className="fa-sharp fa-solid fa-microchip agent-hover-card-icon" />
                        <span className="agent-hover-card-title">{provider}</span>
                        {model !== "" && <span className="agent-hover-card-model">{model}</span>}
                    </div>
                    {statusPres != null && (
                        <div className="agent-hover-card-status">
                            <i className={`fa-sharp fa-solid ${statusPres.icon}`} />
                            <span>{statusPres.label}</span>
                        </div>
                    )}
                </div>
            )}
            {/* Note section */}
            {summary != null && (
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
            )}
        </div>
    );
});

AgentHoverCard.displayName = "AgentHoverCard";

export { AgentHoverCard, useSessionNote, agentSessionIdFromBlockData };
