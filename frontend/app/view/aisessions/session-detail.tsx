// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Tooltip } from "@/app/element/tooltip";
import { Modal } from "@/app/modals/modal";
import { cn } from "@/util/util";
import { type KeyboardEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CopyIconButton, CopyTextButton, IconButton } from "./controls";
import { EmptyState } from "./empty-state";
import { HighlightedMessageText, MessageCard } from "./session-message";
import { SessionTagChips } from "./session-tag-chips";
import {
    extractSessionTagsFromNote,
    mergeSessionTags,
    normalizeSessionTags,
    removeSessionTagFromNote,
    sessionTagsEqual,
} from "./session-tags";
import { defaultVisibleMessageCount, visibleMessageCountStep } from "./types";
import {
    buildSessionDetailTimeline,
    formatDateTimeToSecond,
    formatSessionDate,
    formatToolCallPreview,
    isReadableMessage,
    outlinePreview,
    outlineRoleClass,
    restoreCommandForSession,
    shortSessionId,
    trimMessageText,
    isCollapsibleMessage,
} from "./utils";

type NoteSaveStatus = "idle" | "saving" | "saved" | "error";
const OutlineTooltipPreviewLength = 1800;
const ToolCallPreviewLength = 1200;
const UserLinesPageSize = 8;
const UserLinesSearchLimit = 50;

function sourceDotClass(source: string): string {
    if (source === "claude") return "bg-source-claude";
    if (source === "codex") return "bg-source-codex";
    return "bg-secondary";
}

export type SessionDetailController = {
    loadDetail: (session: SessionSummary, refresh?: boolean) => Promise<void>;
    loadDetailDelta?: (reason?: "manual" | "bottom") => Promise<boolean>;
    loadDetailTools: (refresh?: boolean) => Promise<void>;
    loadUserLines: (session: SessionSummary, request?: Partial<AISessionsUserLinesRequest>) => Promise<UserLinesResult>;
    updateNote: (session: SessionSummary, note: string, tags?: string[]) => Promise<boolean>;
    deleteSession: (session: SessionSummary) => Promise<void>;
    restoreSession: (session: SessionSummary) => Promise<void>;
    openProjectDirectory: (summary: SessionSummary) => Promise<void>;
    openSessionFile: (summary: SessionSummary) => Promise<void>;
    toggleMark: (session: SessionSummary) => Promise<void>;
};

function normalizedSearchQuery(query: string): string {
    return query.trim().toLowerCase();
}

function outlineTooltipText(message: Message): string {
    const text = trimMessageText(message.text).trim();
    if (text.length <= OutlineTooltipPreviewLength) {
        return text || "(empty)";
    }
    return `${text.slice(0, OutlineTooltipPreviewLength).trimEnd()}\n...`;
}

function userMessageResultText(message: Message, query: string): string {
    const preview = outlineTooltipText(message);
    const normalizedQuery = normalizedSearchQuery(query);
    if (normalizedQuery === "" || preview.toLowerCase().includes(normalizedQuery)) {
        return preview;
    }
    return message.text.trim() || "(empty)";
}

function toolCallDetailText(toolCall: ToolCall): string {
    return [
        toolCall.summary ? `Input:\n${toolCall.summary}` : "",
        toolCall.output ? `Output:\n${toolCall.output}` : "",
        toolCall.exitCode ? `Exit code: ${toolCall.exitCode}` : "",
    ]
        .filter(Boolean)
        .join("\n\n");
}

function trimToolCallText(text: string): string {
    const trimmed = text.trim();
    if (trimmed.length <= ToolCallPreviewLength) return trimmed;
    return `${trimmed.slice(0, ToolCallPreviewLength).trimEnd()}\n...`;
}

function messageMatchesSearch(message: Message, query: string): boolean {
    const normalizedQuery = normalizedSearchQuery(query);
    if (normalizedQuery === "") return false;
    return message.text.toLowerCase().includes(normalizedQuery);
}

function messageSearchIndex(messages: Message[], seq: number | null): number {
    if (seq == null) return -1;
    return messages.findIndex((message) => message.seq === seq);
}

function ToolCallCard({
    toolCall,
    expanded,
    onToggle,
}: {
    toolCall: ToolCall;
    expanded: boolean;
    onToggle: () => void;
}) {
    const detailText = toolCallDetailText(toolCall);
    const hasError = Boolean(toolCall.exitCode);
    return (
        <div className="rounded border border-border bg-bg/50 text-xs">
            <button
                type="button"
                className="flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-hover"
                onClick={onToggle}
            >
                <i
                    className={cn(
                        "fa-sharp fa-solid mt-0.5 shrink-0 transition-transform duration-200",
                        expanded ? "fa-chevron-down" : "fa-chevron-right"
                    )}
                />
                <span
                    className={cn(
                        "mt-0.5 h-2 w-2 shrink-0 rounded-full",
                        hasError ? "bg-error shadow-[0_0_4px_var(--color-error)]" : "bg-accent"
                    )}
                />
                <span className="min-w-0 flex-1">
                    <span className="mb-1 flex flex-wrap items-center gap-2 text-[10px] uppercase text-secondary">
                        <span>#{toolCall.seq}</span>
                        <span>{toolCall.name || "tool"}</span>
                        {hasError ? (
                            <span className="rounded bg-error/15 px-1.5 py-0.5 text-[10px] font-medium text-error">
                                exit {toolCall.exitCode}
                            </span>
                        ) : null}
                    </span>
                    <span className="block truncate text-primary">{formatToolCallPreview(toolCall)}</span>
                </span>
            </button>
            {expanded ? (
                <div
                    className="border-t border-border px-3 py-2"
                    style={{
                        animation: "slideDown 0.2s ease-out",
                    }}
                >
                    {detailText ? (
                        <>
                            <pre className="max-h-[360px] overflow-auto whitespace-pre-wrap break-words rounded bg-panel p-2 text-[11px] leading-4 text-primary">
                                {trimToolCallText(detailText)}
                            </pre>
                            <div className="mt-2 flex items-center gap-2">
                                <CopyIconButton text={detailText} label="Copy tool call detail" size="xs" />
                                {toolCall.output ? (
                                    <CopyIconButton text={toolCall.output} label="Copy tool output" size="xs" />
                                ) : null}
                            </div>
                        </>
                    ) : (
                        <div className="text-secondary">No tool detail.</div>
                    )}
                </div>
            ) : null}
        </div>
    );
}

export function SessionDetailPane({
    model,
    detail,
    loading,
    deltaLoading = false,
    toolCallsLoading,
    restoring,
    deleting,
    onClose,
}: {
    model: SessionDetailController;
    detail: SessionDetail | null;
    loading: boolean;
    deltaLoading?: boolean;
    toolCallsLoading: boolean;
    restoring: boolean;
    deleting: boolean;
    onClose?: () => void;
}) {
    const [noteDraft, setNoteDraft] = useState("");
    const [noteCollapsed, setNoteCollapsed] = useState(true);
    const [outlineOpen, setOutlineOpen] = useState(false);
    const [userMessageListOpen, setUserMessageListOpen] = useState(false);
    const [showToolCalls, setShowToolCalls] = useState(false);
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const [noteSaveStatus, setNoteSaveStatus] = useState<NoteSaveStatus>("idle");
    // Header 折叠状态：lazy init 读 localStorage 全局偏好；无偏好时由 ResizeObserver 自适应
    const [headerCollapsed, setHeaderCollapsed] = useState<boolean>(() => {
        try {
            const stored = localStorage.getItem("snorkeling:sessionDetail:headerCollapsed");
            if (stored === "true") return true;
            if (stored === "false") return false;
            return false;
        } catch {
            return false;
        }
    });
    // 用户在本 session 是否主动动过 Header 折叠（不写 localStorage，切 session 重置）
    const userTouchedHeaderRef = useRef(false);
    // 是否已有持久化偏好（影响自适应是否生效）
    const hasStoredPreferenceRef = useRef(false);
    // 测量 detail pane 可用高度以决定折叠态的自适应容器
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [visibleMessageCount, setVisibleMessageCount] = useState(defaultVisibleMessageCount);
    const [collapsedMessages, setCollapsedMessages] = useState<Record<number, boolean>>({});
    const [expandedToolCalls, setExpandedToolCalls] = useState<Record<number, boolean>>({});
    const [detailSearchQuery, setDetailSearchQuery] = useState("");
    const [activeSearchSeq, setActiveSearchSeq] = useState<number | null>(null);
    const [userMessageSearchQuery, setUserMessageSearchQuery] = useState("");
    const [userLines, setUserLines] = useState<Message[]>([]);
    const [userLinesCount, setUserLinesCount] = useState(0);
    const [userLinesHasMore, setUserLinesHasMore] = useState(false);
    const [userLinesNextBeforeSeq, setUserLinesNextBeforeSeq] = useState(0);
    const [userLinesLoading, setUserLinesLoading] = useState(false);
    const [userLinesError, setUserLinesError] = useState("");
    const messageRefs = useRef<Record<number, HTMLDivElement | null>>({});
    const detailScrollRef = useRef<HTMLDivElement | null>(null);
    const pendingJumpSeqRef = useRef<number | null>(null);
    // 本 session 是否已经做过"打开时自动滚到底"（流式新消息到来不重复跟随）
    const autoScrolledToBottomRef = useRef(false);
    const userLinesRequestSeqRef = useRef(0);
    const bottomDeltaRequestedRef = useRef(false);
    const bottomDeltaTimerRef = useRef<number | null>(null);
    const currentSummaryRef = useRef<SessionSummary | null>(null);
    const latestNoteDraftRef = useRef("");
    const summaryKeyRef = useRef<string | null>(null);
    const summaryNoteRef = useRef("");
    const summary = detail?.summary ?? null;
    const summaryKey = summary?.key ?? "";
    const parsedNoteDraft = extractSessionTagsFromNote(noteDraft);
    const nextTags = mergeSessionTags(summary?.tags ?? [], parsedNoteDraft.tags);
    const noteUnchanged = parsedNoteDraft.note === (summary?.note ?? "") && sessionTagsEqual(nextTags, summary?.tags);
    const noteSaving = noteSaveStatus === "saving";
    const refreshing = loading || deltaLoading || toolCallsLoading;

    currentSummaryRef.current = summary;

    useEffect(() => {
        const nextKey = detail?.summary?.key ?? null;
        const nextNote = detail?.summary?.note ?? "";
        const previousKey = summaryKeyRef.current;
        const previousNote = summaryNoteRef.current;
        summaryKeyRef.current = nextKey;
        summaryNoteRef.current = nextNote;
        if (nextKey !== previousKey || extractSessionTagsFromNote(latestNoteDraftRef.current).note === previousNote) {
            latestNoteDraftRef.current = nextNote;
            setNoteDraft(nextNote);
        }
    }, [detail?.summary?.key, detail?.summary?.note, detail?.summary?.tags]);

    useEffect(() => {
        messageRefs.current = {};
        pendingJumpSeqRef.current = null;
        bottomDeltaRequestedRef.current = false;
        if (bottomDeltaTimerRef.current != null) {
            window.clearTimeout(bottomDeltaTimerRef.current);
            bottomDeltaTimerRef.current = null;
        }
        setDeleteConfirmOpen(false);
        setNoteCollapsed(true);
        setNoteSaveStatus("idle");
        setCollapsedMessages({});
        setExpandedToolCalls({});
        setShowToolCalls(false);
        setVisibleMessageCount(defaultVisibleMessageCount);
        setUserMessageListOpen(false);
        setDetailSearchQuery("");
        setActiveSearchSeq(null);
        setUserMessageSearchQuery("");
        setUserLines([]);
        setUserLinesCount(0);
        setUserLinesHasMore(false);
        setUserLinesNextBeforeSeq(0);
        setUserLinesLoading(false);
        setUserLinesError("");
        userLinesRequestSeqRef.current++;
        // 切 session 时重置「用户在本 session 是否动过 Header」标志，让新 session 重新自适应
        userTouchedHeaderRef.current = false;
        // 切 session 时重置「自动滚到底已执行」标志，让新 session 重新滚到底
        autoScrolledToBottomRef.current = false;
    }, [detail?.summary?.key]);

    useEffect(() => {
        bottomDeltaRequestedRef.current = false;
    }, [detail?.messages?.length, deltaLoading]);

    // 初始化持久化偏好标记
    useEffect(() => {
        try {
            hasStoredPreferenceRef.current =
                localStorage.getItem("snorkeling:sessionDetail:headerCollapsed") !== null;
        } catch {
            hasStoredPreferenceRef.current = false;
        }
    }, []);

    // 自适应 Header 折叠：仅在「无持久化偏好 + 用户在本 session 未动过」时按高度决定
    useEffect(() => {
        if (!containerRef.current) return;
        const el = containerRef.current;
        const observer = new ResizeObserver((entries) => {
            if (hasStoredPreferenceRef.current) return;
            if (userTouchedHeaderRef.current) return;
            const h = entries[0]?.contentRect.height ?? 0;
            setHeaderCollapsed(h < 320);
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    const readableMessages = useMemo(
        () => (detail?.messages ?? []).filter((message) => isReadableMessage(message)),
        [detail?.messages]
    );
    const detailMessages = useMemo(
        () => readableMessages.slice(-visibleMessageCount),
        [readableMessages, visibleMessageCount]
    );
    const timelineItems = useMemo(
        () => buildSessionDetailTimeline(detail?.messages ?? [], detailMessages, detail?.toolCalls, showToolCalls),
        [detail?.messages, detailMessages, detail?.toolCalls, showToolCalls]
    );
    const outlineMessages = useMemo(
        () => readableMessages.filter((message) => message.role === "user"),
        [readableMessages]
    );
    const detailSearchMatches = useMemo(
        () => readableMessages.filter((message) => messageMatchesSearch(message, detailSearchQuery)),
        [detailSearchQuery, readableMessages]
    );
    const activeSearchIndex = useMemo(
        () => messageSearchIndex(detailSearchMatches, activeSearchSeq),
        [activeSearchSeq, detailSearchMatches]
    );
    const normalizedDetailSearchQuery = normalizedSearchQuery(detailSearchQuery);
    const toolCalls = detail?.toolCalls ?? [];
    const toolsLoaded = detail?.toolCalls != null;
    const hasPreviousMessages = visibleMessageCount < readableMessages.length;
    const firstVisibleMessage = detailMessages[0];
    const lastVisibleMessage = detailMessages[detailMessages.length - 1];
    const detailSearchSummary =
        normalizedDetailSearchQuery === ""
            ? `${readableMessages.length} messages`
            : detailSearchMatches.length === 0
              ? "No matches"
              : activeSearchIndex >= 0
                ? `${activeSearchIndex + 1} / ${detailSearchMatches.length}`
                : `${detailSearchMatches.length} match${detailSearchMatches.length === 1 ? "" : "es"}`;

    const scrollToVisibleMessage = useCallback((seq: number, behavior: ScrollBehavior = "smooth") => {
        const node = messageRefs.current[seq];
        const container = detailScrollRef.current;
        if (node && container) {
            const containerRect = container.getBoundingClientRect();
            const nodeRect = node.getBoundingClientRect();
            const top = nodeRect.top - containerRect.top + container.scrollTop - 12;
            container.scrollTo({ top, behavior });
            return;
        }
        node?.scrollIntoView({ behavior, block: "start" });
    }, []);

    const loadPreviousMessages = useCallback(() => {
        setVisibleMessageCount((current) => Math.min(current + visibleMessageCountStep, readableMessages.length));
    }, [readableMessages.length]);

    const requestDetailDelta = useCallback(
        (reason: "manual" | "bottom") => {
            if (reason === "manual" && showToolCalls) {
                if (summary != null) {
                    return model.loadDetailTools(true).then(() => true);
                }
                return Promise.resolve(false);
            }
            if (model.loadDetailDelta != null) {
                return model.loadDetailDelta(reason);
            }
            if (summary != null) {
                return model.loadDetail(summary, true).then(() => true);
            }
            return Promise.resolve(false);
        },
        [model, showToolCalls, summary]
    );

    const handleDetailScroll = useCallback(() => {
        if (deltaLoading || loading || model.loadDetailDelta == null || bottomDeltaRequestedRef.current) {
            return;
        }
        const node = detailScrollRef.current;
        if (node == null) {
            return;
        }
        const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
        if (distanceFromBottom > 96) {
            return;
        }
        bottomDeltaRequestedRef.current = true;
        void requestDetailDelta("bottom").finally(() => {
            if (bottomDeltaTimerRef.current != null) {
                window.clearTimeout(bottomDeltaTimerRef.current);
            }
            bottomDeltaTimerRef.current = window.setTimeout(() => {
                bottomDeltaRequestedRef.current = false;
                bottomDeltaTimerRef.current = null;
            }, 500);
        });
    }, [deltaLoading, loading, model.loadDetailDelta, requestDetailDelta]);

    useEffect(() => {
        return () => {
            if (bottomDeltaTimerRef.current != null) {
                window.clearTimeout(bottomDeltaTimerRef.current);
            }
        };
    }, []);

    const toggleMessageCollapsed = useCallback((seq: number, text: string) => {
        setCollapsedMessages((current) => {
            const currentValue = current[seq];
            const nextValue = currentValue == null ? !isCollapsibleMessage(text) : !currentValue;
            return { ...current, [seq]: nextValue };
        });
    }, []);

    const toggleToolCallExpanded = useCallback((seq: number) => {
        setExpandedToolCalls((current) => ({ ...current, [seq]: !current[seq] }));
    }, []);

    const toggleToolCalls = useCallback(() => {
        setShowToolCalls((current) => {
            const next = !current;
            if (next && !toolsLoaded) {
                void model.loadDetailTools(false);
            }
            return next;
        });
    }, [model, toolsLoaded]);

    // 切换 Header 折叠/展开。展开→折叠前若有未决操作（删除确认条/Note 未保存）则阻止。
    const toggleHeader = useCallback(() => {
        setHeaderCollapsed((current) => {
            if (!current) {
                // 准备折叠：检查未决操作
                if (deleteConfirmOpen) return current;
                if (!noteCollapsed && !noteUnchanged) return current;
            }
            userTouchedHeaderRef.current = true;
            const next = !current;
            try {
                localStorage.setItem("snorkeling:sessionDetail:headerCollapsed", String(next));
                hasStoredPreferenceRef.current = true;
            } catch {
                // ignore storage errors (隐私模式/被禁用)
            }
            return next;
        });
    }, [deleteConfirmOpen, noteCollapsed, noteUnchanged]);

    const jumpToMessage = useCallback(
        (seq: number) => {
            if (messageRefs.current[seq]) {
                scrollToVisibleMessage(seq);
                return;
            }
            const targetIndex = readableMessages.findIndex((message) => message.seq === seq);
            if (targetIndex < 0) return;
            pendingJumpSeqRef.current = seq;
            setVisibleMessageCount((current) => Math.max(current, readableMessages.length - targetIndex));
        },
        [readableMessages, scrollToVisibleMessage]
    );

    const jumpToSearchMatch = useCallback(
        (nextIndex: number) => {
            if (detailSearchMatches.length === 0) {
                setActiveSearchSeq(null);
                return;
            }
            const normalizedIndex = (nextIndex + detailSearchMatches.length) % detailSearchMatches.length;
            const match = detailSearchMatches[normalizedIndex];
            setActiveSearchSeq(match.seq);
            setCollapsedMessages((current) => {
                if (!current[match.seq]) return current;
                const next = { ...current };
                delete next[match.seq];
                return next;
            });
            jumpToMessage(match.seq);
        },
        [detailSearchMatches, jumpToMessage]
    );

    const jumpToNextSearchMatch = useCallback(() => {
        jumpToSearchMatch(activeSearchIndex < 0 ? 0 : activeSearchIndex + 1);
    }, [activeSearchIndex, jumpToSearchMatch]);

    const jumpToPreviousSearchMatch = useCallback(() => {
        jumpToSearchMatch(activeSearchIndex < 0 ? detailSearchMatches.length - 1 : activeSearchIndex - 1);
    }, [activeSearchIndex, detailSearchMatches.length, jumpToSearchMatch]);

    const handleDetailSearchKeyDown = useCallback(
        (event: KeyboardEvent<HTMLInputElement>) => {
            if (event.key !== "Enter" || detailSearchMatches.length === 0) return;
            event.preventDefault();
            if (event.shiftKey) {
                jumpToPreviousSearchMatch();
                return;
            }
            jumpToNextSearchMatch();
        },
        [detailSearchMatches.length, jumpToNextSearchMatch, jumpToPreviousSearchMatch]
    );

    const openUserMessage = useCallback(
        (seq: number) => {
            setUserMessageListOpen(false);
            jumpToMessage(seq);
        },
        [jumpToMessage]
    );

    const loadUserLinesPage = useCallback(
        async ({
            beforeSeq = 0,
            append = false,
            query = userMessageSearchQuery,
            refresh = false,
        }: {
            beforeSeq?: number;
            append?: boolean;
            query?: string;
            refresh?: boolean;
        } = {}) => {
            const currentSummary = currentSummaryRef.current;
            if (currentSummary == null) return;
            const requestSeq = ++userLinesRequestSeqRef.current;
            const normalizedQuery = normalizedSearchQuery(query);
            setUserLinesLoading(true);
            setUserLinesError("");
            try {
                const result = await model.loadUserLines(currentSummary, {
                    beforeSeq,
                    query: normalizedQuery,
                    refresh,
                    limit: normalizedQuery === "" ? UserLinesPageSize : UserLinesSearchLimit,
                });
                if (requestSeq !== userLinesRequestSeqRef.current) return;
                setUserLines((current) => (append ? [...result.messages, ...current] : result.messages));
                setUserLinesCount(result.userMessageCount);
                setUserLinesHasMore(result.hasMore);
                setUserLinesNextBeforeSeq(result.nextBeforeSeq ?? 0);
            } catch (e) {
                if (requestSeq !== userLinesRequestSeqRef.current) return;
                setUserLinesError(e instanceof Error ? e.message : String(e));
            } finally {
                if (requestSeq === userLinesRequestSeqRef.current) {
                    setUserLinesLoading(false);
                }
            }
        },
        [model, summaryKey, userMessageSearchQuery]
    );

    useEffect(() => {
        if (!userMessageListOpen || summary == null) return;
        const handle = window.setTimeout(() => {
            void loadUserLinesPage({ query: userMessageSearchQuery });
        }, 200);
        return () => window.clearTimeout(handle);
    }, [loadUserLinesPage, summaryKey, userMessageListOpen, userMessageSearchQuery]);

    useEffect(() => {
        const pendingSeq = pendingJumpSeqRef.current;
        if (pendingSeq == null || !messageRefs.current[pendingSeq]) return;
        pendingJumpSeqRef.current = null;
        window.requestAnimationFrame(() => scrollToVisibleMessage(pendingSeq, "smooth"));
    }, [detailMessages, scrollToVisibleMessage]);

    // 打开 panel / 切换 session 后自动滚到底（最新一条），流式新增不跟随
    useLayoutEffect(() => {
        if (autoScrolledToBottomRef.current) return;
        if (lastVisibleMessage == null) return;
        // 等到最后一条消息的 ref 挂上来才滚，避免在 DOM 还没渲染时就跑
        if (!messageRefs.current[lastVisibleMessage.seq]) return;
        autoScrolledToBottomRef.current = true;
        const container = detailScrollRef.current;
        if (!container) return;
        // 直接将滚动条置底（含 pb-10 padding 都能露出来）
        container.scrollTop = container.scrollHeight;
    }, [lastVisibleMessage?.seq]);

    useEffect(() => {
        if (normalizedDetailSearchQuery === "" || detailSearchMatches.length === 0) {
            setActiveSearchSeq(null);
            return;
        }
        if (activeSearchSeq != null && !detailSearchMatches.some((message) => message.seq === activeSearchSeq)) {
            setActiveSearchSeq(null);
        }
    }, [activeSearchSeq, detailSearchMatches, normalizedDetailSearchQuery]);

    useEffect(() => {
        if (noteSaveStatus !== "saved" && noteSaveStatus !== "error") return;
        const handle = window.setTimeout(() => setNoteSaveStatus("idle"), noteSaveStatus === "saved" ? 1200 : 1800);
        return () => window.clearTimeout(handle);
    }, [noteSaveStatus]);

    const saveNote = useCallback(
        async (nextNote: string): Promise<boolean> => {
            if (summary == null || noteSaveStatus === "saving") return false;
            const parsed = extractSessionTagsFromNote(nextNote);
            const tags = mergeSessionTags(summary.tags ?? [], parsed.tags);
            if (parsed.note === (summary.note ?? "") && sessionTagsEqual(tags, summary.tags)) {
                return true;
            }
            setNoteSaveStatus("saving");
            const saved = await model.updateNote(summary, parsed.note, tags);
            const currentDraftSaved = extractSessionTagsFromNote(latestNoteDraftRef.current).note === parsed.note;
            setNoteSaveStatus(saved ? (currentDraftSaved ? "saved" : "idle") : "error");
            return saved && currentDraftSaved;
        },
        [model, noteSaveStatus, summary]
    );

    if (loading && detail == null) {
        return <EmptyState text="Loading detail..." />;
    }
    if (detail == null) {
        return <EmptyState text="Select a session to view details." />;
    }
    const noteStatusText =
        noteSaveStatus === "saving"
            ? "Saving..."
            : noteSaveStatus === "saved"
              ? "Saved"
              : noteSaveStatus === "error"
                ? "Save failed"
                : !noteUnchanged
                  ? "Unsaved changes"
                  : "";
    const projectDirectory = summary.projectPath?.trim() ?? "";
    const sessionFilePath = summary.filePath?.trim() ?? "";
    const summaryTags = normalizeSessionTags(summary.tags);
    const visibleSummaryTags = summaryTags.slice(0, 3);
    const hasNoteInfo = Boolean(summary.note || summaryTags.length);
    return (
        <div ref={containerRef} className="relative flex h-full min-h-0 flex-col">
            <div className={cn("shrink-0 border-b border-border/70", headerCollapsed ? "p-1.5" : "p-3")}>
                {headerCollapsed ? (
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={toggleHeader}
                            className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-hover"
                            title="Expand session header"
                        >
                            <i className="fa-sharp fa-solid fa-chevron-down shrink-0 text-[10px] text-secondary" />
                            <div
                                className="min-w-0 flex-1 truncate text-sm font-medium"
                                title={summary.title || summary.id}
                            >
                                {summary.title || summary.id}
                            </div>
                        </button>
                        <IconButton
                            icon="fa-chevron-down"
                            label="Expand session header"
                            onClick={toggleHeader}
                        />
                    </div>
                ) : (
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                            <div className="min-w-0 truncate text-sm font-medium" title={summary.title || summary.id}>
                                {summary.title || summary.id}
                            </div>
                            <span className="inline-flex items-center gap-1 text-[11px] text-secondary">
                                <span className={cn("h-1.5 w-1.5 rounded-full", sourceDotClass(summary.source))} />
                                {summary.source}
                            </span>
                        </div>
                        <div className="mt-1 flex min-w-0 flex-wrap items-start gap-x-3 gap-y-1 text-xxs text-secondary">
                            <div className="flex min-w-[220px] flex-[1_1_360px] items-center gap-2">
                                <span className="shrink-0 text-[10px] uppercase">Project directory:</span>
                                {projectDirectory ? (
                                    <CopyTextButton
                                        text={projectDirectory}
                                        label="Copy project directory"
                                        displayText={projectDirectory}
                                        tooltipText={projectDirectory}
                                        wrapperClassName="min-w-0"
                                        className="justify-start"
                                        textClassName="truncate"
                                    />
                                ) : (
                                    <span
                                        className="min-w-0 truncate text-secondary"
                                        title="Project directory unavailable"
                                    >
                                        No project directory
                                    </span>
                                )}
                                {projectDirectory ? (
                                    <IconButton
                                        icon="fa-folder-open"
                                        label="Open project directory"
                                        size="xs"
                                        className="!border-transparent"
                                        onClick={() => void model.openProjectDirectory(summary)}
                                    />
                                ) : null}
                            </div>
                            <div className="ml-auto flex min-w-[260px] max-w-full flex-[0_1_460px] flex-col items-end gap-1">
                                <div className="flex shrink-0 items-center gap-2">
                                    <span className="shrink-0">ID: {shortSessionId(summary.id)}</span>
                                    <CopyIconButton
                                        text={summary.id}
                                        label="Copy session ID"
                                        size="xs"
                                        className="!border-transparent"
                                    />
                                </div>
                                <div className="flex w-full min-w-0 items-center justify-end gap-2">
                                    <span className="shrink-0 text-[10px] uppercase">Session file:</span>
                                    {sessionFilePath ? (
                                        <CopyTextButton
                                            text={sessionFilePath}
                                            label="Copy session file path"
                                            displayText={formatSessionDate(summary.updatedAt || summary.createdAt || 0)}
                                            tooltipText={sessionFilePath}
                                            wrapperClassName="min-w-0"
                                            className="ml-auto justify-end text-right"
                                            textClassName="truncate"
                                        />
                                    ) : (
                                        <span className="text-right text-secondary">No session file</span>
                                    )}
                                </div>
                            </div>
                        </div>
                        <div className="mt-2 flex min-w-0 items-center gap-2 text-xs">
                            <button
                                className="flex h-7 items-center gap-2 rounded border border-accent bg-accent px-2 text-white hover:bg-accent/90 disabled:opacity-60"
                                disabled={restoring}
                                onClick={() => void model.restoreSession(summary)}
                            >
                                <i className="fa-sharp fa-solid fa-square-terminal" />
                                <span>{restoring ? "Resuming..." : "Resume"}</span>
                            </button>
                            <CopyIconButton text={restoreCommandForSession(summary)} label="Copy resume command" />
                            <IconButton
                                icon="fa-trash"
                                label="Delete session"
                                className={deleteConfirmOpen ? "border-error text-error" : ""}
                                disabled={deleting}
                                onClick={() => setDeleteConfirmOpen(true)}
                            />
                            <IconButton
                                icon={showToolCalls && toolCallsLoading ? "fa-spinner animate-spin" : "fa-wrench"}
                                label={showToolCalls ? "Hide tool calls" : "Show tool calls"}
                                className={cn(showToolCalls && "border-accent bg-accent/10 text-accent")}
                                disabled={toolCallsLoading && !toolsLoaded}
                                onClick={toggleToolCalls}
                            />
                            {hasNoteInfo ? (
                                <button
                                    type="button"
                                    className={cn(
                                        "flex min-w-0 max-w-full cursor-pointer items-center gap-1.5 border-l-2 border-accent/50 pl-2 text-left text-xs text-primary hover:text-accent",
                                        !noteCollapsed && "text-accent"
                                    )}
                                    title="Edit note and tags"
                                    aria-label="Edit note and tags"
                                    onClick={() => setNoteCollapsed((current) => !current)}
                                >
                                    <span className="flex min-w-0 max-w-full items-center gap-1.5">
                                        {summary.note ? (
                                            <span className="min-w-0 truncate">{summary.note}</span>
                                        ) : null}
                                        {visibleSummaryTags.map((tag) => (
                                            <span
                                                key={tag}
                                                className="shrink-0 rounded-md bg-surface-soft px-1.5 py-0.5 text-[10px] leading-none text-secondary"
                                            >
                                                <span className="opacity-50">#</span>
                                                {tag}
                                            </span>
                                        ))}
                                        {summaryTags.length > visibleSummaryTags.length ? (
                                            <span className="shrink-0 text-[10px] text-secondary">
                                                +{summaryTags.length - visibleSummaryTags.length}
                                            </span>
                                        ) : null}
                                    </span>
                                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-secondary hover:bg-hover hover:text-primary">
                                        <i className="fa-sharp fa-solid fa-pen text-[10px]" />
                                    </span>
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    className="flex h-7 shrink-0 items-center gap-1.5 rounded border border-border px-2 text-xs text-secondary hover:bg-hover hover:text-primary"
                                    title="Add note and tags"
                                    onClick={() => setNoteCollapsed(false)}
                                >
                                    <i className="fa-sharp fa-solid fa-pen text-[10px]" />
                                    <span>Add note</span>
                                </button>
                            )}
                        </div>
                        {deleteConfirmOpen ? (
                            <div className="mt-2 flex items-center justify-between gap-3 rounded border border-error/40 bg-error/10 px-2 py-2 text-xs">
                                <div className="min-w-0 text-error">
                                    Delete this session? The source file will be moved to deleted storage.
                                </div>
                                <div className="flex shrink-0 items-center gap-2">
                                    <button
                                        className="h-7 rounded border border-border px-2 text-secondary hover:bg-hover hover:text-primary"
                                        disabled={deleting}
                                        onClick={() => setDeleteConfirmOpen(false)}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        className="flex h-7 items-center gap-2 rounded border border-error bg-error px-2 text-white disabled:opacity-60"
                                        disabled={deleting}
                                        onClick={() => void model.deleteSession(summary)}
                                    >
                                        <i
                                            className={cn(
                                                "fa-sharp fa-solid",
                                                deleting ? "fa-spinner animate-spin" : "fa-trash"
                                            )}
                                        />
                                        <span>{deleting ? "Deleting..." : "Delete"}</span>
                                    </button>
                                </div>
                            </div>
                        ) : null}
                        {!noteCollapsed ? (
                            <div className="mt-2 space-y-2 border-t border-border/70 pt-2">
                                <SessionTagChips
                                    tags={nextTags}
                                    removable
                                    onRemove={(tag) => {
                                        const baseTags = normalizeSessionTags(summary?.tags ?? []).filter(
                                            (item) => item !== tag
                                        );
                                        const nextNote = removeSessionTagFromNote(parsedNoteDraft.note, tag);
                                        latestNoteDraftRef.current = nextNote;
                                        setNoteDraft(nextNote);
                                        void model.updateNote(summary, nextNote, baseTags);
                                    }}
                                />
                                <textarea
                                    className="min-h-[72px] w-full resize-none rounded border border-border bg-transparent px-2 py-2 text-xs outline-none focus:border-accent"
                                    placeholder="Add a note, use #tag to add tags"
                                    value={noteDraft}
                                    onChange={(e) => {
                                        latestNoteDraftRef.current = e.target.value;
                                        setNoteDraft(e.target.value);
                                        if (noteSaveStatus !== "saving") {
                                            setNoteSaveStatus("idle");
                                        }
                                    }}
                                />
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        title={noteStatusText || "Save note"}
                                        disabled={noteSaving || noteUnchanged}
                                        className={cn(
                                            "flex h-7 shrink-0 items-center gap-2 rounded border border-border px-2 text-xs text-secondary hover:bg-hover hover:text-primary disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent disabled:hover:text-secondary",
                                            noteSaveStatus === "saved" && "border-accent bg-accent/10 text-accent",
                                            noteSaveStatus === "error" && "border-error bg-error/10 text-error"
                                        )}
                                        onClick={() => void saveNote(noteDraft)}
                                    >
                                        <i
                                            className={cn(
                                                "fa-sharp fa-solid",
                                                noteSaveStatus === "saving"
                                                    ? "fa-spinner animate-spin"
                                                    : noteSaveStatus === "saved"
                                                      ? "fa-check"
                                                      : noteSaveStatus === "error"
                                                        ? "fa-triangle-exclamation"
                                                        : "fa-floppy-disk"
                                            )}
                                        />
                                        <span>Save</span>
                                    </button>
                                    <IconButton
                                        icon="fa-eraser"
                                        label="Clear note"
                                        disabled={noteSaving || (!summary.note && noteDraft.trim() === "")}
                                        onClick={() => {
                                            latestNoteDraftRef.current = "";
                                            setNoteDraft("");
                                            void saveNote("");
                                        }}
                                    />
                                    <span
                                        className={cn(
                                            "min-w-[64px] text-[11px] text-secondary",
                                            noteSaveStatus === "saved" && "text-accent",
                                            noteSaveStatus === "error" && "text-error"
                                        )}
                                        aria-live="polite"
                                    >
                                        {noteStatusText}
                                    </span>
                                </div>
                            </div>
                        ) : null}
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-1">
                        <IconButton
                            icon="fa-chevron-up"
                            label="Collapse session header"
                            onClick={toggleHeader}
                        />
                        {onClose ? (
                            <button
                                className="h-7 w-7 shrink-0 rounded border border-border text-xs text-secondary hover:bg-hover hover:text-primary"
                                title="Close"
                                aria-label="Close"
                                onClick={onClose}
                            >
                                <i className="fa-sharp fa-solid fa-xmark" />
                            </button>
                        ) : null}
                        <button
                            className={cn(
                                "h-7 w-7 shrink-0 rounded border border-border text-xs text-secondary hover:bg-hover hover:text-primary",
                                summary.marked && "border-accent bg-accent/10 text-accent"
                            )}
                            title={summary.marked ? "Unmark session" : "Mark session"}
                            aria-label={summary.marked ? "Unmark session" : "Mark session"}
                            onClick={() => void model.toggleMark(summary)}
                        >
                            <i className={cn("fa-sharp", summary.marked ? "fa-solid fa-star" : "fa-regular fa-star")} />
                        </button>
                        <IconButton
                            icon={refreshing ? "fa-spinner animate-spin" : "fa-rotate"}
                            label="Refresh session detail"
                            disabled={refreshing}
                            onClick={() => void requestDetailDelta("manual")}
                        />
                    </div>
                </div>
                )}
            </div>
            <div className="relative min-h-0 flex-1">
                <div className={cn("flex h-full min-h-0", outlineOpen && "pr-0")}>
                    <div className="flex min-w-0 flex-1 flex-col">
                        <div className="shrink-0 border-b border-border bg-panel px-3 py-2">
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                                <div className="relative min-w-[220px] flex-[1_1_280px]">
                                    <i className="fa-sharp fa-solid fa-magnifying-glass pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-secondary" />
                                    <input
                                        className="h-7 w-full rounded border border-border bg-panel pl-7 pr-7 text-xs text-primary outline-none focus:border-accent"
                                        placeholder="Search session detail"
                                        value={detailSearchQuery}
                                        onChange={(event) => {
                                            setDetailSearchQuery(event.target.value);
                                            setActiveSearchSeq(null);
                                        }}
                                        onKeyDown={handleDetailSearchKeyDown}
                                    />
                                    {detailSearchQuery ? (
                                        <button
                                            type="button"
                                            className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-secondary hover:text-primary"
                                            title="Clear search"
                                            aria-label="Clear search"
                                            onClick={() => {
                                                setDetailSearchQuery("");
                                                setActiveSearchSeq(null);
                                            }}
                                        >
                                            <i className="fa-sharp fa-solid fa-xmark" />
                                        </button>
                                    ) : null}
                                </div>
                                <div className="flex shrink-0 items-center gap-1">
                                    <div
                                        className="min-w-[72px] text-center text-[11px] text-secondary"
                                        aria-live="polite"
                                    >
                                        {detailSearchSummary}
                                    </div>
                                    <IconButton
                                        icon="fa-chevron-up"
                                        label="Previous search match"
                                        disabled={detailSearchMatches.length === 0}
                                        onClick={jumpToPreviousSearchMatch}
                                    />
                                    <IconButton
                                        icon="fa-chevron-down"
                                        label="Next search match"
                                        disabled={detailSearchMatches.length === 0}
                                        onClick={jumpToNextSearchMatch}
                                    />
                                </div>
                                <div className="ml-auto flex shrink-0 items-center gap-1">
                                    <IconButton
                                        icon="fa-window-restore"
                                        label="Open user message list"
                                        onClick={() => setUserMessageListOpen(true)}
                                    />
                                    <IconButton
                                        icon={outlineOpen ? "fa-chevron-right" : "fa-list"}
                                        label={outlineOpen ? "Collapse outline" : "Open outline"}
                                        className={cn(outlineOpen && "border-accent bg-accent/10 text-accent")}
                                        onClick={() => setOutlineOpen((current) => !current)}
                                    />
                                </div>
                            </div>
                        </div>
                        <div className="relative min-h-0 flex-1">
                            <div
                                ref={detailScrollRef}
                                className="h-full min-h-0 overflow-auto p-3 pb-10"
                                onScroll={handleDetailScroll}
                            >
                                {detailMessages.length === 0 ? (
                                    <EmptyState text="No readable messages." />
                                ) : (
                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between gap-2 text-xs text-secondary">
                                            <div>
                                                Showing #{firstVisibleMessage?.seq ?? 0}-#
                                                {lastVisibleMessage?.seq ?? 0} of {readableMessages.length}
                                            </div>
                                            {hasPreviousMessages ? (
                                                <button
                                                    className="h-7 rounded border border-border px-2 text-xs text-secondary hover:bg-hover hover:text-primary"
                                                    onClick={loadPreviousMessages}
                                                >
                                                    Load more
                                                </button>
                                            ) : (
                                                <div className="text-xxs uppercase text-secondary">Start reached</div>
                                            )}
                                        </div>
                                        {showToolCalls && !toolsLoaded ? (
                                            <div className="rounded border border-border bg-bg/40 px-3 py-3 text-center text-xs text-secondary">
                                                Loading tool calls...
                                            </div>
                                        ) : null}
                                        {showToolCalls && toolsLoaded && toolCalls.length === 0 ? (
                                            <div className="rounded border border-border bg-bg/40 px-3 py-3 text-center text-xs text-secondary">
                                                No tool calls.
                                            </div>
                                        ) : null}
                                        {timelineItems.map((item) =>
                                            item.kind === "message" ? (
                                                <MessageCard
                                                    key={`message-${item.message.seq}`}
                                                    message={item.message}
                                                    collapsed={collapsedMessages[item.message.seq]}
                                                    onToggleCollapsed={() => toggleMessageCollapsed(item.message.seq, item.message.text)}
                                                    searchQuery={detailSearchQuery}
                                                    searchActive={item.message.seq === activeSearchSeq}
                                                    registerRef={(node) => {
                                                        messageRefs.current[item.message.seq] = node;
                                                    }}
                                                />
                                            ) : (
                                                <ToolCallCard
                                                    key={`tool-${item.anchorSeq}-${item.toolCall.seq}`}
                                                    toolCall={item.toolCall}
                                                    expanded={Boolean(expandedToolCalls[item.toolCall.seq])}
                                                    onToggle={() => toggleToolCallExpanded(item.toolCall.seq)}
                                                />
                                            )
                                        )}
                                    </div>
                                )}
                            </div>
                            {deltaLoading && detailMessages.length > 0 ? (
                                <div className="pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full border border-border/60 bg-panel/80 px-4 py-1.5 text-xxs text-secondary shadow-lg backdrop-blur-sm">
                                    <span className="inline-flex items-center gap-2">
                                        <i className="fa-sharp fa-solid fa-spinner animate-spin text-accent" />
                                        Loading new messages...
                                    </span>
                                </div>
                            ) : null}
                        </div>
                    </div>
                    {outlineOpen ? (
                        <aside className="flex h-full w-80 shrink-0 flex-col border-l border-border bg-panel">
                            <div className="flex h-10 items-center justify-between gap-2 border-b border-border px-3">
                                <div className="text-xxs uppercase text-secondary">Outline</div>
                                <div className="flex items-center gap-1">
                                    <IconButton
                                        icon="fa-window-restore"
                                        label="Open user message list"
                                        onClick={() => setUserMessageListOpen(true)}
                                    />
                                    <IconButton
                                        icon="fa-chevron-right"
                                        label="Collapse outline"
                                        onClick={() => setOutlineOpen(false)}
                                    />
                                </div>
                            </div>
                            <div className="min-h-0 flex-1 overflow-auto p-2">
                                {outlineMessages.length === 0 ? (
                                    <div className="px-2 py-2 text-xs text-secondary">No readable messages.</div>
                                ) : (
                                    <div className="space-y-1">
                                        {outlineMessages.map((message, index) => (
                                            <Tooltip
                                                key={message.seq}
                                                placement="left"
                                                openDelay={250}
                                                content={
                                                    <div className="max-h-[240px] max-w-[360px] overflow-auto whitespace-pre-wrap break-words text-[11px] leading-4">
                                                        <div className="mb-1 flex items-center gap-2 text-[10px] uppercase text-secondary">
                                                            <span>User message</span>
                                                            <span>#{message.seq}</span>
                                                            {message.timestamp ? (
                                                                <span>{formatDateTimeToSecond(message.timestamp)}</span>
                                                            ) : null}
                                                        </div>
                                                        {outlineTooltipText(message)}
                                                    </div>
                                                }
                                            >
                                                <button
                                                    className={cn(
                                                        "flex w-full items-start gap-2 rounded border px-2 py-2 text-left text-xs hover:bg-hover",
                                                        outlineRoleClass(message)
                                                    )}
                                                    onClick={() => jumpToMessage(message.seq)}
                                                >
                                                    <span className="mt-0.5 shrink-0 text-[10px] uppercase text-secondary">
                                                        {index + 1}
                                                    </span>
                                                    <span className="min-w-0 flex-1 break-words text-primary">
                                                        {outlinePreview(message)}
                                                    </span>
                                                </button>
                                            </Tooltip>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </aside>
                    ) : null}
                </div>
            </div>
            {userMessageListOpen ? (
                <Modal
                    className="w-[min(780px,calc(100vw-32px))] max-h-[calc(100vh-72px)] overflow-hidden pt-10 pb-4 animate-in-scale"
                    onClose={() => setUserMessageListOpen(false)}
                    onClickBackdrop={() => setUserMessageListOpen(false)}
                >
                    <div className="flex max-h-[calc(100vh-120px)] min-h-0 w-full flex-col gap-3">
                        <div className="flex items-start justify-between gap-3 pr-10">
                            <div className="min-w-0">
                                <div className="text-base font-medium">User Messages</div>
                                <div className="mt-1 text-xs text-secondary">
                                    {normalizedSearchQuery(userMessageSearchQuery) === ""
                                        ? `${userLinesCount} message${userLinesCount === 1 ? "" : "s"} in this session`
                                        : `${userLines.length} of ${userLinesCount} matching user messages`}
                                </div>
                            </div>
                        </div>
                        <div className="relative">
                            <i className="fa-sharp fa-solid fa-magnifying-glass pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-secondary" />
                            <input
                                className="h-8 w-full rounded border border-border bg-bg pl-7 pr-7 text-xs text-primary outline-none focus:border-accent"
                                placeholder="Search user messages"
                                value={userMessageSearchQuery}
                                onChange={(event) => setUserMessageSearchQuery(event.target.value)}
                            />
                            {userMessageSearchQuery ? (
                                <button
                                    type="button"
                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-secondary hover:text-primary"
                                    title="Clear user message search"
                                    aria-label="Clear user message search"
                                    onClick={() => setUserMessageSearchQuery("")}
                                >
                                    <i className="fa-sharp fa-solid fa-xmark" />
                                </button>
                            ) : null}
                        </div>
                        <div className="min-h-0 flex-1 overflow-auto rounded border border-border bg-bg/40 p-2">
                            {userLinesError ? (
                                <div className="rounded border border-error/40 bg-error/10 px-2 py-3 text-xs text-error">
                                    {userLinesError}
                                </div>
                            ) : userLinesLoading && userLines.length === 0 ? (
                                <div className="flex items-center justify-center gap-2 px-2 py-6 text-xs text-secondary">
                                    <i className="fa-sharp fa-solid fa-spinner animate-spin text-accent" />
                                    <span>Loading user messages...</span>
                                </div>
                            ) : userLinesCount === 0 && normalizedSearchQuery(userMessageSearchQuery) === "" ? (
                                <div className="px-2 py-3 text-xs text-secondary">No user messages.</div>
                            ) : userLines.length === 0 ? (
                                <div className="px-2 py-3 text-xs text-secondary">No matching user messages.</div>
                            ) : (
                                <div className="space-y-2">
                                    {userLinesHasMore && normalizedSearchQuery(userMessageSearchQuery) === "" ? (
                                        <button
                                            type="button"
                                            className="flex h-8 w-full items-center justify-center gap-2 rounded border border-border text-xs text-secondary hover:bg-hover hover:text-primary disabled:opacity-60"
                                            disabled={userLinesLoading}
                                            onClick={() =>
                                                void loadUserLinesPage({
                                                    beforeSeq: userLinesNextBeforeSeq,
                                                    append: true,
                                                })
                                            }
                                        >
                                            <i
                                                className={cn(
                                                    "fa-sharp fa-solid",
                                                    userLinesLoading ? "fa-spinner animate-spin" : "fa-chevron-up"
                                                )}
                                            />
                                            <span>{userLinesLoading ? "Loading..." : "Load older user messages"}</span>
                                        </button>
                                    ) : null}
                                    {userLines.map((message, index) => (
                                        <div
                                            key={message.seq}
                                            className="flex w-full items-start gap-3 rounded border border-border bg-panel px-3 py-2 text-xs hover:bg-hover"
                                        >
                                            <button
                                                className="flex min-w-0 flex-1 items-start gap-3 text-left"
                                                onClick={() => openUserMessage(message.seq)}
                                            >
                                                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border border-accent/30 bg-accent/10 text-[10px] text-accent">
                                                    {index + 1}
                                                </span>
                                                <span className="min-w-0 flex-1">
                                                    <span className="mb-1 flex flex-wrap items-center gap-2 text-[10px] uppercase text-secondary">
                                                        <span>#{message.seq}</span>
                                                        {message.timestamp ? (
                                                            <span>{formatDateTimeToSecond(message.timestamp)}</span>
                                                        ) : null}
                                                    </span>
                                                    <span className="block whitespace-pre-wrap break-words text-primary">
                                                        <HighlightedMessageText
                                                            text={userMessageResultText(
                                                                message,
                                                                userMessageSearchQuery
                                                            )}
                                                            searchQuery={userMessageSearchQuery}
                                                            active
                                                        />
                                                    </span>
                                                </span>
                                            </button>
                                            <CopyIconButton
                                                text={message.text}
                                                label="Copy user message"
                                                size="xs"
                                                className="mt-0.5"
                                            />
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </Modal>
            ) : null}
        </div>
    );
}
