// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Agent 状态的「已读」写入收口。
//
// 历史上 ack 的写入散落在 4 个面（agent 头部徽章 / inline tab 圆点 / Overview chip /
// Overview 批量栏），每处都要记得同时写两份 map：
//   - `SessionOverviewModel.agentStatusAckedFpAtom`（R 类指纹）
//   - `agentStatusDoneAckStore.doneAckedAtAtom`（D 类完成态时间戳）
// 漏写任何一份，另一面就会「复活」（见 docs/agent-status-handoff.md 的 A/C 路事故）。
//
// 收敛后规则：**任何展示面都只调本模块**，不再直接写两个 store。
// `source` 会进 pslog（`D:<source>` 约定），用于事后区分是哪一面触发的 ack。
//
// 两条已读通道，落点相同、语义不同：
//   ackAgentStatus —— 用户显式确认（点徽章 / 点卡片 pill / 点 Overview chip）
//   markAgentSeen  —— 用户切过去看过了（停留 ≥ 2s，见 use-mark-agent-seen）
// 两者都写 doneAckedAt：因为对「Done 该不该点亮」来说，看过和点过是同一个结果。
// 分开成两个 store 会逼 7 个展示面各读一份再自己合并，没有必要。
// pslog 的 source 后缀保留区分度。

import { agentStatusDoneAckStore } from "@/app/agent-status/agent-status-done-ack-store";
import type { AgentStatus } from "@/app/agent-status/agent-status-types";
import { SessionOverviewModel } from "@/app/session-overview/session-overview-model";

export type AgentAckSource =
    | "term-header"
    | "block-header"
    | "overview-chip"
    | "overview-aggregate"
    | "card-pill"
    | "block-focus";

export type AgentSeenSource = "block-focus";

/**
 * 用户确认了该 block 的当前状态：同时 ack R 类（指纹）与 D 类（完成态），
 * 所有展示面经 `deriveAgentStatusView` 同帧读到 `read: "seen"`。
 *
 * 传 `status` 是必需的：R 类 ack 存的是当前状态指纹，不传就无法形成可比较的 fingerprint。
 */
export function ackAgentStatus(
    blockId: string,
    status: AgentStatus | null | undefined,
    source: AgentAckSource
): void {
    if (!blockId) return;
    const now = Date.now();
    SessionOverviewModel.getInstance().markAgentStatusAcked(blockId, now, status ?? null);
    agentStatusDoneAckStore.markDoneAcked(blockId, now, source);
}

/**
 * 用户实际看到了该 block（切过去并停留），不是 hover。
 * 只写 D 类时间戳 —— 不动 R 指纹：R 的语义是「这条状态报告看过了」，
 * 由用户点击确认，不该被"路过"写脏。
 */
export function markAgentSeen(blockId: string, source: AgentSeenSource = "block-focus"): void {
    if (!blockId) return;
    agentStatusDoneAckStore.markDoneAcked(blockId, Date.now(), source);
}

/** 该 block 的 Done 已读时刻，非 React 消费面（HeaderElem 工厂等）用它构造 view 入参。 */
export function resolveAgentDoneAckedAt(blockId: string): number {
    return agentStatusDoneAckStore.getDoneAckedAt(blockId);
}
