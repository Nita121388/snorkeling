// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 会话时间戳归一化（11-25 R3 抽取）。
//
// session 的 createdAt/updatedAt 在不同后端里既有秒也有毫秒（Go 侧 int64 直传），
// 消费方（SessionMetrics 等）要求毫秒。原本是 session-overview.tsx 的内部函数，
// AgentCardModal 整卡放大弹窗（11-25 R3）需要同一份实现 —— 抽到这里，不复制。

/** 秒/毫秒时间戳 → 毫秒；空值与 0 归 0。 */
export function normalizeTimeMs(timestamp: number | null | undefined): number {
    if (!timestamp) return 0;
    return timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
}
