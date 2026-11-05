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
};

export type OverviewTimelineBar = {
    leftPct: number;
    widthPct: number;
    /** 当前状态色段占整条宽度的比例（0..100）。 */
    tailPct: number;
    state: string | null;
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
/** 最小可见宽度：会话没有时间戳（startUnknown 且 span=0）时也要画出一枚「就发生在现在」的点。 */
const MinBarWidthPct = 0.9;

export function buildTimelineBar(
    row: OverviewTimelineRow,
    opts: { nowMs: number; windowMs: number }
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
    const tailPct =
        spanMs <= 0
            ? row.state == null
                ? 0
                : 100
            : row.state == null
              ? 0
              : clampPct((Math.min(tailMsFor(spanMs), spanMs) / spanMs) * 100);
    return {
        leftPct,
        widthPct,
        tailPct,
        state: row.state,
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
