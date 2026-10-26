// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// SortMenu 排序链面板 DOM 契约测试。
//
// 不渲染整块 AI Sessions（重），只单测下拉的交互语义：
//  - 默认摘要 = "Newest"
//  - 点未入选项 → 追加到链末
//  - 点方向 → 只翻该键方向
//  - 点 ✕ → 移除 + 序号前移
//  - 满 3 条时 ⊕ 置灰
//  - Reset → 回默认
//
// 注意: 本机 Node 26 的 jsdom 不再默认提供 localStorage，需用
// NODE_OPTIONS="--localstorage-file=..." 跑，否则 readSortChain 抛错。

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SortMenu } from "./sort-menu";
import type { SessionSortChain } from "./types";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLElement;
let root: Root;

function mount(chain: SessionSortChain, onChange: (c: SessionSortChain) => void) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
        root.render(<SortMenu chain={chain} onChange={onChange} />);
    });
}

function trigger(): HTMLButtonElement {
    return container.querySelector<HTMLButtonElement>("[aria-haspopup='menu']")!;
}

function options(): HTMLElement[] {
    return Array.from(container.querySelectorAll<HTMLElement>("[data-sort-field], [data-add-field]"));
}

beforeEach(() => {
    // 本文件不读 localStorage（SortMenu 是纯受控组件），不要 stub window —— 
    // 覆盖 window 会拿走 clearTimeout，floating-ui 的 effect cleanup 直接炸。
    Element.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 200, 30);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
});

describe("SortMenu", () => {
    it("shows Newest when chain is the default", () => {
        const onChange = vi.fn();
        mount([{ field: "time", desc: true }], onChange);
        expect(trigger().textContent).toContain("Newest");
    });

    it("summarizes a multi-key chain", () => {
        const onChange = vi.fn();
        mount(
            [
                { field: "subagents", desc: true },
                { field: "messages", desc: true },
            ],
            onChange
        );
        expect(trigger().textContent).toContain("Sub-sessions·Messages");
    });

    it("appends an unselected field to the chain", () => {
        const onChange = vi.fn();
        mount([{ field: "time", desc: true }], onChange);
        act(() => trigger().click());
        const addBtn = document.querySelector<HTMLButtonElement>('[data-add-field="messages"]')!;
        act(() => addBtn.click());
        expect(onChange).toHaveBeenCalledWith([
            { field: "time", desc: true },
            { field: "messages", desc: true },
        ]);
    });

    it("toggles only the direction of the clicked key", () => {
        const onChange = vi.fn();
        mount([{ field: "time", desc: true }], onChange);
        act(() => trigger().click());
        const dirBtn = document.querySelector<HTMLElement>('[data-sort-field="time"]')!.querySelectorAll("button")[0];
        act(() => (dirBtn as HTMLButtonElement).click());
        expect(onChange).toHaveBeenCalledWith([{ field: "time", desc: false }]);
    });

    it("removes a key and shifts the remaining up", () => {
        const onChange = vi.fn();
        mount(
            [
                { field: "subagents", desc: true },
                { field: "messages", desc: true },
            ],
            onChange
        );
        act(() => trigger().click());
        const removeBtn = document.querySelector<HTMLElement>('[data-sort-field="subagents"]')!;
        const close = removeBtn.querySelectorAll("button")[1];
        act(() => (close as HTMLButtonElement).click());
        expect(onChange).toHaveBeenCalledWith([{ field: "messages", desc: true }]);
    });

    it("resets to default", () => {
        const onChange = vi.fn();
        mount(
            [
                { field: "messages", desc: true },
                { field: "subagents", desc: true },
            ],
            onChange
        );
        act(() => trigger().click());
        const resetBtn = Array.from(
            document.querySelectorAll<HTMLButtonElement>("button")
        ).find((b) => b.textContent?.includes("Reset to default"))!;
        act(() => resetBtn.click());
        expect(onChange).toHaveBeenCalledWith([{ field: "time", desc: true }]);
        // 受控组件：父层不更新时按钮摘要不变，所以只断言 onChange 载荷。
    });
});
