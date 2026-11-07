// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Modal（全仓唯一弹窗壳）的 DOM 行为契约测试（jsdom）。
//
// 锁定的回归点：
//  1. 不传 onClose 时不渲染 ✕（修掉「✕ 渲染出来但点了没反应」）。
//  2. 不传 title 的老弹窗保留绝对定位 ✕（20+ 既有弹窗版式不变）。
//  3. 传 title 时走结构化 header，✕ 在 header 流内，aria-labelledby 指向标题。
//  4. padding={false} / scrollBody={false} 分别落到 modal--flush / modal--no-scroll。
//  5. 点 backdrop 默认不关闭；closeOnBackdrop 时调 onClose。
//  6. 点 ✕ 调 onClose。
//
// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Modal, type ModalProps } from "./modal";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let portalTarget: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function mount(props: Partial<ModalProps> & { children?: React.ReactNode }) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
        root.render(
            <Modal {...(props as ModalProps)}>
                <div data-testid="body">content</div>
            </Modal>
        );
    });
}

const modalEl = () => document.querySelector<HTMLDivElement>(".modal");
const backdropEl = () => document.querySelector<HTMLDivElement>(".modal-backdrop");

function click(el: Element | null) {
    expect(el).not.toBeNull();
    act(() => {
        el!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
}

describe("Modal shell contract", () => {
    beforeEach(() => {
        // Modal 用 createPortal 挂到 #main。
        portalTarget = document.createElement("div");
        portalTarget.id = "main";
        document.body.appendChild(portalTarget);
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        portalTarget.remove();
    });

    it("不传 onClose 时不渲染任何关闭按钮", () => {
        mount({});
        expect(document.querySelector(".modal-close")).toBeNull();
        expect(document.querySelector(".modal-close-btn")).toBeNull();
        expect(document.querySelector('[aria-label="Close"]')).toBeNull();
    });

    it("传 onClose 但没有 title 时，退回老形状的绝对定位 ✕", () => {
        const onClose = vi.fn();
        mount({ onClose });
        expect(document.querySelector(".modal-close-btn")).not.toBeNull();
        expect(document.querySelector(".modal-header")).toBeNull();
        click(document.querySelector(".modal-close-btn"));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("传 title 时使用结构化 header，✕ 在 header 内，aria-labelledby 指向标题", () => {
        const onClose = vi.fn();
        mount({ title: "Session Note", subtitle: "codex", onClose });

        const modal = modalEl()!;
        expect(modal.getAttribute("role")).toBe("dialog");
        expect(modal.getAttribute("aria-modal")).toBe("true");

        const header = modal.querySelector(".modal-header");
        expect(header).not.toBeNull();
        expect(header!.querySelector(".modal-header__title")!.textContent).toBe("Session Note");
        expect(header!.querySelector(".modal-header__subtitle")!.textContent).toBe("codex");

        const labelledBy = modal.getAttribute("aria-labelledby");
        expect(labelledBy).toBeTruthy();
        expect(document.getElementById(labelledBy!)!.textContent).toBe("Session Note");

        // ✕ 必须在 header 流内，不是绝对定位的老按钮。
        const inlineClose = header!.querySelector(".modal-close--inline");
        expect(inlineClose).not.toBeNull();
        expect(modal.querySelector(".modal-close-btn")).toBeNull();
        click(inlineClose);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("三段落：header / content-wrapper / 可选 footer", () => {
        mount({ title: "T", onClose: () => {}, onOk: () => {}, okLabel: "OK" });
        const modal = modalEl()!;
        const children = Array.from(modal.children).map((c) => c.className.split(" ")[0]);
        expect(children).toEqual(["modal-header", "content-wrapper", "modal-footer"]);
    });

    it("待 padding / scrollBody 分别落到 flush / no-scroll 修饰类", () => {
        mount({ padding: false, scrollBody: false });
        const modal = modalEl()!;
        expect(modal.classList.contains("modal--flush")).toBe(true);
        expect(modal.classList.contains("modal--no-scroll")).toBe(true);
    });

    it("默认不做 flush / no-scroll", () => {
        mount({});
        const modal = modalEl()!;
        expect(modal.classList.contains("modal--flush")).toBe(false);
        expect(modal.classList.contains("modal--no-scroll")).toBe(false);
    });

    it("点 backdrop 默认不关闭", () => {
        const onClose = vi.fn();
        mount({ onClose });
        click(backdropEl());
        expect(onClose).not.toHaveBeenCalled();
    });

    it("closeOnBackdrop 时点 backdrop 调 onClose", () => {
        const onClose = vi.fn();
        mount({ onClose, closeOnBackdrop: true });
        click(backdropEl());
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("onClickBackdrop 优先于 closeOnBackdrop", () => {
        const onClose = vi.fn();
        const onClickBackdrop = vi.fn();
        mount({ onClose, closeOnBackdrop: true, onClickBackdrop });
        click(backdropEl());
        expect(onClickBackdrop).toHaveBeenCalledTimes(1);
        expect(onClose).not.toHaveBeenCalled();
    });
});
