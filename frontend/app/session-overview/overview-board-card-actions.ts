// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 看板卡动作能力的判定（纯函数，vitest 锁）。
//
// 为什么必须纯函数：这两枚按钮（恢复 / 发消息）会打真实 RPC —— 恢复会**新建一个块**，
// 发送会把文字注入 agent PTY。把「没有会话 id 的卡」也放出按钮，就等于给了两个
// 必然失败、还可能建出空块的入口。
//
// 判定顺序（design §2，固定）：
//   1. 非 agent 卡 → 两个能力都不给（无会话可恢复，也无 agent 可投递）。
//   2. agent 卡但没有会话 id → 两个能力都不给（恢复无目标、发送无会话）。
//   3. agent 卡 + 会话 id → 恢复可用（AgentResumeCommand 按会话重建块，不依赖旧块）；
//      发送需要 blockId（AgentSendCommand 投递目标），块 id 为空时不给。
//      块是否存活不参与判定：发送会 ensureSendBlockController 重启控制器。

export interface BoardCardCapabilities {
    canSend: boolean;
    canRestore: boolean;
}

export function boardCardCapabilities(card: {
    isAgentLike: boolean;
    sessionId: string;
    blockId: string;
}): BoardCardCapabilities {
    if (!card.isAgentLike) {
        return { canSend: false, canRestore: false };
    }
    if (card.sessionId.trim() === "") {
        return { canSend: false, canRestore: false };
    }
    return { canSend: card.blockId.trim() !== "", canRestore: true };
}
