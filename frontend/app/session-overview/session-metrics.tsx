// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Overview 卡片 / 列表行的度量轨：消息数 · 体积 · 活跃跨度 · 创建日期。
//
// 单一渲染入口（`BoardCard` 与 `BlockRow` 都调它，靠 `surface` 分视觉差异）——
// 阈值、缩写、缺数据规则只存在一份，避免两处实现漂移。
//
// 三个「多久」必须可分辨（见 prd R4）：
//   卡头 age `1d`  = 距最后一次活动多久（updatedAt → now）
//   chip `12m`     = 当前这一步/轮跑了多久（phaseSince/activeSince → now）
//   本轨 `↔3d`     = 从创建到最后一次活动跨了多久（createdAt → updatedAt|now）
// 前两个单位与本轨都是"时间"，所以 `↔` 前缀是硬要求，不是装饰。

import type { SessionMetricsView } from "./session-metrics-view";
import { buildSessionMetrics } from "./session-metrics-view";

export type SessionMetricsSurface = "board" | "row";

export type SessionMetricsProps = {
    surface: SessionMetricsSurface;
    messageCount?: number | null;
    size?: number | null;
    /** 必须是毫秒（调用方先过 `normalizeTimeMs`）。 */
    createdAt?: number | null;
    updatedAt?: number | null;
    /** live 会话的活跃跨度走到 now。 */
    live?: boolean | null;
    now: number;
};

function countMetrics(view: SessionMetricsView): number {
    return [view.message, view.size, view.span, view.created].filter((item) => item != null).length;
}

/**
 * 热力格：12×12 的槽 + 内部按档位填充。
 *
 * 为什么是"填充高度 + 透明度"双通道：暗色主题下 5 档纯灰阶几乎分不开（aisessions 的
 * `HeatCell` 踩过同一个坑），填充高度是形状编码，色弱/单色主题下仍然可比。
 */
function HeatCell({ level, fillPct }: { level: number; fillPct: number }) {
    return (
        <span className="session-metric-heat" data-level={level} aria-hidden="true">
            <i style={{ height: `${fillPct}%` }} />
        </span>
    );
}

export function SessionMetrics({ surface, messageCount, size, createdAt, updatedAt, live, now }: SessionMetricsProps) {
    const view = buildSessionMetrics({ messageCount, size, createdAt, updatedAt, live, nowMs: now });
    if (view == null) {
        return null;
    }

    return (
        <span
            className={surface === "row" ? "session-metrics is-row" : "session-metrics is-board"}
            data-metrics-count={countMetrics(view)}
        >
            {view.message ? (
                <span
                    className="session-metric"
                    data-metric="msg"
                    title={view.message.title}
                    aria-label={view.message.ariaLabel}
                >
                    <HeatCell level={view.message.level} fillPct={view.message.fillPct} />
                    <span className="session-metric-value">{view.message.text}</span>
                </span>
            ) : null}
            {view.size ? (
                <span
                    className="session-metric"
                    data-metric="size"
                    title={view.size.title}
                    aria-label={view.size.ariaLabel}
                >
                    <HeatCell level={view.size.level} fillPct={view.size.fillPct} />
                    <span className="session-metric-value">{view.size.text}</span>
                </span>
            ) : null}
            {view.span ? (
                <span
                    className="session-metric is-span"
                    data-metric="span"
                    title={view.span.title}
                    aria-label={view.span.ariaLabel}
                >
                    <span className="session-metric-bar" aria-hidden="true">
                        <i style={{ width: `${view.span.fillPct}%` }} />
                    </span>
                    <span className="session-metric-value">
                        <span className="session-metric-mark" aria-hidden="true">
                            {view.span.mark}
                        </span>
                        {view.span.text}
                    </span>
                </span>
            ) : null}
            {view.created ? (
                <span
                    className="session-metric is-created"
                    data-metric="created"
                    title={view.created.title}
                    aria-label={view.created.ariaLabel}
                >
                    <span className="session-metric-value">{view.created.text}</span>
                </span>
            ) : null}
        </span>
    );
}
