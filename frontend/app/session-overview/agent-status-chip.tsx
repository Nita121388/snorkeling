// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 共享的 AgentStatus chip：列表行、看板卡片、之后的其他面都用这一份。
//
// 抽出原因：看板卡片此前只有一个 8px 色点，状态词/时长/ack 语义与列表行的 chip 是两套实现。
// 现在只有一个实现，颜色、文案、点击 ack 的落点天然一致。
//
// 只依赖 `agent-status` 与 `util`，不 import `session-overview.tsx`，避免循环依赖。

import { agentStatusPresentation, isInferredAgentStatus } from "@/app/agent-status/agent-status-derive";
import type { AgentStatus } from "@/app/agent-status/agent-status-types";
import { Tooltip } from "@/app/element/tooltip";
import { cn, formatCompactDuration, makeIconClass } from "@/util/util";

export function statusDurationText(status: AgentStatus, now: number): string {
    if (status.state === "idle" || status.state === "unknown") return "";
    const start = status.activeSince ?? status.updatedAt;
    if (!start) return "";
    return formatCompactDuration(start, now);
}

export function shouldShowAgentStatusChip(status: AgentStatus): boolean {
    return status.state !== "idle" && status.state !== "unknown";
}

export function AgentStatusChip({
    status,
    now,
    blockId,
    unread,
    onAck,
    className,
}: {
    status: AgentStatus;
    now: number;
    blockId: string;
    unread: boolean;
    onAck: (blockId: string, status: AgentStatus) => void;
    /** Extra classes for surface-specific sizing (board cards use a compact variant). */
    className?: string;
}) {
    const presentation = agentStatusPresentation(status);
    const duration = statusDurationText(status, now);
    const inferred = isInferredAgentStatus(status);
    const tooltipText = unread ? `${presentation.label} — click to mark as read` : `${presentation.label} — up to date`;
    return (
        <Tooltip content={tooltipText} placement="top" hideOnClick divClassName="inline-flex">
            <button
                type="button"
                className={cn(
                    "session-overview-agent-status",
                    `is-${status.state}`,
                    status.phase !== "none" && `phase-${status.phase}`,
                    inferred && "is-inferred",
                    !unread && "is-acked",
                    className
                )}
                onClick={(event) => {
                    event.stopPropagation();
                    onAck(blockId, status);
                }}
                aria-label={tooltipText}
            >
                <i className={makeIconClass(presentation.icon, false)} />
                <span className="session-overview-agent-status-label">{presentation.label}</span>
                {duration ? <span className="session-overview-agent-status-age">{duration}</span> : null}
            </button>
        </Tooltip>
    );
}
