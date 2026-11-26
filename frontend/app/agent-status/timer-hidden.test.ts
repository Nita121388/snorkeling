// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// W2-3 源码契约（性能）：隐藏页面定时器休眠。
//
// 现状（HEAD）：几处 setInterval 不检查 document.hidden —— 窗口最小化/切到别的 Tab 后
// 仍然每 30s/60s 触发整页 setState 与重渲（aisessions 的 refreshTimeNow 甚至触发未虚拟化
// 列表整棵重渲）。
//
// 红证：HEAD 上三个文件都没有 document.hidden 门控 → 本文件全红。

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const files = {
    "agent-status-done-tick.ts": join(root, "agent-status", "agent-status-done-tick.ts"),
    "processviewer.tsx": join(root, "view", "processviewer", "processviewer.tsx"),
    "aiaudit-view.tsx": join(root, "view", "aiaudit", "aiaudit-view.tsx"),
};

describe("隐藏页面定时器休眠（W2-3）", () => {
    it.each(Object.entries(files))("%s 的定时器有 document.hidden 门控", (_name, file) => {
        const source = readFileSync(file, "utf8");
        expect(source).toMatch(/document\.hidden/);
    });
});
