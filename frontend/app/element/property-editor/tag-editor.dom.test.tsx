// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// PropertyTagEditor 的「候选计数」契约（jsdom）。
//
// 锁定的回归点（G2 红证，实现前必须红）：
//  1. 传 optionCounts 时，候选项行尾渲染数字计数。
//  2. 不传 optionCounts 时，渲染结果与今天完全一致（md 预览属性卡走这条路径）。
//  3. 已选但清单里没有 count 的值不伪造 0。
//
// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PropertyTagEditor } from "./tag-editor";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

const optionRows = () => Array.from(document.querySelectorAll(".ptag-option:not(.is-create)"));
const countOf = (row: Element) => row.querySelector(".ptag-option-count")?.textContent?.trim() ?? null;

describe("PropertyTagEditor — 候选计数", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        vi.useRealTimers();
    });

    it("传 optionCounts 时候选项行尾渲染计数", () => {
        mount(
            <PropertyTagEditor
                items={[]}
                options={["fix", "feat"]}
                optionCounts={{ fix: 12, feat: 3 }}
                onChange={vi.fn()}
                onClose={vi.fn()}
            />
        );

        const rows = optionRows();
        expect(rows).toHaveLength(2);
        expect(countOf(rows[0])).toBe("12");
        expect(countOf(rows[1])).toBe("3");
    });

    it("不传 optionCounts 时不渲染任何计数节点（md 预览属性卡回归门）", () => {
        mount(<PropertyTagEditor items={[]} options={["fix", "feat"]} onChange={vi.fn()} onClose={vi.fn()} />);

        expect(optionRows()).toHaveLength(2);
        expect(document.querySelector(".ptag-option-count")).toBeNull();
    });

    it("清单里没有 count 的候选项不伪造 0", () => {
        mount(
            <PropertyTagEditor
                items={["mine-only"]}
                options={["fix", "mine-only"]}
                optionCounts={{ fix: 7 }}
                onChange={vi.fn()}
                onClose={vi.fn()}
            />
        );

        const rows = optionRows();
        const mineOnly = rows.find((row) => row.textContent?.includes("mine-only"));
        expect(mineOnly).toBeDefined();
        // mine-only 没有 count → 不渲染计数节点（不是 "0"）
        expect(countOf(mineOnly!)).toBeNull();
        const fix = rows.find((row) => row.textContent?.includes("fix"));
        expect(countOf(fix!)).toBe("7");
    });

    it("计数不打断点选：点候选项仍然 toggle 并回调完整数组", () => {
        const onChange = vi.fn();
        mount(
            <PropertyTagEditor
                items={[]}
                options={["fix"]}
                optionCounts={{ fix: 5 }}
                onChange={onChange}
                onClose={vi.fn()}
            />
        );

        const row = optionRows()[0];
        act(() => {
            row.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        });
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange.mock.calls[0][0]).toEqual(["fix"]);
    });
});

describe("PropertyTagEditor — 创建行不被子串命中挡住", () => {
    const input = () => document.querySelector<HTMLInputElement>(".ptag-input")!;
    const createRow = () => document.querySelector(".ptag-option.is-create");
    const keydown = (key: string) => {
        act(() => {
            input().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
        });
    };
    const typeInto = (text: string) => {
        act(() => {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
            setter.call(input(), text);
            input().dispatchEvent(new Event("input", { bubbles: true }));
        });
    };

    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        vi.useRealTimers();
    });

    it("精确值不存在但子串命中时，创建行仍然出现（与过滤结果共存）", () => {
        mount(
            <PropertyTagEditor
                items={[]}
                options={["原型设计中"]}
                onChange={vi.fn()}
                onClose={vi.fn()}
            />
        );

        typeInto("设计中");
        // 过滤列表里有「原型设计中」（子串命中）……
        const matched = optionRows().find((row) => row.textContent?.includes("原型设计中"));
        expect(matched).toBeDefined();
        // ……但创建行也在，不被子串命中挡住
        expect(createRow()).toBeDefined();
        expect(createRow()!.textContent).toContain("设计中");
    });

    it("点击创建行新增精确值（不是子串命中的项）", () => {
        const onChange = vi.fn();
        mount(
            <PropertyTagEditor
                items={[]}
                options={["原型设计中"]}
                onChange={onChange}
                onClose={vi.fn()}
            />
        );

        typeInto("设计中");
        act(() => {
            createRow()!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        });
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange.mock.calls[0][0]).toEqual(["设计中"]);
    });

    it("输入完整新值后直接回车 → 创建精确值（不选子串命中的第一行）", () => {
        const onChange = vi.fn();
        mount(
            <PropertyTagEditor
                items={[]}
                options={["原型设计中"]}
                onChange={onChange}
                onClose={vi.fn()}
            />
        );

        typeInto("设计中");
        keydown("Enter");
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange.mock.calls[0][0]).toEqual(["设计中"]);
        expect(onChange.mock.calls[0][0]).not.toContain("原型设计中");
    });

    it("方向键主动挑选子串命中的项后回车 → 选中该行（浏览流不误创）", () => {
        const onChange = vi.fn();
        mount(
            <PropertyTagEditor
                items={[]}
                options={["原型设计中"]}
                onChange={onChange}
                onClose={vi.fn()}
            />
        );

        typeInto("设计中");
        // 默认高亮在创建行（index=filtered.length=1）；ArrowUp 一次到「原型设计中」(index=0)
        keydown("ArrowUp");
        keydown("Enter");
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange.mock.calls[0][0]).toEqual(["原型设计中"]);
    });
});

// 关闭语义回归（task 11-20-property-status-to-select）：列表弹窗不能因为
// “点浮层自身空白 / 焦点逃逸”被误关。旧实现是容器 onBlur → 立即 onClose，
// Windows/Electron 下点列表 padding 就会触发。
describe("PropertyTagEditor — 误关闭回归：只认 Esc / 外部点击", () => {
    const input = () => document.querySelector<HTMLInputElement>(".ptag-input")!;

    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        vi.useRealTimers();
    });

    it("点浮层自身空白（列表 padding / 行间隙）不关闭，且不丢输入焦点路径", () => {
        const onClose = vi.fn();
        mount(
            <PropertyTagEditor items={[]} options={["fix", "feat"]} onChange={vi.fn()} onClose={onClose} />
        );
        const list = document.querySelector(".ptag-list")!;
        act(() => {
            list.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
            list.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        });
        expect(onClose).not.toHaveBeenCalled();
        // 空白区 mousedown 被 preventDefault（默认行为被取消）→ 焦点不会归 body。
        const ev = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
        act(() => {
            list.dispatchEvent(ev);
        });
        expect(ev.defaultPrevented).toBe(true);
    });

    it("焦点逃逸（focusout 到 body）不再关闭浮层", () => {
        const onClose = vi.fn();
        mount(<PropertyTagEditor items={[]} options={["fix"]} onChange={vi.fn()} onClose={onClose} />);
        act(() => {
            input().dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: null }));
            input().dispatchEvent(new FocusEvent("blur"));
        });
        expect(onClose).not.toHaveBeenCalled();
    });

    it("Esc 仍然关闭（键盘退出路径保留）", () => {
        const onClose = vi.fn();
        mount(<PropertyTagEditor items={[]} options={["fix"]} onChange={vi.fn()} onClose={onClose} />);
        act(() => {
            input().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
        });
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
