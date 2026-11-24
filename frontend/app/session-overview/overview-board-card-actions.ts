// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 看板卡动作能力的判定（纯函数，vitest 锁）。
//
// 为什么必须纯函数：这枚按钮（发消息）会打真实 RPC —— 把文字注入 agent PTY。
// 把「没有会话 id 的卡」也放出按钮，就等于给了一个必然失败的入口。
//
// 判定顺序（固定）：
//   1. 非 agent 卡 → 不给（无 agent 可投递）。
//   2. agent 卡但没有会话 id → 不给（发送无会话）。
//   3. agent 卡 + 会话 id → 发送需要 blockId（AgentSendCommand 投递目标），块 id 为空时不给。
//      块是否存活不参与判定：发送会 ensureSendBlockController 重启控制器。
//
// 「恢复」能力位已于 11-24 R2 删除（决策 D6：看板卡不再提供恢复入口，
// AgentResumeCommand RPC 与 AISessions「恢复到终端」保留）。

export interface BoardCardCapabilities {
    canSend: boolean;
}

export function boardCardCapabilities(card: {
    isAgentLike: boolean;
    sessionId: string;
    blockId: string;
}): BoardCardCapabilities {
    if (!card.isAgentLike) {
        return { canSend: false };
    }
    if (card.sessionId.trim() === "") {
        return { canSend: false };
    }
    return { canSend: card.blockId.trim() !== "" };
}
