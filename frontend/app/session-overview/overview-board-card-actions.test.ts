// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 看板卡动作能力的锁。
//
// 为什么值得锁：这两枚按钮（恢复 / 发消息）会打真实 RPC —— 恢复会**新建一个块**，
// 发送会把文字注入 agent PTY。把「没有会话 id 的卡」也放出按钮，就等于给了两个
// 必然失败、还可能建出空块的入口。判定必须是纯函数，一眼可读。

import { describe, expect, it } from "vitest";
import { boardCardCapabilities } from "./overview-board-card-actions";

describe("boardCardCapabilities", () => {
    it("非 agent 卡：两个能力都不给", () => {
        expect(boardCardCapabilities({ isAgentLike: false, sessionId: "s1", blockId: "b1" })).toEqual({
            canSend: false,
            canRestore: false,
        });
    });

    it("agent 卡但没有会话 id：不给（恢复无目标、发送无会话）", () => {
        expect(boardCardCapabilities({ isAgentLike: true, sessionId: "", blockId: "b1" })).toEqual({
            canSend: false,
            canRestore: false,
        });
    });

    it("agent 卡 + 会话 id：两个能力都给（块是否存活不参与判定）", () => {
        expect(boardCardCapabilities({ isAgentLike: true, sessionId: "pi:abc", blockId: "b1" })).toEqual({
            canSend: true,
            canRestore: true,
        });
    });

    it("块 id 为空但会话在：恢复仍可用（恢复是建新块，不依赖旧块）", () => {
        expect(boardCardCapabilities({ isAgentLike: true, sessionId: "pi:abc", blockId: "" })).toEqual({
            canSend: false,
            canRestore: true,
        });
    });
});
