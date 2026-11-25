// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// MessageDialog 源码契约（11-25 R2）：消息详情弹窗不得再有「删除块」按钮。
//
// 为什么是源码级断言而不是组件挂载：MessageDialog 是 session-overview.tsx 的内部组件
// （未导出，由三个入口共用 —— 看板方块 / 列表方块 / 「看全文」），挂载整面板成本过高。
// 与 agent-status-seen-style.test.ts 同范式：锁源码段落里的契约钩子。
//
// 背景：删除按钮与右上角关闭同为 xmark 图标，读一条消息时误触即不可逆地从看板移除卡；
// 删除入口在看板卡动作区 / 列表行本就有，弹窗内不再放第二个。

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(import.meta.dirname, "session-overview.tsx"), "utf8");

/** 截取 `function MessageDialog(` 到下一个顶层 `function ` 的源码段。 */
function extractMessageDialogSource(): string {
    const start = source.indexOf("function MessageDialog(");
    expect(start, "session-overview.tsx 里必须能找到 MessageDialog").toBeGreaterThan(-1);
    const next = source.indexOf("\nfunction ", start + 1);
    const end = next === -1 ? source.length : next;
    return source.slice(start, end);
}

describe("MessageDialog 删除链路移除（11-25 R2）", () => {
    const dialogSource = extractMessageDialogSource();

    it("弹窗内没有 session-overview-block-x-button（唯一 x 按钮是右上角关闭）", () => {
        expect(dialogSource).not.toContain("session-overview-block-x-button");
        // 右上角关闭按钮是唯一 xmark；xmark 图标本身保留（关闭语义）。
        const xmarks = dialogSource.match(/xmark/g) ?? [];
        expect(xmarks.length).toBe(1);
    });

    it("MessageDialog 不再接收 onDeleteBlock", () => {
        expect(dialogSource).not.toContain("onDeleteBlock");
    });

    it("保留：编辑会话备注、跳转、message body 等其余内容不变", () => {
        expect(dialogSource).toContain("onEditSessionNote");
        expect(dialogSource).toContain("session-overview-message-body");
        expect(dialogSource).toContain("session-overview-message-actions");
    });

    it("列表行 / CompactBlockIcon 的删除入口不受牵连（删除入口在行上，不在弹窗里）", () => {
        // MessageDialog 段之外的源码里，删除按钮与其落地（closeOverviewBlock）仍然存在。
        const rest = source.replace(extractMessageDialogSource(), "");
        expect(rest).toContain("session-overview-block-x-button");
        expect(rest).toContain("closeOverviewBlock");
    });
});
