// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// EditableTitle 行为测试（jsdom）。
//
// 锁定的回归点：
//  1. 展示态渲染标题全文 + title 属性（截断不影响可读性）。
//  2. 两种进入编辑的手势：single（悬浮卡）/ double（弹窗）。
//  3. Enter 提交、Escape 放弃；Escape 必须 stopPropagation ——
//     否则冒泡到 document 上的 AppKeyHandlers 会把整个弹窗关掉（keymodel.ts Escape 分支）。
//  4. 空串 / 未变化不发请求。
//  5. onCommit 返回 null → 保持编辑态并显示错误。
//  6. editable=false 时任何手势都不进编辑。
//
// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditableTitle } from "./editable-title";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const containers: HTMLDivElement[] = [];
const roots: ReturnType<typeof createRoot>[] = [];

function mount(node: React.ReactNode): HTMLDivElement {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(node));
    containers.push(container);
    roots.push(root);
    return container;
}

afterEach(() => {
    while (roots.length > 0) {
        const root = roots.pop();
        act(() => root?.unmount());
    }
    while (containers.length > 0) {
        containers.pop()?.remove();
    }
    vi.restoreAllMocks();
});

function titleSpan(container: HTMLElement): HTMLElement | null {
    return container.querySelector<HTMLElement>(".info-card-title");
}

function input(container: HTMLElement): HTMLInputElement | null {
    return container.querySelector<HTMLInputElement>("input");
}

function enterEdit(container: HTMLElement, gesture: "single" | "double"): void {
    const span = titleSpan(container);
    expect(span).not.toBeNull();
    act(() => {
        span?.dispatchEvent(
            new MouseEvent(gesture === "single" ? "click" : "dblclick", { bubbles: true, cancelable: true })
        );
    });
}

function typeInto(el: HTMLInputElement, value: string): void {
    act(() => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
        setter?.call(el, value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

function key(el: HTMLInputElement, name: string): KeyboardEvent {
    const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true });
    act(() => {
        el.dispatchEvent(event);
    });
    return event;
}

describe("EditableTitle — 展示态", () => {
    it("渲染标题全文到 title 属性", () => {
        const container = mount(<EditableTitle title="一个很长的会话名称" onCommit={async () => null} />);
        const span = titleSpan(container);
        expect(span?.getAttribute("title")).toBe("一个很长的会话名称");
        expect(span?.textContent).toContain("一个很长的会话名称");
    });

    it("AI 标题渲染 TitleSourceBadge", () => {
        const container = mount(<EditableTitle title="会话" titleSource="ai" onCommit={async () => null} />);
        expect(container.querySelector('[aria-label="AI-generated title"]')).not.toBeNull();
    });

    it("用户标题不渲染 AI 徽标（TitleSourceBadge 只在 ai 时出现）", () => {
        const container = mount(<EditableTitle title="会话" titleSource="user" onCommit={async () => null} />);
        expect(container.querySelector('[aria-label="AI-generated title"]')).toBeNull();
    });

    it("可编辑时带 cursor-text 提示类", () => {
        const container = mount(<EditableTitle title="会话" onCommit={async () => null} />);
        expect(titleSpan(container)?.className).toContain("is-editable");
    });

    it("editable=false 时不带 is-editable", () => {
        const container = mount(<EditableTitle title="会话" editable={false} onCommit={async () => null} />);
        expect(titleSpan(container)?.className).not.toContain("is-editable");
    });
});

describe("EditableTitle — 进入编辑", () => {
    it("single 手势单击进入编辑", () => {
        const container = mount(<EditableTitle title="会话" enterToEdit="single" onCommit={async () => null} />);
        enterEdit(container, "single");
        expect(input(container)?.value).toBe("会话");
    });

    it("single 手势双击也进入编辑", () => {
        const container = mount(<EditableTitle title="会话" enterToEdit="single" onCommit={async () => null} />);
        enterEdit(container, "double");
        expect(input(container)).not.toBeNull();
    });

    it("double 手势单击不进入编辑", () => {
        const container = mount(<EditableTitle title="会话" enterToEdit="double" onCommit={async () => null} />);
        enterEdit(container, "single");
        expect(input(container)).toBeNull();
    });

    it("double 手势双击进入编辑", () => {
        const container = mount(<EditableTitle title="会话" enterToEdit="double" onCommit={async () => null} />);
        enterEdit(container, "double");
        expect(input(container)?.value).toBe("会话");
    });

    it("editable=false 单击不进入编辑", () => {
        const container = mount(
            <EditableTitle title="会话" enterToEdit="single" editable={false} onCommit={async () => null} />
        );
        enterEdit(container, "single");
        expect(input(container)).toBeNull();
    });
});

describe("EditableTitle — 提交与放弃", () => {
    it("Enter 提交 trim 后的值", async () => {
        const onCommit = vi.fn(async () => null);
        const container = mount(<EditableTitle title="旧" enterToEdit="single" onCommit={onCommit} />);
        enterEdit(container, "single");
        const el = input(container);
        typeInto(el, "  新标题  ");
        key(el, "Enter");
        expect(onCommit).toHaveBeenCalledWith("新标题");
    });

    it("Escape 放弃且 stopPropagation + preventDefault", () => {
        const onCommit = vi.fn(async () => null);
        const container = mount(<EditableTitle title="旧" enterToEdit="single" onCommit={onCommit} />);
        enterEdit(container, "single");
        const el = input(container);
        typeInto(el, "改了");
        const event = key(el, "Escape");
        expect(event.defaultPrevented).toBe(true);
        expect(onCommit).not.toHaveBeenCalled();
        expect(input(container)).toBeNull();
    });

    it("空串不调用 onCommit 且退出编辑", () => {
        const onCommit = vi.fn(async () => null);
        const container = mount(<EditableTitle title="旧" enterToEdit="single" onCommit={onCommit} />);
        enterEdit(container, "single");
        const el = input(container);
        typeInto(el, "   ");
        key(el, "Enter");
        expect(onCommit).not.toHaveBeenCalled();
        expect(input(container)).toBeNull();
    });

    it("与现值相同不调用 onCommit", () => {
        const onCommit = vi.fn(async () => null);
        const container = mount(<EditableTitle title="旧" enterToEdit="single" onCommit={onCommit} />);
        enterEdit(container, "single");
        key(input(container), "Enter");
        expect(onCommit).not.toHaveBeenCalled();
    });
});

// ─── card 变体：121 版本的 callout 样式 + 编辑态排版零变化 ───
//
// 锁定的回归点（都是用户实际报过的问题）：
//  1. card 变体展示态必须落在 .agent-card-title-block（12.5px / 2 行 clamp / 左侧引用线），
//     不能退化成 11px 单行省略。
//  2. 编辑态**不换排版**：仍是 .agent-card-title-block + .agent-card-title-wrap，
//     编辑器自身带 .agent-card-title-editor（无边框/透明底/继承字体），
//     不能出现 RenameTitleInputClass 那套“蓝框表单”。
//  3. 宽度不能把卡片撑破：编辑器是 width:100% + box-sizing:border-box（样式契约）。
describe("EditableTitle — card 变体（agent 悬浮卡标题）", () => {
    it("展示态复用 .agent-card-title-block，不是 11px 单行", () => {
        const container = mount(
            <EditableTitle title="重构认证模块" titleSource="ai" variant="card" onCommit={vi.fn()} />
        );
        expect(container.querySelector(".agent-card-title-wrap")).not.toBeNull();
        const block = container.querySelector(".agent-card-title-block");
        expect(block).not.toBeNull();
        expect(block!.textContent).toContain("重构认证模块");
        // 不能同时渲染 inline 那套
        expect(container.querySelector(".info-card-title")).toBeNull();
    });

    it("编辑态保持同一排版：仍是 title-block，且编辑器无边框", () => {
        const container = mount(
            <EditableTitle title="重构认证模块" variant="card" enterToEdit="single" onCommit={vi.fn()} />
        );
        act(() => {
            container
                .querySelector(".agent-card-title-block")
                ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        });

        // 排版容器没变
        expect(container.querySelector(".agent-card-title-wrap")).not.toBeNull();
        expect(container.querySelector(".agent-card-title-block")).not.toBeNull();
        // 编辑器是专用 class，不是 RenameTitleInputClass 那套表单外观
        const editor = container.querySelector(".agent-card-title-editor");
        expect(editor).not.toBeNull();
        expect(editor!.tagName).toBe("TEXTAREA");
        expect(editor!.className).not.toContain("border");
        expect(editor!.className).not.toContain("bg-surface");
    });

    it("card 编辑态仍能 Enter 提交（textarea 也走同一套键盘语义）", async () => {
        const onCommit = vi.fn().mockResolvedValue({});
        const container = mount(
            <EditableTitle title="旧标题" variant="card" enterToEdit="single" onCommit={onCommit} />
        );
        act(() => {
            container
                .querySelector(".agent-card-title-block")
                ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        });
        const area = container.querySelector<HTMLTextAreaElement>(".agent-card-title-editor")!;
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
        act(() => {
            setter.call(area, "新标题");
            area.dispatchEvent(new Event("input", { bubbles: true }));
        });
        await act(async () => {
            area.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
        });
        expect(onCommit).toHaveBeenCalledWith("新标题");
    });
});
