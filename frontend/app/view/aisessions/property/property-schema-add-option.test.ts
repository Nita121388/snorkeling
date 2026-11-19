// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// appendOptionToSchemaDefs — UI 新值自动追加模板候选（纯函数）的契约。
//
// 锁定的不变量（与 CLI 侧 MergePropertyOptions / pkg/agentdata/patch.go 同一套）：
//  1. 追加在 options 末尾，原候选顺序与 defs 顺序都不动；
//  2. 幂等：重复追加 → changed=false，options 长度不变；
//  3. 去重策略写死：trim + 全部小写比较，大小写变体视为同一候选；
//  4. 绝不删已有 option；
//  5. changed=false 时调用方不得发 setPropertySchema（本测试只断言返回值，不 assert 调用）。

import { describe, expect, it } from "vitest";
import { appendOptionToSchemaDefs } from "./property-schema";

type Def = { key: string; name?: string; type?: string; options?: string[]; order?: number; scope?: string };

const defs = (input: Def[]): Def[] => structuredClone(input);

describe("appendOptionToSchemaDefs", () => {
    it("追加新值到 options 末尾，原有候选顺序不变", () => {
        const { next, changed } = appendOptionToSchemaDefs(
            defs([{ key: "stage", name: "Stage", type: "select", options: ["plan", "build"], order: 1, scope: "" }]),
            "stage",
            ["Working"]
        );
        expect(changed).toBe(true);
        expect(next).toHaveLength(1);
        expect(next[0].options).toEqual(["plan", "build", "Working"]);
    });

    it("重复追加相同值 → changed=false，options 长度不变", () => {
        const first = appendOptionToSchemaDefs(
            defs([{ key: "stage", name: "Stage", type: "select", options: ["plan"], order: 1, scope: "" }]),
            "stage",
            ["Working"]
        );
        expect(first.changed).toBe(true);

        // 第二次（无论基于第一次的产物还是原始 defs）都必须是 no-op。
        const second = appendOptionToSchemaDefs(first.next, "stage", ["Working"]);
        expect(second.changed).toBe(false);
        expect(second.next[0].options).toEqual(["plan", "Working"]);
        expect(first.next).toEqual(second.next);
    });

    it("大小写去重（写死策略：trim + 小写比较）：Doing vs doing 视为同一候选", () => {
        const { next, changed } = appendOptionToSchemaDefs(
            defs([{ key: "status", name: "Status", type: "status", options: ["doing"], order: 1, scope: "" }]),
            "status",
            ["Doing"]
        );
        expect(changed).toBe(false);
        expect(next[0].options).toEqual(["doing"]);
    });

    it("追加保留用户输入的大小写，仅比较时归一", () => {
        const { next, changed } = appendOptionToSchemaDefs(
            defs([{ key: "stage", name: "Stage", type: "select", options: ["plan"], order: 1, scope: "" }]),
            "stage",
            ["Working"]
        );
        expect(changed).toBe(true);
        expect(next[0].options).toEqual(["plan", "Working"]);
    });

    it("def.scope === session（未知编码）→ 不追加，changed=false", () => {
        const { next, changed } = appendOptionToSchemaDefs(
            defs([{ key: "secret", name: "Secret", type: "select", options: ["a"], order: 1, scope: "session" }]),
            "secret",
            ["b"]
        );
        expect(changed).toBe(false);
        expect(next[0].options).toEqual(["a"]);
    });

    it("属性不在模板里（session 私有，无对应 def）→ 不追加，changed=false", () => {
        const { next, changed } = appendOptionToSchemaDefs(
            defs([{ key: "stage", name: "Stage", type: "select", options: ["plan"], order: 1, scope: "" }]),
            "private_prop",
            ["x"]
        );
        expect(changed).toBe(false);
        expect(next).toHaveLength(1);
        expect(next[0].options).toEqual(["plan"]);
    });

    it("agent scope（agent:<source>）可追加", () => {
        const { next, changed } = appendOptionToSchemaDefs(
            defs([{ key: "stage", name: "Stage", type: "select", options: ["plan"], order: 1, scope: "agent:pi" }]),
            "stage",
            ["Working"]
        );
        expect(changed).toBe(true);
        expect(next[0].options).toEqual(["plan", "Working"]);
    });

    it("key 按 slugified 口径匹配：settings 里手写的 'Priority' 与表单建的 'priority' 是同一条定义", () => {
        const { next, changed } = appendOptionToSchemaDefs(
            defs([{ key: "Priority", name: "Priority", type: "select", options: ["p1"], order: 1, scope: "" }]),
            "priority",
            ["p2"]
        );
        expect(changed).toBe(true);
        expect(next[0].options).toEqual(["p1", "p2"]);
    });

    it("multi_select 一次提交多个新值 → 全部追加且保序", () => {
        const { next, changed } = appendOptionToSchemaDefs(
            defs([{ key: "labels", name: "Labels", type: "multi_select", options: ["a"], order: 1, scope: "" }]),
            "labels",
            ["b", "c", "b"]
        );
        expect(changed).toBe(true);
        expect(next[0].options).toEqual(["a", "b", "c"]);
    });

    it("status 类型归一为 select：允许追加", () => {
        const { next, changed } = appendOptionToSchemaDefs(
            defs([{ key: "state", name: "State", type: "status", options: ["new"], order: 1, scope: "" }]),
            "state",
            ["idle"]
        );
        expect(changed).toBe(true);
        expect(next[0].options).toEqual(["new", "idle"]);
    });

    it("非选项类型（text / number / person）不追加", () => {
        for (const type of ["text", "number", "person"]) {
            const { next, changed } = appendOptionToSchemaDefs(
                defs([{ key: "k", name: "K", type, options: ["x"], order: 1, scope: "" }]),
                "k",
                ["y"]
            );
            expect(changed).toBe(false);
            expect(next[0].options).toEqual(["x"]);
        }
    });

    it("空值 / 纯空白值不追加", () => {
        const { next, changed } = appendOptionToSchemaDefs(
            defs([{ key: "stage", name: "Stage", type: "select", options: ["plan"], order: 1, scope: "" }]),
            "stage",
            ["", "   ", null as unknown as string]
        );
        expect(changed).toBe(false);
        expect(next[0].options).toEqual(["plan"]);
    });

    it("多 defs 时只改命中的那一条，其它 def 与顺序不动", () => {
        const input = defs([
            { key: "stage", name: "Stage", type: "select", options: ["plan"], order: 1, scope: "" },
            { key: "owner", name: "Owner", type: "text", order: 2, scope: "" },
        ]);
        const { next, changed } = appendOptionToSchemaDefs(input, "stage", ["Working"]);
        expect(changed).toBe(true);
        expect(next).toHaveLength(2);
        expect(next[0].options).toEqual(["plan", "Working"]);
        expect(next[1]).toEqual(input[1]);
    });
});