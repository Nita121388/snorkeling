// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// useSessionNoteState — 会话 note / tags 的共享状态 hook。
//
// 从 agent-hover-card.tsx 抽出来，供 AgentHoverCard（term agent block）与
// SessionDetailInfoCard（会话详情 / GUI Chat block）共用，避免两份 note 逻辑漂移。
//
// 与旧实现的关键差异（修 bug）：
//  1. `dirty` 标志 —— 只有用户真正输入过才允许自动保存。
//     旧实现里草稿只在 [sessionId] 变化时初始化，summary 异步到达时草稿仍是 ""，
//     自动保存 effect 把「空草稿 ≠ summary.note」当成用户编辑，3 秒后回写空 note，
//     **把真实备注清空**。
//  2. 程序化同步 —— summary.note 到达且用户没在编辑时，同步草稿。
//  3. 预览优先取 summary.note —— 即使草稿同步有延迟，卡片也不会显示
//     "Click to add a note..." 而丢掉已存在的备注。

import { AgentStatusStore } from "@/app/agent-status/agent-status-store";
import type { AgentStatus } from "@/app/agent-status/agent-status-types";
import { ensureSessionNote, getSessionNoteSnapshot, saveSessionNote, subscribeSessionNote } from "@/app/store/session-note-cache";
import { AISessionsServiceType } from "@/app/store/services";
import {
    extractSessionTagsFromNote,
    mergeSessionTags,
    sessionTagsEqual,
    sessionTagsLabel,
} from "@/app/view/aisessions/session-tags";
import { AiSessionNoteUpdatedEvent, dispatchAISessionNoteUpdated, isAISessionNoteUpdatedEvent } from "@/app/view/aisessions/session-note-events";
import { NoteAutoSaveDelayMs } from "@/app/view/aisessions/session-note-autosave";
import { resolveMetadataAIMode } from "@/app/view/term/agent-ai-config";
import { useAtomValueSafe } from "@/util/util";
import * as React from "react";

export type NoteSaveStatus = "idle" | "saving" | "saved" | "error";
export type MetadataStatus = "idle" | "loading" | "ready" | "error";

export type SessionNoteState = {
    sessionId: string;
    connection: string;
    service: AISessionsServiceType;
    summary: SessionSummary | null;
    noteDraft: string;
    /** 用户是否真的输入过（未编辑过就不允许自动保存）。 */
    dirty: boolean;
    setNoteDraft: (value: string) => void;
    isEditing: boolean;
    setIsEditing: (value: boolean) => void;
    saveStatus: NoteSaveStatus;
    error: string;
    inputRef: React.RefObject<HTMLTextAreaElement | null>;
    /** 结束编辑（失焦/Escape）时落盘。 */
    finishEditing: () => void;
    trimmedDraft: string;
    title: string;
    /** 卡片上展示的一行预览：note 首行 → 标签 → 占位。 */
    previewText: string;
    metadataStatus: MetadataStatus;
    metadataError: string;
    metadataNote: string;
    metadataTags: string[];
    setMetadataNote: (value: string) => void;
    setMetadataStatus: (value: MetadataStatus) => void;
    generateMetadata: () => Promise<void>;
    applyMetadata: () => Promise<void>;
    // ── AI 标题提案（不落库，点 Apply 才写） ──
    titleSuggestion: string;
    titleStatus: MetadataStatus;
    titleError: string;
    generateTitle: () => Promise<void>;
    applyTitle: () => Promise<void>;
    dismissTitle: () => void;
};

function firstLine(text: string): string {
    return (
        text
            .trim()
            .split(/\r?\n/)
            .find((line) => line.trim() !== "")
            ?.trim() ?? ""
    );
}

/**
 * 会话 note / tags 状态。
 *
 * @param sessionId    会话 id（aisessions:sessionid 或 agent:sessionid）
 * @param connection   远端连接名（空串表示本地）
 */
export function useSessionNoteState(sessionId: string, connection: string): SessionNoteState {
    const service = React.useMemo(() => new AISessionsServiceType(), []);
    const [noteDraft, setNoteDraftState] = React.useState("");
    const [dirty, setDirty] = React.useState(false);
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

    // 切换会话时重置本地编辑态。
    React.useEffect(() => {
        setNoteDraftState("");
        setDirty(false);
        setIsEditing(false);
        setSaveStatus("idle");
        setError("");
        latestDraftRef.current = "";
    }, [sessionId]);

    // summary 到达/更新后程序化同步草稿：只在用户没在编辑、也没手动改过时同步。
    // （远程事件同样走这里 —— 用户正在编辑时必须让位给草稿，不能覆盖输入。）
    React.useEffect(() => {
        if (summary == null || dirty || isEditing) {
            return;
        }
        const nextNote = summary.note ?? "";
        setNoteDraftState((current) => (current === nextNote ? current : nextNote));
        latestDraftRef.current = nextNote;
    }, [dirty, isEditing, summary?.note, summary?.key]);

    const setNoteDraft = React.useCallback((value: string) => {
        latestDraftRef.current = value;
        setNoteDraftState(value);
        setDirty(true);
    }, []);

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

    // 其它 surface（全局 aisession 列表 / 详情 / Note 弹窗）改了 note 时同步草稿。
    React.useEffect(() => {
        if (sessionId === "") {
            return;
        }
        const handleNoteUpdated = (event: Event) => {
            if (!isAISessionNoteUpdatedEvent(event)) {
                return;
            }
            const eventSummary = event.detail.summary;
            if (eventSummary.id !== sessionId && eventSummary.key !== sessionId) {
                return;
            }
            // 用户正在编辑/手动改过：让位给草稿（cache 已更新，预览会随之刷新）。
            if (dirty || isEditing) {
                return;
            }
            const next = eventSummary.note ?? "";
            setNoteDraftState(next);
            latestDraftRef.current = next;
        };
        window.addEventListener(AiSessionNoteUpdatedEvent, handleNoteUpdated);
        return () => window.removeEventListener(AiSessionNoteUpdatedEvent, handleNoteUpdated);
    }, [dirty, isEditing, sessionId]);

    const summaryTagsKey = (summary?.tags ?? []).join("\u0000");
    const saveNote = React.useCallback(
        (nextNote: string) => {
            if (summary == null) {
                return;
            }
            const parsed = extractSessionTagsFromNote(nextNote);
            const tags = mergeSessionTags(summary.tags ?? [], parsed.tags);
            if (parsed.note === (summary.note ?? "") && sessionTagsEqual(tags, summary.tags)) {
                setError("");
                setDirty(false);
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
                        setNoteDraftState(result.summary.note ?? "");
                        latestDraftRef.current = result.summary.note ?? "";
                    }
                    setDirty(false);
                    setSaveStatus("saved");
                } else {
                    console.debug("[session-note] failed to save session note", {
                        sessionId,
                        error: result.error,
                    });
                    setSaveStatus("error");
                    setError(result.error);
                    // 缓存已回滚到保存前的权威值，草稿也要跟着回滚。
                    const rolledBack = getSessionNoteSnapshot(sessionId, connection).summary?.note ?? "";
                    if (!isEditing) {
                        setNoteDraftState(rolledBack);
                        latestDraftRef.current = rolledBack;
                    }
                }
            });
        },
        // 只依赖 summary 的展示字段，避免无关缓存刷新（如 TTL 背景刷新）重排已排队的保存。
        [connection, isEditing, service, sessionId, summary?.note, summary?.key, summaryTagsKey]
    );

    const finishEditing = React.useCallback(() => {
        setIsEditing(false);
        if (saveTimerRef.current != null) {
            window.clearTimeout(saveTimerRef.current);
            saveTimerRef.current = null;
        }
        saveNote(noteDraft);
    }, [noteDraft, saveNote]);

    // 防抖自动保存：只在用户真的输入过（dirty）且内容与后端不一致时才落盘。
    // 与列表行 / Note 弹窗一致：编辑态停顿同样会保存，不要求先失焦。
    React.useEffect(() => {
        if (summary == null || !dirty) {
            return;
        }
        const parsed = extractSessionTagsFromNote(noteDraft);
        const tags = mergeSessionTags(summary.tags ?? [], parsed.tags);
        if (parsed.note === (summary.note ?? "") && sessionTagsEqual(tags, summary.tags)) {
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
        // 同上：用展示字段而不是 summary 对象身份。
    }, [dirty, noteDraft, saveNote, summary?.note, summaryTagsKey]);

    React.useEffect(() => {
        return () => {
            if (saveTimerRef.current != null) {
                window.clearTimeout(saveTimerRef.current);
                saveTimerRef.current = null;
            }
            saveSeqRef.current++;
        };
    }, []);

    // ── AI 生成的 note / tags 提案（不落库，点 Apply 才写） ──
    const [metadataStatus, setMetadataStatus] = React.useState<MetadataStatus>("idle");
    const [metadataError, setMetadataError] = React.useState("");
    const [metadataNote, setMetadataNote] = React.useState("");
    const [metadataTags, setMetadataTags] = React.useState<string[]>([]);
    const generateMetadata = React.useCallback(async () => {
        if (sessionId === "" || summary == null) {
            return;
        }
        const cfg = resolveMetadataAIMode();
        if (cfg.available === false) {
            setMetadataError(cfg.reason);
            setMetadataStatus("error");
            return;
        }
        setMetadataStatus("loading");
        setMetadataError("");
        try {
            const result = await service.GenerateMetadata({
                id: sessionId,
                connection: connection || undefined,
                aiMode: cfg.mode,
            });
            setMetadataNote(result.suggestion.note);
            setMetadataTags(result.suggestion.tags);
            setMetadataStatus("ready");
        } catch (err) {
            setMetadataError(err instanceof Error ? err.message : String(err));
            setMetadataStatus("error");
        }
    }, [connection, service, sessionId, summary]);
    const applyMetadata = React.useCallback(async () => {
        if (summary == null || metadataStatus !== "ready") {
            return;
        }
        const result = await saveSessionNote(service, sessionId, connection, metadataNote.trim(), metadataTags);
        if (result.status === "ok") {
            setMetadataStatus("idle");
        } else {
            setMetadataError(result.error);
            setMetadataStatus("error");
        }
    }, [connection, metadataNote, metadataStatus, metadataTags, service, sessionId, summary]);

    // ── AI 生成的标题提案（不落库，点 Apply 才写） ──
    const [titleSuggestion, setTitleSuggestion] = React.useState("");
    const [titleStatus, setTitleStatus] = React.useState<MetadataStatus>("idle");
    const [titleError, setTitleError] = React.useState("");
    const generateTitle = React.useCallback(async () => {
        if (sessionId === "" || summary == null) {
            return;
        }
        const cfg = resolveMetadataAIMode();
        if (cfg.available === false) {
            setTitleError(cfg.reason);
            setTitleStatus("error");
            return;
        }
        setTitleStatus("loading");
        setTitleError("");
        try {
            const result = await service.GenerateTitle({
                id: sessionId,
                connection: connection || undefined,
                aiMode: cfg.mode,
            });
            setTitleSuggestion(result.suggestion.title);
            setTitleStatus("ready");
        } catch (err) {
            setTitleError(err instanceof Error ? err.message : String(err));
            setTitleStatus("error");
        }
    }, [connection, service, sessionId, summary]);
    const applyTitle = React.useCallback(async () => {
        if (summary == null || titleStatus !== "ready") {
            return;
        }
        const nextTitle = titleSuggestion.trim();
        if (nextTitle === "") {
            setTitleStatus("idle");
            return;
        }
        try {
            // origin 参数：note-cache 场景是本地会话（无远端 origin 变量）。
            const updated = await service.Title(sessionId, nextTitle, "");
            // 广播后，note-cache 与各个卡片会拿到最新 title，不必本地硬改 summary。
            dispatchAISessionNoteUpdated(updated);
            setTitleStatus("idle");
            setTitleSuggestion("");
        } catch (err) {
            setTitleError(err instanceof Error ? err.message : String(err));
            setTitleStatus("error");
        }
    }, [service, sessionId, summary, titleSuggestion, titleStatus]);
    const dismissTitle = React.useCallback(() => {
        setTitleStatus("idle");
        setTitleSuggestion("");
        setTitleError("");
    }, []);
    // 切换会话时清掉上一个会话的标题提案，避免 Apply 到错误会话。
    React.useEffect(() => {
        setTitleSuggestion("");
        setTitleStatus("idle");
        setTitleError("");
    }, [sessionId]);

    const trimmedDraft = noteDraft.trim();
    const title = summary?.title || summary?.id || sessionId;
    // 未编辑时优先用 summary.note（草稿可能还没同步上），编辑时才用草稿。
    const previewSource = isEditing || dirty ? noteDraft : (summary?.note ?? noteDraft);
    const previewText = firstLine(previewSource) || sessionTagsLabel(summary?.tags) || "Note";

    return {
        sessionId,
        connection,
        service,
        summary,
        noteDraft,
        dirty,
        setNoteDraft,
        isEditing,
        setIsEditing,
        saveStatus,
        error,
        inputRef,
        finishEditing,
        trimmedDraft,
        title,
        previewText,
        metadataStatus,
        metadataError,
        metadataNote,
        metadataTags,
        setMetadataNote,
        setMetadataStatus,
        generateMetadata,
        applyMetadata,
        titleSuggestion,
        titleStatus,
        titleError,
        generateTitle,
        applyTitle,
        dismissTitle,
    };
}

/** 供 card 层读取 agent 运行状态（与 note 状态解耦）。 */
export function useAgentStatusForCard(blockId: string): AgentStatus | null {
    const store = AgentStatusStore.getInstance();
    const [statusAtom, setStatusAtom] = React.useState<ReturnType<AgentStatusStore["acquire"]> | null>(null);
    React.useEffect(() => {
        const atom = store.acquire(blockId);
        setStatusAtom(atom);
        return () => store.release(blockId);
    }, [store, blockId]);
    return useAtomValueSafe(statusAtom);
}
