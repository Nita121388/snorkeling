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

describe("PropertyList — agent 布局（hover 卡）", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        vi.useRealTimers();
    });

    const now = Date.now();
    const agentSummary = () =>
        makeSummary({
            titleSource: "first_user_message",
            marked: true,
            createdAt: now - 5 * 24 * 60 * 60_000,
            updatedAt: now - 3 * 60_000,
            tags: [],
            note: "",
        });

    it("星标与 Title Source 不再出现在属性区", () => {
        mount(<PropertyList summary={agentSummary()} mode="detail" layout="agent" canEdit onChange={vi.fn()} />);
        expect(row("starred")).toBeNull();
        expect(row("title_source")).toBeNull();
    });

    it("固定顺序 Updated → Created → Tags → Note，且带行首图标", () => {
        mount(<PropertyList summary={agentSummary()} mode="detail" layout="agent" canEdit onChange={vi.fn()} />);
        const keys = Array.from(document.querySelectorAll("[data-property-key]")).map((el) =>
            el.getAttribute("data-property-key")
        );
        expect(keys).toEqual(["updated_at", "created_at", "tags", "note"]);
        expect(row("updated_at")!.querySelector(".property-row__icon i")!.className).toContain("fa-clock");
        expect(row("tags")!.querySelector(".property-row__icon i")!.className).toContain("fa-tag");
    });

    it("时间显示相对值，绝对时间在 title 上", () => {
        mount(<PropertyList summary={agentSummary()} mode="detail" layout="agent" canEdit onChange={vi.fn()} />);
        const value = row("updated_at")!.querySelector(".property-text")!;
        expect(value.textContent).toBe("3m ago");
        expect(value.getAttribute("title")).toContain("2026");
    });

    it("空值渲染 —，不再出现 Empty 英文占位", () => {
        mount(<PropertyList summary={agentSummary()} mode="detail" layout="agent" canEdit onChange={vi.fn()} />);
        for (const key of ["tags", "note"]) {
            const cell = row(key)!;
            expect(cell.textContent).toContain("—");
            expect(cell.textContent).not.toContain("Empty");
        }
        expect(document.querySelector(".property-empty--dash")).not.toBeNull();
    });

    it("footer 单行：Add property 在左，footer 插槽在右组", () => {
        mount(
            <PropertyList
                summary={agentSummary()}
                mode="detail"
                layout="agent"
                canEdit
                onAddProperty={vi.fn()}
                footer={<span data-testid="footer-extra">3ce67d75…7ca2</span>}
            />
        );
        const footer = document.querySelector(".property-footer");
        expect(footer).not.toBeNull();
        const add = footer!.querySelector(".property-add--inline")!;
        expect(add.textContent).toContain("Add property");
        expect(footer!.querySelector(".property-footer__right [data-testid='footer-extra']")).not.toBeNull();
    });
});

// ─── 浮层下拉编辑（多值标签 / 单选）───
//
// 锁定回归点：属性行点开是「浮层下拉」（与 md 预览属性卡同源的 Wolai 风格编辑器），
// 而不是窄卡里的逗号分隔输入框 / 原生 <select>。
describe("PropertyList — 浮层下拉编辑", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        document.querySelectorAll(".property-value-popover").forEach((el) => el.remove());
        vi.useRealTimers();
    });

    const tagEditor = () => document.querySelector('[data-testid="property-tag-editor"]');
    const valueButton = (key: string) => row(key)!.querySelector<HTMLButtonElement>(".property-row__button")!;

    it("点 Tags 弹出浮层：当前值作为候选并带 ✓，不再渲染行内输入框", () => {
        mount(<PropertyList summary={makeSummary({ tags: ["fix"] })} mode="detail" canEdit onChange={vi.fn()} />);
        const button = valueButton("tags");
        expect(button.getAttribute("aria-expanded")).toBe("false");

        click(button);

        expect(button.getAttribute("aria-expanded")).toBe("true");
        expect(tagEditor()).not.toBeNull();
        // 行内消费：多选不再走 InlineEditor 文本框
        expect(row("tags")!.querySelector("input.property-edit-input")).toBeNull();
        const selected = tagEditor()!.querySelector(".ptag-option.is-selected");
        expect(selected).not.toBeNull();
        expect(selected!.textContent).toContain("fix");
        expect(selected!.querySelector(".ptag-option-check")).not.toBeNull();
    });

    it("浮层里点已选候选 → toggle 写回数组，浮层保持打开", () => {
        const onChange = vi.fn();
        mount(<PropertyList summary={makeSummary({ tags: ["fix"] })} mode="detail" canEdit onChange={onChange} />);

        click(valueButton("tags"));
        click(tagEditor()!.querySelector(".ptag-option.is-selected"));

        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange.mock.calls[0][0]).toBe("tags");
        expect(onChange.mock.calls[0][1]).toEqual([]);
        expect(tagEditor()).not.toBeNull();
    });

    it("自定义 select 走单值浮层：点选即替换并关闭", () => {
        const onChange = vi.fn();
        const summary = makeSummary({
            props: { stage: { value: "plan", type: "select", source: "user", updatedAt: 1 } },
        } as Partial<SessionSummary>);
        mount(
            <PropertyList
                summary={summary}
                mode="detail"
                canEdit
                onChange={onChange}
                schema={[{ key: "stage", name: "Stage", type: "select", options: ["plan", "build"], order: 1 }]}
            />
        );

        click(valueButton("stage"));
        const build = Array.from(tagEditor()!.querySelectorAll(".ptag-option")).find(
            (option) => option.textContent?.trim() === "build"
        );
        expect(build).toBeDefined();
        click(build!);

        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange.mock.calls[0][1]).toBe("build");
        expect(tagEditor()).toBeNull();
    });
});

// ─── 全局标签清单候选（tagCatalog）───
//
// 锁定的回归点：
//  1. 别的会话用过、本会话没选的标签要出现在候选里（这是本次的核心诉求）。
//  2. 候选带使用次数；没有 count 数据源的候选（本会话已选值 / 用户新建值）不渲染计数。
//  3. 候选顺序：已选值 → def.options → 全局清单（count 降序、同 count 字母序）。
//  4. 不传 tagCatalog 时候选池与改动前完全一致（md 预览属性卡回归门）。
describe("PropertyList — 全局标签清单候选", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        document.querySelectorAll(".property-value-popover").forEach((el) => el.remove());
        vi.useRealTimers();
    });

    const tagEditor = () => document.querySelector('[data-testid="property-tag-editor"]');
    const valueButton = (key: string) => row(key)!.querySelector<HTMLButtonElement>(".property-row__button")!;
    const optionTexts = () =>
        Array.from(tagEditor()!.querySelectorAll(".ptag-option")).map((el) =>
            (el.querySelector(".ptag-option-chip")?.textContent ?? "").trim()
        );
    const countOf = (tag: string) => {
        const row = Array.from(tagEditor()!.querySelectorAll(".ptag-option")).find(
            (el) => (el.querySelector(".ptag-option-chip")?.textContent ?? "").trim() === tag
        );
        return row?.querySelector(".ptag-option-count")?.textContent?.trim() ?? null;
    };

    it("别的会话用过的标签出现在候选里，并带使用次数", () => {
        mount(
            <PropertyList
                summary={makeSummary({ tags: ["fix"] })}
                mode="detail"
                canEdit
                onChange={vi.fn()}
                tagCatalog={{ tags: [
                    { tag: "fix", count: 12 },
                    { tag: "refactor", count: 3 },
                    { tag: "ui", count: 7 },
                ] }}
            />
        );

        click(valueButton("tags"));
        const texts = optionTexts();
        // refactor / ui 本会话没有，但必须出现在候选里
        expect(texts).toContain("refactor");
        expect(texts).toContain("ui");
        expect(countOf("refactor")).toBe("3");
        expect(countOf("ui")).toBe("7");
        expect(countOf("fix")).toBe("12");
    });

    it("顺序：已选值 → 全局清单按 count 降序、同 count 字母序", () => {
        mount(
            <PropertyList
                summary={makeSummary({ tags: ["zzz-mine"] })}
                mode="detail"
                canEdit
                onChange={vi.fn()}
                tagCatalog={{ tags: [
                    { tag: "alpha", count: 2 },
                    { tag: "beta", count: 5 },
                    { tag: "gamma", count: 2 },
                ] }}
            />
        );

        click(valueButton("tags"));
        // zzz-mine 是本会话已选值（不在清单里）→ 排最前，且无计数
        expect(optionTexts()).toEqual(["zzz-mine", "beta", "alpha", "gamma"]);
        expect(countOf("zzz-mine")).toBeNull();
    });

    it("全局清单里的标签可点选，写回完整数组", () => {
        const onChange = vi.fn();
        mount(
            <PropertyList
                summary={makeSummary({ tags: [] })}
                mode="detail"
                canEdit
                onChange={onChange}
                tagCatalog={{ tags: [{ tag: "refactor", count: 3 }] }}
            />
        );

        click(valueButton("tags"));
        const target = Array.from(tagEditor()!.querySelectorAll(".ptag-option")).find(
            (el) => (el.querySelector(".ptag-option-chip")?.textContent ?? "").trim() === "refactor"
        );
        expect(target).toBeDefined();
        click(target!);

        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange.mock.calls[0][0]).toBe("tags");
        expect(onChange.mock.calls[0][1]).toEqual(["refactor"]);
    });

    it("不传 tagCatalog 时候选池与改动前一致（md 预览回归门）", () => {
        mount(<PropertyList summary={makeSummary({ tags: ["fix", "ui"] })} mode="detail" canEdit onChange={vi.fn()} />);

        click(valueButton("tags"));
        expect(optionTexts()).toEqual(["fix", "ui"]);
        expect(document.querySelector(".ptag-option-count")).toBeNull();
    });
});

// ─── 新增属性浮层（范围三选一）───
//
// 锁定的回归点（11-11-agent-property-scope）：
//  1. `+ Add property` 打开浮层面板，而不是 footer 里的内联表单；
//  2. 范围三选一默认「仅此会话」，切换后提交参数随之变化；
//  3. 三种范围：session / agent / global；
//  4. Enter 提交、Esc 关闭、空名禁用、重名行内报错。
describe("PropertyList — 新增属性浮层（范围三选一）", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        vi.useRealTimers();
    });

    const agentSummary = () =>
        makeSummary({
            key: "pi:agent-prop:/tmp/p.jsonl",
            id: "agent-prop",
            source: "pi",
            tags: [],
            note: "",
            props: {},
        } as Partial<SessionSummary>);

    const popover = () => document.querySelector('[data-testid="property-add-popover"]');
    const nameInput = () => document.querySelector<HTMLInputElement>('[data-testid="property-add-name"]');
    const submit = () => document.querySelector<HTMLButtonElement>('[data-testid="property-add-submit"]');
    const errorEl = () => document.querySelector('[data-testid="property-add-error"]');
    const scopeOption = (scope: string) =>
        document.querySelector<HTMLElement>(`[data-testid="property-add-scope"][data-scope="${scope}"]`);
    const typeButton = () => document.querySelector<HTMLButtonElement>('[data-testid="property-add-type"]');
    const typeOption = (type: string) =>
        document.querySelector<HTMLElement>(`[data-testid="property-add-type-option"][data-type="${type}"]`);

    function openPopover() {
        const add = document.querySelector(".property-add");
        click(add);
    }

    function setValue(input: HTMLInputElement, value: string) {
        act(() => {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
            setter.call(input, value);
            input.dispatchEvent(new Event("input", { bubbles: true }));
        });
    }

    function keyPress(input: Element | null, key: string) {
        act(() => {
            input!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
        });
    }

    it("打开浮层：名字 / 类型 / 三个范围，默认仅此会话，旧内联表单消失", () => {
        mount(<PropertyList summary={agentSummary()} mode="detail" layout="agent" canEdit onAddProperty={vi.fn()} />);
        expect(document.querySelector(".property-add-form")).toBeNull();

        openPopover();

        expect(popover()).not.toBeNull();
        expect(nameInput()).not.toBeNull();
        expect(typeButton()).not.toBeNull();
        expect(scopeOption("session")!.classList.contains("is-active")).toBe(true);
        expect(scopeOption("agent")).not.toBeNull();
        expect(scopeOption("global")).not.toBeNull();
        expect(document.querySelector(".property-add-form")).toBeNull();
        expect(submit()!.disabled).toBe(true);
    });

    it("切到「仅此 Agent」后 Add → onAddProperty(key,type,'agent')", () => {
        const onAdd = vi.fn();
        mount(<PropertyList summary={agentSummary()} mode="detail" layout="agent" canEdit onAddProperty={onAdd} />);
        openPopover();
        setValue(nameInput()!, "Priority");
        click(scopeOption("agent"));
        click(submit());

        expect(onAdd).toHaveBeenCalledTimes(1);
        expect(onAdd.mock.calls[0][0]).toBe("priority");
        expect(onAdd.mock.calls[0][2]).toBe("agent");
        expect(popover()).toBeNull();
    });

    it("默认范围提交是 session；切 global 提交 global", () => {
        const onAdd = vi.fn();
        mount(<PropertyList summary={agentSummary()} mode="detail" layout="agent" canEdit onAddProperty={onAdd} />);

        openPopover();
        setValue(nameInput()!, "Owner");
        click(submit());
        expect(onAdd.mock.calls[0][2]).toBe("session");

        openPopover();
        setValue(nameInput()!, "Cycle");
        click(scopeOption("global"));
        click(submit());
        expect(onAdd.mock.calls[1][2]).toBe("global");
    });

    it("类型下拉选 Multi-select 后提交，类型参数正确", () => {
        const onAdd = vi.fn();
        mount(<PropertyList summary={agentSummary()} mode="detail" layout="agent" canEdit onAddProperty={onAdd} />);
        openPopover();
        setValue(nameInput()!, "Risks");
        click(typeButton());
        click(typeOption("multi_select"));
        click(submit());
        expect(onAdd.mock.calls[0][1]).toBe("multi_select");
    });

    it("模板定义行（本会话无值）也能删：菜单 Delete 调 onDeleteProperty", () => {
        const onDelete = vi.fn();
        mount(
            <PropertyList
                summary={agentSummary()}
                mode="detail"
                layout="agent"
                canEdit
                schema={[{ key: "cycle", name: "Cycle", type: "text", order: 1, scope: "" }]}
                onChange={vi.fn()}
                onAddProperty={vi.fn()}
                onDeleteProperty={onDelete}
            />
        );
        const rowEl = row("cycle");
        expect(rowEl).not.toBeNull();
        const menuBtn = rowEl!.querySelector(".property-row__menu-btn");
        expect(menuBtn).not.toBeNull();
        click(menuBtn);
        const del = Array.from(rowEl!.querySelectorAll(".property-row__menu button")).find(
            (b) => b.textContent?.trim() === "Delete"
        );
        expect(del).toBeDefined();
        click(del!);
        expect(onDelete).toHaveBeenCalledWith("cycle");
    });

    it("Enter 提交、Esc 关闭；重名与空名有行内错误", () => {
        const onAdd = vi.fn();
        mount(<PropertyList summary={agentSummary()} mode="detail" layout="agent" canEdit onAddProperty={onAdd} />);

        openPopover();
        keyPress(nameInput(), "Escape");
        expect(popover()).toBeNull();

        openPopover();
        setValue(nameInput()!, "note");
        click(submit());
        expect(onAdd).not.toHaveBeenCalled();
        expect(errorEl()).not.toBeNull();
        expect(errorEl()!.textContent).toContain("already exists");

        setValue(nameInput()!, "Iterator");
        keyPress(nameInput(), "Enter");
        expect(onAdd).toHaveBeenCalledTimes(1);
        expect(onAdd.mock.calls[0][2]).toBe("session");
    });
});
