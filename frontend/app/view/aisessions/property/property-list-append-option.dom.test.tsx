// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// PropertyList — UI 新值自动追加模板候选（agent / 全局 scope）的交互契约（jsdom）。
//
// 锁定的回归点（11-19-property-ui-add-option）：
//  1. select / multi_select 提交不在候选表里的新值 → 值照常写（onChange），
//     且把新值追加进模板 options 末尾（setPropertySchema 收到追加后的 defs）；
//  2. 追加后的模板候选在同一属性的下拉里可见（写回后重新渲染）；
//  3. 会话私有属性（不在模板里 / 其它 agent 的 scope）提交新值 → 模板不动
//     （setPropertySchema 未被调用）；
//  4. 模板写失败（reject）→ 值写入仍成功，只 console.warn，无未捕获异常；
//  5. onChange 返回 rejected Promise（值写失败）→ 不追加模板候选，无未捕获异常。
//
// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { initI18n } from "@/i18n/config";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PropertyList } from "./property-list";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 模块级 mock：setPropertySchema 可控（避免真实 RPC），
// appendOptionToSchemaDefs 保留真实实现 —— DOM 测试必须打到真合并语义，不能只测桩。
const mocks = vi.hoisted(() => ({
    setPropertySchema: vi.fn(async () => undefined),
}));

vi.mock("./property-schema", async () => {
    const actual = await vi.importActual<typeof import("./property-schema")>("./property-schema");
    return {
        ...actual,
        setPropertySchema: mocks.setPropertySchema,
    };
});

function makeSummary(overrides: Partial<SessionSummary> = {}): SessionSummary {
    return {
        key: "codex:abc:/tmp/a.jsonl",
        id: "abc",
        source: "codex",
        ...overrides,
    } as SessionSummary;
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function mount(node: React.ReactNode) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
        root.render(node);
    });
}

function click(el: Element | null) {
    expect(el).not.toBeNull();
    act(() => {
        el!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
}

const row = (key: string) => document.querySelector(`[data-property-key="${key}"]`);
const tagEditor = () => document.querySelector('[data-testid="property-tag-editor"]');
const valueButton = (key: string) => row(key)!.querySelector<HTMLButtonElement>(".property-row__button")!;

function openDropdown(key: string) {
    click(valueButton(key));
    expect(tagEditor()).not.toBeNull();
}

function typeAndEnter(value: string) {
    const input = tagEditor()!.querySelector<HTMLInputElement>(".ptag-input")!;
    act(() => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
        setter.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
}

const candidateTexts = () =>
    Array.from(tagEditor()!.querySelectorAll(".ptag-option .ptag-option-chip")).map((el) =>
        (el.textContent ?? "").trim()
    );

beforeAll(async () => {
    await initI18n("en");
});

describe("PropertyList — UI 新值自动追加模板候选", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        mocks.setPropertySchema.mockClear();
        mocks.setPropertySchema.mockImplementation(async () => undefined);
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        document.querySelectorAll(".property-value-popover").forEach((el) => el.remove());
        vi.useRealTimers();
    });

    const globalSchema = () => [{ key: "stage", name: "Stage", type: "select", options: ["plan"], order: 1, scope: "" }];

    function mountStageSelect(schema: any[], onChange: (key: string, value: any, def: any) => any) {
        mount(
            <PropertyList
                summary={makeSummary({
                    props: { stage: { value: "plan", type: "select", source: "user", updatedAt: 1 } },
                })}
                mode="detail"
                canEdit
                onChange={onChange}
                schema={schema}
            />
        );
        expect(row("stage")).not.toBeNull();
    }

    it("全局 scope 的 select 提交新值 → 值照常写 + 新值追加进模板 options 末尾", () => {
        const onChange = vi.fn();
        mountStageSelect(globalSchema(), onChange);

        openDropdown("stage");
        typeAndEnter("Working");

        // 值写入不受影响（主目标）
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange.mock.calls[0][0]).toBe("stage");
        expect(onChange.mock.calls[0][1]).toBe("Working");
        // 模板追加：options 末尾出现新值，原候选顺序不变
        expect(mocks.setPropertySchema).toHaveBeenCalledTimes(1);
        const written = (mocks.setPropertySchema.mock.calls[0] as unknown[])[0] as any[];
        expect(written).toHaveLength(1);
        expect(written[0].key).toBe("stage");
        expect(written[0].options).toEqual(["plan", "Working"]);
    });

    it("追加写回后，同一属性的下拉候选含该值（读 DOM）", () => {
        mountStageSelect(globalSchema(), vi.fn());
        openDropdown("stage");
        typeAndEnter("Working");
        expect(mocks.setPropertySchema).toHaveBeenCalledTimes(1);
        const written = (mocks.setPropertySchema.mock.calls[0] as unknown[])[0] as any[];

        // 模拟 settings 写回（父组件 usePropertySchema 的新鲜值）后重新渲染：
        // 候选必须来自模板 def.options，而不是只靠「当前值」临时渲染。
        act(() => root.unmount());
        container.remove();
        document.querySelectorAll(".property-value-popover").forEach((el) => el.remove());
        mount(
            <PropertyList
                summary={makeSummary({
                    props: { stage: { value: "plan", type: "select", source: "user", updatedAt: 1 } },
                })}
                mode="detail"
                canEdit
                onChange={vi.fn()}
                schema={written}
            />
        );

        openDropdown("stage");
        // tagToOption 读时归一小写：候选文本比较用小写口径
        expect(candidateTexts().map((t) => t.toLowerCase())).toContain("working");
    });

    it("会话私有属性（不在模板里）提交新值 → 模板不动（setPropertySchema 未被调用）", () => {
        const onChange = vi.fn();
        // 模板非空但不含该属性：即使 schema 里定义了别的属性也不许碰模板
        const template = [{ key: "owner", name: "Owner", type: "text", order: 1, scope: "" }];
        mount(
            <PropertyList
                summary={makeSummary({
                    props: { flavor: { value: ["a"], type: "multi_select", source: "user", updatedAt: 1 } },
                })}
                mode="detail"
                canEdit
                onChange={onChange}
                schema={template}
            />
        );

        openDropdown("flavor");
        typeAndEnter("salty");

        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange.mock.calls[0][0]).toBe("flavor");
        expect(onChange.mock.calls[0][1]).toEqual(["a", "salty"]);
        expect(mocks.setPropertySchema).not.toHaveBeenCalled();
    });

    it("其它 agent 的 scope（agent:pi，本会话 source=codex）不可见 → 不追加", () => {
        const onChange = vi.fn();
        const template = [
            { key: "stage", name: "Stage", type: "select", options: ["plan"], order: 1, scope: "agent:pi" },
        ];
        mount(
            <PropertyList
                summary={makeSummary({
                    props: { stage: { value: "plan", type: "select", source: "user", updatedAt: 1 } },
                })}
                mode="detail"
                canEdit
                onChange={onChange}
                schema={template}
            />
        );

        openDropdown("stage");
        typeAndEnter("Working");

        expect(onChange).toHaveBeenCalledTimes(1);
        expect(mocks.setPropertySchema).not.toHaveBeenCalled();
    });

    it("agent scope 可见（agent:codex，本会话 source=codex）→ 追加", () => {
        const onChange = vi.fn();
        const template = [
            { key: "stage", name: "Stage", type: "select", options: ["plan"], order: 1, scope: "agent:codex" },
        ];
        mount(
            <PropertyList
                summary={makeSummary({
                    props: { stage: { value: "plan", type: "select", source: "user", updatedAt: 1 } },
                })}
                mode="detail"
                canEdit
                onChange={onChange}
                schema={template}
            />
        );

        openDropdown("stage");
        typeAndEnter("Working");

        expect(onChange).toHaveBeenCalledTimes(1);
        expect(((mocks.setPropertySchema.mock.calls[0] as unknown[])[0] as any[])[0].options).toEqual([
            "plan",
            "Working",
        ]);
    });

    it("multi_select 一次提交多个新值 → 全部追加且保序", () => {
        const onChange = vi.fn();
        const template = [{ key: "labels", name: "Labels", type: "multi_select", options: ["a"], order: 1, scope: "" }];
        mount(
            <PropertyList
                summary={makeSummary({
                    props: { labels: { value: ["a"], type: "multi_select", source: "user", updatedAt: 1 } },
                })}
                mode="detail"
                canEdit
                onChange={onChange}
                schema={template}
            />
        );

        openDropdown("labels");
        typeAndEnter("b");
        typeAndEnter("c");

        expect(onChange).toHaveBeenCalledTimes(2);
        expect(onChange.mock.calls[0][1]).toEqual(["a", "b"]);
        expect(onChange.mock.calls[1][1]).toEqual(["a", "b", "c"]);
        expect(mocks.setPropertySchema).toHaveBeenCalledTimes(2);
        expect(((mocks.setPropertySchema.mock.calls[1] as unknown[])[0] as any[])[0].options).toEqual([
            "a",
            "b",
            "c",
        ]);
    });

    it("模板写失败（reject）→ 值写入仍成功，只 console.warn，无未捕获异常", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        mocks.setPropertySchema.mockImplementation(async () => {
            throw new Error("settings write failed");
        });
        const onChange = vi.fn();
        try {
            mountStageSelect(globalSchema(), onChange);

            openDropdown("stage");
            typeAndEnter("Working");

            // 先冲掉微任务：setPropertySchema 的 reject 在 maybeAppendOptions 的 await 处
            // 被 catch 吞掉并 console.warn（异步链，断言前必须 flush）。
            await act(async () => {
                await vi.advanceTimersByTimeAsync(0);
            });

            // 值写入成功（主目标不受模板失败影响）
            expect(onChange).toHaveBeenCalledTimes(1);
            expect(onChange.mock.calls[0][1]).toBe("Working");
            expect(mocks.setPropertySchema).toHaveBeenCalledTimes(1);
            expect(warn).toHaveBeenCalledTimes(1);
            // 让可能泄漏的微任务跑完（reject 被吞掉；vitest 会对未处理 rejection 记错）
            await act(async () => {
                await vi.advanceTimersByTimeAsync(1);
            });
        } finally {
            warn.mockRestore();
        }
    });

    it("值写入失败（onChange 返回 rejected Promise）→ 不追加模板候选，无未捕获异常", async () => {
        const onChange = vi.fn(() => Promise.reject(new Error("value write failed")));
        mountStageSelect(globalSchema(), onChange);

        openDropdown("stage");
        typeAndEnter("Working");

        expect(onChange).toHaveBeenCalledTimes(1);
        expect(mocks.setPropertySchema).not.toHaveBeenCalled();
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1);
        });
    });
});
