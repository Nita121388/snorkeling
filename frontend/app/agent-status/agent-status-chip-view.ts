// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// AgentStatusChipView —— 状态徽章的唯一呈现产出地（纯函数，React 无关）。
//
// 为什么需要它：chip 此前有 4 份实现（Overview 列表/看板、悬浮卡/放大弹窗、
// Tab 聚合、Block 头部 HeaderElem），只有判定层（deriveAgentStatusView）是共享的，
// 文案/类名/跑时各拼一份，于是同一个状态换个位置就漂移（悬浮卡甚至不产出跑时）。
//
// 现在：label / runtime / title / className 全部由本函数产出，React 组件与
// term-model 的 HeaderElem 都只消费它的输出，不再自己拼字符串。
//
// 两条不变量（单测锁死）：
//   I1 同一个 status 在 list / board / card / header 四个变体下 label、title、runtime 完全一致。
//   I2 className 保留既有兼容类（agent-card-status-chip / agent-status-header /
//      session-overview-agent-status / session-overview-agent-aggregate）——
//      scripts/verify 探针与外部样式依赖它们。

import {
    agentStatusPresentation,
    aggregateAgentStatuses,
    aggregateStatusLabel,
} from "./agent-status-derive";
import { agentDoneElapsedMs, formatDoneElapsed } from "./agent-status-done-unread";
import { formatAgentChipRuntime, needsAgentChipRuntime } from "./agent-status-runtime";
import type { AgentDisplayState, AgentStatus, AgentStatusAggregate } from "./agent-status-types";
import { deriveAgentStatusView, type AgentReadState } from "./agent-status-view";

export type AgentStatusChipVariant = "list" | "board" | "card" | "header" | "aggregate";

export type AgentStatusChipView = {
    /** 主文案：状态词（Working / Done / Tool: Bash …），aggregate 变体是聚合词。 */
    label: string;
    /** 运行时长文本，空串 = 不显示。 */
    runtime: string;
    /** 供 UI 选色的语义。 */
    tone: AgentDisplayState;
    /** 完整 tooltip。 */
    title: string;
    /** 是否值得让用户点一下确认。 */
    ackable: boolean;
    /** chip 根元素 class（含 variant 类与既有兼容类）。 */
    className: string;
};

export type BuildAgentStatusChipViewInput = {
    variant: AgentStatusChipVariant;
    status?: AgentStatus | null;
    aggregate?: AgentStatusAggregate | null;
    read: AgentReadState;
    nowMs: number;
};

/** 既有兼容类：verify 探针与外部样式依赖，改动会让真机断言静默失联。 */
const LegacyClassByVariant: Record<AgentStatusChipVariant, string> = {
    list: "session-overview-agent-status",
    board: "session-overview-agent-status",
    card: "agent-card-status-chip",
    header: "agent-status-header",
    aggregate: "session-overview-agent-aggregate",
};

function isSilentState(state: AgentDisplayState): boolean {
    return state === "idle" || state === "unknown";
}

/**
 * 跑时起点：**当前阶段段**的起点。
 *
 * 为什么不是 `activeSince`：`activeSince` 是 state 段的起点，后端只在 state 变化时重置，
 * 而同一次 working 里换了工具（pi 的 tool_call / claude 的 PreToolUse 都是
 * working+tool+新 toolName）state 不变 —— 拿它当跑时起点会让 `Tool: Read` 显示
 * 整轮 working 的总时长。`phaseSince` 按 state+phase+toolName 三者重置。
 *
 * 回退链保留 `activeSince ?? updatedAt`：旧后端 / 旧事件不带 phaseSince 时行为不变。
 */
function runtimeStart(status: AgentStatus): number {
    return status.phaseSince ?? status.activeSince ?? status.updatedAt ?? 0;
}

/**
 * 跑时文本。
 *
 * - 活跃态（working / blocked / stale）：秒级 `mm:ss` / `HhMMm` / `Dd Hh`。
 * - done 态：**不**进 runtime —— 未读 Done 的分钟级 elapsed 已经由
 *   `agentStatusViewLabel` 拼进 label（"Done 3m"），两处都放会重复。
 */
function buildRuntime(status: AgentStatus, nowMs: number): string {
    if (!needsAgentChipRuntime(status)) {
        return "";
    }
    return formatAgentChipRuntime(runtimeStart(status), nowMs);
}

function buildClassName(input: {
    variant: AgentStatusChipVariant;
    tone: AgentDisplayState;
    phase: AgentStatus["phase"];
    read: AgentReadState;
    inferred: boolean;
}): string {
    const classes = ["agent-status-chip", `agent-status-chip--${input.variant}`, LegacyClassByVariant[input.variant]];
    classes.push(`is-${input.tone}`);
    if (input.phase !== "none") {
        classes.push(`phase-${input.phase}`);
    }
    if (input.inferred) {
        classes.push("is-inferred");
    }
    if (input.variant === "card") {
        classes.push(input.read === "unread" ? "is-unread" : "is-seen");
    } else if (input.variant === "header") {
        if (input.read === "seen") {
            classes.push("is-acked");
        } else if (input.tone === "done") {
            classes.push("is-done-unread");
        }
    } else if (input.read === "seen") {
        classes.push("is-acked");
    }
    return classes.join(" ");
}

function buildAggregateView(
    aggregate: AgentStatusAggregate,
    read: AgentReadState
): AgentStatusChipView | null {
    if (aggregate.total === 0 || isSilentState(aggregate.state)) {
        return null;
    }
    const label = aggregateStatusLabel(aggregate);
    const base = label;
    const title =
        read === "seen" ? `${base} — up to date` : `${base} — click to mark tab as read`;
    return {
        label,
        runtime: "",
        tone: aggregate.state,
        title,
        ackable: read === "unread",
        className: buildClassName({
            variant: "aggregate",
            tone: aggregate.state,
            phase: aggregate.phase,
            read,
            inferred: false,
        }),
    };
}

/**
 * 唯一的状态徽章呈现构造。返回 `null` 表示该面**不渲染** chip。
 *
 * 判定完全复用 `deriveAgentStatusView`（read 的唯一入口）与 `agentStatusPresentation`
 * （文案的唯一入口），本函数只做"变体装配"，不新增第二套规则。
 */
export function buildAgentStatusChipView(input: BuildAgentStatusChipViewInput): AgentStatusChipView | null {
    if (input.variant === "aggregate") {
        const aggregate = input.aggregate ?? aggregateAgentStatuses([]);
        return buildAggregateView(aggregate, input.read);
    }
    const status = input.status ?? null;
    if (status == null) {
        return null;
    }
    // 注意：idle / unknown **仍然渲染** chip（旧实现会显示 "Idle" / "Seen"），
    // 只是不产出跑时。"idle 不显示"指的是跑时，不是整个徽章 —— 否则 agent block
    // 头部在空闲时会凭空少一块，视觉上是 regression。
    // deriveAgentStatusView 要求 ackedFp / doneAckedAt 才能自己算 read；
    // 调用面已经把 read 算好了（每个面各自持有 fp 与 doneAckedAt），这里只消费结果。
    const derived = deriveAgentStatusView({ status, nowMs: input.nowMs });
    if (derived == null) {
        return null;
    }
    const inferred = derived.inferred;
    // elapsed 从 status 自己算，不取 derived.elapsedText：derived 的 read 由它内部
    // 的 fp / doneAckedAt 判定，而这里的 read 是调用面给的。两者在等价输入下结论相同
    // （agent-status-view.test.ts 锁死），但缺 fp 的调用面会让 derived.read 退化成 seen。
    const elapsedText =
        derived.state === "done" ? formatDoneElapsed(agentDoneElapsedMs(status, input.nowMs)) : "";
    // label 用 agentStatusViewLabel 的语义（未读 Done 带 elapsed 后缀）。
    const label =
        input.read === "unread" && derived.state === "done" && elapsedText !== ""
            ? `${derived.label} ${elapsedText}`
            : derived.label;
    const base = `${derived.label}${inferred ? " (inferred)" : ""}`;
    const title =
        input.read === "seen"
            ? `${base} — up to date`
            : derived.state === "done"
              ? `${base} — done ${elapsedText === "" ? "" : `${elapsedText} ago, `}not seen yet, click to dismiss`
              : `${base} — click to mark as read`;
    return {
        label,
        runtime: buildRuntime(status, input.nowMs),
        tone: derived.state,
        title,
        ackable: derived.ackable,
        className: buildClassName({
            variant: input.variant,
            tone: derived.state,
            phase: derived.phase,
            read: input.read,
            inferred,
        }),
    };
}

export { agentStatusPresentation };
