// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Modal } from "@/app/modals/modal";
import { ScrollToBottomButton } from "@/app/element/scroll-to-bottom-button";
import { cn } from "@/util/util";
import { getWebServerEndpoint } from "@/util/endpoints";
import { type KeyboardEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { CopyIconButton, IconButton } from "./controls";
import { EmptyState } from "./empty-state";
import { MessageCard, ToolCallRow } from "./session-message";
import { SessionTagChips } from "./session-tag-chips";
import { NoteAutoSaveDelayMs, shouldAutoSaveNote } from "./session-note-autosave";
import {
    extractSessionTagsFromNote,
    mergeSessionTags,
    removeSessionTagFromNote,
    sessionTagsEqual,
} from "./session-tags";
import { defaultVisibleMessageCount, visibleMessageCountStep } from "./types";
import { ChatComposer } from "./chat-composer";
import { defaultChatSource, getChatSource, isSourceAvailable, useChatSourceAvailability } from "./sources";
import { type ChatEvent, type ChatRequestBody, useChatStreams } from "./use-chat-stream";
import { LiveTurnBlock, useLiveTurns } from "./use-live-turn";
import { SessionMoreMenu, buildSessionMarkdown } from "./session-menu";
import { SessionOutlineRail, useActiveOutlineSeq, type OutlinePrompt } from "./session-outline-rail";

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
    loadDetail: (session: SessionSummary, refresh?: boolean) => Promise<void>;
    loadDetailDelta?: (reason?: "manual" | "bottom") => Promise<boolean>;
    loadDetailTools: (refresh?: boolean) => Promise<boolean>;
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
}: {
    toolCall: ToolCall;
    expanded: boolean;
    onToggle: () => void;
}) {
    const detailText = toolCallDetailText(toolCall);
    const hasError = Boolean(toolCall.exitCode);
    return (
        // 与流式 live 工具行共用 ToolCallRow，保证 turn_end 交接时外观/交互一致
        <ToolCallRow
            name={toolCall.name || "tool"}
            preview={formatToolCallPreview(toolCall)}
            status={hasError ? "failed" : "completed"}
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
    onClose,
    onExpandSessionList,
    onBound,
    onRunningSessionIdsChange,
    isNewChat = false,
    newChatEpoch = 0,
}: {
    model: SessionDetailController;
    detail: SessionDetail | null;
    isNewChat?: boolean;
    loading: boolean;
    deltaLoading?: boolean;
    toolCallsLoading: boolean;
    restoring: boolean;
    deleting: boolean;
    onClose?: () => void;
    /** 会话列表收起时，头栏行首展示「展开列表」按钮（左右同行，非悬浮叠加） */
    onExpandSessionList?: () => void;
    /** 新会话收到真实 session id 后据此绑定占位 session（由 aisessions.tsx 传入） */
    onBound?: (sessionId: string) => void;
    onRunningSessionIdsChange?: (sessionIds: ReadonlySet<string>) => void;
    /** 每开启一轮新 New Chat 自增：作废上一轮的绑定/草稿/迟到流 */
    newChatEpoch?: number;
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
    // 新会话（detail == null）使用的 agent 选择；绑定后由后端按所选 source 落地。
    const [composeSource, setComposeSource] = useState<string>(() => defaultChatSource().id);
    // 新会话首条消息流式期间暂存后端回派的 sessionId。
    const boundRef = useRef("");
    // 绑定发生时所处的 New Chat 世代：新一轮 New Chat 会作废旧绑定（防跨轮残留）
    const boundEpochRef = useRef(-1);
    const newChatTurnRef = useRef(false);
    const [newChatTurnFinished, setNewChatTurnFinished] = useState(false);
    const wasNewChatRef = useRef(false);
    // 搜索工具栏（第二行）默认隐藏，点 🔍 展开
    const [searchExpanded, setSearchExpanded] = useState(false);
    // 上滚离开底部时浮出「跳到最新」胶囊（流式吸底/回到底部则收起）
    const [showJumpPill, setShowJumpPill] = useState(false);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [visibleMessageCount, setVisibleMessageCount] = useState(defaultVisibleMessageCount);
    const [expandedToolCalls, setExpandedToolCalls] = useState<Record<number, boolean>>({});
    const [detailSearchQuery, setDetailSearchQuery] = useState("");
    const [activeSearchSeq, setActiveSearchSeq] = useState<number | null>(null);
    const messageRefs = useRef<Record<number, HTMLDivElement | null>>({});
    const detailScrollRef = useRef<HTMLDivElement | null>(null);
    const pendingJumpSeqRef = useRef<number | null>(null);
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
    const parsedNoteDraft = extractSessionTagsFromNote(noteDraft);
    const nextTags = mergeSessionTags(summary?.tags ?? [], parsedNoteDraft.tags);
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
        pendingJumpSeqRef.current = null;
        bottomDeltaRequestedRef.current = false;
        if (bottomDeltaTimerRef.current != null) {
            window.clearTimeout(bottomDeltaTimerRef.current);
            bottomDeltaTimerRef.current = null;
        }
        setDeleteConfirmOpen(false);
        setNoteEditorOpen(false);
        setNoteSaveStatus("idle");
        setExpandedToolCalls({});
        setVisibleMessageCount(defaultVisibleMessageCount);
        setDetailSearchQuery("");
        setActiveSearchSeq(null);
        // 切 session 时重置「自动滚到底已执行」标志，让新 session 重新滚到底
        autoScrolledToBottomRef.current = false;
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
    const detailMessages = useMemo(
        () => readableMessages.slice(-visibleMessageCount),
        [readableMessages, visibleMessageCount]
    );
    const timelineItems = useMemo(
        () => buildSessionDetailTimeline(effectiveDetail?.messages ?? [], detailMessages, effectiveDetail?.toolCalls, true),
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
    const activeOutlineSeq = useActiveOutlineSeq(detailScrollRef, outlinePrompts);
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
    const hasPreviousMessages = visibleMessageCount < readableMessages.length;
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

    // 实时流式 turn（主消息区内联渲染）：assistant_delta/tool 事件累积，turn_end 后由
    // DetailDelta 正式数据替换（先刷新落地再清除，避免空窗闪烁）。
    const {
        liveTurns,
        startLiveTurn,
        handleChatEvent: handleLiveTurnEvent,
        clearLiveTurn,
        moveLiveTurn,
        flushLiveTurn,
    } = useLiveTurns();
    const {
        statuses: chatStreamStatuses,
        send: sendChatStream,
        steer: steerChatStream,
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

    // 交接保护：turn_end 后先确认正式 assistant 消息已落盘，再清除 live 临时块。
    // 否则后端持久化滞后时会出现「回应显示后内容消失」的空窗（见 use-live-turn.tsx 顶部注释）。
    // ponytail: 轮询限 4s，超时则保留 live 副本——绝不擦除未确认内容。
    const clearLiveTurnWhenPersisted = useCallback(
        async (key: string) => {
            if (key === "") return;
            // 先抓取本 turn 的 seq 基线（live 块被清后就读不到了）
            const seqFloor = liveTurnsRef.current[key]?.userMessageSeqFloor ?? 0;
            const hasLanded = () =>
                (detailRef.current?.messages ?? []).some(
                    (m) => m.role === "assistant" && (m.seq ?? 0) > seqFloor
                );
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
    useEffect(() => {
        const sessionId = boundRef.current;
        if (newChatTurnRef.current && newChatTurnFinished && detail?.summary?.id === sessionId) {
            void (async () => {
                await model.loadDetailTools(true);
                await clearLiveTurnWhenPersisted(sessionId);
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
                flushLiveTurn(key);
                turnIdBySessionRef.current.delete(key);
                if (newChatTurnRef.current) {
                    setNewChatTurnFinished(true);
                    return;
                }
                if (activeSessionIdRef.current === key) {
                    void (async () => {
                        await model.loadDetailTools(true);
                        await clearLiveTurnWhenPersisted(key);
                    })();
                } else {
                    // 非激活会话：直接清临时块，正式内容切回时由详情加载补齐
                    clearLiveTurn(key);
                }
                return;
            }
            handleLiveTurnEvent(key, evt);
        },
        [clearLiveTurn, clearLiveTurnWhenPersisted, flushLiveTurn, handleLiveTurnEvent, isNewChat, model, moveChatStream, moveLiveTurn, onBound]
    );

    const handleChatSend = useCallback(
        (body: ChatRequestBody) => {
            const key = summary?.id || boundSessionId || NewChatLiveTurnKey;
            streamEpochRef.current.set(key, epochRef.current);
            const messageSeqFloor = (effectiveDetail?.messages ?? []).reduce(
                (maxSeq, message) => Math.max(maxSeq, message.seq),
                0
            );
            turnIdBySessionRef.current.delete(key);
            flushSync(() => startLiveTurn(key, body.message ?? "", messageSeqFloor));
            sendChatStream(key, chatEndpoint, body, handleChatEvent);
        },
        [chatEndpoint, effectiveDetail?.messages, handleChatEvent, sendChatStream, startLiveTurn, summary?.id]
    );

    const handleChatSteer = useCallback(
        (body: ChatRequestBody) => steerChatStream(chatEndpoint, body),
        [chatEndpoint, steerChatStream]
    );

    const handleChatAbort = useCallback(() => {
        abortChatStream(activeLiveTurnKey);
        handleChatEvent({ type: "turn_end" }, activeLiveTurnKey);
    }, [abortChatStream, activeLiveTurnKey, handleChatEvent]);

    const handleDetailScroll = useCallback(() => {
        const node = detailScrollRef.current;
        if (node != null) {
            nearBottomRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 120;
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
        const pendingSeq = pendingJumpSeqRef.current;
        if (pendingSeq == null || !messageRefs.current[pendingSeq]) return;
        pendingJumpSeqRef.current = null;
        window.requestAnimationFrame(() => scrollToVisibleMessage(pendingSeq, "smooth"));
    }, [detailMessages, scrollToVisibleMessage]);

    // 打开 panel / 切换 session 后：仅在内容超出一屏时才置底（ponytail: 否则短对话应从顶部开始）
    useLayoutEffect(() => {
        if (autoScrolledToBottomRef.current) return;
        if (lastVisibleMessage == null) return;
        if (!messageRefs.current[lastVisibleMessage.seq]) return;
        autoScrolledToBottomRef.current = true;
        const container = detailScrollRef.current;
        if (!container) return;
        // 内容未溢出视图时保持顶部对齐（首个消息从顶部开始）
        if (container.scrollHeight > container.clientHeight) {
            container.scrollTop = container.scrollHeight;
        }
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

    if (detail == null && !isNewChat) {
        return (
            <div className="flex min-h-0 flex-1 items-center justify-center">
                {loading && liveTurn == null ? (
                    <i
                        className="fa-sharp fa-solid fa-spinner animate-spin text-sm text-accent"
                        role="status"
                        aria-label="Loading conversation"
                    />
                ) : null}
            </div>
        );
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
                                restoreCommand={restoreCommandForSession(summary)}
                                onRename={summary.key ? startRename : undefined}
                                onEditNote={() => setNoteEditorOpen(true)}
                                onResume={() => void model.restoreSession(summary)}
                                onRefresh={() => void requestDetailDelta("manual")}
                                onOpenProjectDirectory={() => void model.openProjectDirectory(summary)}
                                onOpenSessionFile={() => void model.openSessionFile(summary)}
                                onDelete={() => setDeleteConfirmOpen(true)}
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
            <div className="relative min-h-0 flex-1">
                <div className="flex h-full min-h-0">
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
                            <SessionOutlineRail prompts={outlinePrompts} activeSeq={activeOutlineSeq} onJump={jumpToMessage} />
                            <div
                                ref={detailScrollRef}
                                className="h-full min-h-0 overflow-auto p-3 pb-10"
                                onScroll={handleDetailScroll}
                            >
                                {detailMessages.length === 0 && liveTurn == null ? (
                                    isNewChat ? (
                                        <div className="px-1 py-10">
                                            <div className="text-sm font-medium text-primary">Start a new conversation</div>
                                            <div className="mt-1 text-xs leading-5 text-secondary">
                                                After you send the first message, pi creates a session automatically; it will appear in the list on the left.
                                            </div>
                                        </div>
                                    ) : (
                                        <EmptyState text="No readable messages." />
                                    )
                                ) : (
                                    <div>
                                        <div className="flex items-center justify-end gap-2 text-xs text-secondary">
                                            {effectiveDetail != null && hasPreviousMessages ? (
                                                <button
                                                    className="h-7 rounded border border-border px-2 text-xs text-secondary hover:bg-hover hover:text-primary"
                                                    onClick={loadPreviousMessages}
                                                >
                                                    Load more
                                                </button>
                                            ) : null}
                                        </div>
                                        {timelineItems.map((item, itemIdx) => {
                                            const prevItem = itemIdx > 0 ? timelineItems[itemIdx - 1] : null;
                                            const isGroupStart =
                                                item.kind !== "message" ||
                                                prevItem == null ||
                                                prevItem.kind !== "message" ||
                                                prevItem.message.role !== item.message.role;
                                            return item.kind === "message" ? (
                                                <MessageCard
                                                    key={`message-${item.message.seq}`}
                                                    message={item.message}
                                                    searchQuery={detailSearchQuery}
                                                    searchActive={item.message.seq === activeSearchSeq}
                                                    groupStart={isGroupStart}
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
                                            );
                                        })}
                                        {/* 实时流式块：当前 turn 的临时渲染，turn_end 后由正式数据替换 */}
                                        {liveTurn != null ? (
                                            <LiveTurnBlock turn={liveTurn} userMessagePersisted={liveUserMessagePersisted} />
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
                        {summary != null && summary.id != null && isSourceAvailable(summary.source, availableChatSources) ? (
                            <ChatComposer
                                key={`composer-${summary.id}`}
                                source={summary.source}
                                sessionId={summary.id}
                                availableSources={availableChatSources}
                                projectPath={summary.projectPath}
                                streamStatus={activeChatStreamStatus}
                                onSend={handleChatSend}
                                onSteer={handleChatSteer}
                                onAbort={handleChatAbort}
                            />
                        ) : isNewChat ? (
                            <ChatComposer
                                key={`composer-new-${newChatEpoch}`}
                                source={composeSource}
                                sessionId=""
                                availableSources={availableChatSources}
                                onSourceChange={setComposeSource}
                                streamStatus={activeChatStreamStatus}
                                onSend={handleChatSend}
                                onSteer={handleChatSteer}
                                onAbort={handleChatAbort}
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
                            <div className="text-base font-semibold">Session Note</div>
                            <div className="truncate text-xs text-secondary">{summary.title || summary.id}</div>
                        </div>
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
                                <i className={cn("fa-sharp fa-solid", deleting ? "fa-spinner animate-spin" : "fa-trash")} />
                                <span>{deleting ? "Deleting..." : "Delete"}</span>
                            </button>
                        </div>
                    </div>
                </Modal>
            ) : null}
        </div>
    );
}
