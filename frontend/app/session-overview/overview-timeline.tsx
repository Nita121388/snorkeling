// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Overview 时间线视图（Gantt · G1 会话寿命条）。
//
// 每行 = 一个 agent 会话；条 = createdAt → (live ? now : updatedAt)；
// 尾巴一小段用当前状态色（与列头色点 / 卡片 chip 同一套 token），历史段斜纹表示「状态未知」。
// 位置/刻度全部来自 `overview-timeline-model.ts`（纯函数），这里只管渲染。

import { cn } from "@/util/util";
import {
    buildTimelineBar,
    buildTimelineTicks,
    splitTimelineRows,
    timelineRangeToMs,
    type OverviewTimelineRange,
    type OverviewTimelineRow,
} from "./overview-timeline-model";
import "./session-overview.scss";

export type OverviewTimelineProps = {
    rows: readonly OverviewTimelineRow[];
    range: OverviewTimelineRange;
    now: number;
    onOpenSession: (row: OverviewTimelineRow) => void;
};

/** 状态 → 尾巴配色类名。未知状态不给颜色（只画斜纹历史段）。 */
function stateClass(state: string | null): string {
    switch (state) {
        case "working":
        case "blocked":
        case "done":
        case "idle":
        case "stale":
            return `is-${state}`;
        default:
            return "";
    }
}

function pad2(value: number): string {
    return value < 10 ? `0${value}` : `${value}`;
}

/** `HH:MM`（完成点 tooltip 用）。0 返回空串，调用方据此跳过。 */
function formatClock(atMs: number): string {
    if (!atMs || atMs <= 0) return "";
    const date = new Date(atMs);
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function formatLastActivity(lastActivityAt: number, nowMs: number): string {
    if (!lastActivityAt || lastActivityAt <= 0) return "";
    const minutes = Math.floor(Math.max(0, nowMs - lastActivityAt) / 60_000);
    if (minutes < 1) return "now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

export function OverviewTimeline({ rows, range, now, onOpenSession }: OverviewTimelineProps) {
    const windowMs = timelineRangeToMs(range);
    const ticks = buildTimelineTicks(range, now);
    // 行数上限：超出的都是"更早"的会话，用一行汇总而不是继续堆 DOM。
    const { visible, hiddenCount } = splitTimelineRows(rows);
    if (rows.length === 0) {
        return (
            <div className="session-overview-empty">
                No agent sessions in the last {range >= 24 ? `${Math.round(range / 24)}d` : `${range}h`}.
            </div>
        );
    }
    return (
        <div className="session-overview-timeline" role="group" aria-label="Overview timeline">
            <div className="session-overview-timeline-axis">
                <span className="session-overview-timeline-axis-label">Agent</span>
                <div className="session-overview-timeline-ticks">
                    {ticks.map((tick, index) => (
                        <span
                            key={`${tick.label}-${index}`}
                            className="session-overview-timeline-tick"
                            style={{ left: `${tick.leftPct}%` }}
                        >
                            {tick.label}
                        </span>
                    ))}
                </div>
            </div>
            <div className="session-overview-timeline-rows">
                {visible.map((row) => {
                    const bar = buildTimelineBar(row, { nowMs: now, windowMs });
                    const age = formatLastActivity(row.lastActivityAt, now);
                    const meta = [row.providerLabel, row.projectName, `${row.messageCount} msgs`]
                        .filter((part) => part !== "" && part !== "0 msgs")
                        .join(" · ");
                    const title = [
                        row.title,
                        meta,
                        bar == null ? "outside window" : `${Math.round(bar.widthPct)}% of window`,
                        bar != null && bar.segments.length > 1 ? `${bar.segments.length} 段状态` : "",
                        bar?.completedPct != null ? `${formatClock(row.completedAt)} 完成` : "",
                        row.startUnknown ? "start unknown" : "",
                        row.live ? "live" : "",
                    ]
                        .filter((part) => part !== "")
                        .join("\n");
                    return (
                        <div
                            key={row.blockId}
                            className="session-overview-timeline-row"
                            data-block-id={row.blockId}
                            data-agent-like="true"
                            role="button"
                            tabIndex={0}
                            title={title}
                            onClick={() => onOpenSession(row)}
                            onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault();
                                    onOpenSession(row);
                                }
                            }}
                            aria-label={`Open session ${row.title}`}
                        >
                            <div className="session-overview-timeline-row-id">
                                <span className="session-overview-timeline-avatar" aria-hidden="true">
                                    {row.avatar.kind === "emoji" ? (
                                        <span className="agent-emoji-icon">{row.avatar.emoji}</span>
                                    ) : row.avatar.kind === "logo" ? (
                                        <span style={row.avatar.color ? { color: row.avatar.color } : undefined}>
                                            {row.avatar.icon}
                                        </span>
                                    ) : (
                                        <i className={row.avatar.iconClass} />
                                    )}
                                </span>
                                <span className="session-overview-timeline-row-text">
                                    <span className="session-overview-timeline-row-title">{row.title}</span>
                                    <span className="session-overview-timeline-row-meta">
                                        {meta}
                                        {age ? ` · ${age}` : ""}
                                    </span>
                                </span>
                            </div>
                            <div className="session-overview-timeline-track">
                                {bar == null ? null : (
                                    <div
                                        className="session-overview-timeline-bar"
                                        data-state={row.state ?? "unknown"}
                                        data-start-unknown={row.startUnknown ? "true" : "false"}
                                        data-segments={bar.segments.length}
                                        data-completed={bar.completedPct == null ? "none" : "true"}
                                        // 极短会话（无时间戳/刚开始）也要看得见：CSS 侧兜一个 8px 最小宽度，
                                        // left 用 min() 夹住，避免最小宽度的条越过 now 线。
                                        style={{
                                            left: `min(${bar.leftPct}%, calc(100% - 8px))`,
                                            width: `max(${bar.widthPct}%, 8px)`,
                                        }}
                                    >
                                        {bar.segments.map((segment, index) => (
                                            <span
                                                key={`${segment.state}-${index}`}
                                                className={cn(
                                                    "session-overview-timeline-bar-seg",
                                                    stateClass(segment.state)
                                                )}
                                                style={{ width: `${segment.widthPct}%` }}
                                                aria-hidden="true"
                                            />
                                        ))}
                                        {/* 完成点竖刻度：completedAt 在窗口内的精确位置。 */}
                                        {bar.completedPct == null ? null : (
                                            <span
                                                className="session-overview-timeline-bar-completed"
                                                style={{ left: `${bar.completedPct}%` }}
                                                title="完成时刻"
                                                aria-hidden="true"
                                            />
                                        )}
                                    </div>
                                )}
                                <span className="session-overview-timeline-now" aria-hidden="true" />
                            </div>
                        </div>
                    );
                })}
            </div>
            {hiddenCount > 0 ? (
                <div className="session-overview-timeline-more" data-hidden-count={hiddenCount}>
                    还有 {hiddenCount} 个更早的会话未显示（按最后活动倒序，最多显示 40 行）
                </div>
            ) : null}
            <div className="session-overview-timeline-legend">
                <span>
                    <i className="session-overview-timeline-legend-swatch is-working" />
                    运行
                </span>
                <span>
                    <i className="session-overview-timeline-legend-swatch is-idle" />
                    空闲
                </span>
                <span>
                    <i className="session-overview-timeline-legend-swatch is-completed" />
                    完成点
                </span>
                <span>
                    <i className="session-overview-timeline-legend-swatch is-history" />
                    状态未知（历史段）
                </span>
                <span
                    className="session-overview-timeline-legend-hint"
                    title="当前状态段的起点来自 AgentStatus.activeSince；多次状态交替需要后端保留转移序列，目前还画不出来。"
                >
                    条长 = 会话寿命；当前段起点 = activeSince
                </span>
            </div>
        </div>
    );
}
