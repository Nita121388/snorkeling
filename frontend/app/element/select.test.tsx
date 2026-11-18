// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// AppSelect DOM 回归锁。
//
// 锁定的契约（design.md §5）：
//   1. 关闭态：触发器是 role=combobox + aria-expanded=false，caret 存在；
//      值通道是视觉隐藏的原生 <select>，.value / .options 反映 props
//      —— 这是 scripts/verify/overview-board|overview-timeline 与 CDP 的驱动契约。
//   2. 打开态：aria-expanded=true，menu 是 role=listbox，恰有一个 aria-selected=true。
//   3. 键盘：ArrowDown 打开并把活动项移到选中项；Enter 提交 → onChange + 关闭 + 焦点回触发器；
//      Escape 关闭；首字母跳转。
//   4. 值通道可被原生赋值 + change 事件驱动（验证台的 `sel.value = x; dispatch change`）。
//   5. bare 变体不画自己的边框底色（视觉交给宿主外壳）。
//
// @vitest-environment jsdom

// React 19：act() 只有在显式打开这个标志时才真正 flush 更新，否则只在控制台刷
// 「not configured to support act(...)」然后 DOM 不更新 —— 断言会看到上一帧。
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppSelect, type AppSelectOption } from "./select";

const OPTIONS: AppSelectOption[] = [
    { value: "status", label: "Status" },
    { value: "tab", label: "Tab" },
    { value: "provider", label: "Provider" },
    { value: "project", label: "Project", disabled: true },
    { value: "tags", label: "Tags" },
];

let container: HTMLDivElement;
let root: Root;
let onChange: ReturnType<typeof vi.fn>;

function render(props: Partial<{ value: string; variant: "default" | "bare"; size: "xs" | "sm" | "md" }> = {}) {
    act(() => {
        root.render(
            <AppSelect
                options={OPTIONS}
                value={props.value ?? "status"}
                onChange={onChange as (value: string) => void}
                variant={props.variant}
                size={props.size}
                ariaLabel="group"
                data-overview-group=""
            />
        );
    });
}

const trigger = () => container.querySelector<HTMLButtonElement>("[data-select-trigger]");
const proxy = () => container.querySelector<HTMLSelectElement>("[data-select-proxy]");
const menu = () => document.body.querySelector<HTMLElement>("[data-select-menu]");
const options = () => [...document.body.querySelectorAll<HTMLElement>("[data-select-option]")];

function key(target: Element, keyName: string) {
    act(() => {
        target.dispatchEvent(new KeyboardEvent("keydown", { key: keyName, bubbles: true, cancelable: true }));
    });
}

function click(target: Element) {
    act(() => {
        target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
}

beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    onChange = vi.fn();
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

describe("AppSelect", () => {
    it("closed: combobox trigger + hidden native select proxy", () => {
        render();
        const btn = trigger();
        expect(btn).not.toBeNull();
        expect(btn.getAttribute("role")).toBe("combobox");
        expect(btn.getAttribute("aria-expanded")).toBe("false");
        expect(container.querySelector("[data-select-caret]")).not.toBeNull();
        expect(container.querySelector("[data-select-label]").textContent).toBe("Status");

        const sel = proxy();
        expect(sel).not.toBeNull();
        expect(sel.tagName).toBe("SELECT");
        expect(sel.value).toBe("status");
        expect([...sel.options].map((o) => o.value)).toEqual(OPTIONS.map((o) => o.value));
        // data-* 透传到值通道（迁移前的 `[data-overview-group]` 契约）
        expect(sel.getAttribute("data-overview-group")).toBe("");
        expect(sel.getAttribute("tabindex")).toBe("-1");
    });

    it("open: aria-expanded flips, listbox renders, exactly one option is selected", () => {
        render();
        click(trigger());
        expect(trigger().getAttribute("aria-expanded")).toBe("true");
        const m = menu();
        expect(m).not.toBeNull();
        expect(m.getAttribute("role")).toBe("listbox");
        expect(options()).toHaveLength(OPTIONS.length);
        const selected = options().filter((o) => o.getAttribute("aria-selected") === "true");
        expect(selected).toHaveLength(1);
        expect(selected[0].getAttribute("data-value")).toBe("status");
        expect(trigger().getAttribute("aria-controls")).toBe(m.id);
    });

    it("ArrowDown opens and moves the active option; aria-activedescendant follows", () => {
        render();
        act(() => trigger().focus());
        key(trigger(), "ArrowDown");
        expect(menu()).not.toBeNull();
        const first = document.activeElement;
        // 焦点仍在触发器（combobox 模式不把焦点搬进列表）
        expect(first).toBe(trigger());
        const activeId = trigger().getAttribute("aria-activedescendant");
        expect(activeId).not.toBeNull();
        expect(document.body.querySelector(`#${activeId}`)?.getAttribute("data-value")).toBe("status");

        key(trigger(), "ArrowDown");
        const nextId = trigger().getAttribute("aria-activedescendant");
        expect(nextId).not.toBe(activeId);
        expect(document.body.querySelector(`#${nextId}`)?.getAttribute("data-value")).toBe("tab");
    });

    it("Enter commits the active option, closes the menu and returns focus to the trigger", () => {
        render();
        act(() => trigger().focus());
        click(trigger());
        key(trigger(), "ArrowDown");
        key(trigger(), "Enter");
        expect(onChange).toHaveBeenCalledWith("tab");
        expect(menu()).toBeNull();
        expect(trigger().getAttribute("aria-expanded")).toBe("false");
        expect(document.activeElement).toBe(trigger());
    });

    it("Escape closes the menu", () => {
        render();
        click(trigger());
        expect(menu()).not.toBeNull();
        key(trigger(), "Escape");
        expect(menu()).toBeNull();
        expect(trigger().getAttribute("aria-expanded")).toBe("false");
    });

    it("clicking an option commits it and closes", () => {
        render();
        click(trigger());
        const tags = options().find((o) => o.getAttribute("data-value") === "tags");
        click(tags);
        expect(onChange).toHaveBeenCalledWith("tags");
        expect(menu()).toBeNull();
    });

    it("typeahead moves the active option to the first match", () => {
        render();
        act(() => trigger().focus());
        click(trigger());
        key(trigger(), "p");
        const activeId = trigger().getAttribute("aria-activedescendant");
        // "provider" 命中；"project" 也以 p 开头，阻塞在 disabled 上不参与导航
        expect(document.body.querySelector(`#${activeId}`)?.getAttribute("data-value")).toBe("provider");
    });

    it("native proxy: setting .value + dispatching change drives onChange", () => {
        render();
        const sel = proxy();
        act(() => {
            sel.value = "tags";
            sel.dispatchEvent(new Event("change", { bubbles: true }));
        });
        expect(onChange).toHaveBeenCalledWith("tags");
    });

    it("disabled option does not commit", () => {
        render();
        click(trigger());
        const project = options().find((o) => o.getAttribute("data-value") === "project");
        expect(project.getAttribute("aria-disabled")).toBe("true");
        click(project);
        expect(onChange).not.toHaveBeenCalled();
    });

    it("bare variant drops its own border/background class set", () => {
        render({ variant: "bare" });
        const rootEl = container.querySelector("[data-select-root]");
        expect(rootEl.className).toContain("app-select--bare");
        expect(rootEl.className).toContain("app-select--sm");
    });

    it("size prop maps to a size class", () => {
        render({ size: "xs" });
        expect(container.querySelector("[data-select-root]").className).toContain("app-select--xs");
    });
});
