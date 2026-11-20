// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { openAgentEmojiPicker } from "@/app/agent-persona/picker-host";
import type { AgentStatus } from "@/app/agent-status/agent-status-types";
import { useAgentReadContext } from "@/app/agent-status/use-agent-status-view";
import { i18n } from "@/i18n/config";
import { cn, makeIconClass } from "@/util/util";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AgentStatusChip } from "./agent-status-chip";
import { parseBoardTabColumnKey, shouldShowAddAgent } from "./overview-add-agent";
import {
    formatBoardAge,
    formatBoardAgeTitle,
    groupOverviewCards,
    resolveBoardMetaLabel,
    resolveBoardTagChips,
    type OverviewBoardAvatar,
    type OverviewBoardCard,
    type OverviewBoardGroup,
    type OverviewBoardStatus,
    type OverviewBoardStatusInput,
} from "./overview-board-model";
import {
    diffBoardLayout,
    OVERVIEW_BOARD_MOTION_ENABLED,
    type BoardMotionKind,
    type BoardRect,
    type BoardSnapshot,
} from "./overview-board-motion";
import type { OverviewTimelineSegment } from "./overview-timeline-model";
import { SessionMetrics } from "./session-metrics";
import "./session-overview.scss";
// 看板卡的属性胶囊复用 property-chip 的 Notion 9 色调色板（浅底深字）。
// 显式 import：悬浮卡（真正引入者）不一定挂载，看板不能依赖它的存在。
import "@/app/view/aisessions/property/property-list.scss";

/** 卡片跨列动效的参数表（与任务 design.md 的参数表同源）。 */
const MotionTiming: Record<BoardMotionKind, { duration: number; easing: string }> = {
    move: { duration: 260, easing: "cubic-bezier(0.2, 0.9, 0.16, 1)" },
    reflow: { duration: 160, easing: "cubic-bezier(0.2, 0.9, 0.16, 1)" },
    enter: { duration: 180, easing: "cubic-bezier(0.2, 0.9, 0.16, 1)" },
};

/** 落点列头光晕的高亮保持时长（CSS 动画 700ms）。 */
const LandingResetMs = 780;

/**
 * 卡片内的「独立热区」白名单。
 *
 * 整卡默认可点开会话弹窗（PRD R1），但卡片里嵌着自带行为的控件：动作按钮
 * （定位/删除/关闭）、状态 chip（ack）、emoji 头像（picker）。判定方式是
 * 「target 向上找最近的独立热区」而不是「target 必须等于卡片根」——
 * 后者会让卡片内部所有子 span（标题/预览/Note/tags/属性/度量）全部点不动。
 * chips（tags/属性）目前是纯展示，不在此列：点它们走整卡开弹窗。
 */
const CardHotzoneSelector = [
    "button",
    "a[href]",
    "input",
    "textarea",
    "select",
    '[contenteditable="true"]',
    "[data-card-interactive]",
].join(",");

/** target 是否落在卡片内的独立热区上（卡片根自身不算）。 */
function isCardHotzone(target: EventTarget | null, root: HTMLElement): boolean {
    if (target == null || !(target instanceof Element)) return false;
    if (target === root) return false;
    const hotzone = target.closest(CardHotzoneSelector);
    // `closest` 会一路找到卡片外面（脏数据/测试包裹层），只认卡片内的命中。
    return hotzone != null && hotzone !== root && root.contains(hotzone);
}

type BoardLanding = {
    columnKeys: readonly string[];
    tick: number;
};

const EmptyLanding: BoardLanding = { columnKeys: [], tick: 0 };

function prefersReducedMotion(): boolean {
    if (typeof window === "undefined") return true;
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/**
 * 卡片的布局盒子（视口坐标）。
 *
 * `getBoundingClientRect()` 返回的是**合成后**坐标，飞行中的卡片会报出插值位置，
 * 把「落点」记成半路位置会让同一张卡被反复判成移动。对仍有动画在跑的元素，
 * 复用上一帧记录的布局 rect（即它将落定的位置）。
 */
function measureLayoutRect(element: HTMLElement, fallback: BoardRect | undefined): BoardRect {
    if (fallback != null && element.getAnimations().length > 0) {
        return fallback;
    }
    const measured = element.getBoundingClientRect();
    return { left: measured.left, top: measured.top, width: measured.width, height: measured.height };
}

/** 采样当前看板布局（两段式写入的第一步）。 */
function captureBoardSnapshot(
    container: HTMLElement,
    columnKeys: readonly string[],
    fallbackItems: BoardSnapshot["items"] | undefined
): BoardSnapshot {
    const elements = Array.from(container.querySelectorAll<HTMLElement>("[data-board-block-id]"));
    const items: BoardSnapshot["items"] = {};
    for (const element of elements) {
        const blockId = element.dataset.boardBlockId;
        if (!blockId) continue;
        items[blockId] = {
            rect: measureLayoutRect(element, fallbackItems?.[blockId]?.rect),
            status: element.dataset.boardColumn ?? "",
        };
    }
    return { containerWidth: container.clientWidth, columns: columnKeys, items };
}

/** 两份快照算不算「布局换了」（而非「卡片动了」）。 */
function isLayoutChange(prev: BoardSnapshot, next: BoardSnapshot): boolean {
    if (prev.containerWidth !== next.containerWidth) return true;
    if (prev.columns.length !== next.columns.length) return true;
    return prev.columns.some((key) => !next.columns.includes(key));
}

export type OverviewBoardProps = {
    cards: readonly OverviewBoardCard[];
    presentedStatuses: Readonly<Record<string, OverviewBoardStatusInput>>;
    agentStatuses?: Readonly<Record<string, AgentStatus | null>>;
    maxTotal?: number;
    group?: OverviewBoardGroup;
    miniTimelines?: Readonly<Record<string, readonly OverviewTimelineSegment[] | undefined>>;
    now: number;
    onOpenCard: (card: OverviewBoardCard) => void;
    /** 定位到块：切到该块所在 Tab 并高亮（复用 overviewModel.jumpToBlock）。不传 = 卡片不提供入口。 */
    onJumpCard?: (card: OverviewBoardCard) => void;
    onCloseCard?: (card: OverviewBoardCard) => void;
    onDeleteSession?: (card: OverviewBoardCard) => void;
    deletingSessionId?: string;
    onAckStatus?: (blockId: string, status: AgentStatus) => void;
    /**
     * 「＋ 新建」入口：仅在容器型分组（tab）渲染。传 tabId + tabName。
     * 不传 = 看板不提供新建入口（测试/嵌入场景）。
     */
    onAddAgent?: (tabId: string, tabName: string) => void;
};

function BoardAvatar({
    avatar,
    emojiLabel,
    onPickEmoji,
}: {
    avatar: OverviewBoardAvatar;
    /** emoji 热区的 aria-label / title（复用 hover 卡的文案 key，不新增文本）。 */
    emojiLabel?: string;
    /**
     * 传入 = 头像升级为独立热区按钮（点它开 picker，不冒泡到整卡弹窗）。
     * 不传 = 纯展示 span，点它按整卡语义开弹窗（**不要**渲染 disabled 的死按钮）。
     */
    onPickEmoji?: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
    const content =
        avatar.kind === "emoji" ? (
            <span className="agent-emoji-icon">{avatar.emoji}</span>
        ) : avatar.kind === "logo" ? (
            <span style={avatar.color ? { color: avatar.color } : undefined}>{avatar.icon}</span>
        ) : (
            <i className={avatar.iconClass} />
        );
    if (onPickEmoji == null) {
        return (
            <span className="session-overview-board-card-avatar" data-avatar-kind={avatar.kind} aria-hidden="true">
                {content}
            </span>
        );
    }
    // 兼容类名 `.session-overview-board-card-avatar` + `data-avatar-kind` 是 verify 探针的
    // 契约（agent-card-emoji-avatar 直接读它们），新按钮必须继续挂上。
    return (
        <button
            type="button"
            className="session-overview-board-card-avatar session-overview-board-card-avatar-btn"
            data-avatar-kind={avatar.kind}
            data-card-interactive="true"
            onClick={onPickEmoji}
            aria-label={emojiLabel}
            title={emojiLabel}
        >
            {content}
        </button>
    );
}

function BoardCardImpl({
    card,
    status,
    columnKey,
    now,
    onOpenCard,
    onJumpCard,
    onCloseCard,
    onDeleteSession,
    deletingSessionId,
    onAckStatus,
    miniSegments,
}: {
    card: OverviewBoardCard;
    status: AgentStatus | null;
    /** 卡片当前所在列的稳定 key（`status:working` / `tab:<id>` / `provider:<name>`）。 */
    columnKey: string;
    now: number;
    onOpenCard: (card: OverviewBoardCard) => void;
    /** 见 OverviewBoardProps.onJumpCard；未传则该卡不渲染定位按钮。 */
    onJumpCard?: (card: OverviewBoardCard) => void;
    onCloseCard?: (card: OverviewBoardCard) => void;
    onDeleteSession?: (card: OverviewBoardCard) => void;
    deletingSessionId?: string;
    onAckStatus?: (blockId: string, status: AgentStatus) => void;
    /**
     * 卡片底部迷你时间线的段（毫秒）。不传 = 不画迷你条。
     * 由面板侧用 `buildTimelineSegments(row)` 算好传下来 —— 看板本身不做时间推导。
     */
    miniSegments?: readonly OverviewTimelineSegment[];
}) {
    const { t } = useTranslation("session-overview");
    const age = formatBoardAge(card.updatedAt, now);
    const ageTitle = formatBoardAgeTitle(card.updatedAt, now);
    const readContext = useAgentReadContext(card.blockId, status);
    const unread = readContext.read === "unread";
    const chips = [card.providerLabel, card.projectName || card.tabName].filter((chip) => chip !== "");
    const visibleChips = chips.slice(0, 2);

    // Chip 内部是 <button>，卡片容器不能再是 <button>（嵌套按钮是非法 HTML，点击会串）。
    const openCard = () => onOpenCard(card);
    const tagChips = resolveBoardTagChips(card.tags, 3);
    // 状态 chip 与视图名标签各按自己的条件渲染；两者都缺席时 meta 行不留下空胶囊。
    const hasStatusChip = status != null && onAckStatus != null;
    const metaLabel = resolveBoardMetaLabel({ hasStatusChip, kindLabel: card.kindLabel });
    const isDeletingSession = deletingSessionId !== "" && deletingSessionId === card.sessionId;
    const showDeleteSession = onDeleteSession != null && card.sessionId !== "";
    // 没有 tabId 的卡片无处可跳（理论上不会出现；留着防脏数据长出死按钮）。
    const showJump = onJumpCard != null && card.tabId !== "";
    const stopCardEvent = (event: React.SyntheticEvent) => {
        event.preventDefault();
        event.stopPropagation();
    };
    // emoji 头像独立热区：只对「agent 卡 + 有 raw provider」开放。
    // 同 icon 再点一次由 picker-host 自己 toggle（不要在这里写状态）。
    const provider = card.provider ?? "";
    const pickEmoji = card.isAgentLike && provider !== "";
    const openEmojiPicker = (event: React.MouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        event.stopPropagation();
        openAgentEmojiPicker(
            card.blockId,
            provider,
            event.currentTarget.getBoundingClientRect(),
            "session",
            card.sessionId || null
        );
    };
    /**
     * 整卡点击的唯一判定点（head 上不再挂重复 handler）。
     *
     * 热区（动作按钮 / 状态 chip / emoji 头像）命中 → 直接 return，交给它自己的
     * handler；其余一律开弹窗。
     */
    const handleCardClick = (event: React.MouseEvent<HTMLDivElement>) => {
        // 拖选预览/Note 文本后松开的那一下不算点击（否则选区一松手就弹窗）。
        if (typeof window !== "undefined" && window.getSelection?.()?.isCollapsed === false) return;
        if (isCardHotzone(event.target, event.currentTarget)) return;
        // 命中即开弹窗：拦掉冒泡，不让 block frame 的 setBlockClickedTrue 再追加一轮
        // 焦点搬运（setFocusTarget/focusNode —— focusNode 还会走一次 layout model 持久化 IPC）
        // 与随之而来的额外重渲 —— 那一轮发生在弹窗入场动画的同一帧里，是「点开弹窗顿一下」
        // 的放大器之一（11-10-overview-board-click-perf）。
        // 键盘 Enter/Space 路径不受影响；action 按钮/chip 自己已 stopPropagation。
        // 注意：这是 bubble 阶段的拦截，capture 阶段的 document 监听（hover 卡消失、
        // chat composer 退出）照旧生效；唯一可见副作用是 block sidebar 的
        // 「点外侧关闭」（bubble 阶段）不再被这一下点击触发。
        event.stopPropagation();
        openCard();
    };

    return (
        <div
            className="session-overview-board-card"
            data-block-id={card.blockId}
            // 动效层（OverviewBoard 的 useLayoutEffect）读这两个属性
            data-board-block-id={card.blockId}
            data-board-column={columnKey}
            data-agent-like={card.isAgentLike ? "true" : "false"}
            role="button"
            tabIndex={0}
            onClick={handleCardClick}
            onKeyDown={(event) => {
                // 热区自己的键盘行为（emoji 按钮 / 动作按钮上的 Enter）不能冒泡到这里
                // 同时再开一次弹窗（双触发）。
                if (event.target !== event.currentTarget) return;
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openCard();
                }
            }}
            aria-label={i18n.t("session-overview:board.openSession", { title: card.title })}
            title={card.preview ? `${card.title}\n${card.preview}` : card.title}
        >
            <span className="session-overview-board-card-head">
                <BoardAvatar
                    avatar={card.avatar}
                    emojiLabel={pickEmoji ? i18n.t("term:hoverCard.setPersonaEmoji") : undefined}
                    onPickEmoji={pickEmoji ? openEmojiPicker : undefined}
                />
                <span className="session-overview-board-card-title">{card.title}</span>
                {age ? (
                    <span className="session-overview-board-card-age" title={ageTitle} aria-label={ageTitle}>
                        {age}
                    </span>
                ) : null}
                <span
                    className="session-overview-board-card-actions"
                    onClick={stopCardEvent}
                    onMouseDown={stopCardEvent}
                >
                    {showJump ? (
                        <button
                            type="button"
                            className="session-overview-board-card-action"
                            data-board-jump
                            onClick={() => onJumpCard?.(card)}
                            aria-label={i18n.t("session-overview:board.jumpToSession", { title: card.title })}
                            title={t("session-overview:board.jumpToBlock")}
                        >
                            <i className={makeIconClass("location-crosshairs", false)} />
                        </button>
                    ) : null}
                    {showDeleteSession ? (
                        <button
                            type="button"
                            className={cn(
                                "session-overview-board-card-action",
                                "danger",
                                isDeletingSession && "is-busy"
                            )}
                            onClick={() => !isDeletingSession && onDeleteSession?.(card)}
                            disabled={isDeletingSession}
                            aria-label={i18n.t("session-overview:board.deleteSessionAria", { title: card.title })}
                            title={t("session-overview:board.deleteSessionFile")}
                        >
                            <i className={makeIconClass(isDeletingSession ? "spinner" : "trash", false)} />
                        </button>
                    ) : null}
                    {onCloseCard ? (
                        <button
                            type="button"
                            className="session-overview-board-card-action"
                            onClick={() => onCloseCard(card)}
                            aria-label={i18n.t("session-overview:board.closeBlockAria", { title: card.title })}
                            title={t("session-overview:board.closeBlock")}
                        >
                            <i className={makeIconClass("xmark", false)} />
                        </button>
                    ) : null}
                </span>
            </span>
            <span className="session-overview-board-card-meta">
                {hasStatusChip ? (
                    <AgentStatusChip
                        variant="board"
                        status={status}
                        now={now}
                        blockId={card.blockId}
                        unread={unread}
                        onAck={onAckStatus}
                    />
                ) : null}
                {metaLabel !== "" ? (
                    <span className="session-overview-board-card-view-label">{metaLabel}</span>
                ) : null}
                {visibleChips.map((chip, index) => (
                    <span key={`${chip}-${index}`} className="session-overview-board-chip" title={chip}>
                        {chip}
                    </span>
                ))}
                {/* 会话标签：与 aisessions 属性面板同一套「标签 chip」观感，
                    最多 3 个 + `+n` 溢出计数（硬上限，卡片高度不随标签数跳动）。 */}
                {tagChips.visible.map((tag) => (
                    <span
                        key={`tag-${tag}`}
                        className="session-overview-board-chip is-tag"
                        data-board-tag={tag}
                        title={`#${tag}`}
                    >
                        #{tag}
                    </span>
                ))}
                {tagChips.hiddenCount > 0 ? (
                    <span
                        className="session-overview-board-chip is-tag-more"
                        data-board-tag-overflow={tagChips.hiddenCount}
                        title={i18n.t("session-overview:board.moreTags", { count: tagChips.hiddenCount })}
                    >
                        +{tagChips.hiddenCount}
                    </span>
                ) : null}
            </span>
            {/* 自定义属性：只读展示（status/select 用 Notion 9 色胶囊；多值 chips；其余单行文本）。
                最多 3 条 + 溢出计数，卡片高度不因属性多而跳动（与 tags 同策略）。 */}
            {card.propRows.visible.length > 0 ? (
                <span
                    className="session-overview-board-card-props"
                    data-board-props={card.propRows.visible.length}
                >
                    {card.propRows.visible.map((row) => {
                        const rowValue =
                            row.single?.value ??
                            row.multi?.join(", ") ??
                            (row.checked === true ? "✓" : "") ??
                            row.text ??
                            "";
                        return (
                        <span
                            key={row.key}
                            className="session-overview-board-card-prop"
                            data-board-prop={row.key}
                            data-board-prop-type={row.type}
                            title={`${row.name}: ${rowValue}`}
                        >
                            <span className="session-overview-board-card-prop-name">{row.name}</span>
                            {row.single ? (
                                <span className={cn("property-chip", `property-chip--${row.single.color}`)}>
                                    {row.single.value}
                                </span>
                            ) : null}
                            {row.multi?.map((value) => (
                                <span key={value} className="property-chip">
                                    {value}
                                </span>
                            ))}
                            {row.checked != null ? (
                                <span className="property-chip property-chip--green">
                                    <i className="fa-sharp fa-solid fa-check" aria-hidden="true" />
                                </span>
                            ) : null}
                            {row.text ? <span className="session-overview-board-card-prop-text">{row.text}</span> : null}
                        </span>
                        );
                    })}
                    {card.propRows.hiddenCount > 0 ? (
                        <span
                            className="session-overview-board-card-prop-more"
                            data-board-prop-overflow={card.propRows.hiddenCount}
                            title={i18n.t("session-overview:board.moreProps", {
                                count: card.propRows.hiddenCount,
                            })}
                        >
                            +{card.propRows.hiddenCount}
                        </span>
                    ) : null}
                </span>
            ) : null}
            {card.preview ? <span className="session-overview-board-card-preview">{card.preview}</span> : null}
            {card.note ? (
                <span className="session-overview-board-card-note">
                    <span className="session-overview-board-card-note-mark" aria-hidden="true">
                        ✎
                    </span>
                    {card.note}
                </span>
            ) : null}
            {/* 度量区：4 格度量轨 + 既有 mini timeline。两行共用同一容器，
                `gap` 只在这里生效一次，卡高不因抽屉变化而漂。 */}
            <span className="session-overview-board-card-data">
                <SessionMetrics
                    surface="board"
                    messageCount={card.messageCount}
                    size={card.size}
                    createdAt={card.createdAt}
                    updatedAt={card.updatedAt}
                    live={card.live}
                    now={now}
                />
                {miniSegments != null && miniSegments.length > 0 ? (
                    // 迷你时间线：一段 = 一个真实状态区间（宽度按毫秒比例），
                    // 3px 高、2px 圆角、段间 1px 缝 —— 与甘特图同一套配色 token。
                    <span
                        className="session-overview-board-card-mini"
                        data-mini-segments={miniSegments.length}
                        aria-hidden="true"
                    >
                        {miniSegments.map((segment, index) => (
                            <span
                                key={`${segment.state}-${index}`}
                                className={cn("session-overview-board-card-mini-seg", `is-${segment.state}`)}
                                style={{ flexGrow: Math.max(segment.toMs - segment.fromMs, 1) }}
                            />
                        ))}
                    </span>
                ) : null}
            </span>
        </div>
    );
}

/**
 * BoardCard 必须走 memo：面板的一次无关重渲（如 markBlockViewed 写的 blockViewedAtAtom）
 * 会带着整块看板全部卡片重跑，上百张卡是几十 ms 级 long task，把弹窗入场动画的
 * 首帧压在后面（11-10-overview-board-click-perf）。memo 生效的前提是父级的
 * onOpenCard / onJumpCard / onCloseCard / onDeleteSession 全部引用稳定（useCallback）。
 */
export const BoardCard = memo(BoardCardImpl);

/**
 * 「＋ 新建」占位卡（仅 tab 分组渲染）。
 * tabId 从列 key（`tab:<tabId>`）解析 —— 看板的列是纯数据产物，不在卡片模型里多存一份 tabId。
 */
function AddAgentButton({
    columnKey,
    columnTitle,
    onAddAgent,
}: {
    columnKey: string;
    columnTitle: string;
    onAddAgent: (tabId: string, tabName: string) => void;
}) {
    const tabId = parseBoardTabColumnKey(columnKey);
    if (tabId == null) return null;
    return (
        <button
            type="button"
            className="session-overview-board-add"
            data-board-add-tab={tabId}
            onClick={() => onAddAgent(tabId, columnTitle)}
            aria-label={i18n.t("session-overview:board.addAgentAria", { name: columnTitle })}
            title={i18n.t("workspace:agentLaunch.newAction")}
        >
            <i className={makeIconClass("plus", false)} />
        </button>
    );
}

export function OverviewBoard({
    cards,
    presentedStatuses,
    agentStatuses,
    maxTotal,
    group = "status",
    miniTimelines,
    now,
    onOpenCard,
    onJumpCard,
    onCloseCard,
    onDeleteSession,
    deletingSessionId,
    onAckStatus,
    onAddAgent,
}: OverviewBoardProps) {
    const { t } = useTranslation("session-overview");
    // 状态分组常显 5 列（空列给占位）；tab / provider 分组只显示有卡的列。
    const columns = groupOverviewCards(cards, presentedStatuses, group, {
        maxTotal,
        includeEmpty: group === "status",
    });

    const boardRef = useRef<HTMLDivElement | null>(null);
    const prevSnapshotRef = useRef<BoardSnapshot | null>(null);
    const armedRef = useRef(false);
    const [landing, setLanding] = useState<BoardLanding>(EmptyLanding);

    // 值相等签名：`now` tick / 预览文本变化引起的重渲染不会重跑动效采样。
    // 列 key 也进签名：切分组（status ⇄ tab ⇄ provider）必须重跑一次，才能被 diff 的
    // 「列集合变了 → 整体静默」规则拦下来。
    const layoutSignature = useMemo(
        () => columns.map((column) => `${column.key}:${column.blocks.map((c) => c.blockId).join(",")}`).join("|"),
        [columns]
    );

    const columnKeys = useMemo(() => columns.map((column) => column.key), [columns]);

    /**
     * 以当前 DOM 为新基线（不播动效）。
     *
     * 为什么需要它：`layoutSignature` 只包含「列 key + 卡片集合」，面板宽度变化不会让它变，
     * 于是 layout effect 不跑、`prev` 里留着旧宽度的坐标。之后任何一次真实的状态变化都会
     * 因为 `prev.containerWidth !== next.containerWidth` 被判成 resize 而整体静默 ——
     * 实测表现就是「动效偶尔完全不播」。ResizeObserver 负责在这条缝隙里重算基线。
     */
    const rebaseline = useCallback(() => {
        const container = boardRef.current;
        if (container == null) return;
        prevSnapshotRef.current = captureBoardSnapshot(container, columnKeys, undefined);
    }, [columnKeys]);

    useLayoutEffect(() => {
        if (!OVERVIEW_BOARD_MOTION_ENABLED) return;
        const container = boardRef.current;
        if (container == null) return;

        const prev = prevSnapshotRef.current;
        // 第一段——先读完全部 rect 再写：边读边 animate 会让后面的采样读到被 transform 污染的坐标。
        const next = captureBoardSnapshot(container, columnKeys, prev?.items);
        const elements = Array.from(container.querySelectorAll<HTMLElement>("[data-board-block-id]"));

        // 挂载后首帧只记账：list -> board 切换不得回放动效。
        if (!armedRef.current) {
            armedRef.current = true;
            prevSnapshotRef.current = next;
            return;
        }

        prevSnapshotRef.current = next;
        if (prev == null) return;

        // 基线重置：容器宽度变化（resize）或分组口径切换都属于「布局换了」，不是「卡片动了」。
        // 这一帧以新布局为新基线且不播动效。宽度的日常变化由 ResizeObserver 先一步重算；
        // 这里兜底处理 observer 回调与 React 提交错序的情况。
        if (isLayoutChange(prev, next)) return;

        if (prefersReducedMotion()) return;

        const movements = diffBoardLayout(prev, next, {
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
        });
        if (movements.length === 0) return;
        // 第二段——写。
        const elementById = new Map<string, HTMLElement>();
        for (const element of elements) {
            const blockId = element.dataset.boardBlockId;
            if (blockId) elementById.set(blockId, element);
        }

        const landedColumns = new Set<string>();
        for (const movement of movements) {
            const element = elementById.get(movement.blockId);
            if (element == null) continue;
            // 幂等：不在飞行中的卡片上再叠一层飞行。
            for (const running of element.getAnimations()) running.cancel();

            const timing = MotionTiming[movement.kind];
            if (movement.kind === "enter") {
                element.animate(
                    [
                        { opacity: 0, transform: "translateY(6px) scale(0.98)" },
                        { opacity: 1, transform: "none" },
                    ],
                    { duration: timing.duration, easing: timing.easing }
                );
                continue;
            }

            const from =
                movement.kind === "move"
                    ? { transform: `translate(${movement.dx}px, ${movement.dy}px) scale(0.97)`, opacity: 0.6 }
                    : { transform: `translate(${movement.dx}px, ${movement.dy}px)`, opacity: 1 };
            const animation = element.animate([from, { transform: "none", opacity: 1 }], {
                duration: timing.duration,
                easing: timing.easing,
            });

            if (movement.kind === "move") {
                element.classList.add("is-flying");
                const clearFlying = () => element.classList.remove("is-flying");
                animation.finished.then(clearFlying, clearFlying);
                const columnKey = next.items[movement.blockId]?.status;
                if (columnKey) landedColumns.add(columnKey);
            }
        }

        if (landedColumns.size > 0) {
            const columnKeys = Array.from(landedColumns);
            setLanding((current) => ({ columnKeys, tick: current.tick + 1 }));
        }
    }, [layoutSignature, columnKeys]);

    // 面板宽度变化不会进 `layoutSignature`，layout effect 因此不会跑 —— 但基线必须跟着更新，
    // 否则后续每一次真实的状态变化都会被 isLayoutChange 判成 resize 静默掉（实测踩到）。
    useEffect(() => {
        if (!OVERVIEW_BOARD_MOTION_ENABLED) return;
        const container = boardRef.current;
        if (container == null || typeof ResizeObserver === "undefined") return;
        let lastWidth = container.clientWidth;
        const observer = new ResizeObserver(() => {
            const width = container.clientWidth;
            if (width === lastWidth) return;
            lastWidth = width;
            rebaseline();
        });
        observer.observe(container);
        return () => observer.disconnect();
    }, [rebaseline]);

    // 落点高亮是一次性的：清掉后其他重渲染不会重播脉冲。
    useEffect(() => {
        if (landing.columnKeys.length === 0) return;
        const timer = setTimeout(() => {
            setLanding((current) => (current.tick === landing.tick ? EmptyLanding : current));
        }, LandingResetMs);
        return () => clearTimeout(timer);
    }, [landing]);

    if (columns.length === 0) {
        return <div className="session-overview-empty">{t("session-overview:board.empty")}</div>;
    }

    const isLanding = (columnKey: string) => landing.columnKeys.includes(columnKey);

    return (
        <div
            className="session-overview-board"
            role="group"
            aria-label={t("session-overview:board.groupLabel")}
            ref={boardRef}
        >
            {columns.map((column) => (
                <section
                    key={column.key}
                    className={cn("session-overview-board-column", column.blocks.length === 0 && "is-empty")}
                    data-column-key={column.key}
                    aria-label={i18n.t("session-overview:board.columnAria", {
                        title: column.title,
                        count: column.blocks.length,
                    })}
                >
                    <h3 className="session-overview-board-column-head">
                        {column.tone != null ? (
                            <span
                                key={`dot-${column.key}-${isLanding(column.key) ? landing.tick : 0}`}
                                className={cn(
                                    "session-overview-board-column-dot",
                                    `is-${column.tone}`,
                                    isLanding(column.key) && "is-landing"
                                )}
                                aria-hidden="true"
                            />
                        ) : null}
                        <span className="session-overview-board-column-title">{column.title}</span>
                        <span
                            key={`count-${column.key}-${isLanding(column.key) ? landing.tick : 0}`}
                            className={cn("session-overview-board-column-count", isLanding(column.key) && "is-bumping")}
                            role="status"
                        >
                            {column.blocks.length}
                        </span>
                    </h3>
                    <div className="session-overview-board-cards">
                        {column.blocks.length === 0 ? (
                            <div className="session-overview-board-empty">
                                {t("session-overview:board.columnEmpty")}
                            </div>
                        ) : (
                            column.blocks.map((card) => (
                                <BoardCard
                                    key={card.blockId}
                                    card={card}
                                    status={agentStatuses?.[card.blockId] ?? null}
                                    columnKey={column.key}
                                    now={now}
                                    onOpenCard={onOpenCard}
                                    onJumpCard={onJumpCard}
                                    onCloseCard={onCloseCard}
                                    onDeleteSession={onDeleteSession}
                                    deletingSessionId={deletingSessionId}
                                    onAckStatus={onAckStatus}
                                    miniSegments={miniTimelines?.[card.blockId]}
                                />
                            ))
                        )}
                        {/* ＋ 新建：仅容器型分组（tab）提供；派生列（status/provider/…）不可加卡 */}
                        {shouldShowAddAgent(group) && onAddAgent != null ? (
                            <AddAgentButton
                                columnKey={column.key}
                                columnTitle={column.title}
                                onAddAgent={onAddAgent}
                            />
                        ) : null}
                    </div>
                </section>
            ))}
        </div>
    );
}

export type { OverviewBoardStatus };
