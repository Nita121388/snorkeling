// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// `planNewTab` 的锁：新建 Tab 弹窗的三选一意图 → 落库计划。
//
// 只锁纯决策，不碰 RPC：真机链路（CreateTab / CreateBlockInTab）由 verify 台断言。
// 值得锁的点：模板项本轮只是占位，若函数层不拒绝，禁用的按钮之外的调用路径
// （键盘回车、后续代码复用）会静默创建出"看起来像模板其实是空 Tab"的东西。

import { describe, expect, it } from "vitest";
import { planNewTab } from "./overview-new-tab";

describe("planNewTab", () => {
    it("empty → 只建空 Tab", () => {
        const p = planNewTab({ kind: "empty", name: "实验", fallbackName: "新 Tab" });
        expect(p.ok).toBe(true);
        expect(p.addAgent).toBe(false);
        expect(p.name).toBe("实验");
    });

    it("agent → 建 Tab 并加 agent 块", () => {
        const p = planNewTab({ kind: "agent", name: "pi 场", fallbackName: "新 Tab" });
        expect(p.ok).toBe(true);
        expect(p.addAgent).toBe(true);
    });

    it("template → 本轮拒绝（占位）", () => {
        const p = planNewTab({ kind: "template", name: "x", fallbackName: "新 Tab" });
        expect(p.ok).toBe(false);
        expect(p.error).toBe("template-unsupported");
    });

    it("空名（含纯空白）回落 fallbackName", () => {
        expect(planNewTab({ kind: "empty", name: "", fallbackName: "新 Tab" }).name).toBe("新 Tab");
        expect(planNewTab({ kind: "empty", name: "   ", fallbackName: "新 Tab" }).name).toBe("新 Tab");
    });

    it("名称 trim", () => {
        expect(planNewTab({ kind: "empty", name: "  dev  ", fallbackName: "新 Tab" }).name).toBe("dev");
    });
});
