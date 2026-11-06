// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// AgentStatusChip —— 全仓唯一的状态徽章组件。
//
// 历史：chip 曾有 4 份实现（本文件的旧版 = Overview 列表/看板；悬浮卡与放大弹窗
// 用 info-card.scss 的 `.agent-card-status-chip`；Tab 聚合用 AggregateStatusChip；
// Block 头部是 term-model 自己拼的 HeaderElem 文本）。只有判定层是共享的，
// 几何/文案/跑时各写一份，于是同一个状态换个位置就漂移 —— 悬浮卡甚至不产出跑时，
// 且 20px/10.5px 的胶囊与 18px/10px 的圆角在光学上不是一回事（文字看着不居中）。
//
// 现在：**呈现数据全部来自 `buildAgentStatusChipView()`**（纯函数，React 无关），
// 本组件只负责把 view 装配成 DOM，`variant` 只决定几何与装饰。
//
// 性能约定（不要改）：
//   秒级跑时由 `agentStatusSecondTickAtom` 驱动，**只有本组件订阅**，
//   且被 React.memo 包裹（status 引用 / unread / variant / now 变化才重渲染）。
//   绝不允许把 tick 提到 SessionOverviewPanel —— 那里的 `now` 被 boardCards、
//   timelineRows 两个 memo 与看板 useLayoutEffect 依赖。

import { needsAgentChipRuntime } from "@/app/agent-status/agent-status-runtime";
import { agentStatusSecondTickAtom } from "@/app/agent-status/agent-status-second-tick";
import type { AgentStatus, AgentStatusAggregate } from "@/app/agent-status/agent-status-types";
import { agentStatusAccent } from "@/app/agent-status/agent-status-view";
import { Tooltip } from "@/app/element/tooltip";
import { cn, makeIconClass, useAtomValueSafe } from "@/util/util";
import * as React from "react";
import "@/app/agent-status/agent-status-chip.scss";
import { buildAgentStatusChipView, type AgentStatusChipVariant } from "@/app/agent-status/agent-status-chip-view";
import { agentStatusPresentation } from "@/app/agent-status/agent-status-derive";

/** 已废弃的几何辅助函数，保留导出以免打断既有调用点。 */
export function shouldShowAgentStatusChip(status: AgentStatus): boolean {
    return status.state !== "idle" && status.state !== "unknown";
}

type AgentStatusChipProps = {
    variant?: AgentStatusChipVariant;
    status?: AgentStatus | null;
    /** 仅 variant="aggregate"。 */
    aggregate?: AgentStatusAggregate | null;
    /** 面板 30s tick / 测试注入；跑时取 max(now, 秒级 tick)。 */
    now: number;
    unread: boolean;
    blockId?: string;
    onAck?: (blockId: string, status: AgentStatus) => void;
    /** 仅 variant="aggregate"：聚合 chip 的 ack 不带 blockId。 */
    onAckAggregate?: () => void;
    className?: string;
};

function AgentStatusChipInner({
    variant = "list",
    status = null,
    aggregate = null,
    now,
    unread,
    blockId = "",
    onAck,
    onAckAggregate,
    className,
}: AgentStatusChipProps) {
    // 只有活跃态需要秒级刷新；其余面保持 0 订阅，不白付 1Hz 代价。
    const tickEnabled = variant === "aggregate" ? false : needsAgentChipRuntime(status);
    const tick = tickEnabled ? (useAtomValueSafe(agentStatusSecondTickAtom) ?? 0) : 0;
    const view = buildAgentStatusChipView({
        variant,
        status,
        aggregate,
        read: unread ? "unread" : "seen",
        nowMs: Math.max(now, tick),
    });
    if (view == null) {
        return null;
    }
    const presentation = status != null && variant !== "aggregate" ? agentStatusPresentation(status) : null;
    const accent =
        variant === "aggregate"
            ? undefined
            : agentStatusAccent(view.tone, unread ? "unread" : "seen");
    const showIcon = variant !== "card" && variant !== "aggregate";
    const showDot = variant === "card";
    const showRuntime = view.runtime !== "";
    const rootClass = cn(view.className, className);
    const style = accent != null ? ({ "--agent-status-color": accent } as React.CSSProperties) : undefined;
    const ackClick = (event: React.MouseEvent) => {
        event.stopPropagation();
        if (variant === "aggregate") {
            onAckAggregate?.();
            return;
        }
        if (status != null) {
            onAck?.(blockId, status);
        }
    };
    const readAttr = unread ? "unread" : "seen";
    const content = (
        <>
            {showIcon && presentation != null ? <i className={makeIconClass(presentation.icon, false)} /> : null}
            {showDot ? (
                // 兼容类名（.agent-card-status-dot + is-*）是 verify 探针的契约，
                // 动画已由 agent-status-chip.scss 的新类名驱动，旧类只作选择器锚点保留。
                <span
                    className={cn("agent-status-chip-dot", "agent-card-status-dot", {
                        "is-working": view.tone === "working",
                        "is-thinking": view.tone === "working" && status?.phase === "thinking",
                        "is-done-unread": unread && view.tone === "done",
                        "is-seen": !unread,
                    })}
                />
            ) : null}
            <span className="agent-status-chip-label">{view.label}</span>
            {showRuntime ? <span className="agent-status-chip-runtime">{view.runtime}</span> : null}
        </>
    );
    const interactive = variant === "aggregate" ? true : onAck != null && status != null;
    // data-agent-read 必须在**所有**渲染分支上都有：verify 台按它断言 read，
    // 缺一个分支就会让某一面永远读到 null（实测：ack 后卡片面读到 null 而报红）。
    const readDataAttr = variant === "aggregate" || variant === "header" ? {} : { "data-agent-read": readAttr };

    if (variant === "aggregate") {
        // 嵌在 tab-toggle 的 <button> 里，嵌套 button 非法 → role="button" span。
        return (
            <Tooltip content={view.title} placement="top" hideOnClick divClassName="inline-flex">
                <span
                    role="button"
                    tabIndex={0}
                    className={rootClass}
                    style={style}
                    onClick={ackClick}
                    onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            ackClick(event as unknown as React.MouseEvent);
                        }
                    }}
                    aria-label={view.title}
                >
                    {content}
                </span>
            </Tooltip>
        );
    }
    if (variant === "header") {
        // HeaderElem 走 term-model 的纯文本路径，本分支只服务「测试/预览」等 React 场景。
        return (
            <span className={rootClass} style={style} title={view.title} aria-label={view.title} {...readDataAttr}>
                {content}
            </span>
        );
    }
    if (!interactive) {
        return (
            <span className={rootClass} style={style} title={view.title} aria-label={view.title} {...readDataAttr}>
                {content}
            </span>
        );
    }
    return (
        <Tooltip content={view.title} placement="top" hideOnClick divClassName="inline-flex">
            <button
                type="button"
                className={rootClass}
                style={style}
                onClick={ackClick}
                aria-label={view.title}
                {...readDataAttr}
            >
                {content}
            </button>
        </Tooltip>
    );
}

export const AgentStatusChip = React.memo(AgentStatusChipInner, (prev, next) => {
    return (
        prev.status === next.status &&
        prev.aggregate === next.aggregate &&
        prev.unread === next.unread &&
        prev.variant === next.variant &&
        prev.now === next.now &&
        prev.blockId === next.blockId &&
        prev.className === next.className &&
        prev.onAck === next.onAck &&
        prev.onAckAggregate === next.onAckAggregate
    );
});
AgentStatusChip.displayName = "AgentStatusChip";
