// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 右侧 WidgetsBar 的 action 分发契约（任务 11-24-schedtask-entry-fix）。
//
// 回归点：需求是「点右侧定时任务 widget 打开 CommonText 同款弹窗」，不是建 Block。
// commit 8939d11f5 把入口做成 Overview 工具栏按钮，widget 仍走 blockdef 建块 —— 本文件锁定
// 「scheduledtasks:manager 这个 action 必须打开管理弹窗」这条链路。

// @vitest-environment jsdom

import { modalsModel } from "@/app/store/modalmodel";
import { globalStore } from "@/app/store/jotaiStore";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runWidgetAction, ScheduledTaskManagerWidgetAction } from "./widget-actions";

function modalStack() {
    return globalStore.get(modalsModel.modalsAtom);
}

describe("runWidgetAction", () => {
    beforeEach(() => {
        while (modalsModel.hasOpenModals()) {
            modalsModel.popModal();
        }
    });

    it("scheduledtasks:manager 打开 ScheduledTaskManagerModal（不是建块）", () => {
        expect(ScheduledTaskManagerWidgetAction).toBe("scheduledtasks:manager");
        expect(runWidgetAction(ScheduledTaskManagerWidgetAction)).toBe(true);
        const stack = modalStack();
        expect(stack).toHaveLength(1);
        expect(stack[0].displayName).toBe("ScheduledTaskManagerModal");
    });

    it("未知 action 返回 false（保持既有 warn 语义）", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        expect(runWidgetAction("nope:nothing")).toBe(false);
        expect(modalStack()).toHaveLength(0);
        warn.mockRestore();
    });
});
