// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// React 绑定的 AgentStatusView：把「状态 + 两条已读通道」组装成 view。
//
// 之前三个卡片面各写一份 `agentStatusPresentation(status)` + 各自的颜色 switch，
// 导致 ack 之后卡片仍显示高饱和 Done。现在它们统一走这里，read 判定只有一处。
//
// 订阅的都是低频写（用户点 ack / 切到 block 看够了），不会给 hover 卡带来
// 高频 re-render；分钟 tick 只在 Done 未读时才有意义，一并订阅以保证
// "Done 3m" → "Done 4m" 自己走。

import { agentStatusDoneAckStore } from "@/app/agent-status/agent-status-done-ack-store";
import { nowMinuteTickAtom } from "@/app/agent-status/agent-status-done-tick";
import { needsAgentChipRuntime } from "@/app/agent-status/agent-status-runtime";
import { agentStatusSecondTickAtom } from "@/app/agent-status/agent-status-second-tick";
import type { AgentStatus } from "@/app/agent-status/agent-status-types";
import { deriveAgentStatusView, type AgentReadState, type AgentStatusView } from "@/app/agent-status/agent-status-view";
import { SessionOverviewModel } from "@/app/session-overview/session-overview-model";
import { useAtomValueSafe } from "@/util/util";
import * as React from "react";

export type AgentReadContext = {
    ackedFp: string | null;
    /** Done 的已读时刻（点击 ack 或切过去看过，两条通道同落点），=0 表示未读。 */
    doneAckedAt: number;
    read: AgentReadState;
};

/**
 * 只关心「读过没」的消费面用这个；需要 label / tone / elapsed 的用 `useAgentStatusView`。
 * `read` 与 view 走同一个判定函数，不会出现两套结论。
 */
export function useAgentReadContext(blockId: string, status: AgentStatus | null): AgentReadContext {
    const overview = SessionOverviewModel.getInstance();
    const ackedFpMap = useAtomValueSafe(overview.agentStatusAckedFpAtom) ?? {};
    const doneAckedAtMap = useAtomValueSafe(agentStatusDoneAckStore.doneAckedAtAtom) ?? {};
    const ackedFp = ackedFpMap[blockId] ?? null;
    const doneAckedAt = doneAckedAtMap[blockId] ?? 0;
    return React.useMemo(() => {
        const view = deriveAgentStatusView({ status, blockId, ackedFp, doneAckedAt, nowMs: Date.now() });
        return { ackedFp, doneAckedAt, read: view?.read ?? "seen" };
    }, [status, blockId, ackedFp, doneAckedAt]);
}

/**
 * 该 block 的呈现态（含 read）。`status == null` 返回 null —— 消费面自行决定不渲染。
 */
export function useAgentStatusView(blockId: string, status: AgentStatus | null): AgentStatusView | null {
    const overview = SessionOverviewModel.getInstance();
    const ackedFpMap = useAtomValueSafe(overview.agentStatusAckedFpAtom) ?? {};
    const doneAckedAtMap = useAtomValueSafe(agentStatusDoneAckStore.doneAckedAtAtom) ?? {};
    // 分钟 tick：仅让 unread 的 Done elapsed 自己刷新；不做每秒 tick。
    const minuteTick = useAtomValueSafe(nowMinuteTickAtom) ?? 0;
    const ackedFp = ackedFpMap[blockId] ?? null;
    const doneAckedAt = doneAckedAtMap[blockId] ?? 0;
    return React.useMemo(
        () => deriveAgentStatusView({ status, blockId, ackedFp, doneAckedAt, nowMs: Date.now() }),
        [status, blockId, ackedFp, doneAckedAt, minuteTick]
    );
}

/**
 * 徽章跑时的「当前时刻」，供**不用** `<AgentStatusChip>` 的消费面使用。
 *
 * 为什么需要它：`buildAgentStatusChipView().runtime` 只在活跃态（working / blocked /
 * stale）产出 "3min21s"，而真正把它拼进文案的是 term-model（头部）与 chip 组件自己。
 * Tab 悬浮卡的 pill 是手写 `<span>`，此前只读 `agentStatusViewLabel`（状态词 + Done 的
 * 分钟级 elapsed），于是 working/tool 期间那一行只有 "Tool: Bash"、没有跑时。
 * 这里把 chip 内部的 1Hz tick 收成一个 hook：活跃态才订阅，其余面 0 订阅。
 */
export function useAgentChipNow(status: AgentStatus | null): number {
    const tickEnabled = needsAgentChipRuntime(status);
    const tick = tickEnabled ? (useAtomValueSafe(agentStatusSecondTickAtom) ?? 0) : 0;
    return Math.max(Date.now(), tick);
}
