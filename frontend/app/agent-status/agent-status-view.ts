// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// AgentStatusView — 呈现层的唯一 read 判定入口。
//
// 背景：`presentCanonicalAgentStatus` 只把 `idle + prevState≠idle` 提升为 `done`，
// 本身**没有** read（看过没看过）维度；read 过去由每个消费面各自叠
// `isAgentStatusUnread` / `isAgentDoneUnread` 才算出来。结果 7 个展示面里只有 4 个
// 叠了（头部徽章 / inline tab 点 / app tab 圆点 / Overview chip），3 个 agent 卡片面
// （悬浮卡、Tab「更多」agent 行、Tab 悬浮卡 agent 行）完全没叠，于是 ack 之后卡片
// 仍然显示高饱和绿色 `Done`。
//
// 本模块把「state 呈现」与「read」合并成一个纯结构 `AgentStatusView`，所有面只读它。
// 刻意**不改** `state` 语义（done 仍是粘性状态），read 是叠加维度 —— 未接入的面
// 行为完全不变，接入面之间也不可能再出现判定漂移。
//
// 判定表（写进 agent-status-view.test.ts）：
//   working / blocked / error / rate-limited / stale -> fp === ackedFp ? seen : unread
//   done（idle + prevState≠idle）                    -> completedAt > doneAckedAt ? unread : seen
//   idle（无跳变）/ unknown                          -> seen（不点亮）
//
// doneAckedAt 由两条通道写入（显式点击 / 切过去看够 2s），对 read 来说完全等价，
// 写入口统一收口在 agent-status-ack.ts。

import {
    agentStatusPresentation,
    isInferredAgentStatus,
} from "@/app/agent-status/agent-status-derive";
import {
    agentDoneElapsedMs,
    formatDoneElapsed,
    isAgentDoneUnread,
} from "@/app/agent-status/agent-status-done-unread";
import type { AgentDisplayState, AgentPhase, AgentStatus } from "@/app/agent-status/agent-status-types";
import { isAgentStatusUnread, type AgentStatusFp } from "@/app/agent-status/agent-status-unread";

export type AgentReadState = "unread" | "seen";

export type AgentStatusTone = AgentDisplayState;

export type AgentStatusView = {
    state: AgentDisplayState;
    phase: AgentPhase;
    /** 状态词，只表达"做了什么"（Done / Working / Thinking / Idle …）。 */
    label: string;
    /** 样式类用的色彩语义，与 state 同构，单独列出避免消费面自己 switch。 */
    tone: AgentStatusTone;
    /** 看过没看过。卡片按这个换色，头部徽章按这个决定 is-acked / is-done-unread。 */
    read: AgentReadState;
    /** 仅 unread 的 Done 有值："3m" / "1h" / "Just now"；其余为 ""。 */
    elapsedText: string;
    /** 可直接进 tooltip 的一句话（含 inferred / 已读语义）。 */
    title: string;
    /** 是否值得让用户点一下确认（unread 且不是 idle/unknown 的静默态）。 */
    ackable: boolean;
    inferred: boolean;
};

export type DeriveAgentStatusViewInput = {
    status: AgentStatus | null;
    blockId?: string;
    /** R 类已读指纹（`SessionOverviewModel.agentStatusAckedFpAtom[blockId]`）。 */
    ackedFp?: AgentStatusFp | null;
    /** D 类已读时间戳（`agentStatusDoneAckStore.doneAckedAtAtom[blockId]`）：点击或看过两条通道写入。 */
    doneAckedAt?: number;
    nowMs: number;
};

function finitePositive(value: number | null | undefined): number {
    if (value == null || !Number.isFinite(value) || value <= 0) {
        return 0;
    }
    return value;
}

/** canonical idle 带完成跳变（prevState 非 idle/unknown）—— 等价于 presented 层的 done。 */
function hasCompletionTransition(status: AgentStatus): boolean {
    const prev = status.prevState;
    return prev != null && prev !== "" && prev !== "idle" && prev !== "unknown";
}

/**
 * 吃 canonical 或 presented 两种输入都给出同一个 Done 呈现：
 * Store 的 presented atom 已经提升过一轮，但 HeaderElem 工厂 / 单元测试仍可能传 canonical
 * idle + prevState，这里补齐，避免同一状态在两个入口出现两种结论。
 */
function promoteCompletedIdle(status: AgentStatus): AgentStatus {
    if (status.state !== "idle" || !hasCompletionTransition(status)) {
        return status;
    }
    return { ...status, state: "done", phase: "none" };
}

function isSilentState(state: AgentDisplayState): boolean {
    // idle（无跳变）/ unknown 本身没什么可阅 —— 不点亮、不提供 ack。
    return state === "idle" || state === "unknown";
}

function readStateFor(input: {
    status: AgentStatus;
    ackedFp: AgentStatusFp | null;
    doneAckedAt: number;
}): AgentReadState {
    const { status } = input;
    // done / idle / unknown 三态只认 D 类（完成跳变）判定。done 用 R 指纹会双点亮：
    // 卡片面历史上不写 fp，ackedFp 为 null 时 isAgentStatusUnread 恒 true，会把已读的
    // Done 又点亮。
    if (status.state === "done" || isSilentState(status.state)) {
        return isAgentDoneUnread(status, input.doneAckedAt) ? "unread" : "seen";
    }
    return isAgentStatusUnread(status, input.ackedFp) ? "unread" : "seen";
}

function buildTitle(input: {
    label: string;
    read: AgentReadState;
    state: AgentDisplayState;
    inferred: boolean;
    elapsedText: string;
}): string {
    const base = `${input.label}${input.inferred ? " (inferred)" : ""}`;
    if (input.read === "seen") {
        return `${base} — up to date`;
    }
    if (input.state === "done") {
        const elapsed = input.elapsedText === "" ? "" : `${input.elapsedText} ago, `;
        return `${base} — done ${elapsed}not seen yet, click to dismiss`;
    }
    return `${base} — click to mark as read`;
}

/**
 * 唯一的 read 判定 + 呈现构造。`status == null` 返回 null，消费面自行决定不渲染。
 */
export function deriveAgentStatusView(input: DeriveAgentStatusViewInput): AgentStatusView | null {
    const { status } = input;
    if (status == null) {
        return null;
    }
    const viewStatus = promoteCompletedIdle(status);
    const read = readStateFor({
        status: viewStatus,
        ackedFp: input.ackedFp ?? null,
        doneAckedAt: finitePositive(input.doneAckedAt),
    });
    const presentation = agentStatusPresentation(viewStatus);
    const inferred = isInferredAgentStatus(status);
    const elapsedText =
        read === "unread" && viewStatus.state === "done"
            ? formatDoneElapsed(agentDoneElapsedMs(status, input.nowMs))
            : "";
    return {
        state: viewStatus.state,
        phase: viewStatus.phase,
        label: presentation.label,
        tone: viewStatus.state,
        read,
        elapsedText,
        title: buildTitle({
            label: presentation.label,
            read,
            state: viewStatus.state,
            inferred,
            elapsedText,
        }),
        ackable: read === "unread" && !isSilentState(viewStatus.state),
        inferred,
    };
}

/**
 * 是否属于「已完成但未被看过」—— 卡片/徽章只用它判 read 之外的一件事：
 * 切到该 block 并停留时要不要自动写 seen。
 */
export function isAgentDoneAwaitingView(view: AgentStatusView | null): boolean {
    return view != null && view.state === "done" && view.read === "unread";
}

/**
 * 状态色 token。read==="seen" 时统一收敛到 secondary —— ack 过的状态不再抢注意力，
 * 与头部徽章 `is-acked` 的视觉语言一致。
 */
export function agentStatusAccent(tone: AgentStatusTone, read: AgentReadState): string {
    if (read === "seen") {
        return "var(--secondary-text-color)";
    }
    switch (tone) {
        case "working":
            return "var(--agent-working-color)";
        case "done":
            return "var(--agent-done-color)";
        case "blocked":
        case "rate-limited":
            return "var(--warning-color, #f59e0b)";
        case "error":
            return "var(--error-color)";
        case "stale":
            return "var(--agent-stale-color, #a855f7)";
        default:
            return "var(--secondary-text-color)";
    }
}

/**
 * 卡片 / 徽章共用的一行文案：unread 的 Done 带 elapsed 后缀（"Done 3m"），其余只有状态词。
 * 已读不换词（不用 "Seen"）—— 读没读交给颜色与动画表达，避免同一状态出现两种词。
 */
export function agentStatusViewLabel(view: AgentStatusView): string {
    if (view.read === "unread" && view.state === "done" && view.elapsedText !== "") {
        return `${view.label} ${view.elapsedText}`;
    }
    return view.label;
}
