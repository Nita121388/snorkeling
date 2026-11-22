// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Overview「＋ 新建 Tab」纯逻辑：三选一意图 → 落库计划。
// UI 层在 overview-new-tab-modal.tsx；入口在 session-overview.tsx（工具栏 + 组列表尾部）。
//
// 保持纯函数（不 import React / jotai / i18n），与 overview-add-agent.ts 同一约定：
// 文案（fallbackName「新 Tab」）由调用方传入，规则直接单测（overview-new-tab.test.ts）。

/** 弹窗三选一（对齐父 PRD 决策 C）：template 本轮只是占位。 */
export type NewTabKind = "empty" | "agent" | "template";

/** 一次创建的落库计划：CreateTab（+ 可选 CreateBlockInTab）由调用方照计划执行。 */
export type NewTabPlan = {
    ok: boolean;
    kind: NewTabKind;
    /** 空名回落 fallbackName（PRD R2.1），一律 trim。 */
    name: string;
    /** true = 建 Tab 后再建一枚默认 provider 的 agent 块。 */
    addAgent: boolean;
    /** 本轮唯一的拒绝原因：模板未实现（按钮本来 disabled，函数兜底防键盘/复用误调用）。 */
    error: "template-unsupported" | null;
};

export function planNewTab(args: { kind: NewTabKind; name: string; fallbackName: string }): NewTabPlan {
    const name = args.name?.trim() ?? "";
    const fallback = args.fallbackName?.trim() ?? "";
    const resolvedName = name === "" ? fallback : name;
    if (args.kind === "template") {
        return { ok: false, kind: "template", name: resolvedName, addAgent: false, error: "template-unsupported" };
    }
    return { ok: true, kind: args.kind, name: resolvedName, addAgent: args.kind === "agent", error: null };
}
