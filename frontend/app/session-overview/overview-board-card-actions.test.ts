// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 看板卡动作能力的锁。
//
// 为什么值得锁：这枚按钮（发消息）会打真实 RPC —— 把文字注入 agent PTY。
// 把「没有会话 id 的卡」也放出按钮，就等于给了一个必然失败的入口。
// 判定必须是纯函数，一眼可读。
// 「恢复」能力位已于 11-24 R2 删除（看板卡不再提供恢复入口）。

import { describe, expect, it } from "vitest";
import { boardCardCapabilities } from "./overview-board-card-actions";

describe("boardCardCapabilities", () => {
    it("非 agent 卡：不给发送能力", () => {
        expect(boardCardCapabilities({ isAgentLike: false, sessionId: "s1", blockId: "b1" })).toEqual({
            canSend: false,
        });
    });

    it("agent 卡但没有会话 id：不给（发送无会话）", () => {
        expect(boardCardCapabilities({ isAgentLike: true, sessionId: "", blockId: "b1" })).toEqual({
            canSend: false,
        });
    });

    it("agent 卡 + 会话 id：发送可用（块是否存活不参与判定）", () => {
        expect(boardCardCapabilities({ isAgentLike: true, sessionId: "pi:abc", blockId: "b1" })).toEqual({
            canSend: true,
        });
    });

    it("不再提供恢复能力位（11-24 R2：看板卡移除恢复入口，RPC 与 AISessions 恢复保留）", () => {
        const caps = boardCardCapabilities({ isAgentLike: true, sessionId: "pi:abc", blockId: "" });
        expect(caps).toEqual({ canSend: false });
        expect("canRestore" in caps).toBe(false);
    });
});
