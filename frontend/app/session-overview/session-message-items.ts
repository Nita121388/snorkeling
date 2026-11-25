// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 会话最近消息 → 方块条数据 的共享管线（11-25 R3 抽取）。
//
// 为什么要抽：`BoardMessageSquareLimit` / `readableMessages` / `messagePreview`
// 原本长在 `session-overview.tsx` 内部，看板卡（overview-board.tsx 经面板层数据组装）
// 与列表行共用；AgentCardModal 整卡放大弹窗（11-25 R3）也要同一份数据 ——
// 复制实现意味着三处口径各漂各的（历史教训见 session-message-squares.tsx 头注释）。
// 抽到这里后，看板/列表/弹窗三个消费方都从这一份走。
//
// 契约（与 11-24 版逐字符等价，只是搬家）：
//   · `messagePreview`：空白归一 + 140 字裁断，空文本占位 "(empty)"；
//   · `readableMessages`：过滤空文本 / tool 角色 / [Tool: …] 桥接消息；
//   · `buildRecentMessageSquares`：裁到上限（默认 BoardMessageSquareLimit=10），
//     溢出条数回传（渲染 `+n`，条数不随消息数无限增长）；
//   · label 用 `session-overview:dialog.messageSeq`（读屏文案，三个面同一份）。

import { i18n } from "@/i18n/config";
import type { SessionMessageSquareItem } from "./session-message-squares";

export function messagePreview(message: Message | null): string {
    const text = message?.text?.replace(/\s+/g, " ").trim() ?? "";
    if (!text) return "(empty)";
    if (text.length <= 140) return text;
    return `${text.slice(0, 140)}...`;
}

/** 看板卡/弹窗方块条上限（11-24 R1）：卡高不随消息数跳动，超出渲染 `+n`。 */
export const BoardMessageSquareLimit = 10;

export function readableMessages(detail: SessionDetail | null): Message[] {
    return (detail?.messages ?? []).filter((message) => {
        const text = message.text?.trim() ?? "";
        return text !== "" && message.role !== "tool" && !/^\[Tool:\s*[^\]]+\]$/.test(text);
    });
}

/** 最近消息 → 方块条 items + 溢出计数（看板卡 / 整卡放大弹窗同一份管线）。 */
export function buildRecentMessageSquares(
    detail: SessionDetail | null,
    limit: number = BoardMessageSquareLimit
): { items: SessionMessageSquareItem[]; overflow: number } {
    const messages = readableMessages(detail);
    const visible = messages.slice(-limit);
    return {
        items: visible.map((message) => ({
            seq: message.seq,
            role: message.role,
            preview: messagePreview(message),
            label: i18n.t("session-overview:dialog.messageSeq", { role: message.role, seq: message.seq }),
        })),
        overflow: messages.length - visible.length,
    };
}
