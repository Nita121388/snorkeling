// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// PropertyList 的交互契约（jsdom）。
//
// 锁定的回归点：
//  1. checkbox（含内置 starred）点击即切换，不渲染编辑态文本框。
//  2. detail 模式折叠的只读行能展开，且展开后编辑按钮是 disabled。
//
// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PropertyList } from "./property-list";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

function expandMore() {
    const more = Array.from(document.querySelectorAll("button")).find((b) =>
        b.textContent?.startsWith("More properties (")
    ) as HTMLButtonElement | undefined;
    expect(more).toBeDefined();
    click(more!);
}

const row = (key: string) => document.querySelector(`[data-property-key="${key}"]`);

describe("PropertyList interactions", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        vi.useRealTimers();
    });

    it("点 Starred 直接切换，不进入编辑态、不渲染文本框", () => {
        const onChange = vi.fn();
        mount(<PropertyList summary={makeSummary({ marked: false })} mode="detail" canEdit onChange={onChange} />);

        expandMore();
        const starredRow = row("starred");
        expect(starredRow).not.toBeNull();
        const button = starredRow!.querySelector<HTMLButtonElement>(".property-row__button")!;
        expect(button.getAttribute("role")).toBe("switch");
        expect(button.getAttribute("aria-checked")).toBe("false");

        click(button);
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange.mock.calls[0][0]).toBe("starred");
        expect(onChange.mock.calls[0][1]).toBe(true);

        // 不应该出现编辑用的文本输入框（旧 bug：框里显示字符串 "false"）。
        expect(starredRow!.querySelector('input[type="text"]')).toBeNull();
    });

    it("已勾选的 Starred 再点变成 false", () => {
        const onChange = vi.fn();
        mount(<PropertyList summary={makeSummary({ marked: true })} mode="detail" canEdit onChange={onChange} />);
        expandMore();
        const button = row("starred")!.querySelector<HTMLButtonElement>(".property-row__button")!;
        expect(button.getAttribute("aria-checked")).toBe("true");
        click(button);
        expect(onChange.mock.calls[0][1]).toBe(false);
    });

    it("自定义 checkbox 属性走同一条切换路径", () => {
        const onChange = vi.fn();
        mount(
            <PropertyList
                summary={makeSummary({
                    note: "",
                    props: { reviewed: { value: false, type: "checkbox", source: "user", updatedAt: 1 } },
                })}
                mode="detail"
                canEdit
                onChange={onChange}
            />
        );
        expandMore();
        const button = row("reviewed")!.querySelector<HTMLButtonElement>(".property-row__button")!;
        click(button);
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange.mock.calls[0][0]).toBe("reviewed");
        expect(onChange.mock.calls[0][1]).toBe(true);
    });

    it("展开 More properties 后出现只读行，其编辑按钮 disabled", () => {
        mount(<PropertyList summary={makeSummary({ createdAt: 1767225600000 })} mode="detail" canEdit onChange={vi.fn()} />);

        expect(row("created_at")).toBeNull();
        expandMore();
        const createdRow = row("created_at");
        expect(createdRow).not.toBeNull();
        const button = createdRow!.querySelector<HTMLButtonElement>(".property-row__button")!;
        expect(button.disabled).toBe(true);
    });
});
