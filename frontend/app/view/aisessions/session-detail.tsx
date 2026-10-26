// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ScrollToBottomButton } from "@/app/element/scroll-to-bottom-button";
import { Modal } from "@/app/modals/modal";
import { AISessionsServiceType } from "@/app/store/services";
import { type OutlinePrompt, SessionOutlineRail, useActiveOutlineSeq } from "@/app/view/session-outline-rail";
import { getWebServerEndpoint } from "@/util/endpoints";
import { cn } from "@/util/util";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
    Fragment,
    type KeyboardEvent,
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { flushSync } from "react-dom";
import { autoGenerate } from "./aisession-gen-store";
import { replaceAnnotationDrafts, requestAnnotationDrafts } from "./annotation-assist";
import { AnnotationEditor } from "./annotation-editor";
import { AnnotationFlashMs, annotationCountBySeq, buildAnnotationAnchors } from "./annotation-model";
import { AnnotationRail } from "./annotation-rail";
import { bulkDraftAnnotations, useSessionAnnotations } from "./annotation-store";
import { ChatComposer } from "./chat-composer";
import { CopyIconButton, IconButton } from "./controls";
import { EmptyState } from "./empty-state";
import { GenActionButton } from "./gen-action-button";
import { MessageQueueStore, useMessageQueueStore } from "./message-queue-store";
import { NoteAIButton, NoteAISuggestionBar, useNoteAIGenerate } from "./note-ai-controls";
import { openAISessionDetailFromList } from "./session-detail-block";
import { SessionDetailSkeleton } from "./session-detail-skeleton";
import { SessionMoreMenu, buildSessionMarkdown } from "./session-menu";
import { MessageCard, ToolCallRow } from "./session-message";
import { NoteAutoSaveDelayMs, shouldAutoSaveNote } from "./session-note-autosave";
import { SessionTagChips } from "./session-tag-chips";
import { extractSessionTagsFromNote, mergeSessionTags, sessionTagsEqual } from "./session-tags";
import { defaultChatSource, getChatSource, isSourceAvailable, useChatSourceAvailability } from "./sources";
import { SubagentCard } from "./subagent-card";
import {
    EstimatedRowHeight,
    VirtualOverscan,
    activeSeqFromVirtualItems,
    buildSeqToIndex,
    outlineProbeOffset as computeOutlineProbeOffset,
    isNearBottom,
    shouldVirtualize,
    timelineItemKey,
} from "./timeline-virtual";
import { TitleSourceBadge } from "./title-source-badge";
import { type ChatEvent, type ChatRequestBody, useChatStreams } from "./use-chat-stream";
import { liveTurnToTimelineItems, useLiveTurns } from "./use-live-turn";

/**
 * Transient pane shown while the "new chat" placeholder is selected. The
 * backend assigns the real session id on the first message; onBound promotes
 * the placeholder to a canonical session entry.
 *
 * ponytail: no project picker yet — pi spawns with its default cwd. Upgrade
 * path is the project selector from the M3 New Agent GUI work.
 */
// 新会话（detail == null）现由统一的 SessionDetailPane 处理：组件常驻持有 live turn，
// 首条消息流式内容内联渲染、绑定落地后无缝替换为 canonical，不再有居中浮卡 / loading 闪烁。

import { registerSessionContextResolver, sessionContextAttrs } from "@/app/element/copy-context-contract";
import {
    type SessionContextState,
    type SessionCopyMessage,
    formatSessionContext,
    makeSessionContextResolver,
} from "./copy-context";
import type { SessionDetailTimelineItem } from "./utils";
import {
    buildSessionDetailTimeline,
    formatToolCallPreview,
    isReadableMessage,
    outlinePreview,
    restoreCommandForSession,
} from "./utils";

type NoteSaveStatus = "idle" | "saving" | "saved" | "error";
const ToolCallPreviewLength = 1200;
const NewChatLiveTurnKey = "__new-chat-live-turn__";

function sourceDotClass(source: string): string {
    return getChatSource(source).dotClass ?? "bg-secondary";
}

const RenameTitleInputClass =
    "h-6 min-w-0 flex-1 rounded border border-accent bg-surface px-1.5 text-sm font-medium text-primary outline-none";

export type SessionDetailController = {
    // 可选：供子代理折叠卡片加载子会话内容 / 打开子会话块。
    service?: AISessionsServiceType;
    blockId?: string;
    loadDetail: (session: SessionSummary, refresh?: boolean) => Promise<void>;
    loadDetailDelta?: (reason?: "manual" | "bottom") => Promise<boolean>;
    loadDetailTools: (refresh?: boolean) => Promise<boolean>;
    // turn_end 后只刷新工具调用，不整块替换消息列表（避免旧快照覆盖新内容）。
    refreshToolCallsOnly?: () => Promise<boolean>;
    updateNote: (session: SessionSummary, note: string, tags?: string[]) => Promise<boolean>;
    updateTitle: (session: SessionSummary, title: string) => Promise<boolean>;
    deleteSession: (session: SessionSummary) => Promise<void>;
    restoreSession: (session: SessionSummary) => Promise<void>;
    openProjectDirectory: (summary: SessionSummary) => Promise<void>;
    openSessionFile: (summary: SessionSummary) => Promise<void>;
    toggleMark: (session: SessionSummary) => Promise<void>;
};

function normalizedSearchQuery(query: string): string {
    return query.trim().toLowerCase();
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
    liveStatus,
}: {
    toolCall: ToolCall;
    expanded: boolean;
    onToggle: () => void;
    liveStatus?: "running" | "completed" | "failed";
}) {
    const detailText = toolCallDetailText(toolCall);
    const hasError = Boolean(toolCall.exitCode) || liveStatus === "failed";
    return (
        // 与流式 live 工具行共用 ToolCallRow，保证 turn_end 交接时外观/交互一致
        <ToolCallRow
            name={toolCall.name || "tool"}
            preview={formatToolCallPreview(toolCall)}
            status={liveStatus ?? (hasError ? "failed" : "completed")}
            exitCode={toolCall.exitCode ?? undefined}
            expanded={expanded}
            onToggle={onToggle}
        >
            {detailText ? (
                <>
                    <pre className="max-h-[360px] overflow-auto whitespace-pre-wrap break-words rounded bg-panel p-2 text-[11px] leading-4 text-primary">
                        {trimToolCallText(detailText)}
                    </pre>
                    <div className="mt-2 flex items-center gap-2">
                        <CopyIconButton text={detailText} label="Copy" size="xs" />
                    </div>
                </>
            ) : (
                <div className="text-secondary">No tool detail.</div>
            )}
        </ToolCallRow>
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
    error = "",
    historySyncError = "",
    onClose,
    onExpandSessionList,
    onBound,
    onRunningSessionIdsChange,
    isNewChat = false,
    newChatEpoch = 0,
    projectPath,
    connection = "",
    canChangeDirectory = false,
    onChangeDirectory,
}: {
    model: SessionDetailController;
    detail: SessionDetail | null;
    isNewChat?: boolean;
    loading: boolean;
    deltaLoading?: boolean;
    toolCallsLoading: boolean;
    restoring: boolean;
    deleting: boolean;
    error?: string;
    historySyncError?: string;
    onClose?: () => void;
    /** 会话列表收起时，头栏行首展示「展开列表」按钮（左右同行，非悬浮叠加） */
    onExpandSessionList?: () => void;
    /** 新会话收到真实 session id 后据此绑定占位 session（由 aisessions.tsx 传入） */
    onBound?: (sessionId: string) => void;
    onRunningSessionIdsChange?: (sessionIds: ReadonlySet<string>) => void;
    /** 每开启一轮新 New Chat 自增：作废上一轮的绑定/草稿/迟到流 */
    newChatEpoch?: number;
    /** 新会话使用的项目路径，传给 pi 以确定会话文件目录 */
    projectPath?: string;
    connection?: string;
    canChangeDirectory?: boolean;
    onChangeDirectory?: () => Promise<void>;
}) {
    const availableChatSources = useChatSourceAvailability();
    const [noteDraft, setNoteDraft] = useState("");
    const [noteEditorOpen, setNoteEditorOpen] = useState(false);
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const [noteSaveStatus, setNoteSaveStatus] = useState<NoteSaveStatus>("idle");
    const [renaming, setRenaming] = useState(false);
    const [titleDraft, setTitleDraft] = useState("");
    // 实时 agent 模型（来自聊天 session_state 事件，头栏药丸 chip 展示）
    const [chatAgentModel, setChatAgentModel] = useState("");
    // 状态栏用量：上下文占用百分比（session_state）+ 本会话输入/输出 Token（turn_end）
    const [chatUsage, setChatUsage] = useState<{ input?: number; output?: number }>({});
    const [contextUsagePercent, setContextUsagePercent] = useState<number | undefined>(undefined);
    // 新会话（detail == null）使用的 agent 选择；绑定后由后端按所选 source 落地。
    const [composeSource, setComposeSource] = useState<string>(() => defaultChatSource().id);
    // 新会话首条消息流式期间暂存后端回派的 sessionId。
    const boundRef = useRef("");
    // 绑定发生时所处的 New Chat 世代：新一轮 New Chat 会作废旧绑定（防跨轮残留）
    const boundEpochRef = useRef(-1);
    const newChatTurnRef = useRef(false);
    const [newChatTurnFinished, setNewChatTurnFinished] = useState(false);
    // Queue store: reactive priority queue for messages submitted while a turn is running.
    // Replaces the bare useRef<ChatRequestBody[]> with structured QueuedMessage items.
    const queueStoreRef = useRef(new MessageQueueStore());
    const queueSnap = useMessageQueueStore(queueStoreRef.current);
    // Ref so the turn_end handler can pull the next queued message without
    // stale-closure issues (handleChatSend is defined below this point).
    const flushQueuedRef = useRef<() => void>(() => {});
    const wasNewChatRef = useRef(false);
    // 搜索工具栏（第二行）默认隐藏，点 🔍 展开
    const [searchExpanded, setSearchExpanded] = useState(false);
    // 上滚离开底部时浮出「跳到最新」胶囊（流式吸底/回到底部则收起）
    const [showJumpPill, setShowJumpPill] = useState(false);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [expandedToolCalls, setExpandedToolCalls] = useState<Record<number, boolean>>({});
    const [detailSearchQuery, setDetailSearchQuery] = useState("");
    const [activeSearchSeq, setActiveSearchSeq] = useState<number | null>(null);
    const messageRefs = useRef<Record<number, HTMLDivElement | null>>({});
    // 虚拟化状态通过 ref 暴露给早期定义的 scrollToVisibleMessage（避免 TDZ 与 deps 抖动）。
    const virtualScrollRef = useRef<{
        enabled: boolean;
        seqToIndex: Map<number, number>;
        scrollToIndex: (index: number) => void;
        items: () => Array<{ index: number; start: number }>;
    } | null>(null);
    // 虚拟化下滚动高度来自 virtualizer，供 nearBottom 判定复用。
    const virtualTotalSizeRef = useRef(0);
    const detailScrollRef = useRef<HTMLDivElement | null>(null);
    // 本 session 是否已经做过"打开时自动滚到底"（流式新消息到来不重复跟随）
    const autoScrolledToBottomRef = useRef(false);
    const bottomDeltaRequestedRef = useRef(false);
    const bottomDeltaTimerRef = useRef<number | null>(null);
    const latestNoteDraftRef = useRef("");
    const summaryKeyRef = useRef<string | null>(null);
    const summaryNoteRef = useRef("");
    // 新建会话时屏蔽旧 detail 的竞态残留：未绑定、或绑定属上一轮 epoch 时一律隐藏；
    // 透传条件缩严为「detail 的 sessionId 恰是本轮绑定的 id」
    const effectiveDetail = (() => {
        if (!isNewChat) return detail;
        if (boundRef.current === "" || boundEpochRef.current !== newChatEpoch) return null;
        return detail?.summary?.id === boundRef.current ? detail : null;
    })();
    const summary = effectiveDetail?.summary ?? null;
    const summaryKey = summary?.key ?? "";
    // Note 弹窗里的 AI 生成（提案式：填入草稿，由既有保存逻辑落盘）
    const noteAI = useNoteAIGenerate(summaryKey, connection);
    const genService = useMemo(() => new AISessionsServiceType(), []);
    // AI 建议的 tags 先暂存，保存时与 note 内 #tag、summary.tags 合并。
    const [aiTags, setAiTags] = useState<string[]>([]);
    const applyNoteAISuggestion = useCallback(
        (suggestion: { note: string; tags: string[] }) => {
            latestNoteDraftRef.current = suggestion.note;
            setNoteDraft(suggestion.note);
            setAiTags(suggestion.tags);
            if (noteSaveStatus !== "saving") setNoteSaveStatus("idle");
            noteAI.dismiss();
        },
        [noteAI.dismiss, noteSaveStatus]
    );
    const parsedNoteDraft = extractSessionTagsFromNote(noteDraft);
    const nextTags = mergeSessionTags(mergeSessionTags(summary?.tags ?? [], parsedNoteDraft.tags), aiTags);
    const noteUnchanged = parsedNoteDraft.note === (summary?.note ?? "") && sessionTagsEqual(nextTags, summary?.tags);
    const noteSaving = noteSaveStatus === "saving";
    const trimmedNoteDraft = noteDraft.trim();
    const refreshing = loading || deltaLoading || toolCallsLoading;

    // 切换会话时退出改名态，避免把草稿写进别的会话
    useEffect(() => {
        setRenaming(false);
        setTitleDraft("");
    }, [summaryKey]);

    const startRename = useCallback(() => {
        if (!summary?.key) return;
        setTitleDraft(summary.title || "");
        setRenaming(true);
    }, [summary]);

    const commitRename = useCallback(async () => {
        if (!summary) return;
        const nextTitle = titleDraft.trim();
        if (nextTitle === "" || nextTitle === summary.title) {
            setRenaming(false);
            return;
        }
        const ok = await model.updateTitle(summary, nextTitle);
        if (ok) {
            setRenaming(false);
        }
    }, [model, summary, titleDraft]);

    useEffect(() => {
        const nextKey = effectiveDetail?.summary?.key ?? null;
        const nextNote = effectiveDetail?.summary?.note ?? "";
        const previousKey = summaryKeyRef.current;
        const previousNote = summaryNoteRef.current;
        summaryKeyRef.current = nextKey;
        summaryNoteRef.current = nextNote;
        if (nextKey !== previousKey || extractSessionTagsFromNote(latestNoteDraftRef.current).note === previousNote) {
            latestNoteDraftRef.current = nextNote;
            setNoteDraft(nextNote);
        }
    }, [effectiveDetail?.summary?.key, effectiveDetail?.summary?.note, effectiveDetail?.summary?.tags]);

    useEffect(() => {
        messageRefs.current = {};
        bottomDeltaRequestedRef.current = false;
        if (bottomDeltaTimerRef.current != null) {
            window.clearTimeout(bottomDeltaTimerRef.current);
            bottomDeltaTimerRef.current = null;
        }
        setDeleteConfirmOpen(false);
        setNoteEditorOpen(false);
        setNoteSaveStatus("idle");
        setExpandedToolCalls({});
        setDetailSearchQuery("");
        setActiveSearchSeq(null);
        // 切 session 时重置「自动滚到底已执行」标志，让新 session 重新滚到底
        autoScrolledToBottomRef.current = false;
        // Clear any pending queue from the previous session.
        queueStoreRef.current.clearAll();
    }, [effectiveDetail?.summary?.key]);

    useEffect(() => {
        bottomDeltaRequestedRef.current = false;
    }, [effectiveDetail?.messages?.length, deltaLoading]);

    const readableMessages = useMemo(
        () => (effectiveDetail?.messages ?? []).filter((message) => isReadableMessage(message)),
        [effectiveDetail?.messages]
    );
    const actualModels = useMemo(() => {
        const models: string[] = [];
        for (const message of effectiveDetail?.messages ?? []) {
            const modelName = message.model?.trim();
            if (!modelName || modelName === "<synthetic>" || models.includes(modelName)) continue;
            models.push(modelName);
        }
        return models;
    }, [effectiveDetail?.messages]);
    const actualModel = actualModels.at(-1) ?? "";
    // 全量渲染：详情里的可读消息一次性全部呈现，不再按 30 条分页。
    // 后端本就一次返回整份可读消息（toolResult 的 base64 图片不进 payload），
    // 契约上不存在"点一次加载一页"的语义，分页窗口纯属前端历史遗留。
    const detailMessages = readableMessages;
    const timelineItems = useMemo(
        () =>
            buildSessionDetailTimeline(
                effectiveDetail?.messages ?? [],
                detailMessages,
                effectiveDetail?.toolCalls,
                true
            ),
        [effectiveDetail?.messages, detailMessages, effectiveDetail?.toolCalls]
    );
    const outlineMessages = useMemo(
        () => readableMessages.filter((message) => message.role === "user"),
        [readableMessages]
    );
    // PreviewRail 数据：用户消息即 prompt 刻度
    const outlinePrompts = useMemo<OutlinePrompt[]>(
        () => outlineMessages.map((message) => ({ seq: message.seq, preview: outlinePreview(message) })),
        [outlineMessages]
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
    const toolCalls = effectiveDetail?.toolCalls ?? [];
    const annotationAnchors = useMemo(
        () => buildAnnotationAnchors(detailMessages, toolCalls),
        [detailMessages, toolCalls]
    );
    const { annotations, reload: reloadAnnotations } = useSessionAnnotations(summaryKey, connection, annotationAnchors);
    const annotationCounts = useMemo(() => annotationCountBySeq(annotations), [annotations]);
    const annotationPreviewBySeq = useMemo(() => {
        const map = new Map<number, string>();
        for (const message of detailMessages) {
            map.set(message.seq, message.text.replace(/^\s+|\s+$/g, "").slice(0, 240));
        }
        return map;
    }, [detailMessages]);
    const [annotationEditor, setAnnotationEditor] = useState<{
        seq: number;
        anchorKey: string;
        annotation?: AnnotationView;
    } | null>(null);
    const [activeAnnotationSeq, setActiveAnnotationSeq] = useState<number | null>(null);
    const [timelineGenerating, setTimelineGenerating] = useState(false);
    const [annotationError, setAnnotationError] = useState("");
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
        const container = detailScrollRef.current;
        if (container == null) return;
        // 虚拟化后目标行可能不在视区（没有 DOM 节点）：先按行号滚动，再在下一帧
        // 用测量后的真实位置修正一次，避免用户看到明显跳动。
        const virtual = virtualScrollRef.current;
        if (virtual != null && virtual.enabled) {
            const index = virtual.seqToIndex.get(seq);
            if (index == null) return;
            virtual.scrollToIndex(index);
            const correct = (attempt: number) => {
                const item = virtual.items().find((candidate) => candidate.index === index);
                if (item != null) {
                    container.scrollTo({ top: Math.max(0, item.start - 12), behavior: "auto" });
                    return;
                }
                if (attempt < 3) {
                    window.requestAnimationFrame(() => correct(attempt + 1));
                }
            };
            window.requestAnimationFrame(() => correct(0));
            return;
        }
        // 全量渲染后消息节点应当已在 DOM；仅当首帧尚未提交时做几次 rAF 重试。
        const attemptScroll = (attempt: number) => {
            const node = messageRefs.current[seq];
            if (node && container) {
                const containerRect = container.getBoundingClientRect();
                const nodeRect = node.getBoundingClientRect();
                const top = nodeRect.top - containerRect.top + container.scrollTop - 12;
                container.scrollTo({ top, behavior });
                return;
            }
            if (node) {
                node.scrollIntoView({ behavior, block: "start" });
                return;
            }
            if (attempt < 3) {
                window.requestAnimationFrame(() => attemptScroll(attempt + 1));
            }
        };
        attemptScroll(0);
    }, []);

    // rail 点击 → 跳到对应消息并高亮 1200ms。
    const jumpToAnnotationSeq = useCallback(
        (seq: number) => {
            setActiveAnnotationSeq(seq);
            scrollToVisibleMessage(seq, "smooth");
            const flash = (attempt: number) => {
                const node = messageRefs.current[seq];
                if (node == null) {
                    if (attempt < 8) window.requestAnimationFrame(() => flash(attempt + 1));
                    return;
                }
                const previousOutline = node.style.outline;
                const previousOffset = node.style.outlineOffset;
                node.style.outline = "2px solid rgba(120, 150, 255, 0.75)";
                node.style.outlineOffset = "2px";
                window.setTimeout(() => {
                    node.style.outline = previousOutline;
                    node.style.outlineOffset = previousOffset;
                }, AnnotationFlashMs);
            };
            window.requestAnimationFrame(() => flash(0));
            window.setTimeout(() => {
                setActiveAnnotationSeq((current) => (current === seq ? null : current));
            }, AnnotationFlashMs);
        },
        [scrollToVisibleMessage]
    );

    const generateAnnotationTimeline = useCallback(async () => {
        if (summaryKey === "" || timelineGenerating) return;
        setTimelineGenerating(true);
        setAnnotationError("");
        try {
            const drafts = await requestAnnotationDrafts({
                sessionKey: summaryKey,
                connection,
                scope: "timeline",
                maxEntries: 12,
            });
            if (drafts.length > 0) {
                await replaceAnnotationDrafts(summaryKey, connection, drafts);
                await reloadAnnotations();
            }
        } catch (err) {
            setAnnotationError(err instanceof Error ? err.message : String(err));
        } finally {
            setTimelineGenerating(false);
        }
    }, [connection, reloadAnnotations, summaryKey, timelineGenerating]);

    const bulkDrafts = useCallback(
        async (action: "accept" | "discard", ids?: number[]) => {
            if (summaryKey === "") return;
            try {
                await bulkDraftAnnotations(summaryKey, connection, ids ?? [], action);
                await reloadAnnotations();
            } catch (err) {
                setAnnotationError(err instanceof Error ? err.message : String(err));
            }
        },
        [connection, reloadAnnotations, summaryKey]
    );

    // 实时流式 turn（主消息区内联渲染）：assistant_delta/tool 事件累积，turn_end 后由
    // DetailDelta 正式数据替换（先刷新落地再清除，避免空窗闪烁）。
    const {
        liveTurns,
        startLiveTurn,
        handleChatEvent: handleLiveTurnEvent,
        clearLiveTurn,
        moveLiveTurn,
        flushLiveTurn,
        setTurnError,
    } = useLiveTurns();
    const {
        statuses: chatStreamStatuses,
        send: sendChatStream,
        abort: abortChatStream,
        move: moveChatStream,
    } = useChatStreams();
    // ref 指向最新值，供异步交接逻辑读取，避免使用陈旧闭包中的 detail / liveTurns。
    const liveTurnsRef = useRef(liveTurns);
    liveTurnsRef.current = liveTurns;
    const detailRef = useRef<SessionDetail | null>(detail);
    detailRef.current = detail;
    const chatEndpoint = `${getWebServerEndpoint()}/api/aisessions-chat`;
    // New Chat 世代镜像与每条流的发送世代：区分并丢弃上一轮 New Chat 的迟到事件
    const epochRef = useRef(newChatEpoch);
    epochRef.current = newChatEpoch;
    const prevEpochRef = useRef(newChatEpoch);
    const streamEpochRef = useRef(new Map<string, number>());
    // 本轮绑定（可能为空）：渲染期即时遮蔽旧绑定，不依赖 effect 时序
    const boundSessionId = isNewChat && boundEpochRef.current === newChatEpoch ? boundRef.current : "";
    const activeLiveTurnKey = summary?.id || (isNewChat ? boundSessionId || NewChatLiveTurnKey : "");
    const liveTurn = liveTurns[activeLiveTurnKey] ?? null;
    const liveUserMessagePersisted =
        liveTurn != null &&
        detailMessages.some((message) => message.seq > liveTurn.userMessageSeqFloor && message.role === "user");
    const activeChatStreamStatus = chatStreamStatuses[activeLiveTurnKey] ?? "idle";
    const turnIdBySessionRef = useRef(new Map<string, string>());
    const activeSessionIdRef = useRef("");
    const nearBottomRef = useRef(true);
    activeSessionIdRef.current = summary?.id ?? "";

    // New Chat 重置：进入占位页 或 在同占位上再点 New Chat（epoch 变化）时触发。
    // 已绑定的旧流已搬到真实 session key 下（属于真实会话，继续滚不受影响）；
    // 未绑定的旧流还在占位 key 上 —— 会进本轮渲染，立即断开并清掉残留 live turn。
    useEffect(() => {
        const prevEpoch = prevEpochRef.current;
        const epochChanged = prevEpoch !== newChatEpoch;
        prevEpochRef.current = newChatEpoch;
        if (isNewChat && (!wasNewChatRef.current || epochChanged)) {
            const previouslyBound = epochChanged && boundRef.current !== "" && boundEpochRef.current === prevEpoch;
            boundRef.current = "";
            boundEpochRef.current = -1;
            newChatTurnRef.current = false;
            setNewChatTurnFinished(false);
            setComposeSource(defaultChatSource().id);
            if (epochChanged && !previouslyBound) {
                clearLiveTurn(NewChatLiveTurnKey);
                abortChatStream(NewChatLiveTurnKey);
                // 同步抹掉占位流的世代记录：后续迟到事件必然与本轮 epoch 不符而被丢弃
                streamEpochRef.current.delete(NewChatLiveTurnKey);
            }
        }
        wasNewChatRef.current = isNewChat;
    }, [isNewChat, newChatEpoch, clearLiveTurn, abortChatStream]);

    useEffect(() => {
        const sessionIds = new Set(Object.keys(liveTurns).filter((key) => key !== NewChatLiveTurnKey));
        onRunningSessionIdsChange?.(sessionIds);
    }, [liveTurns, onRunningSessionIdsChange]);

    // 流式期间跟随滚动：仅当用户本就停在底部附近时才自动吸底。
    useEffect(() => {
        if (liveTurn == null || !nearBottomRef.current) return;
        const node = detailScrollRef.current;
        if (node != null) node.scrollTop = node.scrollHeight;
    }, [liveTurn]);

    const historyRetryRef = useRef({ error: "", attempt: 0 });
    const requestDetailDelta = useCallback(
        (reason: "manual" | "bottom") => {
            if (reason === "manual") {
                if (summary != null) {
                    return model.loadDetail(summary, true).then(() => true);
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
        [model, summary]
    );

    useEffect(() => {
        if (!historySyncError || effectiveDetail == null || liveTurn != null) {
            historyRetryRef.current = { error: "", attempt: 0 };
            return;
        }
        const retry = historyRetryRef.current;
        if (retry.error !== historySyncError) {
            retry.error = historySyncError;
            retry.attempt = 0;
        }
        if (retry.attempt >= 3) return;
        retry.attempt += 1;
        const delayMs = Math.min(1000 * 2 ** (retry.attempt - 1), 8000);
        const handle = window.setTimeout(() => {
            void requestDetailDelta("manual");
        }, delayMs);
        return () => window.clearTimeout(handle);
    }, [effectiveDetail, historySyncError, liveTurn, requestDetailDelta]);

    // 交接保护：turn_end 后先确认正式 assistant 消息已落盘，再清除 live 临时块。
    // 否则后端持久化滞后时会出现「回应显示后内容消失」的空窗（见 use-live-turn.tsx 顶部注释）。
    // ponytail: 轮询限 4s，超时则保留 live 副本——绝不擦除未确认内容。
    const clearLiveTurnWhenPersisted = useCallback(
        async (key: string) => {
            if (key === "") return;
            // 先抓取本 turn 的 seq 基线（live 块被清后就读不到了）
            const seqFloor = liveTurnsRef.current[key]?.userMessageSeqFloor ?? 0;
            const hasLanded = () =>
                (detailRef.current?.messages ?? []).some((m) => m.role === "assistant" && (m.seq ?? 0) > seqFloor);
            if (hasLanded()) {
                clearLiveTurn(key);
                return;
            }
            const startedAt = Date.now();
            const MaxWaitMs = 4000;
            const PollMs = 150;
            while (Date.now() - startedAt < MaxWaitMs) {
                await requestDetailDelta("bottom");
                // 让 React 提交本次详情刷新，更新 detailRef 后再判定
                await new Promise((r) => setTimeout(r, PollMs));
                if (hasLanded()) {
                    clearLiveTurn(key);
                    return;
                }
            }
            // 最终兜底：全量刷新再确认；仍缺失则保留 live 副本（不擦除未确认内容）。
            await requestDetailDelta("manual");
            await new Promise((r) => setTimeout(r, PollMs));
            if (hasLanded()) {
                clearLiveTurn(key);
            }
        },
        [clearLiveTurn, requestDetailDelta]
    );

    // 新会话的正式详情可能先于 SSE 结束到达，必须等本轮结束再替换临时内容。
    // detail 在此 effect 触发时已加载（依赖 detail?.summary?.id === sessionId），
    // 因此用只追加的 delta 合并 + 工具刷新，不做全量 loadDetailTools(true) 覆盖。
    useEffect(() => {
        const sessionId = boundRef.current;
        if (newChatTurnRef.current && newChatTurnFinished && detail?.summary?.id === sessionId) {
            void (async () => {
                await clearLiveTurnWhenPersisted(sessionId);
                await model.refreshToolCallsOnly?.();
                newChatTurnRef.current = false;
                setNewChatTurnFinished(false);
            })();
        }
    }, [detail?.summary?.id, newChatTurnFinished, clearLiveTurnWhenPersisted, model]);

    const handleChatEvent = useCallback(
        (evt: ChatEvent, streamSessionId: string) => {
            let key = streamSessionId || boundRef.current || NewChatLiveTurnKey;
            // 上一轮 New Chat 已作废：该轮的占位流事件（含迟到的 sessionId 回派）一律丢弃
            if (
                isNewChat &&
                streamSessionId === NewChatLiveTurnKey &&
                streamEpochRef.current.get(NewChatLiveTurnKey) !== epochRef.current
            ) {
                return;
            }
            if (evt.type === "session_state") {
                if (evt.state?.model) {
                    const m = evt.state.model;
                    setChatAgentModel(String(m.name || m.id || ""));
                }
                if (typeof evt.state?.contextUsagePercent === "number") {
                    setContextUsagePercent(evt.state.contextUsagePercent);
                }
                if (evt.usage) {
                    setChatUsage({ input: evt.usage.it, output: evt.usage.ot });
                }
                // 新会话：后端在首条消息后回派真实 sessionId，暂存待 turn_end 绑定。
                if (isNewChat && evt.state?.sessionId && boundRef.current === "") {
                    boundRef.current = String(evt.state.sessionId);
                    boundEpochRef.current = epochRef.current;
                    key = boundRef.current;
                    moveLiveTurn(NewChatLiveTurnKey, key);
                    moveChatStream(NewChatLiveTurnKey, key);
                    newChatTurnRef.current = true;
                    setNewChatTurnFinished(false);
                    onBound?.(boundRef.current);
                }
                return;
            }

            const eventTurnId = evt.turnId?.trim() ?? "";
            const currentTurnId = turnIdBySessionRef.current.get(key) ?? "";
            if (evt.type === "turn_start" && eventTurnId !== "") {
                turnIdBySessionRef.current.set(key, eventTurnId);
            } else if (eventTurnId !== "" && currentTurnId !== "" && eventTurnId !== currentTurnId) {
                return;
            }

            if (evt.type === "turn_end" || evt.type === "turn_failed") {
                // turn_failed 携带错误信息：存入 LiveTurn.error 以便渲染错误 UI + 重试/继续按钮
                if (evt.type === "turn_failed" && evt.error) {
                    setTurnError(key, { message: evt.error, retryable: true });
                }
                // turn_end 携带本轮 usage：更新状态栏的输入/输出 Token 累计
                if (evt.usage) {
                    setChatUsage({ input: evt.usage.it, output: evt.usage.ot });
                }
                flushLiveTurn(key);
                turnIdBySessionRef.current.delete(key);
                if (newChatTurnRef.current) {
                    setNewChatTurnFinished(true);
                    return;
                }
                if (activeSessionIdRef.current === key) {
                    void (async () => {
                        // 不再用 loadDetailTools(true) 全量替换 detail：那会与并发 delta /
                        // 后端旧快照竞态，用更短列表覆盖旧内容。改为只追加的 delta 合并
                        // （clearLiveTurnWhenPersisted 内部轮询 requestDetailDelta）确认正式
                        // assistant 消息落盘，再单独刷新工具调用。消息列表只增不减。
                        await clearLiveTurnWhenPersisted(key);
                        await model.refreshToolCallsOnly?.();
                        // 本回合结束且正式数据已落盘：若队列里还有等待中的消息，补发下一条。
                        flushQueuedRef.current();
                    })();
                } else {
                    // 非激活会话：直接清临时块，正式内容切回时由详情加载补齐
                    clearLiveTurn(key);
                }
                return;
            }
            handleLiveTurnEvent(key, evt);
        },
        [
            clearLiveTurn,
            clearLiveTurnWhenPersisted,
            flushLiveTurn,
            handleLiveTurnEvent,
            isNewChat,
            model,
            moveChatStream,
            moveLiveTurn,
            onBound,
            setTurnError,
        ]
    );

    const handleChatSend = useCallback(
        (body: ChatRequestBody) => {
            const key = summary?.id || boundSessionId || NewChatLiveTurnKey;
            // For new chats: after the first message, pi assigns a real sessionId.
            // Inject it into the request body so subsequent messages reuse the same
            // subprocess instead of spawning a duplicate.
            const effectiveBody =
                isNewChat && !body.sessionId && boundSessionId ? { ...body, sessionId: boundSessionId } : body;
            streamEpochRef.current.set(key, epochRef.current);
            const messageSeqFloor = (effectiveDetail?.messages ?? []).reduce(
                (maxSeq, message) => Math.max(maxSeq, message.seq),
                0
            );
            turnIdBySessionRef.current.delete(key);
            flushSync(() => startLiveTurn(key, effectiveBody.message ?? "", messageSeqFloor));
            sendChatStream(key, chatEndpoint, effectiveBody, handleChatEvent);
        },
        [
            chatEndpoint,
            effectiveDetail?.messages,
            handleChatEvent,
            isNewChat,
            boundSessionId,
            sendChatStream,
            startLiveTurn,
            summary?.id,
        ]
    );

    // 当前 turn 已结束并落盘，把队列里的下一条作为正常发送（复用 handleChatSend
    // 的单连接语义，不再用 steer 并行第二条 SSE，避免多流互相覆盖）。放在 ref 里
    // 由 turn_end 分支调用，避免 handleChatSend 定义在 handleChatEvent 之后带来的
    // 顺序/陈旧闭包问题。
    flushQueuedRef.current = () => {
        const store = queueStoreRef.current;
        // Complete the previous active item before pulling the next.
        store.completeActive();
        const item = store.takeNext();
        if (item) {
            handleChatSend(item.body);
        }
    };

    const handleChatQueue = useCallback((body: ChatRequestBody) => {
        queueStoreRef.current.enqueue(body);
    }, []);

    const handleChatAbort = useCallback(() => {
        // Stop: abort the active stream, but retain queued messages (Paseo-style).
        // User sees the pill shrink + toast with count; they can dismiss (keep)
        // or flush the retained queue manually.
        const store = queueStoreRef.current;
        store.clearActive();
        abortChatStream(activeLiveTurnKey);
        handleChatEvent({ type: "turn_end" }, activeLiveTurnKey);
    }, [abortChatStream, activeLiveTurnKey, handleChatEvent]);

    const handleDetailScroll = useCallback(() => {
        const node = detailScrollRef.current;
        if (node != null) {
            // 虚拟化后 scrollHeight 只是已渲染窗口的高度，真实内容高度取 virtualizer 总高。
            const contentHeight = virtualTotalSizeRef.current > 0 ? virtualTotalSizeRef.current : node.scrollHeight;
            nearBottomRef.current = isNearBottom(contentHeight, node.scrollTop, node.clientHeight, 120);
            // 上滚离开底部 → 浮出「跳到最新」胶囊；流式吸底 / 回到底部则收起。
            setShowJumpPill(!nearBottomRef.current && (readableMessages.length > 0 || liveTurn != null));
        }
        if (
            liveTurn != null ||
            activeChatStreamStatus === "sending" ||
            activeChatStreamStatus === "streaming" ||
            deltaLoading ||
            loading ||
            model.loadDetailDelta == null ||
            bottomDeltaRequestedRef.current
        ) {
            return;
        }
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
    }, [activeChatStreamStatus, deltaLoading, liveTurn, loading, model.loadDetailDelta, requestDetailDelta]);

    useEffect(() => {
        return () => {
            if (bottomDeltaTimerRef.current != null) {
                window.clearTimeout(bottomDeltaTimerRef.current);
            }
        };
    }, []);

    const toggleToolCallExpanded = useCallback((seq: number) => {
        setExpandedToolCalls((current) => ({ ...current, [seq]: !current[seq] }));
    }, []);

    // 子代理折叠：detail 命中 subagent 派发时，按 itemKey 渲染 SubagentCard。
    // 只在 detail 已就绪时拉一次，避免每次 delta 刷新都打后端。
    const subagentSessionId = detail?.summary?.key ?? "";
    const [subagentFold, setSubagentFold] = useState<AISessionsSubagentFoldResponse | null>(null);
    useEffect(() => {
        if (model.service == null || subagentSessionId === "") {
            setSubagentFold(null);
            return;
        }
        let cancelled = false;
        model.service
            .SubagentFold({ id: subagentSessionId, connection })
            .then((result) => {
                if (!cancelled) {
                    setSubagentFold(result);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setSubagentFold(null);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [model.service, subagentSessionId, connection]);
    const subagentMatchesByKey = useMemo(() => {
        const matches = subagentFold?.matches ?? [];
        const byKey = new Map<string, SubagentMatch>();
        for (const match of matches) {
            if (match.call.itemKey) {
                byKey.set(match.call.itemKey, match);
            }
        }
        return byKey;
    }, [subagentFold]);
    // 只有 subagent 工具行才查折叠数据；其余工具保持原卡片。
    const subagentMatchFor = useCallback(
        (item: { toolCall: ToolCall }) =>
            item.toolCall.name === "subagent" ? subagentMatchesByKey.get(item.toolCall.itemKey ?? "") : undefined,
        [subagentMatchesByKey]
    );

    const jumpToMessage = useCallback(
        (seq: number) => {
            scrollToVisibleMessage(seq);
        },
        [scrollToVisibleMessage]
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
            const tags = mergeSessionTags(mergeSessionTags(summary.tags ?? [], parsed.tags), aiTags);
            if (parsed.note === (summary.note ?? "") && sessionTagsEqual(tags, summary.tags)) {
                return true;
            }
            setNoteSaveStatus("saving");
            const saved = await model.updateNote(summary, parsed.note, tags);
            const currentDraftSaved = extractSessionTagsFromNote(latestNoteDraftRef.current).note === parsed.note;
            setNoteSaveStatus(saved ? (currentDraftSaved ? "saved" : "idle") : "error");
            return saved && currentDraftSaved;
        },
        [model, noteSaveStatus, summary, aiTags]
    );

    const closeNoteEditor = useCallback(() => {
        if (noteSaving) return;
        if (!noteUnchanged) {
            void saveNote(trimmedNoteDraft).then((saved) => {
                if (saved) setNoteEditorOpen(false);
            });
            return;
        }
        setNoteEditorOpen(false);
    }, [noteSaving, noteUnchanged, saveNote, trimmedNoteDraft]);

    // 防抖自动保存：停止输入 NoteAutoSaveDelayMs 后落盘，与列表行/Note 弹窗行为一致。
    useEffect(() => {
        if (
            !shouldAutoSaveNote({
                loaded: summary != null,
                visible: noteEditorOpen,
                unchanged: noteUnchanged,
                saving: noteSaving,
            })
        ) {
            return;
        }
        const handle = window.setTimeout(() => void saveNote(trimmedNoteDraft), NoteAutoSaveDelayMs);
        return () => window.clearTimeout(handle);
    }, [noteEditorOpen, noteSaving, noteUnchanged, saveNote, summary, trimmedNoteDraft]);

    // 实时 turn 转成与历史同款 timeline 项，追加在历史项之后，用同一套
    // MessageCard / ToolCallCard 渲染——保证实时与历史样式完全一致。
    const liveTimelineItems = liveTurn != null ? liveTurnToTimelineItems(liveTurn, liveUserMessagePersisted) : [];
    // 子代理归位：把已匹配的 subagent 工具行从时间线里摘掉，改成发起它的那条消息的
    // 子级内容（MessageCard children）。未匹配的仍按普通工具行降级显示。
    const subagentMatchesByAnchor = useMemo(() => {
        const byAnchor = new Map<number, SubagentMatch[]>();
        for (const item of timelineItems) {
            if (item.kind !== "tool" || item.toolCall.name !== "subagent") continue;
            const match = subagentMatchesByKey.get(item.toolCall.itemKey ?? "");
            if (match == null) continue;
            const list = byAnchor.get(item.anchorSeq);
            if (list == null) {
                byAnchor.set(item.anchorSeq, [match]);
            } else {
                list.push(match);
            }
        }
        return byAnchor;
    }, [timelineItems, subagentMatchesByKey]);
    const renderItems = useMemo(() => {
        const merged = liveTimelineItems.length > 0 ? [...timelineItems, ...liveTimelineItems] : timelineItems;
        if (subagentMatchesByAnchor.size === 0) return merged;
        return merged.filter(
            (item) =>
                !(
                    item.kind === "tool" &&
                    item.toolCall.name === "subagent" &&
                    subagentMatchesByKey.has(item.toolCall.itemKey ?? "")
                )
        );
    }, [timelineItems, liveTimelineItems, subagentMatchesByAnchor, subagentMatchesByKey]);
    // 大会话走虚拟化：只渲染视口附近的几行，避免 5000+ 个 DOM 节点把滚动拖死。
    // 小会话保持原有全量渲染（行为与改动前一致）。
    const virtualEnabled = shouldVirtualize(renderItems.length);
    const seqToIndex = useMemo(() => buildSeqToIndex(renderItems), [renderItems]);
    const virtualizer = useVirtualizer({
        count: renderItems.length,
        getScrollElement: () => detailScrollRef.current,
        estimateSize: () => EstimatedRowHeight,
        overscan: VirtualOverscan,
        enabled: virtualEnabled,
        measureElement: (element) => element.getBoundingClientRect().height,
    });
    const virtualItems = virtualizer.getVirtualItems();
    virtualScrollRef.current = {
        enabled: virtualEnabled,
        seqToIndex,
        scrollToIndex: (index: number) => virtualizer.scrollToIndex(index, { align: "start" }),
        items: () => virtualizer.getVirtualItems(),
    };
    virtualTotalSizeRef.current = virtualEnabled ? virtualizer.getTotalSize() : 0;
    const timelineItemSeqs = useMemo(
        () => renderItems.map((item) => (item.kind === "message" ? item.message.seq : null)),
        [renderItems]
    );
    // 大纲轨 active 刻度：虚拟化后改用可见项推导，不再遍历 DOM 节点。
    const [outlineProbeOffset, setOutlineProbeOffset] = useState(0);
    useEffect(() => {
        const container = detailScrollRef.current;
        if (container == null || !virtualEnabled) return;
        const update = () => setOutlineProbeOffset(computeOutlineProbeOffset(container.clientHeight));
        update();
        if (typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(update);
        observer.observe(container);
        return () => observer.disconnect();
    }, [virtualEnabled]);
    const fullRenderActiveSeq = useActiveOutlineSeq(detailScrollRef, outlinePrompts, !virtualEnabled);
    const activeOutlineSeq = virtualEnabled
        ? activeSeqFromVirtualItems(virtualItems, timelineItemSeqs, outlineProbeOffset, outlinePrompts[0]?.seq ?? null)
        : fullRenderActiveSeq;
    // live turn 追加时消息节点高度变化：显式重测，避免虚拟行高失真。
    useEffect(() => {
        if (!virtualEnabled || liveTurn == null) return;
        virtualizer.measure();
    }, [virtualEnabled, liveTurn, virtualizer]);
    // 打开会话自动置底：虚拟化后用总高度滚动，语义与全量渲染一致。
    useLayoutEffect(() => {
        if (autoScrolledToBottomRef.current) return;
        if (lastVisibleMessage == null) return;
        // 非虚拟化路径沿用「等真实节点出现」的旧条件，行为完全不变。
        if (!virtualEnabled && messageRefs.current[lastVisibleMessage.seq] == null) return;
        autoScrolledToBottomRef.current = true;
        const container = detailScrollRef.current;
        if (container == null) return;
        const totalHeight = virtualEnabled ? virtualizer.getTotalSize() : container.scrollHeight;
        // 内容未溢出视图时保持顶部对齐（首个消息从顶部开始）
        if (totalHeight > container.clientHeight) {
            container.scrollTo({ top: totalHeight, behavior: "auto" });
        }
    }, [lastVisibleMessage?.seq, virtualEnabled, virtualizer]);
    // 打开子会话时用作 tab 标题提示的项目路径（子会话的 projectPath 拿不到，
    // 多数场景与父会话同仓，退化用父会话路径；仅作 tab 分层标题提示，不参与会话加载）。
    const subagentTabCwd = summary?.projectPath?.trim() || projectPath?.trim() || "";

    // ── Copy Context 接线（见任务 10-24-aisessions-copy-context-builder）──
    //
    // 两个载体：
    //  1. 每条消息容器上的 data-copy-context-*，让全局 💡 浮层能把选区解析成「来自哪条消息」；
    //  2. 下方面板注册的 resolver，它持有完整 model，能重建选区跨越多条（且被虚拟化卸载）的消息。
    //
    // seqRange 必须在 selectionchange 期间持续记录：拖选跨出视口后，起始行会被
    // 虚拟化回收，mouseup 时刻的 DOM 已经拿不到它。
    const copyDragActiveRef = useRef(false);
    const copyRangeRef = useRef<{ start: number; end: number } | null>(null);
    const sessionContextStateRef = useRef<SessionContextState | null>(null);
    // 会话级定位信息（只拼一次，给 resolver 与 hover 按钮共用）。
    // filePath / key / parentKey / messageCount 都是为了让接到上下文的 agent
    // 能直接找到那份会话文件，而不是反问「哪个会话」。
    const copySummary = useMemo(
        () =>
            summary == null
                ? null
                : {
                      id: summary.id,
                      source: summary.source,
                      title: summary.title,
                      projectPath: summary.projectPath,
                      key: summary.key,
                      filePath: summary.filePath,
                      createdAt: summary.createdAt,
                      updatedAt: summary.updatedAt,
                      messageCount: summary.messageCount,
                      parentKey: summary.parentKey,
                  },
        [
            summary?.id,
            summary?.source,
            summary?.title,
            summary?.projectPath,
            summary?.key,
            summary?.filePath,
            summary?.createdAt,
            summary?.updatedAt,
            summary?.messageCount,
            summary?.parentKey,
        ]
    );

    sessionContextStateRef.current =
        copySummary == null
            ? null
            : {
                  summary: copySummary,
                  messages: detailMessages as SessionCopyMessage[],
                  seqRange: copyRangeRef.current,
              };

    useEffect(() => {
        const sessionId = summary?.id ?? "";
        if (!sessionId) {
            return;
        }
        return registerSessionContextResolver(
            sessionId,
            makeSessionContextResolver(() => sessionContextStateRef.current)
        );
    }, [summary?.id]);

    useEffect(() => {
        const stopDrag = () => {
            copyDragActiveRef.current = false;
        };
        window.addEventListener("pointerup", stopDrag);
        window.addEventListener("pointercancel", stopDrag);
        return () => {
            window.removeEventListener("pointerup", stopDrag);
            window.removeEventListener("pointercancel", stopDrag);
        };
    }, []);

    const handleCopyRangePointerDown = useCallback(() => {
        copyDragActiveRef.current = true;
        copyRangeRef.current = null;
    }, []);

    // 一次委托取代给每行挂事件：从选中节点向上找最近的消息容器，读它的 seq。
    const handleCopyRangePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        if (!copyDragActiveRef.current) {
            return;
        }
        const target = event.target as Element | null;
        const annotated = target?.closest?.("[data-copy-context-kind]");
        if (annotated == null) {
            return;
        }
        const seq = Number(annotated.getAttribute("data-aisession-seq"));
        if (!Number.isFinite(seq) || seq <= 0) {
            return;
        }
        const current = copyRangeRef.current;
        copyRangeRef.current = current == null ? { start: seq, end: seq } : { start: current.start, end: seq };
    }, []);

    // 每行一个 context 块：hover 的「Copy as context」与 💡 Copy Context 必须同源同文。
    const contextTextBySeq = useMemo(() => {
        const map = new Map<number, string>();
        if (copySummary == null) {
            return map;
        }
        for (const message of detailMessages) {
            map.set(
                message.seq,
                formatSessionContext({
                    summary: copySummary,
                    messages: [message as SessionCopyMessage],
                    seqStart: message.seq,
                    seqEnd: message.seq,
                    selectedText: message.text,
                })
            );
        }
        return map;
    }, [copySummary, detailMessages]);

    const contextAttrsBySeq = useMemo(() => {
        const map = new Map<number, Record<string, string>>();
        if (summary == null) {
            return map;
        }
        for (const message of detailMessages) {
            map.set(message.seq, {
                ...sessionContextAttrs({
                    sessionId: summary.id,
                    source: summary.source,
                    title: summary.title,
                    projectPath: summary.projectPath,
                    model: message.model,
                    seq: message.seq,
                    role: message.role,
                    timestamp: message.timestamp,
                    entryId: message.entryId,
                    itemKey: message.itemKey,
                }),
                "data-aisession-seq": String(message.seq),
            });
        }
        return map;
    }, [summary?.id, summary?.source, summary?.title, summary?.projectPath, detailMessages]);

    const toolContextAttrsBySeq = useMemo(() => {
        const map = new Map<number, Record<string, string>>();
        if (summary == null) {
            return map;
        }
        const session = {
            sessionId: summary.id,
            source: summary.source,
            title: summary.title,
            projectPath: summary.projectPath,
        };
        for (const toolCall of toolCalls) {
            map.set(
                toolCall.seq,
                sessionContextAttrs({ ...session, toolName: toolCall.name, exitCode: toolCall.exitCode })
            );
        }
        return map;
    }, [summary?.id, summary?.source, summary?.title, summary?.projectPath, toolCalls]);
    // 渲染单行的共享实现：全量分支与虚拟分支必须长得完全一样，避免两条路径漂移。
    const renderTimelineItem = useCallback(
        (item: SessionDetailTimelineItem, itemIdx: number, items: SessionDetailTimelineItem[]) => {
            const prevItem = itemIdx > 0 ? items[itemIdx - 1] : null;
            const isGroupStart =
                item.kind !== "message" ||
                prevItem == null ||
                prevItem.kind !== "message" ||
                prevItem.message.role !== item.message.role;
            if (item.kind === "message") {
                const foldedSubagents = subagentMatchesByAnchor.get(item.message.seq);
                return (
                    <MessageCard
                        message={item.message}
                        searchQuery={detailSearchQuery}
                        searchActive={item.message.seq === activeSearchSeq}
                        groupStart={isGroupStart}
                        contextAttrs={contextAttrsBySeq.get(item.message.seq)}
                        contextText={contextTextBySeq.get(item.message.seq)}
                        annotationCount={annotationCounts.get(item.message.seq) ?? 0}
                        onOpenAnnotations={
                            item.message.itemKey
                                ? () => {
                                      const existing = annotations.find(
                                          (annotation) => annotation.seq === item.message.seq
                                      );
                                      setAnnotationEditor({
                                          seq: item.message.seq,
                                          anchorKey: item.message.itemKey!,
                                          annotation: existing,
                                      });
                                  }
                                : undefined
                        }
                        registerRef={(node) => {
                            if (node) messageRefs.current[item.message.seq] = node;
                        }}
                    >
                        {foldedSubagents != null && model.service != null
                            ? foldedSubagents.map((match) => (
                                  <div key={match.call.itemKey ?? match.sessionKey} className="mt-1">
                                      <SubagentCard
                                          match={match}
                                          service={model.service!}
                                          connection={connection || undefined}
                                          onOpenSession={(sessionKey) => {
                                              if (model.blockId) {
                                                  // 不强制单开：同一子会话已开着就聚焦，避免重复堆块。
                                                  void openAISessionDetailFromList(sessionKey, model.blockId, {
                                                      cwd: subagentTabCwd || undefined,
                                                  });
                                              }
                                          }}
                                      />
                                  </div>
                              ))
                            : null}
                    </MessageCard>
                );
            }
            const subagentMatch = subagentMatchFor(item);
            if (subagentMatch != null && model.service != null) {
                return (
                    <SubagentCard
                        match={subagentMatch}
                        service={model.service}
                        connection={connection || undefined}
                        onOpenSession={(sessionKey) => {
                            if (model.blockId) {
                                // 不强制单开：同一子会话已开着就聚焦，避免重复堆块。
                                void openAISessionDetailFromList(sessionKey, model.blockId, {
                                    cwd: subagentTabCwd || undefined,
                                });
                            }
                        }}
                    />
                );
            }
            return (
                // 工具卡也挂 provenance，选区落在里面时才能输出 tool / tool-exit。
                // 故意不给 data-aisession-seq：工具 seq 与消息 seq 同域但不同集合，
                // 让它参与范围记录会把消息区间污染成空区间。
                <div {...(toolContextAttrsBySeq.get(item.toolCall.seq) ?? {})}>
                    <ToolCallCard
                        toolCall={item.toolCall}
                        liveStatus={"liveStatus" in item ? item.liveStatus : undefined}
                        expanded={Boolean(expandedToolCalls[item.toolCall.seq])}
                        onToggle={() => toggleToolCallExpanded(item.toolCall.seq)}
                    />
                </div>
            );
        },
        [
            activeSearchSeq,
            connection,
            contextAttrsBySeq,
            contextTextBySeq,
            detailSearchQuery,
            expandedToolCalls,
            model.blockId,
            model.service,
            subagentMatchFor,
            subagentMatchesByAnchor,
            subagentTabCwd,
            toggleToolCallExpanded,
            toolContextAttrsBySeq,
        ]
    );

    // Keep the live turn visible while authoritative history is loading. The
    // detail request may briefly clear the persisted snapshot during promotion;
    // returning an empty pane here would hide an otherwise healthy stream.
    if (detail == null && !isNewChat && liveTurn == null) {
        // 加载中：用骨架屏撑出时间线结构（而不是空白 + 小 spinner）。
        // 有 liveTurn 时上文已拦截，绝不会用骨架盖住实时流。
        if (!loading) {
            return <div className="h-full w-full" />;
        }
        return <SessionDetailSkeleton />;
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
    const projectDirectory = summary?.projectPath?.trim() ?? "";
    const sessionFilePath = summary?.filePath?.trim() ?? "";
    return (
        <div ref={containerRef} className="relative flex h-full min-h-0 flex-col">
            {historySyncError && effectiveDetail != null ? (
                <div
                    className="flex shrink-0 items-center gap-2 border-b border-warning/40 bg-warning/10 px-3 py-1.5 text-xs text-warning"
                    role="status"
                >
                    <span className="min-w-0 flex-1 truncate">History sync paused: {historySyncError}</span>
                    <button
                        type="button"
                        className="shrink-0 cursor-pointer rounded border border-warning/40 px-2 py-0.5 text-[11px] hover:bg-warning/10"
                        onClick={() => void requestDetailDelta("manual")}
                    >
                        Retry
                    </button>
                </div>
            ) : null}
            <div className="flex h-[46px] shrink-0 items-center gap-2 border-b border-border px-3">
                {onExpandSessionList ? (
                    <IconButton
                        icon="fa-chevron-right"
                        label="Expand sessions list"
                        onClick={onExpandSessionList}
                        className="mr-1 shrink-0"
                    />
                ) : null}
                {summary != null ? (
                    <>
                        {renaming ? (
                            <input
                                autoFocus
                                value={titleDraft}
                                onChange={(e) => setTitleDraft(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                        e.preventDefault();
                                        void commitRename();
                                    } else if (e.key === "Escape") {
                                        e.preventDefault();
                                        setRenaming(false);
                                    }
                                }}
                                onBlur={() => void commitRename()}
                                placeholder={summary.title || summary.id}
                                className={RenameTitleInputClass}
                            />
                        ) : (
                            <div
                                className="min-w-0 flex-1 cursor-text truncate text-sm font-medium"
                                title={summary.title || summary.id}
                                onDoubleClick={startRename}
                            >
                                {summary.title || summary.id}
                                <TitleSourceBadge titleSource={summary.titleSource} className="ml-1 align-middle" />
                            </div>
                        )}
                        <span className="inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-full border border-border px-2 text-[11px] text-secondary">
                            <span className={cn("h-1.5 w-1.5 rounded-full", sourceDotClass(summary.source))} />
                            {summary.source}
                        </span>
                        {chatAgentModel || actualModel ? (
                            <span
                                className={cn(
                                    "inline-flex h-[22px] max-w-44 shrink-0 items-center overflow-hidden whitespace-nowrap rounded-full border px-2 text-[11px] text-secondary",
                                    actualModels.length > 1 ? "border-warning/60 text-warning" : "border-border"
                                )}
                                title={`Model${actualModels.length > 1 ? ` (multi-model: ${actualModels.join(", ")})` : ""}`}
                            >
                                {chatAgentModel || actualModel}
                            </span>
                        ) : null}
                        <div className="flex shrink-0 items-center gap-0.5">
                            <GenActionButton
                                sessionKey={summary.key ?? ""}
                                connection={connection}
                                kind="title"
                                titleSource={summary.titleSource}
                            />
                            <IconButton
                                icon="fa-magnifying-glass"
                                label="Search session"
                                className={cn(searchExpanded && "border-accent bg-accent/10 text-accent")}
                                onClick={() => setSearchExpanded((current) => !current)}
                            />
                            <IconButton
                                icon="fa-star"
                                label={summary.marked ? "Unmark session" : "Mark session"}
                                className={cn(
                                    !summary.marked && "text-secondary/50",
                                    summary.marked && "border-warning/60 bg-warning/10 text-warning"
                                )}
                                onClick={() => void model.toggleMark(summary)}
                            />
                            <SessionMoreMenu
                                projectDirectory={projectDirectory}
                                sessionFilePath={sessionFilePath}
                                sessionId={summary.id}
                                sessionKey={summary.key}
                                restoreCommand={restoreCommandForSession(summary)}
                                onRename={summary.key ? startRename : undefined}
                                onEditNote={() => setNoteEditorOpen(true)}
                                onResume={() => void model.restoreSession(summary)}
                                onRefresh={() => void requestDetailDelta("manual")}
                                onOpenProjectDirectory={() => void model.openProjectDirectory(summary)}
                                onOpenSessionFile={() => void model.openSessionFile(summary)}
                                onDelete={() => setDeleteConfirmOpen(true)}
                                onGenerate={(kind) => {
                                    if (summary.key == null || summary.key === "") return;
                                    void autoGenerate(genService, {
                                        ids: [summary.key],
                                        connection,
                                        kind,
                                    });
                                }}
                                restoring={restoring}
                                refreshing={refreshing}
                                deleting={deleting}
                                buildMarkdown={() =>
                                    buildSessionMarkdown(
                                        summary.title || summary.id,
                                        summary.source,
                                        summary.id,
                                        detailMessages,
                                        toolCalls
                                    )
                                }
                            />
                        </div>
                    </>
                ) : (
                    <>
                        <div className="min-w-0 flex-1 truncate text-sm font-medium text-primary">New Chat</div>
                        <span className="inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-full border border-border px-2 text-[11px] text-secondary">
                            <span className={cn("h-1.5 w-1.5 rounded-full", sourceDotClass(composeSource))} />
                            {getChatSource(composeSource).label}
                        </span>
                    </>
                )}
            </div>
            {annotationError ? (
                <div className="flex shrink-0 items-center gap-2 border-b border-warning/40 bg-warning/10 px-3 py-1 text-[11px] text-warning">
                    <span className="min-w-0 flex-1 truncate">Annotation AI: {annotationError}</span>
                    <button
                        type="button"
                        className="shrink-0 cursor-pointer rounded px-1.5 py-0.5 hover:bg-warning/10"
                        onClick={() => setAnnotationError("")}
                    >
                        Dismiss
                    </button>
                </div>
            ) : null}
            <div className="relative min-h-0 flex-1">
                <div className="flex h-full min-h-0">
                    <AnnotationRail
                        annotations={annotations}
                        onJump={jumpToAnnotationSeq}
                        activeSeq={activeAnnotationSeq}
                        previewBySeq={annotationPreviewBySeq}
                        onGenerateTimeline={() => void generateAnnotationTimeline()}
                        generating={timelineGenerating}
                        onAccept={(id) => void bulkDrafts("accept", [id])}
                        onDiscard={(id) => void bulkDrafts("discard", [id])}
                        onAcceptAllDrafts={() => void bulkDrafts("accept")}
                        onDiscardAllDrafts={() => void bulkDrafts("discard")}
                    />
                    <div className="relative flex min-w-0 flex-1 flex-col">
                        {/* 搜索浮层：头栏下方居中弹出（对齐原型 srch-pop） */}
                        <div
                            className={cn(
                                "absolute left-1/2 top-1.5 z-30 w-[min(520px,90%)] -translate-x-1/2 rounded-xl border border-border bg-modalbg p-2 shadow-2xl",
                                !searchExpanded && "hidden"
                            )}
                        >
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
                            </div>
                        </div>
                        <div className="relative min-h-0 flex-1">
                            <SessionOutlineRail
                                prompts={outlinePrompts}
                                activeSeq={activeOutlineSeq}
                                onJump={jumpToMessage}
                            />
                            <div
                                ref={detailScrollRef}
                                className="h-full min-h-0 overflow-auto p-3 pb-10"
                                onScroll={handleDetailScroll}
                                onPointerDown={handleCopyRangePointerDown}
                                onPointerMove={handleCopyRangePointerMove}
                            >
                                {detailMessages.length === 0 && liveTurn == null ? (
                                    isNewChat ? (
                                        <div className="px-1 py-10">
                                            <div className="text-sm font-medium text-primary">
                                                Start a new conversation
                                            </div>
                                            <div className="mt-1 text-xs leading-5 text-secondary">
                                                After you send the first message, pi creates a session automatically; it
                                                will appear in the list on the left.
                                            </div>
                                        </div>
                                    ) : loading || deltaLoading ? (
                                        <SessionDetailSkeleton />
                                    ) : (
                                        <EmptyState text="No readable messages." />
                                    )
                                ) : (
                                    <div>
                                        {virtualEnabled ? (
                                            <div
                                                style={{
                                                    height: virtualizer.getTotalSize(),
                                                    position: "relative",
                                                    width: "100%",
                                                }}
                                                data-testid="aisessions-virtual-timeline"
                                            >
                                                {virtualItems.map((virtualItem) => {
                                                    const item = renderItems[virtualItem.index];
                                                    if (item == null) return null;
                                                    return (
                                                        <div
                                                            key={virtualItem.key}
                                                            data-index={virtualItem.index}
                                                            ref={virtualizer.measureElement}
                                                            style={{
                                                                position: "absolute",
                                                                top: 0,
                                                                left: 0,
                                                                width: "100%",
                                                                transform: `translateY(${virtualItem.start}px)`,
                                                            }}
                                                        >
                                                            {renderTimelineItem(item, virtualItem.index, renderItems)}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        ) : (
                                            renderItems.map((item, itemIdx) => (
                                                <Fragment key={timelineItemKey(item, itemIdx)}>
                                                    {renderTimelineItem(item, itemIdx, renderItems)}
                                                </Fragment>
                                            ))
                                        )}
                                        {liveTurn != null &&
                                        (activeChatStreamStatus === "sending" ||
                                            activeChatStreamStatus === "streaming") ? (
                                            <div
                                                className="flex items-center gap-1.5 px-1 py-1 text-xs text-accent"
                                                role="status"
                                                aria-live="polite"
                                            >
                                                <i className="fa-sharp fa-solid fa-spinner animate-spin text-[11px]" />
                                                <span>Working</span>
                                            </div>
                                        ) : null}
                                        {/* 实时 turn 错误 UI：重试/继续（正文与工具已并入上方 renderItems 统一渲染） */}
                                        {liveTurn?.error ? (
                                            <div className="mt-2 flex flex-col gap-1.5 rounded-xl border border-error/25 bg-error/10 px-3.5 py-2.5">
                                                <div className="flex items-center gap-1.5 text-xs font-medium text-error">
                                                    <i className="fa-sharp fa-solid fa-triangle-exclamation text-[11px]" />
                                                    <span>出错了</span>
                                                </div>
                                                <div className="whitespace-pre-wrap break-words text-xs leading-5 text-primary">
                                                    {liveTurn.error.message}
                                                </div>
                                                <div className="flex items-center gap-2 pt-0.5">
                                                    <button
                                                        type="button"
                                                        className="flex items-center gap-1 rounded-lg border border-border bg-surface px-2.5 py-1 text-xs text-secondary hover:bg-hover hover:text-primary"
                                                        onClick={() => {
                                                            clearLiveTurn(activeLiveTurnKey);
                                                            handleChatSend({
                                                                source: summary?.source ?? composeSource,
                                                                sessionId: summary?.id ?? boundSessionId ?? undefined,
                                                                projectPath: summary?.projectPath ?? projectPath,
                                                                message: "",
                                                            });
                                                        }}
                                                    >
                                                        <i className="fa-sharp fa-solid fa-forward text-[10px]" />
                                                        <span>继续</span>
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="flex items-center gap-1 rounded-lg border border-border bg-surface px-2.5 py-1 text-xs text-secondary hover:bg-hover hover:text-primary"
                                                        onClick={() => {
                                                            const lastUserMsg = [...(effectiveDetail?.messages ?? [])]
                                                                .reverse()
                                                                .find((m) => m.role === "user");
                                                            if (lastUserMsg) {
                                                                clearLiveTurn(activeLiveTurnKey);
                                                                abortChatStream(activeLiveTurnKey);
                                                                handleChatSend({
                                                                    source: summary?.source ?? composeSource,
                                                                    sessionId:
                                                                        summary?.id ?? boundSessionId ?? undefined,
                                                                    projectPath: summary?.projectPath ?? projectPath,
                                                                    message: lastUserMsg.text,
                                                                });
                                                            }
                                                        }}
                                                    >
                                                        <i className="fa-sharp fa-solid fa-rotate-right text-[10px]" />
                                                        <span>重试</span>
                                                    </button>
                                                </div>
                                            </div>
                                        ) : null}
                                    </div>
                                )}
                            </div>
                            <ScrollToBottomButton
                                isAtBottom={!showJumpPill || deltaLoading}
                                onClick={() => {
                                    const node = detailScrollRef.current;
                                    if (node != null) node.scrollTop = node.scrollHeight;
                                    setShowJumpPill(false);
                                }}
                            />
                        </div>
                        {summary != null &&
                        summary.id != null &&
                        isSourceAvailable(summary.source, availableChatSources) ? (
                            <ChatComposer
                                key={`composer-${summary.id}`}
                                source={summary.source}
                                sessionId={summary.id}
                                availableSources={availableChatSources}
                                projectPath={summary.projectPath?.trim() || projectPath}
                                connection={connection}
                                canChangeDirectory={canChangeDirectory}
                                onChangeDirectory={onChangeDirectory}
                                streamStatus={activeChatStreamStatus}
                                queuedCount={queueSnap.queuedCount}
                                queueHighCount={queueSnap.highCount}
                                queueActive={queueSnap.active}
                                queueItems={queueSnap.items}
                                onSend={handleChatSend}
                                onQueue={handleChatQueue}
                                onAbort={handleChatAbort}
                                onQueueCancel={(id) => queueStoreRef.current.cancel(id)}
                                onQueuePromote={(id) => queueStoreRef.current.promote(id)}
                                onQueueReorder={(id, idx) => queueStoreRef.current.reorder(id, idx)}
                                contextUsagePercent={contextUsagePercent}
                                usage={chatUsage}
                            />
                        ) : isNewChat ? (
                            <ChatComposer
                                key={`composer-new-${newChatEpoch}`}
                                source={composeSource}
                                sessionId=""
                                availableSources={availableChatSources}
                                projectPath={projectPath ?? summary?.projectPath}
                                connection={connection}
                                canChangeDirectory={canChangeDirectory}
                                onChangeDirectory={onChangeDirectory}
                                onSourceChange={setComposeSource}
                                streamStatus={activeChatStreamStatus}
                                queuedCount={queueSnap.queuedCount}
                                queueHighCount={queueSnap.highCount}
                                queueActive={queueSnap.active}
                                queueItems={queueSnap.items}
                                onSend={handleChatSend}
                                onQueue={handleChatQueue}
                                onAbort={handleChatAbort}
                                onQueueCancel={(id) => queueStoreRef.current.cancel(id)}
                                onQueuePromote={(id) => queueStoreRef.current.promote(id)}
                                onQueueReorder={(id, idx) => queueStoreRef.current.reorder(id, idx)}
                            />
                        ) : null}
                    </div>
                </div>
            </div>
            {noteEditorOpen && summary != null ? (
                <Modal
                    className="w-[520px] max-w-[calc(100vw-32px)]"
                    onClose={closeNoteEditor}
                    onClickBackdrop={closeNoteEditor}
                >
                    <div className="space-y-3 text-primary">
                        <div className="space-y-1 pr-8">
                            <div className="flex items-center gap-2">
                                <div className="text-base font-semibold">Session Note</div>
                                <NoteAIButton status={noteAI.status} onGenerate={() => void noteAI.generate()} />
                            </div>
                            <div className="truncate text-xs text-secondary">{summary.title || summary.id}</div>
                        </div>
                        <NoteAISuggestionBar
                            suggestion={noteAI.suggestion}
                            status={noteAI.status}
                            error={noteAI.error}
                            configError={noteAI.configError}
                            onApply={applyNoteAISuggestion}
                            onRegenerate={() => void noteAI.generate()}
                            onDismiss={noteAI.dismiss}
                            onOpenSettings={noteAI.openAISettings}
                        />
                        <SessionTagChips tags={nextTags} />
                        <textarea
                            autoFocus
                            className="min-h-[140px] w-full resize-none rounded border border-border bg-transparent px-3 py-2 text-sm outline-none focus:border-accent"
                            placeholder="Add a note, use #tag to add tags"
                            value={noteDraft}
                            onChange={(event) => {
                                latestNoteDraftRef.current = event.target.value;
                                setNoteDraft(event.target.value);
                                if (noteSaveStatus !== "saving") setNoteSaveStatus("idle");
                            }}
                            onBlur={() => {
                                if (!noteUnchanged && !noteSaving) void saveNote(trimmedNoteDraft);
                            }}
                        />
                        <div className="flex items-center justify-between gap-3">
                            <span
                                className={cn(
                                    "min-w-[72px] text-xs text-secondary",
                                    noteSaveStatus === "saved" && "text-accent",
                                    noteSaveStatus === "error" && "text-error"
                                )}
                                aria-live="polite"
                            >
                                {noteStatusText}
                            </span>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    className="h-8 rounded border border-border px-3 text-xs text-secondary hover:bg-hover hover:text-primary disabled:opacity-60"
                                    disabled={noteSaving || (!summary.note && noteDraft.trim() === "")}
                                    onClick={() => {
                                        latestNoteDraftRef.current = "";
                                        setNoteDraft("");
                                        void saveNote("");
                                    }}
                                >
                                    Clear
                                </button>
                                <button
                                    type="button"
                                    className="h-8 rounded border border-border px-3 text-xs text-secondary hover:bg-hover hover:text-primary disabled:opacity-60"
                                    disabled={noteSaving}
                                    onClick={closeNoteEditor}
                                >
                                    Close
                                </button>
                            </div>
                        </div>
                    </div>
                </Modal>
            ) : null}
            {annotationEditor != null && summaryKey !== "" ? (
                <AnnotationEditor
                    sessionKey={summaryKey}
                    connection={connection || undefined}
                    seq={annotationEditor.seq}
                    anchorKey={annotationEditor.anchorKey}
                    annotation={annotationEditor.annotation ?? null}
                    onClose={() => setAnnotationEditor(null)}
                    onSaved={() => void reloadAnnotations()}
                />
            ) : null}
            {deleteConfirmOpen && summary != null ? (
                <Modal
                    className="w-[440px] max-w-[calc(100vw-32px)]"
                    onClose={() => setDeleteConfirmOpen(false)}
                    onClickBackdrop={() => setDeleteConfirmOpen(false)}
                >
                    <div className="space-y-4 text-primary">
                        <div className="space-y-1 pr-8">
                            <div className="text-base font-semibold">Delete session?</div>
                            <div className="text-sm leading-5 text-secondary">
                                The source file will be moved to deleted storage.
                            </div>
                        </div>
                        <div className="flex justify-end gap-2">
                            <button
                                type="button"
                                className="h-8 rounded border border-border px-3 text-xs text-secondary hover:bg-hover hover:text-primary"
                                disabled={deleting}
                                onClick={() => setDeleteConfirmOpen(false)}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="flex h-8 items-center gap-2 rounded bg-error px-3 text-xs text-white disabled:opacity-60"
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
                </Modal>
            ) : null}
        </div>
    );
}
