// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 会话最近消息 → 方块条 items 的共享管线（11-25 R3 抽取）：
//   · readableMessages：过滤空文本 / tool 角色 / [Tool: …] 桥接消息；
//   · messagePreview：空白归一 + 140 字裁断 + "(empty)" 占位；
//   · buildRecentMessageSquares：裁到上限（默认 10），溢出回传；
//   · label 走 session-overview:dialog.messageSeq（与看板/列表同一份）。

import { describe, expect, it } from "vitest";
import {
    BoardMessageSquareLimit,
    buildRecentMessageSquares,
    messagePreview,
    readableMessages,
} from "./session-message-items";

function msg(seq: number, role: string, text: string): Message {
    return { seq, role, text, charCount: text.length };
}

const detail = (messages: Message[]): SessionDetail => ({
    summary: {
        key: "sess-1",
        id: "sess-1",
        source: "wave",
        messageCount: messages.length,
    },
    messages,
    hasMore: false,
});

describe("messagePreview", () => {
    it("空白归一 + 140 字裁断", () => {
        expect(messagePreview(msg(1, "user", "  hello \n world  "))).toBe("hello world");
        expect(messagePreview(null)).toBe("(empty)");
        expect(messagePreview(msg(1, "user", ""))).toBe("(empty)");
        const long = "a".repeat(200);
        expect(messagePreview(msg(1, "user", long))).toBe(`${"a".repeat(140)}...`);
    });
});

describe("readableMessages", () => {
    it("过滤空文本 / tool 角色 / [Tool: …] 桥接消息", () => {
        const messages = [
            msg(1, "user", "hello"),
            msg(2, "assistant", ""), // 空文本
            msg(3, "tool", "tool output"), // tool 角色
            msg(4, "user", "[Tool: bash]"), // 桥接消息
            msg(5, "assistant", "answer"),
        ];
        const readable = readableMessages(detail(messages));
        expect(readable.map((m) => m.seq)).toEqual([1, 5]);
    });

    it("null detail → 空数组", () => {
        expect(readableMessages(null)).toEqual([]);
    });
});

describe("buildRecentMessageSquares", () => {
    it("裁到上限（默认 BoardMessageSquareLimit=10），溢出回传", () => {
        const messages = Array.from({ length: 15 }, (_, i) =>
            msg(i + 1, i % 2 === 0 ? "user" : "assistant", `m${i + 1}`)
        );
        const { items, overflow } = buildRecentMessageSquares(detail(messages));
        expect(items).toHaveLength(BoardMessageSquareLimit);
        expect(overflow).toBe(5);
        // 裁掉的是最旧的：items 从 seq 6 开始
        expect(items[0].seq).toBe(6);
        expect(items.map((item) => item.seq)).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    });

    it("item 形状：seq/role/preview/label（label 走 messageSeq 文案）", () => {
        const { items } = buildRecentMessageSquares(detail([msg(3, "user", "hi"), msg(4, "assistant", "yo")]));
        expect(items.map((item) => item.role)).toEqual(["user", "assistant"]);
        expect(items[0].preview).toBe("hi");
        // label 走 i18n（单测环境未初始化翻译，可能是空串或 key）：只断言类型是字符串，
        // 真正的文案契约由看板/弹窗的 aria-label 断言覆盖（真机台）。
        expect(typeof items[0].label).toBe("string");
    });

    it("自定义 limit", () => {
        const messages = Array.from({ length: 4 }, (_, i) => msg(i + 1, "user", `m${i + 1}`));
        const { items, overflow } = buildRecentMessageSquares(detail(messages), 2);
        expect(items.map((item) => item.seq)).toEqual([3, 4]);
        expect(overflow).toBe(2);
    });

    it("无消息 → items 空数组（调用方据此不渲染空行）", () => {
        const { items, overflow } = buildRecentMessageSquares(null);
        expect(items).toHaveLength(0);
        expect(overflow).toBe(0);
    });
});
