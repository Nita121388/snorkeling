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
