// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure logic for the Overview timeline (Gantt, G1 "session lifetime" flavour).
//
// G1 只用现有字段（`SessionSummary.createdAt/updatedAt/live` + `AgentStatus.state`）：
//   条 = createdAt → (live ? now : updatedAt)，尾巴一小段用当前状态色，历史段「状态未知」。
// G2（状态分段）需要 per-block 状态历史，落地时只换 `buildTimelineBar` 的段计算，
// 行/刻度/排序都不变 —— 见 `design/plans/overview-board-timeline.md`。
//
// 全部纯函数，方便直接单测（不 import React、不读 store）。

import type { OverviewBoardAvatar } from "./overview-board-model";
import { createPersistedNumberEnum } from "./persisted-enum";

export const OverviewTimelineRanges = [2, 8, 24, 168] as const;

export type OverviewTimelineRange = (typeof OverviewTimelineRanges)[number];

export const OverviewTimelineRangeDefault: OverviewTimelineRange = 8;

export const OverviewTimelineRangeStorageKey = "snorkeling.overview.timelineRange";

const timelineRangeStorage = createPersistedNumberEnum(
    OverviewTimelineRangeStorageKey,
    OverviewTimelineRanges,
    OverviewTimelineRangeDefault
);

export const overviewTimelineRangeAtom = timelineRangeStorage.atom;

export function readOverviewTimelineRange(
    storage: Parameters<typeof timelineRangeStorage.read>[0]
): OverviewTimelineRange {
    return timelineRangeStorage.read(storage);
}

export function writeOverviewTimelineRange(
    storage: Parameters<typeof timelineRangeStorage.write>[0],
    range: OverviewTimelineRange
): OverviewTimelineRange | null {
    return timelineRangeStorage.write(storage, range);
}

export function formatTimelineRangeLabel(rangeHours: OverviewTimelineRange): string {
    return rangeHours >= 24 ? `${Math.round(rangeHours / 24)}d` : `${rangeHours}h`;
}

export function timelineRangeToMs(rangeHours: OverviewTimelineRange): number {
    return rangeHours * 3_600_000;
}

/** 时间线需要的最小卡片形状（board card 已满足，测试里可以只给这几个字段）。 */
export type OverviewTimelineCardLike = {
    blockId: string;
    sessionId: string;
    title: string;
    avatar: OverviewBoardAvatar;
    providerLabel: string;
    projectName: string;
};

export type OverviewTimelineSessionInfo = {
    /** ms；缺失 = 0。 */
    createdAt?: number | null;
    updatedAt?: number | null;
    messageCount?: number | null;
    live?: boolean | null;
};

export type OverviewTimelineRow = {
    blockId: string;
    sessionId: string;
    title: string;
    avatar: OverviewBoardAvatar;
    providerLabel: string;
    projectName: string;
    messageCount: number;
    /** 当前 AgentDisplayState（working/blocked/done/idle/stale），未知为 null。 */
    state: string | null;
    startedAt: number;
    startUnknown: boolean;
    endedAt: number;
    lastActivityAt: number;
    live: boolean;
    /**
     * 当前状态的起始时刻（`AgentStatus.activeSince`）。0 = 未知。
     *
     * 这是**真实报告时刻**，不是从尾巴倒推的估算 —— 分段起点用它，不再用 tailMsFor。
     */
    activeSince: number;
    /**
     * 最近一次完成跳变时刻（`AgentStatus.completedAt`）。0 = 无 / 已被下一次 working 清空。
     *
     * 甘特图上的「完成点竖刻度」与 idle 段起点都用它。
     */
    completedAt: number;
};

/**
 * 时间线的段（0..100 的宽度百分比）。
 *
 * 与 `OverviewTimelineSegment`（毫秒）分开：渲染层只吃百分比，模型层只算毫秒，
 * 中间换算集中在 `buildTimelineBar` 一处，避免两边各自除窗口宽度。
 */
export type OverviewTimelineSegmentPct = {
    state: string;
    widthPct: number;
};

export type OverviewTimelineBar = {
    leftPct: number;
    widthPct: number;
    /** @deprecated G1 的「猜出来的尾巴」。新代码读 `segments`；保留一个版本避免老测试全红。 */
    tailPct: number;
    state: string | null;
    /** 真实分段（无历史时是「一段 unknown + 一段当前态」两段）。 */
    segments: OverviewTimelineSegmentPct[];
    /** `completedAt` 在本行 bar 内的位置（0..100）；null = 无完成点或超窗。 */
    completedPct: number | null;
};

/**
 * 毫秒区间的状态段。
 *
 * `state` 为 `"unknown"` 表示「当时在干什么不知道」——画成斜纹，不谎报状态。
 */
export type OverviewTimelineSegment = {
    state: string;
    fromMs: number;
    toMs: number;
};

export type OverviewTimelineTick = {
    label: string;
    leftPct: number;
};

function clampPct(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.min(100, Math.max(0, value));
}

function positiveOrZero(value: number | null | undefined): number {
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/** 尾巴（当前状态色段）最短 6 分钟、最长 20% 条宽 —— G1 没有精确的状态切换时刻，只能给视觉近似。 */
const TailMinMs = 6 * 60_000;

function tailMsFor(spanMs: number): number {
    return Math.max(TailMinMs, Math.min(spanMs * 0.2, 30 * 60_000));
}

/**
 * 构时间线行（已排序、已按窗口过滤）。
 *
 * - 只保留「窗口内有活动」的会话：`endedAt >= windowStart`（终点更早的会话不占屏）。
 * - 排序：最后活动时间倒序（最上面 = 刚刚动过的），同时间按标题。
 * - `createdAt` 缺失 → 起点退到 `updatedAt`，并标 `startUnknown`。
 * - `live` 会话的终点延到 now。
 */
export function buildTimelineRows(
    cards: readonly OverviewTimelineCardLike[],
    opts: {
        nowMs: number;
        windowMs: number;
        sessions: Readonly<Record<string, OverviewTimelineSessionInfo | null | undefined>>;
        states: Readonly<Record<string, string | null | undefined>>;
        /** 当前状态的起始时刻（AgentStatus.activeSince）：没有会话摘要时用它当条起点。 */
        activeSince?: Readonly<Record<string, number | null | undefined>>;
        /** 最近一次完成跳变时刻（AgentStatus.completedAt）：画完成点竖刻度。 */
        completedAt?: Readonly<Record<string, number | null | undefined>>;
    }
): OverviewTimelineRow[] {
    const windowStart = opts.nowMs - opts.windowMs;
    const rows: OverviewTimelineRow[] = [];
    for (const card of cards) {
        const session = card.sessionId ? opts.sessions[card.sessionId] : null;
        const updatedAt = positiveOrZero(session?.updatedAt);
        const createdAt = positiveOrZero(session?.createdAt);
        const live = session?.live === true;
        const endedAt = live ? opts.nowMs : updatedAt > 0 ? updatedAt : opts.nowMs;
        if (endedAt < windowStart) continue;
        const startUnknown = createdAt <= 0;
        // 没有 createdAt 时优先用「当前状态开始时间」（真实已知的活动起点），
        // 再退回 updatedAt（一个点），最后用 now —— 三者都比编造一个起点诚实。
        const activeSince = positiveOrZero(opts.activeSince?.[card.blockId]);
        const completedAt = positiveOrZero(opts.completedAt?.[card.blockId]);
        const startedAt = !startUnknown
            ? createdAt
            : activeSince > 0 && activeSince < endedAt
              ? activeSince
              : updatedAt > 0
                ? updatedAt
                : opts.nowMs;
        rows.push({
            blockId: card.blockId,
            sessionId: card.sessionId,
            title: card.title,
            avatar: card.avatar,
            providerLabel: card.providerLabel,
            projectName: card.projectName,
            messageCount: Math.max(0, Math.floor(session?.messageCount ?? 0)),
            state: card.blockId ? (opts.states[card.blockId] ?? null) : null,
            startedAt: Math.min(startedAt, endedAt),
            startUnknown,
            endedAt,
            lastActivityAt: updatedAt > 0 ? updatedAt : endedAt,
            live,
            activeSince,
            completedAt,
        });
    }
    return rows.sort((a, b) => {
        if (b.lastActivityAt !== a.lastActivityAt) return b.lastActivityAt - a.lastActivityAt;
        return a.title.localeCompare(b.title);
    });
}

/**
 * 条在窗口里的位置。完全落在窗口左侧（更早）→ `null`（调用方不画）。
 * 跨越窗口左边界的条会被裁到 0%。
 */
/**
 * 时间线一次最多画多少行。7d 窗口 + 大量历史会话时行数会爆炸（每行一个 DOM 轨道），
 * 这里按"最后活动倒序"截断，剩下的用一行汇总（`hiddenCount`），避免滚动卡顿。
 */
export const OverviewTimelineMaxRows = 40;

export type OverviewTimelineRowSplit<T> = {
    visible: T[];
    hiddenCount: number;
};

/** 截断行 + 给出隐藏数量（隐藏的都是更早的，因为 rows 已按活动时间倒序）。 */
export function splitTimelineRows<T>(
    rows: readonly T[],
    maxRows = OverviewTimelineMaxRows
): OverviewTimelineRowSplit<T> {
    const limit = Number.isFinite(maxRows) ? Math.max(0, Math.floor(maxRows)) : rows.length;
    if (rows.length <= limit) {
        return { visible: [...rows], hiddenCount: 0 };
    }
    return { visible: rows.slice(0, limit), hiddenCount: rows.length - limit };
}

/** 最小可见宽度：会话没有时间戳（startUnknown 且 span=0）时也要画出一枚「就发生在现在」的点。 */
const MinBarWidthPct = 0.9;

/**
 * 构一段真实状态分段（G2.1）。
 *
 * **不做的事**：不编造中间段。没有 per-block 状态历史时，只能给出两段：
 *
 * ```
 * [startedAt ──── activeSince)  unknown（不知道自己当时在干什么）
 * [activeSince ── endedAt]     当前状态（真实报告时刻起算）
 * ```
 *
 * 三个边界全部来自**已有真实字段**：`startedAt`（会话创建）、`activeSince`
 * （`AgentStatus.activeSince`，后端在同一 state 连续上报时保留首个时刻）、
 * `endedAt`（live → now，否则 updatedAt）。
 *
 * 与旧的 `tailMsFor` 的区别：旧法尾巴宽度 = `max(6min, min(span*20%, 30min))`，
 * 与真实状态切换无关，所以「运行阶段多久 / 完成点在哪」永远读不对。
 *
 * 局限（必须诚实）：画不出 `working → idle → working` 的多次交替。要画出来需要后端
 * 环形历史，见 `design/plans/overview-board-timeline.md` §4 的 G2 方案。
 */
export function buildTimelineSegments(
    row: OverviewTimelineRow,
    opts: { nowMs: number; windowMs: number; history?: readonly OverviewTimelineSegment[] }
): OverviewTimelineSegment[] {
    const windowStart = opts.nowMs - opts.windowMs;
    const from = Math.max(row.startedAt, windowStart);
    const to = Math.min(row.endedAt, opts.nowMs);
    if (to <= from) {
        // 零宽会话：给一个「就发生在 to 这一点」的段，调用方用最小宽度画出来。
        return [{ state: row.state ?? "unknown", fromMs: to, toMs: to }];
    }

    // 有历史（目前没有调用方传，留给后端 ring buffer 落地后接）→ 直接裁剪使用。
    const history = opts.history;
    if (history != null && history.length > 0) {
        const clipped: OverviewTimelineSegment[] = [];
        for (const segment of history) {
            const segFrom = Math.max(segment.fromMs, from);
            const segTo = Math.min(segment.toMs, to);
            if (segTo <= segFrom) continue;
            clipped.push({ state: segment.state, fromMs: segFrom, toMs: segTo });
        }
        if (clipped.length > 0) {
            // 历史首段之前若有空洞，补 unknown（宁可斜纹，也不谎报状态）。
            if (clipped[0].fromMs > from) {
                clipped.unshift({ state: "unknown", fromMs: from, toMs: clipped[0].fromMs });
            }
            return clipped;
        }
    }

    // 无历史：两段（unknown 历史 + 当前态）。activeSince 必须落在 [from, to] 内才用它。
    const currentState = row.state ?? "unknown";
    const currentFrom =
        row.activeSince > 0 && row.activeSince > from && row.activeSince < to ? row.activeSince : null;
    if (currentFrom == null) {
        return [{ state: currentState, fromMs: from, toMs: to }];
    }
    return [
        { state: "unknown", fromMs: from, toMs: currentFrom },
        { state: currentState, fromMs: currentFrom, toMs: to },
    ];
}

export function buildTimelineBar(
    row: OverviewTimelineRow,
    opts: { nowMs: number; windowMs: number; history?: readonly OverviewTimelineSegment[] }
): OverviewTimelineBar | null {
    const windowStart = opts.nowMs - opts.windowMs;
    if (row.endedAt <= windowStart) return null;
    const from = Math.max(row.startedAt, windowStart);
    const to = Math.min(row.endedAt, opts.nowMs);
    const spanMs = Math.max(0, to - from);
    let leftPct = clampPct(((from - windowStart) / opts.windowMs) * 100);
    let widthPct = clampPct((spanMs / opts.windowMs) * 100);
    if (widthPct < MinBarWidthPct) {
        // 零宽/极短的条：先撑到最小可见宽度，再把左边往回挪，避免越过 now 线。
        widthPct = MinBarWidthPct;
        leftPct = clampPct(Math.min(leftPct, 100 - MinBarWidthPct));
    }

    const segments = buildTimelineSegments(row, opts);
    const totalMs = spanMs > 0 ? spanMs : 0;
    const segmentPct: OverviewTimelineSegmentPct[] =
        totalMs === 0
            ? [{ state: segments[0]?.state ?? row.state ?? "unknown", widthPct: 100 }]
            : segments.map((segment) => ({
                  state: segment.state,
                  widthPct: clampPct(((segment.toMs - segment.fromMs) / totalMs) * 100),
              }));

    // 完成点：`completedAt` 落在 [from, to] 内才画（超窗不画，避免误导）。
    const completedPct =
        row.completedAt > 0 && row.completedAt >= from && row.completedAt <= to && totalMs > 0
            ? clampPct(((row.completedAt - from) / totalMs) * 100)
            : null;

    // 兼容字段：尾巴 = 最后一段的宽度（新渲染不再用它）。
    const tailPct = segmentPct.length === 0 ? 0 : segmentPct[segmentPct.length - 1].widthPct;

    return {
        leftPct,
        widthPct,
        tailPct,
        state: row.state,
        segments: segmentPct,
        completedPct,
    };
}

/**
 * 刻度：≤8h 用 `HH:MM`，≥24h 用 `MM/DD HH:MM`。
 * 等距 `tickCount` 段（含左右端点），左端是窗口起点、右端是 now。
 */
export function buildTimelineTicks(
    rangeHours: OverviewTimelineRange,
    nowMs: number,
    tickCount = rangeHours <= 8 ? 8 : 7
): OverviewTimelineTick[] {
    const safeCount = Math.max(1, Math.floor(tickCount));
    const windowMs = timelineRangeToMs(rangeHours);
    const ticks: OverviewTimelineTick[] = [];
    for (let i = 0; i <= safeCount; i++) {
        const leftPct = (i / safeCount) * 100;
        const atMs = nowMs - windowMs + (windowMs / safeCount) * i;
        ticks.push({ label: formatTickLabel(atMs, rangeHours), leftPct });
    }
    return ticks;
}

function pad2(value: number): string {
    return value < 10 ? `0${value}` : `${value}`;
}

function formatTickLabel(atMs: number, rangeHours: OverviewTimelineRange): string {
    const date = new Date(atMs);
    const hhmm = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
    if (rangeHours < 24) return hhmm;
    return `${pad2(date.getMonth() + 1)}/${pad2(date.getDate())} ${hhmm}`;
}
