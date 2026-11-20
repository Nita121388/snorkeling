// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { globalStore, WOS } from "@/store/global";
import { ScrollToBottomButton } from "@/app/element/scroll-to-bottom-button";
import { Modal } from "@/app/modals/modal";
import { AISessionsServiceType } from "@/app/store/services";
import {
    type OutlinePrompt,
    SessionOutlineRail,
    useActiveMessageSeq,
    useActiveOutlineSeq,
} from "@/app/view/session-outline-rail";
import { getWebServerEndpoint } from "@/util/endpoints";
import { i18n } from "@/i18n/config";
import { cn } from "@/util/util";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
    Fragment,
    type KeyboardEvent,
    type ReactNode,
    memo,
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { flushSync } from "react-dom";
import { useTranslation } from "react-i18next";
import { autoGenerate } from "./aisession-gen-store";
import { replaceAnnotationDrafts, requestAnnotationDrafts } from "./annotation-assist";
import { AnnotationEditor } from "./annotation-editor";
import {
    applyPrependAnchor,
    computeGutterMarkers,
    createSeqTimestampOf,
    gutterMarkersEqual,
    type PrependAnchorSnapshot,
} from "./annotation-markers";
import {
    AnnotationFlashMs,
    type AnnotationLike,
    type MessagePage,
    annotationCountBySeq,
    annotationKindMeta,
    buildAnnotationAnchors,
    pageIndexOfSeq,
    seqFromSyntheticAnchorKey,
    UnknownBucketKey,
} from "./annotation-model";
import {
    bucketHeaderAbsoluteLabel,
    dateKeyOfTimestamp,
    filterTimelineItemsToPage,
    insertBucketHeaders,
    relativeOfDateKey,
} from "./annotation-flow-rows";
import { AnnotationRail, type AnnotationGutterMarker } from "./annotation-rail";
import {
    AnnotationPagerBar,
    AnnotationViewChip,
    type PageModeStorage,
    usePageModeState,
} from "./annotation-pager";
import {
    bulkDraftAnnotations,
    loadOlderAnnotations,
    reloadAnnotationsWithAnchors,
    saveAnnotationNodeText,
    useAnnotationWindow,
    useSessionAnnotations,
} from "./annotation-store";
import { ChatComposer } from "./chat-composer";
import { CopyIconButton, IconButton } from "./controls";
import { EmptyState } from "./empty-state";
import { toolGroupDurationMs } from "./fold-duration";
import { GenActionButton } from "./gen-action-button";
import { MessageQueueStore, useMessageQueueStore } from "./message-queue-store";
import { NoteAIButton, NoteAISuggestionBar, useNoteAIGenerate } from "./note-ai-controls";
import { useSessionOpenEntry } from "./open-sessions-store";
import { normalizeDetailOrigin, openAISessionDetailFromList } from "./session-detail-block";
import {
    PageModeMetaKey,
    buildPageModeMeta,
    parsePageModeMeta,
    recallPageModeMap,
    rememberPageModeMap,
} from "./page-mode-persist";
import { SessionDetailSkeleton } from "./session-detail-skeleton";
import { SessionMoreMenu, buildSessionMarkdown } from "./session-menu";
import { MessageCard, ToolCallRow } from "./session-message";
import { NoteAutoSaveDelayMs, shouldAutoSaveNote } from "./session-note-autosave";
import { SessionTagChips } from "./session-tag-chips";
import {
    extractSessionTagsFromNote,
    mergeSessionTags,
    removeSessionTagFromNote,
    sessionTagsEqual,
} from "./session-tags";
import { defaultChatSource, getChatSource, isSourceAvailable, useChatSourceAvailability } from "./sources";
import { SubagentCard } from "./subagent-card";
import { isSubagentToolName, synthesizeSubagentMatch } from "./subagent-detect";
import { SubagentPlaceholderCard } from "./subagent-placeholder";
import {
    VirtualOverscan,
    activeSeqFromVirtualItems,
    buildAnchorKeyToSeq,
    buildSeqToIndex,
    buildTimelineAnnotationAnchors,
    outlineProbeOffset as computeOutlineProbeOffset,
    createRafCoalescer,
    estimateTimelineRowHeight,
    groupConsecutiveTools,
    isNearBottom,
    shouldVirtualize,
    timelineItemKey,
    type SessionDetailBucketHeader,
    type SessionFlowRow,
} from "./timeline-virtual";
import { RenameTitleInputClass } from "./title-edit";
import { TitleSourceBadge } from "./title-source-badge";
import { describeToolGroupKind } from "./tool-describe";
import { ToolGroup } from "./tool-group";
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

// 稳定的空时间线数组：liveTurn 为空时若每帧新建 []，会把下方 renderItems/rows/
// 锚点签名等一串 useMemo 全部打穿（每帧重算 + 对全部消息重算 anchorHash），
// 滚动时表现为持续的 JS 开销。
const EmptyTimelineItems: SessionDetailTimelineItem[] = [];

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
    shortSessionId,
} from "./utils";

type NoteSaveStatus = "idle" | "saving" | "saved" | "error";
const ToolCallPreviewLength = 1200;
const NewChatLiveTurnKey = "__new-chat-live-turn__";
/**
 * 实时 turn 合成行的 seq 起点（与 use-live-turn 的 LiveSeqBase 同值）。
 * 页内过滤（§4.2c）不能把正在流式的行滤掉，所以 seq ≥ 该值的行无条件保留。
 * 不在 use-live-turn 里导出是为了不扩那个模块的公开面（本包白名单外）。
 */
const PageFilterLiveSeqFloor = 10_000_000;

function sourceDotClass(source: string): string {
    return getChatSource(source).dotClass ?? "bg-secondary";
}

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
        toolCall.summary ? `${i18n.t("aisessions:liveTurn.input")}\n${toolCall.summary}` : "",
        toolCall.output ? `${i18n.t("aisessions:liveTurn.output")}\n${toolCall.output}` : "",
        toolCall.exitCode ? i18n.t("aisessions:toolCall.exitCode", { code: toolCall.exitCode }) : "",
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
    const { t } = useTranslation("aisessions");
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
                        <CopyIconButton text={detailText} label={i18n.t("common:common.copy")} size="xs" />
                    </div>
                </>
            ) : (
                <div className="text-secondary">{t("aisessions:liveTurn.noToolDetail")}</div>
            )}
        </ToolCallRow>
    );
}

/**
 * 时间线单行包装组件。
 *
 * 为什么要单独 memo：滚动时 virtualizer 每次范围变化都会重渲染整个 SessionDetailPane，
 * 旧写法直接在 map 里调 renderTimelineItem(...)，等于每帧为所有可见行重建一次元素树
 * （dev 下 jsxDEV 占滚动脚本开销的 20%+）。
 *
 * rows 数组、renderTimelineItem 回调在纯滚动时引用稳定，所以 item/index/items/render
 * 都不变 → memo 直接跳过；只有当真正影响渲染的依赖变化（搜索词、展开的工具、批注数、
 * 子代理匹配等）使 renderTimelineItem 换引用时，行才会重渲染。
 */
const TimelineRow = memo(function TimelineRow({
    item,
    index,
    items,
    render,
}: {
    item: SessionFlowRow;
    index: number;
    items: SessionFlowRow[];
    render: (item: SessionFlowRow, index: number, items: SessionFlowRow[]) => ReactNode;
}) {
    return <>{render(item, index, items)}</>;
});

/**
 * 日分段头（§4.1 / §4.2）：相对日期 chip（今天/昨天 accent）+ 绝对日期 + 计数 + 密度微条。
 *
 * sticky 选型：非虚拟化路径（行在正常流里）用 `position: sticky; top: 0`；虚拟化路径
 * 行是 `position: absolute` + translateY 的绝对定位盒，sticky 的包含块就是行自身高度、
 * 没有任何可吸顶的滚动行程 → sticky 失效，所以那时传 `sticky=false`，由消息流顶部
 * 那条常驻的「当前日」chip 承担始终可见的日期导航。
 *
 * 背景用不透明 `bg-block-solid`（不照搬 spec 的 84% 半透明）：分段头是**同一容器里的
 * 兄弟节点**，没有按日子包的 section，所以多个头会同时吸在 top:0 且完全重叠；
 * 半透明会让旧头的文字从新头背景里透出来（残影）。柔化改由底部渐隐条表达。
 */
function BucketHeaderRow({ row, sticky }: { row: SessionDetailBucketHeader; sticky: boolean }) {
    const relativeLabel =
        row.relative === "today"
            ? i18n.t("aisessions:annotationRail.today")
            : row.relative === "yesterday"
              ? i18n.t("aisessions:annotationRail.yesterday")
              : null;
    const isUnknown = row.dateKey === UnknownBucketKey;
    const absoluteLabel = isUnknown
        ? i18n.t("aisessions:annotationRail.unknownTime")
        : bucketHeaderAbsoluteLabel(row.dateKey);
    return (
        <div
            className={cn(
                "relative flex items-center gap-2 px-1.5 py-1",
                sticky && "sticky top-0 z-[5] bg-block-solid"
            )}
            aria-hidden="true"
            data-bucket-header={row.dateKey}
        >
            {/* sticky 态的底部渐隐（§4.2「实色 84% + 底部渐隐」）：盖在内容上方但永不挡指针 */}
            {sticky ? (
                <span className="pointer-events-none absolute inset-x-0 bottom-0 h-2 bg-gradient-to-b from-border/50 to-transparent" />
            ) : null}
            {relativeLabel != null ? (
                <span className="inline-flex shrink-0 items-center rounded-full bg-accent/15 px-1.5 text-[10px] font-medium leading-4 text-accent">
                    {relativeLabel}
                </span>
            ) : null}
            <span className="shrink-0 text-[11px] leading-4 text-secondary">{absoluteLabel}</span>
            <span className="h-px min-w-4 flex-1 bg-border/60" />
            <span className="flex shrink-0 items-center gap-1">
                {/* 密度微条（§4.2：4×15px 圆角 2px，kind 色）：一眼看出这天批注的类型分布 */}
                {row.kindCounts.map((entry) => {
                    const meta = annotationKindMeta(entry.kind);
                    return (
                        <span
                            key={entry.kind}
                            className="inline-block w-[4px] rounded-[2px]"
                            style={{
                                height: 15,
                                backgroundColor: meta == null ? "var(--secondary-text-color)" : `var(${meta.colorToken})`,
                            }}
                            title={meta == null ? entry.kind : i18n.t(meta.labelKey as never)}
                        />
                    );
                })}
                <span className="min-w-4 text-center text-[10px] leading-4 text-muted">{row.count}</span>
            </span>
        </div>
    );
}

/** 跨天 GapRow（§3.2 gapDaysBefore）：`… 跳过 N 天 …` 居中淡字，纯视觉。 */
function BucketGapRow({ gapDays }: { gapDays: number }) {
    return (
        <div className="flex items-center justify-center gap-2 py-1.5" aria-hidden="true" data-bucket-gap={gapDays}>
            <span className="h-px w-6 bg-border/60" />
            <span className="text-[10px] leading-4 text-muted">
                {i18n.t("aisessions:annotationFlow.gapDays", { count: gapDays })}
            </span>
            <span className="h-px w-6 bg-border/60" />
        </div>
    );
}

/**
 * 虚拟化路径的「当前日」悬浮 chip（sticky 降级，选型理由见 BucketHeaderRow 注释）。
 * 只在当前视口命中的日子**本来就有分段头**时显示（有批注锚定的日子），不凭空报日期。
 */
function BucketDayChip({ dateKey }: { dateKey: string }) {
    const relative = relativeOfDateKey(dateKey, Date.now());
    const label =
        relative === "today"
            ? i18n.t("aisessions:annotationRail.today")
            : relative === "yesterday"
              ? i18n.t("aisessions:annotationRail.yesterday")
              : bucketHeaderAbsoluteLabel(dateKey);
    return (
        <div
            className="pointer-events-none absolute left-2 top-1.5 z-10 inline-flex max-w-[45%] items-center truncate rounded-full border border-border bg-surface/85 px-2 py-0.5 text-[10px] leading-4 text-secondary backdrop-blur-sm"
            aria-hidden="true"
            data-bucket-day-chip={dateKey}
        >
            {label}
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
    const { t } = useTranslation("aisessions");
    const availableChatSources = useChatSourceAvailability();
    const [noteDraft, setNoteDraft] = useState("");
    const [noteEditorOpen, setNoteEditorOpen] = useState(false);
    const [noteError, setNoteError] = useState("");
    const pendingCloseRef = useRef(false);
    const [dirtyDismiss, setDirtyDismiss] = useState(false);
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
        anchorKeyToSeq: Map<string, number>;
        scrollToIndex: (index: number) => void;
        items: () => Array<{ index: number; start: number }>;
    } | null>(null);
    // 虚拟化下滚动高度来自 virtualizer，供 nearBottom 判定复用。
    const virtualTotalSizeRef = useRef(0);
    const detailScrollRef = useRef<HTMLDivElement | null>(null);
    // 滚动时的 rail 标记同步 + 顶部预取（定义在分页/批注窗口之后，走 ref 避开 TDZ）。
    const gutterSideEffectsRef = useRef<() => void>(() => {});
    // ── 分页跳转（§4.2c「跳到不在当前页的消息 → 先切页再定位」）──
    // jumpTo* 回调定义在 pageState 之前，经这个 ref 转发到后面基于 pageState 的实现
    //（guidelines：需要 live 数据时用 ref 转发，不为拿最新值把依赖写进 useCallback）。
    const requestJumpRef = useRef<
        (seq: number, anchorKey?: string, opts?: { flash?: boolean; behavior?: ScrollBehavior }) => void
    >(() => {});
    // 切页请求：目标 seq 不在当前页时先记下，等页内行落地后的 layout effect 再定位。
    const pendingJumpRef = useRef<{
        seq: number;
        anchorKey?: string;
        flash?: boolean;
        behavior?: ScrollBehavior;
    } | null>(null);
    // 当前视口所在消息 seq（翻页条切模式时的页脚锚点）：由渲染末尾回写，
    // pageState 只经 ref 读它（currentSeq 只在「切模式」这一条冷路径上用）。
    const scrollMessageSeqRef = useRef<number | null>(null);
    // 底部 composer 高度：rail（批注时间线）需要按它让位，避免竖轴压到输入框上。
    const [composerEl, setComposerEl] = useState<HTMLDivElement | null>(null);
    const [composerHeight, setComposerHeight] = useState(0);
    useLayoutEffect(() => {
        if (composerEl == null) {
            setComposerHeight(0);
            return;
        }
        const update = () => setComposerHeight(Math.round(composerEl.getBoundingClientRect().height));
        update();
        if (typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(update);
        observer.observe(composerEl);
        return () => observer.disconnect();
    }, [composerEl]);
    // 本 session 是否已经做过"打开时自动滚到底"（流式新消息到来不重复跟随）
    const autoScrolledToBottomRef = useRef(false);
    const bottomDeltaRequestedRef = useRef(false);
    const bottomDeltaTimerRef = useRef<number | null>(null);
    const latestNoteDraftRef = useRef("");
    const summaryKeyRef = useRef<string | null>(null);
    const summaryNoteRef = useRef("");
    // contextAttrs 引用稳定缓存：seq → {sig, attrs}；sig 不变复用旧对象引用，
    // 让 MessageCard memo 在 delta/刷新时挡住未变行。切会话时整体清空（见下方 effect）。
    const contextAttrsCacheRef = useRef(new Map<number, { sig: string; attrs: Record<string, string> }>());
    // 新建会话时屏蔽旧 detail 的竞态残留：未绑定、或绑定属上一轮 epoch 时一律隐藏；
    // 透传条件缩严为「detail 的 sessionId 恰是本轮绑定的 id」
    const effectiveDetail = (() => {
        if (!isNewChat) return detail;
        if (boundRef.current === "" || boundEpochRef.current !== newChatEpoch) return null;
        return detail?.summary?.id === boundRef.current ? detail : null;
    })();
    const summary = effectiveDetail?.summary ?? null;
    const summaryKey = summary?.key ?? "";
    // 多块打开提示：同一会话在多个块里打开时头栏显示 N（仅 N>1）。
    const openEntry = useSessionOpenEntry(summary?.id ?? "");
    const openBlockCount = openEntry == null ? 0 : 1 + openEntry.duplicateBlockIds.length;
    // Note 弹窗里的 AI 生成（提案式：填入草稿，由既有保存逻辑落盘）
    const noteAI = useNoteAIGenerate(summaryKey, connection);
    const genService = useMemo(() => new AISessionsServiceType(), []);
    // AI 建议的 tags 先暂存，保存时与 note 内 #tag、summary.tags 合并。
    const [aiTags, setAiTags] = useState<string[]>([]);
    // 本轮编辑里被 × 移除的 tag（summary.tags 里的旧 tag 需要减法，否则保存时会被合并回来）。
    const [removedTags, setRemovedTags] = useState<string[]>([]);
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
    // chips 上的 ×：同步删除正文 #tag、残留 aiTags，并记入 removedTags 把 summary.tags 里的旧 tag
    // 也一并减掉；nextTags 统一由 noteDraft + aiTags + removedTags 派生，单一事实源。
    const handleRemoveTag = useCallback(
        (tag: string) => {
            setNoteDraft((d) => removeSessionTagFromNote(d, tag));
            setAiTags((t) => t.filter((x) => x !== tag));
            setRemovedTags((r) => (r.includes(tag) ? r : [...r, tag]));
            if (noteSaveStatus !== "saving") setNoteSaveStatus("idle");
        },
        [noteSaveStatus]
    );
    const parsedNoteDraft = extractSessionTagsFromNote(noteDraft);
    const nextTags = mergeSessionTags(mergeSessionTags(summary?.tags ?? [], parsedNoteDraft.tags), aiTags).filter(
        (tag) => !removedTags.includes(tag)
    );
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
        setNoteError("");
        setDirtyDismiss(false);
        setRemovedTags([]);
        setAiTags([]);
        pendingCloseRef.current = false;
        setExpandedToolCalls({});
        setDetailSearchQuery("");
        setActiveSearchSeq(null);
        // 切 session 时重置「自动滚到底已执行」标志，让新 session 重新滚到底
        autoScrolledToBottomRef.current = false;
        // Clear any pending queue from the previous session.
        queueStoreRef.current.clearAll();
        // 切会话：旧 seq 可能复用到别的会话，清掉 contextAttrs 缓存防陈旧 attrs 泄漏。
        contextAttrsCacheRef.current.clear();
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
    const [annotationEditor, setAnnotationEditor] = useState<{
        seq: number;
        anchorKey: string;
        annotation?: AnnotationView;
    } | null>(null);
    // 只给「真正会被悬浮卡 / 编辑器读取」的 seq 做文本切片。
    // 之前对整份会话每个消息都 replace+slice，流式 delta 每帧都会 O(N) 重做；
    // 现在只处理有批注的 seq（加当前打开的编辑器 seq），扫描仍 O(N) 但不切片。
    const previewNeededSeqs = useMemo(() => {
        const seqs = new Set<number>();
        for (const annotation of annotations) seqs.add(annotation.seq);
        if (annotationEditor != null) seqs.add(annotationEditor.seq);
        return seqs;
    }, [annotations, annotationEditor]);
    const annotationPreviewBySeq = useMemo(() => {
        const map = new Map<number, string>();
        if (previewNeededSeqs.size === 0) return map;
        for (const message of detailMessages) {
            if (!previewNeededSeqs.has(message.seq)) continue;
            map.set(message.seq, message.text.replace(/^\s+|\s+$/g, "").slice(0, 240));
        }
        return map;
    }, [detailMessages, previewNeededSeqs]);
    // MessageCard 的 memo 比较器会比较 onOpenAnnotations 的**引用**。传入内联闭包会让
    // 几乎所有带 itemKey 的行 memo 失效，于是每个滚动事件/流式 delta 都会重跑
    // WaveStreamdown 解析 markdown。这里把「打开批注编辑器」做成引用稳定的回调，
    // 由 MessageCard 自己带上 seq/anchorKey 调用。annotations 走 ref 读取最新值。
    const annotationsRef = useRef(annotations);
    annotationsRef.current = annotations;
    const openAnnotationsFor = useCallback((seq: number, anchorKey: string) => {
        const existing = annotationsRef.current.find((annotation) => annotation.seq === seq);
        setAnnotationEditor({ seq, anchorKey, annotation: existing });
    }, []);
    const [activeAnnotationSeq, setActiveAnnotationSeq] = useState<number | null>(null);
    const [timelineGenerating, setTimelineGenerating] = useState(false);
    const [annotationError, setAnnotationError] = useState("");
    // annotationStatus 仅作调试/埋点用途（queued/running/done），不直接渲染。
    const [annotationStatus, setAnnotationStatus] = useState("");
    const lastVisibleMessage = detailMessages[detailMessages.length - 1];
    const detailSearchSummary =
        normalizedDetailSearchQuery === ""
            ? i18n.t("aisessions:detail.searchSummary.messages", { count: readableMessages.length })
            : detailSearchMatches.length === 0
              ? i18n.t("aisessions:detail.searchSummary.noMatches")
              : activeSearchIndex >= 0
                ? i18n.t("aisessions:detail.searchSummary.range", {
                      current: activeSearchIndex + 1,
                      total: detailSearchMatches.length,
                  })
                : i18n.t("aisessions:detail.searchSummary.matches", {
                      count: detailSearchMatches.length,
                  });

    // 批注的 seq 可能是历史脏数据（AI 草稿落库时恒为 0）。这里用 anchorKey 反推真实 seq：
    // 先按 seq 查行号，查不到再用 anchorKey→seq 兜底，避免 Jump 静默失败。
    const resolveAnnotationTargetSeq = useCallback((seq: number, anchorKey?: string): number | null => {
        // 合成锚点 seq:<n> 自带行号，直接用（缓存消息没有 ItemKey 时会走这条路）。
        const synthetic = seqFromSyntheticAnchorKey(anchorKey);
        if (synthetic != null) return synthetic;
        const virtual = virtualScrollRef.current;
        if (virtual != null && virtual.enabled) {
            if (virtual.seqToIndex.has(seq)) return seq;
            const mapped = anchorKey ? virtual.anchorKeyToSeq.get(anchorKey) : undefined;
            return mapped == null ? null : mapped;
        }
        if (messageRefs.current[seq] != null) return seq;
        const mapped = anchorKey ? virtualScrollRef.current?.anchorKeyToSeq.get(anchorKey) : undefined;
        return mapped == null ? null : mapped;
    }, []);

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

    // 实际执行跳转：滚到目标行 + （flash=true 时）高亮 1200ms。
    // 定义在 requestJump 之前（页切换逻辑经 requestJumpRef 转发到它）。
    const performJump = useCallback(
        (seq: number, _anchorKey?: string, opts?: { flash?: boolean; behavior?: ScrollBehavior }) => {
            scrollToVisibleMessage(seq, opts?.behavior ?? "smooth");
            if (opts?.flash !== true) return;
            setActiveAnnotationSeq(seq);
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

    // rail 点击 → 跳到对应消息并高亮 1200ms。
    // 非 all 模式的目标可能不在当前页：交给 requestJump 先切页再定位（§4.2c）。
    const jumpToAnnotationSeq = useCallback(
        (seq: number, anchorKey?: string) => {
            const targetSeq = resolveAnnotationTargetSeq(seq, anchorKey);
            if (targetSeq == null) return;
            requestJumpRef.current(targetSeq, anchorKey, { flash: true });
        },
        [resolveAnnotationTargetSeq]
    );

    const generateAnnotationTimeline = useCallback(async () => {
        if (summaryKey === "" || timelineGenerating) return;
        setTimelineGenerating(true);
        setAnnotationError("");
        setAnnotationStatus("queued");
        void annotationStatus;
        try {
            const drafts = await requestAnnotationDrafts({
                sessionKey: summaryKey,
                connection,
                scope: "timeline",
                maxEntries: 12,
            });
            console.log("[annotation-ai] timeline drafts", drafts);
            if (drafts.length === 0) {
                setAnnotationError(i18n.t("aisessions:assist.timelineNoDrafts"));
                return;
            }
            const inserted = await replaceAnnotationDrafts(summaryKey, connection, drafts);
            console.log("[annotation-ai] inserted drafts", inserted);
            await reloadAnnotations();
            setAnnotationStatus("done");
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.warn("[annotation-ai] generate failed", message);
            setAnnotationError(message);
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

    // 卡片 / 编辑器里的 NODE 就地编辑：只写 node_text（空串 = 清覆盖），
    // 其余字段由 saveAnnotationNodeText 原样回传，不会冲到 title/body/tags。
    const handleNodeTextSave = useCallback(
        (annotation: AnnotationLike, nodeText: string) => {
            if (summaryKey === "") return;
            void saveAnnotationNodeText(annotation, nodeText, summaryKey, connection).catch((err) =>
                setAnnotationError(err instanceof Error ? err.message : String(err))
            );
        },
        [connection, summaryKey]
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

    // 滚动提交：读滚动位置 + 一次 setState。通过 ref 让消费方拿到最新的闭包，
    // 再由 createRafCoalescer 保证一帧内最多执行一次（滚轮一次手势会抛 3~8 个事件）。
    const commitScrollStateRef = useRef<() => void>(() => {});
    const scrollCoalescer = useMemo(() => createRafCoalescer(() => commitScrollStateRef.current()), []);
    commitScrollStateRef.current = () => {
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
    };
    const handleDetailScroll = useCallback(() => {
        scrollCoalescer.schedule();
        // 标记跟内容一起动 + scrollTop 靠近顶部时预取更早一页（§4.2b / §3.8）。
        gutterSideEffectsRef.current();
    }, [scrollCoalescer]);

    useEffect(() => {
        return () => {
            scrollCoalescer.cancel();
            if (bottomDeltaTimerRef.current != null) {
                window.clearTimeout(bottomDeltaTimerRef.current);
            }
        };
    }, [scrollCoalescer]);

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
    // 只有子代理派发工具行才查折叠数据；其余工具保持原卡片。
    const subagentMatchFor = useCallback(
        (item: { toolCall: ToolCall }) =>
            isSubagentToolName(item.toolCall.name) ? subagentMatchesByKey.get(item.toolCall.itemKey ?? "") : undefined,
        [subagentMatchesByKey]
    );

    const jumpToMessage = useCallback(
        (seq: number) => {
            requestJumpRef.current(seq);
        },
        []
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
            const tags = mergeSessionTags(mergeSessionTags(summary.tags ?? [], parsed.tags), aiTags).filter(
                (tag) => !removedTags.includes(tag)
            );
            if (parsed.note === (summary.note ?? "") && sessionTagsEqual(tags, summary.tags)) {
                setNoteError("");
                setRemovedTags([]);
                if (pendingCloseRef.current) {
                    pendingCloseRef.current = false;
                    setNoteEditorOpen(false);
                }
                return true;
            }
            setNoteSaveStatus("saving");
            setNoteError("");
            const saved = await model.updateNote(summary, parsed.note, tags);
            const currentDraftSaved = extractSessionTagsFromNote(latestNoteDraftRef.current).note === parsed.note;
            if (saved && currentDraftSaved) {
                // 回写 trim 后的稳定值：消除首尾空格让 unchanged 判定抖动
                setNoteDraft(parsed.note);
                latestNoteDraftRef.current = parsed.note;
                setRemovedTags([]);
                setAiTags((t) => t.filter((x) => parsed.tags.includes(x)));
            }
            if (!saved) {
                setNoteError(i18n.t("aisessions:row.saveFailed"));
            }
            setNoteSaveStatus(saved ? (currentDraftSaved ? "saved" : "idle") : "error");
            if (pendingCloseRef.current) {
                pendingCloseRef.current = false;
                if (saved && currentDraftSaved) setNoteEditorOpen(false);
            }
            return saved && currentDraftSaved;
        },
        [model, noteSaveStatus, summary, aiTags, removedTags]
    );

    // Close 按钮：有改动则保存后关闭；saving 中不卡死，改为保存完成后自动关。
    const saveAndClose = useCallback(() => {
        if (summary == null) {
            setNoteEditorOpen(false);
            return;
        }
        if (noteUnchanged) {
            setNoteEditorOpen(false);
            return;
        }
        pendingCloseRef.current = true;
        if (noteSaving) return;
        void saveNote(trimmedNoteDraft);
    }, [noteSaving, noteUnchanged, saveNote, summary, trimmedNoteDraft]);

    // backdrop / X / ESC：无改动直接关；有改动先提示 dirty，再次触发才丢弃关闭（不静默落盘）。
    const requestDismiss = useCallback(() => {
        if (noteUnchanged || dirtyDismiss) {
            setDirtyDismiss(false);
            setNoteEditorOpen(false);
            return;
        }
        setDirtyDismiss(true);
    }, [dirtyDismiss, noteUnchanged]);

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
    //
    // 必须 useMemo：liveTurn 为空时返回稳定的 EmptyTimelineItems，否则每帧新建
    // [] 会让下方 renderItems / rows / 锚点签名全部重算，滚动时白白烧 CPU。
    const liveTimelineItems = useMemo(
        () => (liveTurn != null ? liveTurnToTimelineItems(liveTurn, liveUserMessagePersisted) : EmptyTimelineItems),
        [liveTurn, liveUserMessagePersisted]
    );
    // 子代理归位：把已匹配的 subagent 工具行从时间线里摘掉，改成发起它的那条消息的
    // 子级内容（MessageCard children）。未匹配的仍按普通工具行降级显示。
    const subagentMatchesByAnchor = useMemo(() => {
        const byAnchor = new Map<number, SubagentMatch[]>();
        for (const item of timelineItems) {
            if (item.kind !== "tool" || !isSubagentToolName(item.toolCall.name)) continue;
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
                    isSubagentToolName(item.toolCall.name) &&
                    subagentMatchesByKey.has(item.toolCall.itemKey ?? "")
                )
        );
    }, [timelineItems, liveTimelineItems, subagentMatchesByAnchor, subagentMatchesByKey]);
    // 连续工具行折叠成「工具 ×N」摘要行：只改变渲染行数与顺序，锚点仍用上面
    // raw renderItems（单条工具）计算，所以批注 / 子代理归位不受影响。
    const rows = useMemo(() => groupConsecutiveTools(renderItems), [renderItems]);
    // 折叠组时长：一条消息 timestamp → O(1) 取组内首尾锚点。建表一次、之后每组 O(1)。
    const seqTimestamps = useMemo(() => {
        const map = new Map<number, number>();
        for (const message of effectiveDetail?.messages ?? []) {
            if (message.timestamp != null && message.timestamp > 0) {
                map.set(message.seq, message.timestamp);
            }
        }
        return map;
    }, [effectiveDetail?.messages]);
    // 折叠组时长：组锚点 seq → 组内末尾工具之后最近的一条消息 seq（时长终点）。
    // 以前是「按渲染行下标」的数组（nextMessageSeqByRow）；页内过滤（§4.2c）后渲染
    // 下标不再等于全量行下标，改成按 anchorSeq 索引（每个折叠组的 anchorSeq 唯一），
    // 时长数据在全量行上算一次，页切换不重算。
    const toolGroupEndSeqByAnchor = useMemo(() => {
        const map = new Map<number, number>();
        let upcoming: number | null = null;
        for (let i = rows.length - 1; i >= 0; i--) {
            const row = rows[i];
            if (row.kind === "toolGroup") {
                map.set(row.anchorSeq, upcoming ?? row.endSeq);
                continue;
            }
            if (row.kind === "message") upcoming = row.message.seq;
        }
        return map;
    }, [rows]);
    // 本会话最长工具组时长：归一化时长条宽度，避免每次 render 重算。
    const maxToolGroupDurationMs = useMemo(() => {
        let max = 0;
        for (const row of rows) {
            if (row.kind !== "toolGroup") continue;
            const duration = toolGroupDurationMs(
                seqTimestamps,
                row.startSeq,
                toolGroupEndSeqByAnchor.get(row.anchorSeq) ?? row.endSeq
            );
            if (duration != null && duration > max) max = duration;
        }
        return max;
    }, [rows, toolGroupEndSeqByAnchor, seqTimestamps]);
    // anchorKey → seq 用**全量行**建表（页内过滤后仍能跨页解析锚点；all 模式两者等价）。
    const anchorKeyToSeq = useMemo(() => buildAnchorKeyToSeq(rows), [rows]);
    // 会话详情里的 Message 来自 SQLite 缓存，ItemKey 为空（表里没有 item_key 列），
    // 所以上面那套基于 messages 的锚点其实是空的。renderItems 里的工具行带
    // anchorSeq，是唯一能把「工具锚点 → 真实 seq」对上号的地方：等它可用后补发一次
    // 锚点，既修好 Jump，也让服务端把历史 seq=0 的批注回填成真实行号。
    const timelineAnnotationAnchors = useMemo(() => buildTimelineAnnotationAnchors(renderItems), [renderItems]);
    const timelineAnnotationAnchorSignature = useMemo(
        () => timelineAnnotationAnchors.map((anchor) => `${anchor.anchorKey}:${anchor.seq}`).join("|"),
        [timelineAnnotationAnchors]
    );
    useEffect(() => {
        if (summaryKey === "" || timelineAnnotationAnchors.length === 0) return;
        void reloadAnnotationsWithAnchors(summaryKey, connection, timelineAnnotationAnchors);
        // 用签名字符串做依赖，避免数组换引用导致的重复请求。
    }, [summaryKey, connection, timelineAnnotationAnchorSignature]);
    // ── 分页模式（主文档 §4.2c / §4.2c-1） ────────────────────────────────
    // 分页只发生在**渲染层**：页数组来自 computePages（纯函数），与数据加载（游标）无关。
    // 状态机 / 持久化在 `annotation-pager` 的 usePageModeState 里，这里只做宿主的三件事：
    //  block meta 读写通道、切页后的滚动定位（复用现有虚拟化滚动）、作用域收窄传给 rail。
    const pageModeStorage = useMemo<PageModeStorage>(() => {
        const blockId = model.blockId ?? "";
        if (blockId === "") {
            // 无 block 的宿主（modal / 独立详情）：纯内存态，功能完整但不跨重启。
            return { load: () => ({}), save: () => {} };
        }
        return {
            load: () => {
                // 内存热缓存优先（SetMetaCommand 异步，块卸载后立刻切回可能读到旧 meta）。
                const cached = recallPageModeMap(blockId);
                if (cached != null) return cached;
                const block = globalStore.get(WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId)));
                const meta = block?.meta as Record<string, unknown> | undefined;
                return parsePageModeMeta(meta?.[PageModeMetaKey]) ?? {};
            },
            save: (map) => {
                rememberPageModeMap(blockId, map);
                void RpcApi.SetMetaCommand(TabRpcClient, {
                    oref: `block:${blockId}`,
                    meta: { [PageModeMetaKey]: buildPageModeMeta(map) } as MetaType,
                });
            },
        };
    }, [model.blockId]);

    // 切页 → 滚到该页首条消息。翻页条切页 = 换行集合，行要等下一次渲染才换成新页；
    // 直接滚会拿旧页的 seqToIndex 静默失败，所以经 pendingJump 延迟到页内行落地后定位。
    const handlePageActivate = useCallback((page: MessagePage) => {
        pendingJumpRef.current = { seq: page.startSeq, behavior: "auto" };
    }, []);

    const pageState = usePageModeState({
        rows: detailMessages,
        timestamps: seqTimestamps,
        sessionKey: summaryKey,
        connection,
        storage: pageModeStorage,
        totalMessages: detailMessages.length,
        // 只用于「切模式」时的页脚对齐（冷路径）：读渲染末尾回写的 ref，不把
        // scrollMessageSeq 的派生链（虚拟化 → flowRows → pageState）绕成死循环。
        currentSeq: scrollMessageSeqRef.current,
        onPageActivate: handlePageActivate,
        // 消息窗口当前是全量加载，没有更早的消息页可补，所以翻页条在首页禁用 ‹；
        // 批注窗口的「加载更早」已由 rail 端帽（onLoadOlder → handleLoadOlder）承担。
    });
    const [pageMenuOpen, setPageMenuOpen] = useState(false);
    // 非 all 模式：rail 标记 / 悬浮卡 / 类型过滤计数 / 草稿条 / 读数 / 消息流只反映当前页（§4.2c）。
    // all 模式刻意不传（保持 v1 语义：孤儿 / 已重锚定到其他 seq 的条目也要看得见）。
    const pageScopeSeqsArg = pageState.pageMode === "all" ? undefined : pageState.pageScopeSeqs;

    // ── 页内渲染（§4.2c）：非 all 模式只保留当前页 seq 区间内的行 ──────────────
    // 过滤发生在 groupConsecutiveTools **之前**（renderItems 层）：页边界把连续工具行
    // 天然切开，不会出现「一个折叠组横跨两页」。all 模式 activePage 里 startSeq..endSeq
    // 覆盖全部消息 → 过滤返回同一引用，行为与改造前逐字节等价。
    // 实时 turn 的行 seq 从 10_000_000 起（use-live-turn 的 LiveSeqBase，永远在页区间
    // 之外）→ 强制保留，否则分页模式下发完消息内容凭空消失。
    const pageFilteredItems = useMemo(
        () =>
            filterTimelineItemsToPage(
                renderItems,
                // all 模式显式传 null：过滤函数原样返回**同一引用**，与改造前逐字节等价。
                pageState.pageMode === "all" ? null : pageState.activePage,
                { alwaysIncludeFromSeq: PageFilterLiveSeqFloor }
            ),
        [renderItems, pageState.pageMode, pageState.activePage]
    );
    const pageRows = useMemo(() => groupConsecutiveTools(pageFilteredItems), [pageFilteredItems]);
    // 消息行批注角标读数（§4.2c「读数只反映当前页」）：非 all 模式只数当前页作用域内的条目。
    const scopedAnnotationCounts = useMemo(() => {
        const scope = pageScopeSeqsArg;
        if (scope == null) return annotationCounts;
        return annotationCountBySeq(annotations.filter((annotation) => scope.has(annotation.seq)));
    }, [annotationCounts, annotations, pageScopeSeqsArg]);

    // ── gutter 行对齐标记（§4.2b）+ 端帽游标加载 + 前插锚定（§3.8） ────────────
    //
    // 数据源 = 窗口内扁平批注（`annotations`，store 快照恒按 (seq,id) 升序）；位置来源两条路径：
    //  - 虚拟化（>60 行）：`virtualizer.getVirtualItems()` 的 `item.start`，**不读 DOM rect**
    //    （滚动时逐行 layout 抖动会把动画打成掉帧，与 10-27 virtual-row-stability 同源）；
    //  - 非虚拟化（短会话，真机主路径）：`messageRefs` 的 DOM rect。
    //
    // 坐标常量（滚动容器 paddingTop / clientTop、rail 本体相对滚动容器顶部的偏移、rail 本体
    // 高度）首帧实测一次并缓存，ResizeObserver / window resize 时失效重测；每帧只读一次
    // scrollTop。标记计算走 rAF 合并 + diff：内容不变就不 setState（滚动路径性能契约）。
    const seqTsOf = useMemo(() => createSeqTimestampOf(seqTimestamps), [seqTimestamps]);
    // 窗口事实（§3.1 / §3.7）：hasMoreOlder / atEarliest / loadingOlder / olderError。
    // 条目不从这里取 —— `annotations`（useSessionAnnotations）就是同一份窗口快照的扁平视图。
    const annotationWindow = useAnnotationWindow(summaryKey, connection, seqTsOf);
    // ── 日分段头 + GapRow（§3.2 / §4.1）─────────────────────────────────
    // 数据源 = 批注窗口的时间桶：只在「有批注锚定的日子」生成（没有窗口数据时不插入，
    // flow 与现状等价）；非 all 模式只保留与当前页有交集的桶，count / 密度微条同步收窄。
    const flowRows = useMemo(
        () => insertBucketHeaders(pageRows, annotationWindow.buckets, { scopeSeqs: pageScopeSeqsArg }),
        [pageRows, annotationWindow.buckets, pageScopeSeqsArg]
    );
    const annotationWindowRef = useRef(annotationWindow);
    annotationWindowRef.current = annotationWindow;
    const pageScopeSeqsRef = useRef<Set<number> | undefined>(pageScopeSeqsArg);
    pageScopeSeqsRef.current = pageScopeSeqsArg;
    const pageModeRef = useRef(pageState.pageMode);
    pageModeRef.current = pageState.pageMode;

    // ── 虚拟化（行集合 = 页内过滤 + 日分段头之后的 flowRows）────────────────────
    // 大会话只渲染视口附近的几行，避免 5000+ 个 DOM 节点把滚动拖死；
    // 虚拟化判定与行数均取 flowRows（§4.2c：页内过滤生效后的行数）。
    const virtualEnabled = shouldVirtualize(flowRows.length);
    // seqToIndex 只映射当前渲染行（页内定位用）；跨页解析靠上面的全量 anchorKeyToSeq。
    const seqToIndex = useMemo(() => buildSeqToIndex(flowRows), [flowRows]);
    const virtualizer = useVirtualizer({
        count: flowRows.length,
        getScrollElement: () => detailScrollRef.current,
        // 按行类型估算（user 气泡 / tool 行 / assistant 段落 / 折叠组 / 分段头 / GapRow），
        // 而不是全行共用 96px：96px 对 assistant 段落误差高达 4 倍，快速滚动时未测行先按
        // 估计高度排、measureElement 下一帧才纠正，那一帧里相邻行内容会叠在一起（重影）。
        estimateSize: (index) => estimateTimelineRowHeight(flowRows[index]),
        overscan: VirtualOverscan,
        enabled: virtualEnabled,
        // offsetHeight 等价于库的默认实现，但不走 transform/滚动相关的 rect 计算路径。
        measureElement: (element) => (element as HTMLElement).offsetHeight,
    });
    const virtualItems = virtualizer.getVirtualItems();
    // 非虚拟化时 seqToIndex 不生效，但 anchorKey→seq 兜底同样要用，所以这里始终赋值。
    virtualScrollRef.current = {
        enabled: virtualEnabled,
        seqToIndex,
        anchorKeyToSeq,
        scrollToIndex: (index: number) => virtualizer.scrollToIndex(index, { align: "start" }),
        items: () => virtualizer.getVirtualItems(),
    };
    virtualTotalSizeRef.current = virtualEnabled ? virtualizer.getTotalSize() : 0;
    const timelineItemSeqs = useMemo(
        () => flowRows.map((item) => (item.kind === "message" ? item.message.seq : null)),
        [flowRows]
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
    // 批注时间线跟随滚动：探针覆盖所有可读消息（不只 user），虚拟路径复用 activeOutlineSeq。
    const readableMessageSeqs = useMemo(() => detailMessages.map((message) => message.seq), [detailMessages]);
    const fullRenderMessageSeq = useActiveMessageSeq(detailScrollRef, readableMessageSeqs, !virtualEnabled);
    const scrollMessageSeq = virtualEnabled ? activeOutlineSeq : fullRenderMessageSeq;
    scrollMessageSeqRef.current = scrollMessageSeq;

    // ── 跨页跳转（§4.2c「跳到不在当前页的消息 → 先切页再定位」）──────────────
    // 目标 seq 在当前页作用域内 → 直接跳；否则先找页切过去，把定位记到 pendingJump，
    // 等页内行落地后由下面的 layout effect 补一次（直接滚会拿旧页的 seqToIndex 静默失败）。
    const requestJump = useCallback(
        (seq: number, anchorKey?: string, opts?: { flash?: boolean; behavior?: ScrollBehavior }) => {
            const scope = pageScopeSeqsArg;
            if (scope == null || scope.has(seq)) {
                performJump(seq, anchorKey, opts);
                return;
            }
            const index = pageIndexOfSeq(pageState.pages, seq);
            // 不在任何页（live turn / 页内 seq 非连续）：直接试，不把事情挂起来。
            if (index < 0 || index === pageState.activePageIndex) {
                performJump(seq, anchorKey, opts);
                return;
            }
            pendingJumpRef.current = { seq, anchorKey, ...opts };
            pageState.goToPage(index);
        },
        [pageScopeSeqsArg, pageState.pages, pageState.activePageIndex, pageState.goToPage, performJump]
    );
    requestJumpRef.current = requestJump;

    // 每次渲染后检查一次 pendingJump（纯 ref 读，滚动路径零成本）：
    // - 目标已落入当前页作用域 → 执行定位并清掉；
    // - 目标页已不可达（切回 all / 页空间变化）→ 放弃，避免悬挂到下一次渲染。
    useLayoutEffect(() => {
        const pending = pendingJumpRef.current;
        if (pending == null) return;
        if (pageScopeSeqsArg != null && !pageScopeSeqsArg.has(pending.seq)) {
            if (pageIndexOfSeq(pageState.pages, pending.seq) < 0) pendingJumpRef.current = null;
            return;
        }
        pendingJumpRef.current = null;
        performJump(pending.seq, pending.anchorKey, { flash: pending.flash, behavior: pending.behavior });
    });

    // 虚拟化路径的「当前日」：视口探针命中的消息所在的日子（只在它有分段头即有批注锚定时才有意义）。
    const activeBucketDay = useMemo(() => {
        if (!virtualEnabled || scrollMessageSeq == null) return null;
        const ts = seqTsOf(scrollMessageSeq);
        if (ts == null || !(ts > 0)) return null;
        const dateKey = dateKeyOfTimestamp(ts);
        if (!annotationWindow.buckets.some((bucket) => bucket.dateKey === dateKey)) return null;
        return dateKey;
    }, [virtualEnabled, scrollMessageSeq, seqTsOf, annotationWindow.buckets]);

    const [gutterMarkers, setGutterMarkers] = useState<AnnotationGutterMarker[]>([]);
    const gutterMetricsRef = useRef<{
        railBodyTop: number;
        paddingBoxTop: number;
        padTop: number;
        railBodyHeight: number;
    } | null>(null);
    // 前插锚定（§3.8）：加载更早之前的滚动几何；数据落地后同一帧补偿 scrollTop。
    const pendingPrependRef = useRef<PrependAnchorSnapshot | null>(null);
    // 顶部预取：进入顶部区域（<200px）时自动预取一页，失败静默重试 1 次（§3.8）。
    // `armed` 是滞后阀：只有离开顶部（scrollTop ≥ 400px）后重新置位，
    // 否则“停在顶部”会被每次 scroll 事件当成新的一次预取 → 一路把全会话加载完。
    const olderPrefetchRef = useRef<{ armed: boolean; retried: boolean }>({ armed: true, retried: false });
    // 视口外新批注 pill（§3.6）：只计数、不自动跳转。
    const [pendingNewCount, setPendingNewCount] = useState(0);
    const seenAnnotationIdsRef = useRef<Set<number> | null>(null);
    const newestAnnotationSeqRef = useRef<number>(Number.NEGATIVE_INFINITY);

    const measureGutterMetrics = useCallback(() => {
        const scrollEl = detailScrollRef.current;
        const root = containerRef.current;
        if (scrollEl == null || root == null) return false;
        const railBody = root.querySelector<HTMLElement>(".annotation-rail-body");
        if (railBody == null) return false;
        const scrollRect = scrollEl.getBoundingClientRect();
        const railRect = railBody.getBoundingClientRect();
        const paddingBoxTop = scrollRect.top + (scrollEl.clientTop || 0);
        const padTop = Number.parseFloat(window.getComputedStyle(scrollEl).paddingTop) || 0;
        gutterMetricsRef.current = {
            // rail 本体顶边在滚动内容坐标系里的位置：布局常量（rail 与消息列同顶）。
            railBodyTop: railRect.top - paddingBoxTop,
            paddingBoxTop,
            padTop,
            railBodyHeight: railBody.clientHeight,
        };
        return true;
    }, []);

    const commitGutterMarkersRef = useRef<() => void>(() => {});
    const gutterCoalescer = useMemo(() => createRafCoalescer(() => commitGutterMarkersRef.current()), []);
    commitGutterMarkersRef.current = () => {
        const scrollEl = detailScrollRef.current;
        const root = containerRef.current;
        if (scrollEl == null || root == null) return;
        if (gutterMetricsRef.current == null && !measureGutterMetrics()) return;
        const metrics = gutterMetricsRef.current;
        if (metrics == null) return;
        const virtual = virtualScrollRef.current;
        const starts =
            virtual != null && virtual.enabled
                ? new Map(virtual.items().map((item) => [item.index, item.start] as const))
                : null;
        const scrollTop = scrollEl.scrollTop;
        const next = computeGutterMarkers(
            annotationsRef.current,
            (seq) => {
                if (virtual != null && virtual.enabled) {
                    const index = virtual.seqToIndex.get(seq);
                    if (index == null) return undefined;
                    const start = starts?.get(index);
                    return start == null ? undefined : metrics.padTop + start;
                }
                const node = messageRefs.current[seq];
                if (node == null) return undefined;
                return node.getBoundingClientRect().top - metrics.paddingBoxTop + scrollTop;
            },
            {
                scrollTop,
                railBodyTop: metrics.railBodyTop,
                railBodyHeight: metrics.railBodyHeight,
                scopeSeqs: pageScopeSeqsRef.current,
            }
        );
        setGutterMarkers((current) => (gutterMarkersEqual(current, next) ? current : next));
    };

    // 每次渲染后重排一次：覆盖「行集合 / 行高 / 批注 / 作用域」的所有变化。滚动本身另由
    // handleDetailScroll 直接 schedule（非虚拟化滚动不会引起 React 渲染）。diff 相等时不
    // setState，所以「渲染 → schedule → commit」一定收敛，不会自激循环。
    useEffect(() => {
        gutterCoalescer.schedule();
    });
    // 滚动几何 / rail 本体尺寸变化 → 失效常量缓存（折叠 rail、窗口缩放、composer 高度变化）。
    useLayoutEffect(() => {
        measureGutterMetrics();
        gutterCoalescer.schedule();
        if (typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(() => {
            if (measureGutterMetrics()) gutterCoalescer.schedule();
        });
        const scrollEl = detailScrollRef.current;
        const railBody = containerRef.current?.querySelector<HTMLElement>(".annotation-rail-body") ?? null;
        if (scrollEl != null) observer.observe(scrollEl);
        if (railBody != null) observer.observe(railBody);
        return () => observer.disconnect();
        // detailMessages 到达 / 虚拟化开关切换时容器首次真正挂载，这里需要重新挂观察器
        //（骨架屏阶段 containerRef 还是 null，观察不到任何东西）。
    }, [gutterCoalescer, measureGutterMetrics, summaryKey, virtualEnabled]);
    useEffect(() => () => gutterCoalescer.cancel(), [gutterCoalescer]);

    // 端帽「加载更早」（§3.3 游标 / §3.8 前插）：记录前插前的滚动几何，数据落地后同帧补偿。
    const handleLoadOlder = useCallback(() => {
        if (summaryKey === "") return;
        const container = detailScrollRef.current;
        if (container != null && pendingPrependRef.current == null) {
            // 虚拟化后 scrollHeight 只是已渲染窗口的高度，真实内容高度取 virtualizer 总高。
            const contentHeight = virtualTotalSizeRef.current > 0 ? virtualTotalSizeRef.current : container.scrollHeight;
            pendingPrependRef.current = { scrollHeight: contentHeight, scrollTop: container.scrollTop };
        }
        void loadOlderAnnotations(summaryKey, connection, { tsOf: seqTsOf, refSeq: scrollMessageSeq ?? undefined });
    }, [connection, scrollMessageSeq, seqTsOf, summaryKey]);

    // 前插落地 → **同一帧**补偿 scrollTop（§3.8，判据 S2：视口像素不动，误差 ≤ 1px）。
    useLayoutEffect(() => {
        const pending = pendingPrependRef.current;
        if (pending == null) return;
        const container = detailScrollRef.current;
        if (container == null) return;
        const contentHeight = virtualTotalSizeRef.current > 0 ? virtualTotalSizeRef.current : container.scrollHeight;
        const delta = contentHeight - pending.scrollHeight;
        // 还没落地（内容高度没变且仍在加载）→ 保留基线，等真正的窗口更新。
        if (delta === 0 && annotationWindow.loadingOlder) return;
        pendingPrependRef.current = null;
        // 内容高度没变（本批只有标记、没有插行）→ 绝不写 scrollTop：
        // 快照里的 scrollTop 是几帧前的值，拿它回写会把用户这几帧的滚动抹掉。
        if (delta === 0) return;
        applyPrependAnchor(container, pending, contentHeight);
    }, [annotations, annotationWindow.loadingOlder]);

    // 顶部预取（§3.8）：scrollTop < 200px 自动预取一页；失败静默重试 1 次，绝不改滚动位置。
    const prefetchOlderIfNeeded = useCallback(() => {
        const container = detailScrollRef.current;
        if (container == null) return;
        const state = olderPrefetchRef.current;
        // 滞后阀：离开顶部（≥ 400px）才重新武装，避免“停在顶部”连环预取。
        if (container.scrollTop >= 400) {
            state.armed = true;
            state.retried = false;
            return;
        }
        if (container.scrollTop >= 200) return;
        const snapshot = annotationWindowRef.current;
        if (snapshot == null || !snapshot.hasMoreOlder || snapshot.loadingOlder) return;
        if (pageModeRef.current !== "all") return; // 分页模式的补数据由翻页条承担（§4.2c）
        if (snapshot.olderError != null) {
            if (state.retried) return; // 已重试过一次：等用户点端帽
            state.retried = true;
        } else {
            if (!state.armed) return;
            state.armed = false;
            state.retried = false;
        }
        void loadOlderAnnotations(summaryKey, connection, { tsOf: seqTsOf, refSeq: scrollMessageSeq ?? undefined });
    }, [connection, scrollMessageSeq, seqTsOf, summaryKey]);

    // 滚动副作用总入口（handleDetailScroll 定义在前面，经 ref 调用这里的最新实现）。
    gutterSideEffectsRef.current = () => {
        gutterCoalescer.schedule();
        prefetchOlderIfNeeded();
        // 用户已回到底部：pill 里的新批注已经在眼前了。
        if (nearBottomRef.current) setPendingNewCount((current) => (current === 0 ? current : 0));
    };

    // 切会话：pill / 预取 / 已见集合全部重置（避免把上一会话的条目算成「新批注」）。
    useEffect(() => {
        seenAnnotationIdsRef.current = null;
        newestAnnotationSeqRef.current = Number.NEGATIVE_INFINITY;
        olderPrefetchRef.current = { armed: true, retried: false };
        setPendingNewCount(0);
    }, [summaryKey]);
    useEffect(() => {
        const seen = seenAnnotationIdsRef.current;
        const newestSeq = newestAnnotationSeqRef.current;
        const ids = new Set<number>();
        let fresh = 0;
        for (const annotation of annotations) {
            ids.add(annotation.id);
            // 只把「最新端新增」算新批注：加载更早（前插）不算。
            if (seen != null && !seen.has(annotation.id) && annotation.seq > newestSeq) fresh += 1;
        }
        seenAnnotationIdsRef.current = ids;
        if (annotations.length > 0) {
            // annotations 恒按 (seq,id) 升序，末项即最新端。
            newestAnnotationSeqRef.current = Math.max(newestSeq, annotations[annotations.length - 1].seq);
        }
        if (fresh > 0 && !nearBottomRef.current) setPendingNewCount((current) => current + fresh);
    }, [annotations]);

    // 新批注 pill 点击：跳到最新一条（normalize seq 走 anchorKey 兜底），不清滚动位置。
    // 非 all 模式下最新一条大概率不在当前页 → 走 requestJump 先切页再定位。
    const handleJumpToNew = useCallback(() => {
        setPendingNewCount(0);
        const list = annotationsRef.current;
        const latest = list[list.length - 1];
        if (latest == null) return;
        const target = resolveAnnotationTargetSeq(latest.seq, latest.anchorKey);
        requestJumpRef.current(target ?? latest.seq, latest.anchorKey);
    }, [resolveAnnotationTargetSeq]);

    // ← / → 翻页（卡片未打开、且焦点不在输入控件里时；卡片内的 ←/→ 由卡片自己处理）。
    useEffect(() => {
        if (pageState.pageMode === "all") return;
        // 注意：本文件从 react 导入了 `KeyboardEvent`（合成事件类型），会遮蔽全局 DOM 类型，
        // 所以 window 级监听器的形参要显式取 WindowEventMap 里的 DOM KeyboardEvent。
        const onPageKeyDown = (event: WindowEventMap["keydown"]) => {
            if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
            const target = event.target as HTMLElement | null;
            if (target != null) {
                const tag = target.tagName;
                if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) return;
            }
            // 悬浮卡 / 编辑器 / 分页弹层打开时让位（§4.4：卡片内 ←/→ 是上下条导航）。
            if (annotationEditor != null || pageMenuOpen) return;
            if (document.querySelector("[data-annotation-card]") != null) return;
            if (event.key === "ArrowLeft") {
                event.preventDefault();
                pageState.goPrevPage();
            } else if (event.key === "ArrowRight") {
                event.preventDefault();
                pageState.goNextPage();
            }
        };
        window.addEventListener("keydown", onPageKeyDown);
        return () => window.removeEventListener("keydown", onPageKeyDown);
    }, [pageMenuOpen, pageState.pageMode, pageState.goPrevPage, pageState.goNextPage, annotationEditor]);
    // 只允许在「实时 turn 开始 / 结束」两个边界做全量重测。
    //
    // 禁止把 liveTurn 对象本身放进依赖：useLiveTurns 每 32ms flush 一次，每次都是新对象，
    // 会让这个 effect 在流式期间以约 30 次/秒执行；而 virtualizer.measure() 会清空
    // itemSizeCache（virtual-core `measure()`），等于每秒 30 次把所有行高退回估算值，
    // 总高度塌陷 → scrollTop 被 clamp → 内容剧烈跳动 + 整页重渲染。
    //
    // 流式期间的行高变化由 measureElement 的 ResizeObserver 逐行增量处理，库会对位于
    // 视口上方的行做 scrollAdjustments 补偿，这才是我们想要的精确行为。
    const liveTurnActive = liveTurn != null;
    useEffect(() => {
        if (!virtualEnabled) return;
        virtualizer.measure();
    }, [virtualEnabled, liveTurnActive, virtualizer]);
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
        if (summary == null) {
            contextAttrsCacheRef.current.clear();
            return new Map<number, Record<string, string>>();
        }
        const cache = contextAttrsCacheRef.current;
        const next = new Map<number, Record<string, string>>();
        for (const message of detailMessages) {
            const sig = `${summary.id}|${summary.source}|${summary.title}|${summary.projectPath}|${message.model}|${message.seq}|${message.role}|${message.timestamp}|${message.entryId}|${message.itemKey}`;
            const cached = cache.get(message.seq);
            // 引用稳定：内容签名未变则复用旧对象，让 MessageCard 的 memo
            // （previous.contextAttrs === next.contextAttrs）在 delta/刷新时对未变行通过，
            // 避免每次刷新把所有行整片重渲染。
            if (cached != null && cached.sig === sig) {
                next.set(message.seq, cached.attrs);
                continue;
            }
            const attrs: Record<string, string> = {
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
            };
            cache.set(message.seq, { sig, attrs });
            next.set(message.seq, attrs);
        }
        return next;
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
        (item: SessionFlowRow, itemIdx: number, items: SessionFlowRow[]) => {
            // 日分段头 / GapRow（§4.1）：纯视觉分隔行，不参与消息渲染与搜索高亮。
            // sticky 只在非虚拟化路径生效（虚拟行是 position:absolute + translateY，
            // sticky 的包含块就是行自身高度、没有可吸顶的滚动行程）；虚拟化路径改由
            // 顶部悬浮的小 chip 常驻当前日（见下方 activeBucketDay）。
            if (item.kind === "bucketHeader") {
                return <BucketHeaderRow row={item} sticky={!virtualEnabled} />;
            }
            if (item.kind === "gapRow") {
                return <BucketGapRow gapDays={item.gapDays} />;
            }
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
                        annotationCount={scopedAnnotationCounts.get(item.message.seq) ?? 0}
                        onOpenAnnotations={openAnnotationsFor}
                        registerRef={(node) => {
                            if (node) messageRefs.current[item.message.seq] = node;
                        }}
                    >
                        {foldedSubagents != null && model.service != null
                            ? foldedSubagents.map((match) =>
                                  match.status !== "matched" && match.status !== "ambiguous" ? (
                                      <div key={match.call.itemKey ?? match.sessionKey} className="mt-1">
                                          <SubagentPlaceholderCard match={match} />
                                      </div>
                                  ) : (
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
                                                          // 子会话与父会话同 origin：不传就会回落到本机 manager。
                                                          origin: normalizeDetailOrigin(summary?.origin),
                                                      });
                                                  }
                                              }}
                                          />
                                      </div>
                                  )
                              )
                            : null}
                    </MessageCard>
                );
            }
            if (item.kind === "toolGroup") {
                const running = item.liveStatus === "running";
                // 时长终点按 anchorSeq 查（不按渲染下标：页内过滤后下标不再对齐全量行）。
                const groupEndSeq = toolGroupEndSeqByAnchor.get(item.anchorSeq) ?? item.endSeq;
                const groupDurationMs = toolGroupDurationMs(seqTimestamps, item.startSeq, groupEndSeq);
                return (
                    <ToolGroup
                        toolNames={item.tools.map((tool) => tool.name)}
                        summary={describeToolGroupKind(item.tools.map((tool) => tool.name))}
                        running={running}
                        durationMs={groupDurationMs}
                        maxDurationMs={maxToolGroupDurationMs}
                    >
                        {item.tools.map((tool) => (
                            <div key={`group-tool-${tool.seq}`} {...(toolContextAttrsBySeq.get(tool.seq) ?? {})}>
                                <ToolCallCard
                                    toolCall={tool}
                                    liveStatus={item.liveStatus}
                                    expanded={Boolean(expandedToolCalls[tool.seq])}
                                    onToggle={() => toggleToolCallExpanded(tool.seq)}
                                />
                            </div>
                        ))}
                    </ToolGroup>
                );
            }
            const subagentMatch =
                subagentMatchFor(item) ??
                (isSubagentToolName(item.toolCall.name) ? synthesizeSubagentMatch(item.toolCall) : undefined);
            if (subagentMatch != null) {
                if (subagentMatch.status !== "matched" && subagentMatch.status !== "ambiguous") {
                    return <SubagentPlaceholderCard match={subagentMatch} />;
                }
                if (model.service != null) {
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
                                        origin: normalizeDetailOrigin(summary?.origin),
                                    });
                                }
                            }}
                        />
                    );
                }
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
            maxToolGroupDurationMs,
            model.blockId,
            model.service,
            openAnnotationsFor,
            scopedAnnotationCounts,
            seqTimestamps,
            subagentMatchFor,
            subagentMatchesByAnchor,
            subagentTabCwd,
            toggleToolCallExpanded,
            toolContextAttrsBySeq,
            toolGroupEndSeqByAnchor,
            virtualEnabled,
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
            ? t("aisessions:row.saving")
            : noteSaveStatus === "saved"
              ? t("aisessions:row.saved")
              : noteSaveStatus === "error"
                ? t("aisessions:row.saveFailed")
                : !noteUnchanged
                  ? t("aisessions:row.unsaved")
                  : "";
    const projectDirectory = summary?.projectPath?.trim() ?? "";
    const sessionFilePath = summary?.filePath?.trim() ?? "";
    return (
        <div
            ref={containerRef}
            className="relative flex h-full min-h-0 flex-col"
            // 机器验证钩子：当前面板渲染的会话 key（验证台按它断言「面板正文=被点的那一行」）。
            data-detail-session-key={summary?.key ?? ""}
        >
            {historySyncError && effectiveDetail != null ? (
                <div
                    className="flex shrink-0 items-center gap-2 border-b border-warning/40 bg-warning/10 px-3 py-1.5 text-xs text-warning"
                    role="status"
                >
                    <span className="min-w-0 flex-1 truncate">
                        {i18n.t("aisessions:detail.historySyncPaused", { error: historySyncError })}
                    </span>
                    <button
                        type="button"
                        className="shrink-0 cursor-pointer rounded border border-warning/40 px-2 py-0.5 text-[11px] hover:bg-warning/10"
                        onClick={() => void requestDetailDelta("manual")}
                    >
                        {t("aisessions:liveTurn.retry")}
                    </button>
                </div>
            ) : null}
            <div className="flex h-[46px] shrink-0 items-center gap-2 border-b border-border px-3">
                {onExpandSessionList ? (
                    <IconButton
                        icon="fa-chevron-right"
                        label={t("aisessions:list.expand")}
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
                                title={i18n.t("aisessions:detail.modelTitle", {
                                    suffix:
                                        actualModels.length > 1
                                            ? i18n.t("aisessions:detail.modelMulti", {
                                                  models: actualModels.join(", "),
                                              })
                                            : "",
                                })}
                            >
                                {chatAgentModel || actualModel}
                            </span>
                        ) : null}
                        {openBlockCount > 1 ? (
                            <span
                                className="inline-flex h-[22px] shrink-0 items-center gap-1 rounded-full border border-border px-2 text-[11px] text-secondary"
                                title={i18n.t("aisessions:detail.openInBlocks", { count: openBlockCount })}
                                aria-label={i18n.t("aisessions:detail.openInBlocks", { count: openBlockCount })}
                            >
                                <i className="fa-sharp fa-solid fa-table-cells text-[10px]" />
                                {openBlockCount}
                            </span>
                        ) : null}
                        <div className="flex shrink-0 items-center gap-0.5">
                            <GenActionButton
                                sessionKey={summary.key ?? ""}
                                connection={connection}
                                origin={summary.origin ?? ""}
                                kind="title"
                                titleSource={summary.titleSource}
                                source="detail"
                            />
                            <IconButton
                                icon="fa-magnifying-glass"
                                label={t("aisessions:detail.searchSession")}
                                className={cn(searchExpanded && "border-accent bg-accent/10 text-accent")}
                                onClick={() => setSearchExpanded((current) => !current)}
                            />
                            <IconButton
                                icon="fa-star"
                                label={summary.marked ? t("aisessions:detail.unmark") : t("aisessions:row.mark")}
                                className={cn(
                                    !summary.marked && "text-secondary/50",
                                    summary.marked && "border-warning/60 bg-warning/10 text-warning"
                                )}
                                onClick={() => void model.toggleMark(summary)}
                            />
                            <AnnotationViewChip
                                pageMode={pageState.pageMode}
                                intervalHours={pageState.intervalHours}
                                countSize={pageState.countSize}
                                totalPages={pageState.pages.length}
                                open={pageMenuOpen}
                                onOpenChange={setPageMenuOpen}
                                onSelect={pageState.selectMode}
                                onFollowDefault={pageState.followDefault}
                            />
                            <SessionMoreMenu
                                projectDirectory={projectDirectory}
                                sessionFilePath={sessionFilePath}
                                sessionId={summary.id}
                                sessionKey={summary.key}
                                restoreCommand={restoreCommandForSession(summary)}
                                onRename={summary.key ? startRename : undefined}
                                onEditNote={() => {
                                    setNoteError("");
                                    setDirtyDismiss(false);
                                    setRemovedTags([]);
                                    setAiTags([]);
                                    pendingCloseRef.current = false;
                                    setNoteEditorOpen(true);
                                }}
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
                                        origin: summary.origin ?? "",
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
                        <div className="min-w-0 flex-1 truncate text-sm font-medium text-primary">
                            {t("aisessions:newChat.title")}
                        </div>
                        <span className="inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-full border border-border px-2 text-[11px] text-secondary">
                            <span className={cn("h-1.5 w-1.5 rounded-full", sourceDotClass(composeSource))} />
                            {getChatSource(composeSource).label}
                        </span>
                    </>
                )}
            </div>
            {timelineGenerating || annotationError ? (
                <div
                    className={cn(
                        "flex shrink-0 items-center gap-2 border-b px-3 py-1 text-[11px]",
                        annotationError
                            ? "border-warning/40 bg-warning/10 text-warning"
                            : "border-accent/40 bg-accent/10 text-accent"
                    )}
                    role="status"
                >
                    {annotationError ? null : <i className="fa-sharp fa-solid fa-spinner animate-spin text-[10px]" />}
                    <span className="min-w-0 flex-1 truncate">
                        {annotationError
                            ? i18n.t("aisessions:detail.annotationError", { error: annotationError })
                            : t("aisessions:detail.annotationGenerating")}
                    </span>
                    {annotationError ? (
                        <button
                            type="button"
                            className="shrink-0 cursor-pointer rounded px-1.5 py-0.5 hover:bg-warning/10"
                            onClick={() => {
                                setAnnotationError("");
                                setAnnotationStatus("");
                            }}
                        >
                            {t("aisessions:undo.dismiss")}
                        </button>
                    ) : null}
                </div>
            ) : null}
            <div className="relative min-h-0 flex-1">
                <div className="flex h-full min-h-0">
                    <AnnotationRail
                        annotations={annotations}
                        onJump={jumpToAnnotationSeq}
                        activeSeq={activeAnnotationSeq}
                        scrollSeq={scrollMessageSeq}
                        seqToTimestamp={seqTimestamps}
                        previewBySeq={annotationPreviewBySeq}
                        onGenerateTimeline={() => void generateAnnotationTimeline()}
                        generating={timelineGenerating}
                        onAccept={(id) => void bulkDrafts("accept", [id])}
                        onDiscard={(id) => void bulkDrafts("discard", [id])}
                        onAcceptAllDrafts={() => void bulkDrafts("accept")}
                        onDiscardAllDrafts={() => void bulkDrafts("discard")}
                        onNodeTextSave={handleNodeTextSave}
                        bottomInset={composerHeight}
                        // 分页作用域（§4.2c）：非 all 模式下 rail 标记 / 悬浮卡 / 类型过滤计数 /
                        // 草稿条 / 读数只反映当前页；all 模式不传（保持 v1 全量语义）。
                        scopeSeqs={pageScopeSeqsArg}
                        // 端帽 `↑N` 只在 all 模式出现；非 all 模式的加载语义由翻页条承担。
                        showLoadOlder={pageState.pageMode === "all"}
                        // ── gutter 行对齐标记（§4.2b）：传入即启用行对齐 gutter 渲染 ──
                        markers={gutterMarkers}
                        onLoadOlder={handleLoadOlder}
                        loadingOlder={annotationWindow.loadingOlder}
                        olderError={annotationWindow.olderError}
                        // 精确计数 B2 接 author 列后补：现在只能区分「还有 / 没有」。
                        olderCount={annotationWindow.hasMoreOlder ? 1 : 0}
                        pendingNewCount={pendingNewCount}
                        onJumpToNew={handleJumpToNew}
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
                                        placeholder={t("aisessions:detail.searchPlaceholder")}
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
                                            title={t("aisessions:detail.clearSearch")}
                                            aria-label={t("aisessions:detail.clearSearch")}
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
                                        label={t("aisessions:detail.previousMatch")}
                                        disabled={detailSearchMatches.length === 0}
                                        onClick={jumpToPreviousSearchMatch}
                                    />
                                    <IconButton
                                        icon="fa-chevron-down"
                                        label={t("aisessions:detail.nextMatch")}
                                        disabled={detailSearchMatches.length === 0}
                                        onClick={jumpToNextSearchMatch}
                                    />
                                </div>
                            </div>
                        </div>
                        <div className="relative min-h-0 flex-1">
                            {/* 虚拟化路径的「当前日」悬浮 chip（sticky 降级，见 BucketHeaderRow 注释）。
                                只在有批注锚定的日子显示；与居中的翻页条 / 搜索浮层错开在左侧。 */}
                            {activeBucketDay != null ? <BucketDayChip dateKey={activeBucketDay} /> : null}
                            {/* 分页翻页条（§4.2c）：非 all 模式浮在消息流顶部，不占消息行；
                                搜索浮层展开时下移一行避开它（搜索浮层 z-30）。 */}
                            {pageState.pageMode !== "all" && pageState.activePage != null ? (
                                <div
                                    className={cn(
                                        "pointer-events-none absolute left-1/2 z-20 -translate-x-1/2",
                                        searchExpanded ? "top-[52px]" : "top-1.5"
                                    )}
                                >
                                    <AnnotationPagerBar
                                        pages={pageState.pages}
                                        activePageIndex={pageState.activePageIndex}
                                        onPrev={pageState.goPrevPage}
                                        onNext={pageState.goNextPage}
                                        onOpenModeMenu={() => setPageMenuOpen(true)}
                                    />
                                </div>
                            ) : null}
                            <SessionOutlineRail
                                prompts={outlinePrompts}
                                activeSeq={activeOutlineSeq}
                                onJump={jumpToMessage}
                            />
                            <div
                                ref={detailScrollRef}
                                className="h-full min-h-0 overflow-auto p-3 pb-10"
                                // 关掉浏览器自带的 scroll anchoring：行高被重测时它会再调一次
                                // scrollTop，和 virtualizer 的 scrollAdjustments 叠加 → 抖动/撕裂。
                                style={{ overflowAnchor: "none" }}
                                onScroll={handleDetailScroll}
                                onPointerDown={handleCopyRangePointerDown}
                                onPointerMove={handleCopyRangePointerMove}
                            >
                                {detailMessages.length === 0 && liveTurn == null ? (
                                    isNewChat ? (
                                        <div className="px-1 py-10">
                                            <div className="text-sm font-medium text-primary">
                                                {t("aisessions:detail.startNewConversation")}
                                            </div>
                                            <div className="mt-1 text-xs leading-5 text-secondary">
                                                {t("aisessions:detail.firstMessageHint")}
                                            </div>
                                        </div>
                                    ) : loading || deltaLoading ? (
                                        <SessionDetailSkeleton />
                                    ) : (
                                        <EmptyState text={t("aisessions:detail.noReadableMessages")} />
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
                                                    const item = flowRows[virtualItem.index];
                                                    if (item == null) return null;
                                                    return (
                                                        <div
                                                            key={virtualItem.key}
                                                            data-index={virtualItem.index}
                                                            // 虚拟行重播 ly-enter 淡入就是“突然插入一段文字”的主因，
                                                            // 这里关掉；小会话（非虚拟）的落盘过渡不受影响。
                                                            data-no-anim="1"
                                                            ref={virtualizer.measureElement}
                                                            style={{
                                                                position: "absolute",
                                                                top: 0,
                                                                left: 0,
                                                                width: "100%",
                                                                // 取整到整数像素：tanstack 的 start 是分数值，
                                                                // 分数位移 + 12px 小字会在 macOS/Electron 上渲染成亚像素叠影（重影）。
                                                                transform: `translateY(${Math.round(virtualItem.start)}px)`,
                                                                // contain: layout style 把每行的布局/样式计算限制在行内，
                                                                // 使 measureElement 的 offsetHeight 强制布局只重排该行，
                                                                // 而不是整块滚动容器（实测 p90 约减半）。
                                                                contain: "layout style",
                                                            }}
                                                        >
                                                            <TimelineRow
                                                                item={item}
                                                                index={virtualItem.index}
                                                                items={flowRows}
                                                                render={renderTimelineItem}
                                                            />
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        ) : (
                                            flowRows.map((item, itemIdx) => (
                                                <Fragment key={timelineItemKey(item, itemIdx)}>
                                                    <TimelineRow
                                                        item={item}
                                                        index={itemIdx}
                                                        items={flowRows}
                                                        render={renderTimelineItem}
                                                    />
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
                                                <span>{t("aisessions:liveTurn.working")}</span>
                                            </div>
                                        ) : null}
                                        {/* 实时 turn 错误 UI：重试/继续（正文与工具已并入上方 renderItems 统一渲染） */}
                                        {liveTurn?.error ? (
                                            <div className="mt-2 flex flex-col gap-1.5 rounded-xl border border-error/25 bg-error/10 px-3.5 py-2.5">
                                                <div className="flex items-center gap-1.5 text-xs font-medium text-error">
                                                    <i className="fa-sharp fa-solid fa-triangle-exclamation text-[11px]" />
                                                    <span>{t("aisessions:liveTurn.errorTitle")}</span>
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
                                                        <span>{t("aisessions:liveTurn.continue")}</span>
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
                                                        <span>{t("aisessions:liveTurn.retry")}</span>
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
                            <div ref={setComposerEl} className="shrink-0">
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
                            </div>
                        ) : isNewChat ? (
                            <div ref={setComposerEl} className="shrink-0">
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
                            </div>
                        ) : null}
                    </div>
                </div>
            </div>
            {noteEditorOpen && summary != null ? (
                <Modal
                    className="w-[520px] max-w-[calc(100vw-32px)]"
                    onClose={requestDismiss}
                    onClickBackdrop={requestDismiss}
                >
                    <div className="space-y-3 text-primary">
                        <div className="space-y-1 pr-8">
                            <div className="flex items-center gap-2">
                                <div className="text-base font-semibold">{t("aisessions:detail.sessionNote")}</div>
                                <NoteAIButton status={noteAI.status} onGenerate={() => void noteAI.generate()} />
                            </div>
                            <div className="flex min-w-0 items-center gap-2 text-xs text-secondary">
                                {summary.source ? (
                                    <span className="shrink-0 rounded border border-border px-1.5 py-0.5 uppercase">
                                        {summary.source}
                                    </span>
                                ) : null}
                                {summary.title ? (
                                    <span className="min-w-0 truncate" title={summary.title}>
                                        {summary.title}
                                    </span>
                                ) : null}
                                <span className="shrink-0">ID: {shortSessionId(summary.id)}</span>
                            </div>
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
                        <SessionTagChips tags={nextTags} removable onRemove={handleRemoveTag} />
                        {noteError ? (
                            <div className="rounded border border-error/40 bg-error/10 p-2 text-xs text-error">
                                {noteError}
                            </div>
                        ) : null}
                        <textarea
                            autoFocus
                            className="min-h-[140px] w-full resize-none rounded border border-border bg-transparent px-3 py-2 text-sm outline-none focus:border-accent"
                            placeholder={t("aisessions:row.notePlaceholder")}
                            value={noteDraft}
                            onChange={(event) => {
                                latestNoteDraftRef.current = event.target.value;
                                setNoteDraft(event.target.value);
                                setNoteError("");
                                if (dirtyDismiss) setDirtyDismiss(false);
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
                                {dirtyDismiss && !noteSaving ? (
                                    <span className="text-warning">{t("aisessions:detail.discardOnClose")}</span>
                                ) : (
                                    noteStatusText
                                )}
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
                                    {t("aisessions:detail.clear")}
                                </button>
                                <button
                                    type="button"
                                    className="h-8 rounded border border-border px-3 text-xs text-secondary hover:bg-hover hover:text-primary disabled:opacity-60"
                                    onClick={saveAndClose}
                                >
                                    {i18n.t("common:common.close")}
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
                    nodePreview={annotationPreviewBySeq.get(annotationEditor.seq)}
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
                            <div className="text-base font-semibold">{t("aisessions:menu.deleteSessionTitle")}</div>
                            <div className="text-sm leading-5 text-secondary">
                                {t("aisessions:menu.deleteSessionBody")}
                            </div>
                        </div>
                        <div className="flex justify-end gap-2">
                            <button
                                type="button"
                                className="h-8 rounded border border-border px-3 text-xs text-secondary hover:bg-hover hover:text-primary"
                                disabled={deleting}
                                onClick={() => setDeleteConfirmOpen(false)}
                            >
                                {i18n.t("common:common.cancel")}
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
                                <span>
                                    {deleting ? t("aisessions:menu.deleting") : i18n.t("common:common.delete")}
                                </span>
                            </button>
                        </div>
                    </div>
                </Modal>
            ) : null}
        </div>
    );
}
