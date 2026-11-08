// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// SessionRunBadgeView —— SessionRow 右侧运行徽章的**唯一呈现产出地**（纯函数，React 无关）。
//
// 为什么拆出来：徽章有三条输入分支（AgentStatus / 有活跃块但无状态 / 只有 GUI 对话），
// 每条分支的文案、tone、跑时有各自的取舍。把判定与拼装放在纯函数里，
// 单测可以逐分支锁死，不需要 jsdom + 渲染库（本仓没有 @testing-library）。
//
// 与左侧 `RunningDot` 分工（不变量，单测锁死）：
//   RunningDot     只表达「这个会话有活着的块」，不带文字。
//   本函数         表达「跑到哪一步 + 跑了多久」，带状态词与跑时。
//
// 文案来源：`agentStatusPresentation`（与 block 头部 chip、Overview chip 同一份），
// 所以同一个状态在任何面都不可能有两种说法。

import { agentStatusPresentation } from "@/app/agent-status/agent-status-derive";
import { formatAgentChipRuntime, needsAgentChipRuntime } from "@/app/agent-status/agent-status-runtime";
import type { AgentStatus } from "@/app/agent-status/agent-status-types";
import type { SessionRunningState } from "./use-sessions-running";

export type SessionRunBadgeTone = "agent" | "live" | "chat";

export type SessionRunBadgeView = {
    /** 三态来源，决定类名与 tooltip 措辞。 */
    tone: SessionRunBadgeTone;
    /** 主文案：Thinking / Tool: Bash / Done / Running / Chat。 */
    label: string;
    /** 跑时文本，空串 = 不显示。 */
    runtime: string;
    /** 完整 tooltip。 */
    title: string;
    /** 是否可点击跳转到 block。 */
    clickable: boolean;
    /** 徽章根元素 class（含 tone 类与 AgentDisplayState 类）。 */
    className: string;
    /** 图标：FA 图标名（`tone === "agent"`）或空串（走圆点渲染）。 */
    icon: string;
};

export type BuildSessionRunBadgeViewInput = {
    runningState?: SessionRunningState | null;
    /** 该活跃块的 canonical AgentStatus（presented = 含 staleness 翻转）。 */
    status?: AgentStatus | null;
    chatRunning?: boolean;
    nowMs: number;
};

/** AgentDisplayState → 徽章类名（与 agent-status-chip 的 is-* 词汇保持一致）。 */
const ToneClassByState: Record<string, string> = {
    working: "is-working",
    done: "is-done",
    blocked: "is-blocked",
    error: "is-error",
    "rate-limited": "is-rate-limited",
    stale: "is-stale",
    idle: "is-idle",
    unknown: "is-unknown",
};

function buildClassName(tone: SessionRunBadgeTone, stateClass?: string): string {
    const classes = ["session-run-badge"];
    if (tone === "chat") {
        classes.push("session-run-badge--chat", "is-chat");
    } else if (tone === "live") {
        classes.push("session-run-badge--button", "is-live");
    } else {
        classes.push("session-run-badge--button", stateClass ?? "is-unknown");
    }
    return classes.join(" ");
}

/**
 * 唯一构造入口。返回 `null` 表示该行**不渲染**徽章。
 *
 * 分支优先级（与 UI 一致）：
 *   1. 有活跃块 + 有 AgentStatus  → 完整 chip（状态词 + 跑时），可点击
 *   2. 有活跃块 + 无 AgentStatus  → 「Running」（进程存活是事实，不编造 phase），可点击
 *   3. 只有 chatRunning           → 「Chat」，不可点击（没有 block 可跳）
 *   都没有                        → null
 */
export function buildSessionRunBadgeView(input: BuildSessionRunBadgeViewInput): SessionRunBadgeView | null {
    const runningState = input.runningState ?? null;
    const chatRunning = input.chatRunning === true;

    if (runningState == null && !chatRunning) {
        return null;
    }

    // ── 分支 3：只有 GUI 对话在跑（没有 block 可跳） ──
    if (runningState == null) {
        return {
            tone: "chat",
            label: "Chat",
            runtime: "",
            title: "GUI chat is running in this session",
            clickable: false,
            className: buildClassName("chat"),
            icon: "comment-dots",
        };
    }

    const status = input.status ?? null;

    // ── 分支 1：有 AgentStatus，走共享呈现层 ──
    if (status != null) {
        const presentation = agentStatusPresentation(status);
        // 跑时起点与 block 头部 chip 同一口径：当前阶段段（phaseSince），不是整轮 working 总时长。
        const runtime = needsAgentChipRuntime(status)
            ? formatAgentChipRuntime(status.phaseSince ?? status.activeSince ?? status.updatedAt ?? 0, input.nowMs)
            : "";
        return {
            tone: "agent",
            label: presentation.label,
            runtime,
            title: `${presentation.title} — click to jump to block`,
            clickable: true,
            className: buildClassName("agent", ToneClassByState[status.state]),
            icon: presentation.icon,
        };
    }

    // ── 分支 2：进程活着但 agent 没上报 ──
    // 不写 "Working"：那需要 phase（thinking / tool），没有就是没有。
    return {
        tone: "live",
        label: "Running",
        runtime: "",
        title: "This session has a live block in the app — click to jump to block",
        clickable: true,
        className: buildClassName("live"),
        icon: "",
    };
}
