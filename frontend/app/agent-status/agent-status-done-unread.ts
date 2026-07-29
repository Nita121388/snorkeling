// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { AgentStatus } from "@/app/agent-status/agent-status-types";
import { normalizeTimeMs } from "@/app/agent-status/agent-status-unread";

// "Done flash" 解答为什么不能复用 isAgentStatusUnread:
// isAgentStatusUnread 的语义是"当前状态本身是否未读" —— idle/unknown 永远不算未读,
// 这是对的: idle 本身没什么可阅. Session Overview 的 chip 与 agent header 共用这个函数,
// 硬塞 idle 分支会让 chip 在 idle 上无端复亮, 与"运行中才算未读"的现有行为冲突.
//
// 我们要的是事件跳变级语义: "上一帧非 idle、这一帧变 idle" 才点亮一次.
// Go 端把完成跳变保留在 canonical idle 状态上, 所以实时事件与 GetAgentStatus 晚读取
// 都能拿到 prevState/completedAt. 开局即 idle 时这两个字段为空, 仍不触发 D.
//
// ack 用 per-block doneAckedAt: D 点亮后用户点头部徽章写入 doneAckedAt[block]=now,
// 下一次跳变 completedAt 仍 > doneAckedAt 则继续未读, 直到下一次跳变再次超过它. 重入
// working 时上层应 clearDoneAckedAt(block) (见 agent-status-done-ack) 重置, 否则
// 下一轮 idle 会被旧 ack 永久压制 —— 但本函数不负责这件事, 由调用方在 state 跳回
// 非 idle 时驱动.
export function isAgentDoneUnread(status: AgentStatus | null, doneAckedAt: number): boolean {
    if (status == null) return false;
    if (status.state !== "idle") return false;
    // prevState 缺失 = 主动拉取或开局第一帧, 没有跳变 → 不点亮 (场景 6 边界).
    if (!status.prevState || status.prevState === "idle" || status.prevState === "unknown") {
        return false;
    }
    const completedAt = normalizeTimeMs(status.completedAt ?? status.updatedAt);
    if (completedAt <= 0) return false;
    return completedAt > doneAckedAt;
}

// elapsed in ms from status.completedAt to now(=referenceMs). 消费方传一个可控的
// referenceMs 便于 SSR/testing 与低频 tick 对齐, 不直接用 Date.now() (preview-toolbar-
// buttons-live-in-model 原则: 状态出 model 不在 JSX 内联算时间).
export function agentDoneElapsedMs(status: AgentStatus | null, referenceMs: number): number {
    if (status == null) return 0;
    const completedAt = normalizeTimeMs(status.completedAt ?? status.updatedAt);
    if (completedAt <= 0) return 0;
    return Math.max(0, referenceMs - completedAt);
}

// Format an elapsed-ms into the short human-readable label users see on the badge: "10m" / "1h"
// / "2h" / "Just now". Mirrors the "完成了多久前" semantics from 22 号方案 — keep this the only
// formatter so A/B/C stay consistent.
export function formatDoneElapsed(elapsedMs: number): string {
    if (elapsedMs < 30_000) return "Just now";
    if (elapsedMs < 60_000) return `${Math.round(elapsedMs / 1000)}s`;
    const minutes = Math.floor(elapsedMs / 60_000);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    return `${days}d`;
}
