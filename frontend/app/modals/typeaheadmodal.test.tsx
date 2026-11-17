// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 连接下拉行结构 / hover 复制 / 加载骨架的 DOM 契约。
//
// 回归背景（2026-11-17）：
//  1. 右栏没居右：.typeahead-item-source 的 margin-left:auto 挂在**内容宽度**的
//     .typeahead-item-name 里，只能把自己推到文字屁股后面；行级 .typeahead-current-checkbox
//     也在用 margin-left:auto，两个 auto 互相竞争。→ 结构上断言右栏是行的直接子节点。
//  2. .typeahead-item-name.ellipsis 打不到文本（flex 匿名 item）→ 断言 label 是真实元素。
//  3. 无一键复制 → 断言 [data-copy-conn] 只在有连接名的行出现，点击不冒泡触发连接。
//  4. 无加载骨架 → 断言 loading 时骨架行数 + aria-busy，且不渲染可点击行。
//
// 像素级对齐（右边缘极差 ≤1px）由 scripts/verify/conn-typeahead-rail 在真机上采数字。
//
// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/config";
import { Suggestions, TypeAheadModal } from "./typeaheadmodal";

class FakeResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
}

(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= FakeResizeObserver;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function render(node: React.ReactNode): void {
    act(() => {
        root.render(node);
    });
}

function q(selector: string): HTMLElement | null {
    return container.querySelector(selector) as HTMLElement | null;
}

function qa(selector: string): HTMLElement[] {
    return Array.from(container.querySelectorAll(selector)) as HTMLElement[];
}

beforeAll(async () => {
    await initI18n("en");
});

beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    (window as any).api = { writeClipboardText: vi.fn(async () => true) };
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
});

/** 一行完整形态：来源徽标 + copy 槽 + 当前勾，用来卡右栏结构。 */
function remoteRow(extra: Record<string, unknown> = {}): any {
    return {
        status: "connected",
        icon: "arrow-right-arrow-left",
        iconColor: "var(--grey-text-color)",
        value: "nita@100.110.167.25",
        label: "nita@100.110.167.25",
        copyText: "nita@100.110.167.25",
        current: true,
        sources: ["settings"],
        ...extra,
    };
}

describe("Suggestions 行结构（右栏居右的结构前提）", () => {
    it("右栏是行的直接子节点，来源徽标不再塞进名字盒", () => {
        render(
            <Suggestions
                suggestions={[{ headerText: "Remote", items: [remoteRow()] }]}
                selectIndex={-1}
                onSelect={() => {}}
            />
        );
        const row = q(".suggestion-item");
        expect(row).not.toBeNull();
        const rail = row.querySelector(":scope > .typeahead-item-rail");
        expect(rail).not.toBeNull();
        const name = row.querySelector(":scope > .typeahead-item-name");
        expect(name).not.toBeNull();
        // 病根：徽标/勾曾经在 name 里 → 无法贴行右边
        expect(name.querySelector(".typeahead-item-source")).toBeNull();
        expect(name.querySelector(".typeahead-current-checkbox")).toBeNull();
        expect(rail.querySelector(".typeahead-item-source")).not.toBeNull();
        expect(rail.querySelector(".typeahead-current-checkbox")).not.toBeNull();
    });

    it("label 是真实元素（省略号才有落点）", () => {
        render(<Suggestions suggestions={[remoteRow()]} selectIndex={-1} onSelect={() => {}} />);
        const label = q(".typeahead-item-name .typeahead-item-label");
        expect(label).not.toBeNull();
        expect(label.textContent).toBe("nita@100.110.167.25");
    });

    it("上行/下行顺序与传入顺序一致（rail 不改变行序）", () => {
        render(
            <Suggestions
                suggestions={[remoteRow({ value: "a", label: "a" }), remoteRow({ value: "b", label: "b" })]}
                selectIndex={-1}
                onSelect={() => {}}
            />
        );
        expect(qa(".suggestion-item").map((el) => el.textContent.trim())).toEqual(["a", "b"]);
    });
});

describe("hover 一键复制", () => {
    it("只有带 copyText 的行渲染复制槽", () => {
        render(
            <Suggestions
                suggestions={[
                    remoteRow(),
                    // Local / Edit Connections 这类行没有连接名语义
                    remoteRow({ value: "", label: "chemclin@DESKTOP", copyText: undefined, current: false }),
                ]}
                selectIndex={-1}
                onSelect={() => {}}
            />
        );
        const copies = qa("[data-copy-conn]");
        expect(copies).toHaveLength(1);
        expect(copies[0].getAttribute("data-copy-conn")).toBe("nita@100.110.167.25");
    });

    it("点复制 → 写剪贴板，且不触发行选择（不冒泡）", async () => {
        const onSelect = vi.fn();
        render(<Suggestions suggestions={[remoteRow()]} selectIndex={-1} onSelect={onSelect} />);
        const button = q("[data-copy-conn] .copy-button") as HTMLButtonElement;
        expect(button).not.toBeNull();
        await act(async () => {
            button.click();
        });
        expect((window as any).api.writeClipboardText).toHaveBeenCalledWith("nita@100.110.167.25");
        expect(onSelect).not.toHaveBeenCalled();
    });

    it("复制成功后有 copied 反馈（check 图标），不是静默无反馈", async () => {
        render(<Suggestions suggestions={[remoteRow()]} selectIndex={-1} onSelect={() => {}} />);
        const button = q("[data-copy-conn] .copy-button") as HTMLButtonElement;
        await act(async () => {
            button.click();
        });
        expect(button.classList.contains("copied")).toBe(true);
        expect(button.querySelector("i").className).toContain("fa-check");
    });
});

describe("加载骨架", () => {
    function renderModal(loading: boolean) {
        const blockEl = document.createElement("div");
        document.body.appendChild(blockEl);
        const blockRef = { current: blockEl };
        const anchorEl = document.createElement("div");
        document.body.appendChild(anchorEl);
        const anchorRef = { current: anchorEl };
        render(
            <TypeAheadModal
                blockRef={blockRef as any}
                anchorRef={anchorRef as any}
                suggestions={[]}
                loading={loading}
                label="Connect to"
                value=""
                onChange={() => {}}
                onSelect={() => {}}
                selectIndex={0}
            />
        );
        return blockEl;
    }

    it("loading 时渲染固定行数骨架并标 aria-busy，且没有可点击行", () => {
        const host = renderModal(true);
        const skeleton = host.querySelector(".typeahead-skeleton") as HTMLElement;
        expect(skeleton).not.toBeNull();
        expect(skeleton.getAttribute("aria-busy")).toBe("true");
        expect(skeleton.getAttribute("role")).toBe("status");
        expect(host.querySelectorAll(".typeahead-skeleton-row")).toHaveLength(5);
        expect(host.querySelectorAll(".suggestion-item")).toHaveLength(0);
    });

    it("非 loading 时不出骨架", () => {
        const host = renderModal(false);
        expect(host.querySelector(".typeahead-skeleton")).toBeNull();
    });
});
