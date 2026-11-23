// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// `scheduledtask-hero` 的锁：编辑弹窗提交载荷里的 hero 绑定语义。
//
// 为什么值得锁：后端 `hero` 是 `json:"hero,omitempty"`，所以
//   · 选中 hero → 载荷必须带 `hero`（否则后端永远不知道要按 hero home 解析 cwd/provider/model）；
//   · 用户清空选择（"不绑定"）→ 载荷必须**不带** `hero` 键（带空串不一定被 omitempty 吃掉，
//     且语义上"清除绑定"要靠"键缺失"，不能靠空值赌博）。

import { describe, expect, it } from "vitest";
import { heroSelectOptions, normalizeHeroBinding } from "./scheduledtask-hero";

function draft(over: Record<string, any> = {}): any {
    return {
        id: "t1",
        name: "daily",
        enabled: true,
        agentProfile: "pi",
        model: "gpt-5",
        prompt: "p",
        workdir: "",
        schedule: { type: "daily", timeOfDay: "09:00" },
        ...over,
    };
}

describe("normalizeHeroBinding", () => {
    it("选中 hero → 载荷带 hero id", () => {
        const out = normalizeHeroBinding(draft({ hero: "nita" }));
        expect(out.hero).toBe("nita");
    });

    it("hero 前后空格被裁剪后写入", () => {
        const out = normalizeHeroBinding(draft({ hero: "  nita  " }));
        expect(out.hero).toBe("nita");
    });

    it("清空选择 → 载荷不含 hero 键", () => {
        const out = normalizeHeroBinding(draft({ hero: "" }));
        expect("hero" in out).toBe(false);
        expect(out.hero).toBeUndefined();
    });

    it("纯空白 / 未设置 → 载荷不含 hero 键", () => {
        expect("hero" in normalizeHeroBinding(draft({ hero: "   " }))).toBe(false);
        expect("hero" in normalizeHeroBinding(draft())).toBe(false);
        expect("hero" in normalizeHeroBinding(draft({ hero: null }))).toBe(false);
    });

    it("不改动其它字段，也不改入参对象", () => {
        const input = draft({ hero: "nita" });
        const out = normalizeHeroBinding(input);
        expect(out.name).toBe("daily");
        expect(out.model).toBe("gpt-5");
        expect(out.schedule).toEqual({ type: "daily", timeOfDay: "09:00" });
        expect(input.hero).toBe("nita");
        expect(out).not.toBe(input);
    });
});

describe("heroSelectOptions", () => {
    it("首项是「不绑定」占位，其后按名册给出 emoji + 名称", () => {
        const options = heroSelectOptions(
            [
                { id: "nita", name: "Nita", emoji: "🦊" },
                { id: "ghost", name: "" },
            ],
            "不绑定 hero"
        );
        expect(options[0]).toEqual({ value: "", label: "不绑定 hero" });
        expect(options[1]).toEqual({ value: "nita", label: "🦊 Nita" });
        // 无名 / 无 emoji 的 hero 回落到 id，且不产生多余空格
        expect(options[2]).toEqual({ value: "ghost", label: "ghost" });
    });

    it("空名册只返回占位项", () => {
        expect(heroSelectOptions([], "none")).toEqual([{ value: "", label: "none" }]);
        expect(heroSelectOptions(null, "none")).toEqual([{ value: "", label: "none" }]);
    });
});
