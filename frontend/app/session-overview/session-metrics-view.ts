// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Overview 卡片度量（消息数 / 体积 / 活跃跨度 / 创建日期）的**纯数据整形层**（`*-view.ts`
// = 纯 view model，`.tsx` = 组件；同 aisessions 的 `session-run-badge-view.ts` 约定）。
//
// 为什么独立成纯函数（同 `session-run-badge-view.ts` 的套路）：阈值档位、数字缩写、
// 缺数据规则、跨年日期这四类判定都能被单测逐条钉死，组件只剩"把 view 装配成 span"。
// 本仓没有 @testing-library，纯函数是唯一低成本的锁。
//
// **阈值与格式化一律从 aisessions 借**：`HeatCell` 那套（消息数 / 体积）已经用它自己的
// 实测分布定标过（中位 5 条 / p90 100 条；中位 122KB / p90 1.9MB），抄一份必然漂移 ——
// 这个仓库在 agent status chip 上已经吃过"4 份实现各自漂移"的亏。
//
// 时间戳约定：本模块**不做秒/毫秒归一化**，调用方必须先过 `normalizeTimeMs`
// （`frontend/app/session-overview/session-overview.tsx` 已有同名局部函数）。
// 归一化规则在本仓已被抄了 3 份，这里不再加第 4 份。

import {
    formatDateTimeToSecond,
    formatFileSize,
    formatSessionDateCompact,
    heatLevel,
    MessageHeatThresholds,
    SizeHeatThresholds,
} from "@/app/view/aisessions/utils";

/**
 * 活跃跨度（createdAt → 最后一次活动 / now）的档位阈值（毫秒，1..5 档的第 1~4 个分界）。
 *
 * 为什么不是"比例条"：`span / (now − createdAt)` 对老会话恒接近 100%，没有信息量；
 * 档位条跨卡可比，且与两个热力格共用同一套"档位 × 20% 填充"的形状词汇。
 * 分界取 10 分钟 / 1 小时 / 8 小时 / 1 天：覆盖"刚开 / 一轮对话 / 半天活 / 跨天"四个量级。
 */
export const SpanHeatThresholds = [10 * 60_000, 60 * 60_000, 8 * 3_600_000, 24 * 3_600_000] as const;

/** 每个档位对应的填充比例（%）。1 档 20% …… 5 档 100%。 */
const HeatFillStepPct = 20;

export type SessionMetricsInput = {
    messageCount?: number | null;
    size?: number | null;
    createdAt?: number | null;
    updatedAt?: number | null;
    /** `SessionSummary.live`：live 会话的跨度一直走到 now，否则停在最后一次活动。 */
    live?: boolean | null;
    nowMs: number;
};

export type SessionHeatMetric = {
    /** 1..5 */
    level: number;
    /** 填充高度百分比（`level × 20`），热力格与档位条共用。 */
    fillPct: number;
    text: string;
    title: string;
    ariaLabel: string;
};

export type SessionMetricsView = {
    message?: SessionHeatMetric;
    size?: SessionHeatMetric;
    span?: SessionHeatMetric & { mark: "↔" };
    created?: { text: string; title: string; ariaLabel: string };
};

/** 紧凑时长（度量轨里的那一格）：`<1m` / `37m` / `3h` / `12d`。 */
export function formatCompactSpan(ms: number): string {
    if (!Number.isFinite(ms) || ms <= 0) return "";
    const minutes = Math.floor(ms / 60_000);
    if (minutes < 1) return "<1m";
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
}

/**
 * 精确到分/时的时长（只给 tooltip）：`37m` / `1h05m` / `3d4h`。
 *
 * 与 `agent-status-runtime.formatAgentChipRuntime` 的区别：那个要秒级（`12min34s`）且输入是
 * "起点 + now"，chip 用来表达「正在跑多久」；这里输入是"一段跨度"，口语里不需要秒。
 */
export function formatSpanDetail(ms: number): string {
    if (!Number.isFinite(ms) || ms <= 0) return "0m";
    const totalMinutes = Math.floor(ms / 60_000);
    if (totalMinutes < 60) return `${totalMinutes}m`;
    const totalHours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (totalHours < 24) return `${totalHours}h${String(minutes).padStart(2, "0")}m`;
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    return `${days}d${hours}h`;
}

function heatMetric(
    value: number,
    thresholds: readonly number[],
    text: string,
    title: string,
    ariaLabel: string
): SessionHeatMetric {
    const level = heatLevel(value, thresholds);
    return { level, fillPct: level * HeatFillStepPct, text, title, ariaLabel };
}

/** 消息数：≥10000 走 `12.3k`，避免窄列里 5 位数字把其余度量挤掉。 */
export function formatMessageCount(count: number): string {
    if (!Number.isFinite(count) || count <= 0) return "";
    if (count >= 10_000) return `${(count / 1000).toFixed(1)}k`;
    return String(count);
}

/**
 * 唯一入口。返回 `null` 表示**四格全缺** —— 调用方据此整条轨道不渲染
 * （不留一条空分割线，也不让卡片高度出现"半截"）。
 */
export function buildSessionMetrics(input: SessionMetricsInput): SessionMetricsView | null {
    const { nowMs } = input;
    const view: SessionMetricsView = {};

    const messageCount = input.messageCount ?? 0;
    if (Number.isFinite(messageCount) && messageCount > 0) {
        view.message = heatMetric(
            messageCount,
            MessageHeatThresholds,
            formatMessageCount(messageCount),
            `${messageCount} 条消息`,
            `${messageCount} messages`
        );
    }

    const size = input.size ?? 0;
    if (Number.isFinite(size) && size > 0) {
        const sizeText = formatFileSize(size);
        view.size = heatMetric(
            size,
            SizeHeatThresholds,
            sizeText.replace(" ", ""),
            `会话文件 ${sizeText}（${size} bytes）`,
            `Session size ${sizeText}`
        );
    }

    const createdAt = Math.max(0, input.createdAt ?? 0);
    const live = input.live === true;
    const updatedAt = Math.max(0, input.updatedAt ?? 0);
    const spanEnd = live ? nowMs : updatedAt;
    if (createdAt > 0 && spanEnd > 0) {
        // 脏数据（updatedAt 早于 createdAt）钳到 0，不画出负跨度。
        const spanMs = Math.max(0, spanEnd - createdAt);
        const spanText = spanMs > 0 ? formatCompactSpan(spanMs) : "<1m";
        const endLabel = live ? "现在" : formatDateTimeToSecond(spanEnd);
        view.span = {
            ...heatMetric(
                spanMs,
                SpanHeatThresholds,
                spanText,
                `活跃跨度 ${formatSpanDetail(spanMs)}：${formatDateTimeToSecond(createdAt)} → ${endLabel}`,
                `Active span ${spanText}`
            ),
            mark: "↔",
        };
    }

    if (createdAt > 0) {
        const createdFull = formatDateTimeToSecond(createdAt);
        view.created = {
            // 跨年自动带年份（`2025-12-11`），同年只给 `12-11` —— 与 aisessions 列表行同一口径。
            text: formatSessionDateCompact(createdAt, nowMs, false),
            title: `创建：${createdFull}`,
            ariaLabel: `Created ${createdFull}`,
        };
    }

    return view.message || view.size || view.span || view.created ? view : null;
}
