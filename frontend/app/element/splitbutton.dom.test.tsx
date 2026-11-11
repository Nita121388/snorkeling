// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// SplitButton DOM 回归锁。
//
// 锁定的历史 bug（2026-11-11，CommonText Send 目标选择器）：
//  旧实现自建 <div class="fixed inset-0"> 遮罩挂 body —— position:fixed + z-index:auto
//  自成层叠上下文，把内部 z-1000 困在 .modal-wrapper(z-index:500) 之下，
//  弹层「开了但完全看不见、不可点」。改成 floating-ui FloatingPortal 后，
//  这里锁三件结构性事实：
//   1. caret 点击 → 弹层渲染，且 zIndex 1000（在 .modal-wrapper 之上）；
//   2. 主段点击不触发弹层、只走主回调（split button 语义）；
//   3. 外点 pointerdown / Escape 都能关，Escape 后焦点还给 caret。
//
// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SplitButton } from "./splitbutton";

let container: HTMLDivElement;
let root: Root;

// 受控状态透出给断言（render 在 React 内部闭环，避免「harness 对象改了但没重渲」的假失败）
let openState = false;
const readOpen = () => openState;

function Harness(props: { onPrimaryClick: () => void; render?: (api: { close: () => void }) => React.ReactNode }) {
    const [open, setOpen] = useState(false);
    openState = open;
    return (
        <SplitButton
            icon={<i className="fa-solid fa-paper-plane" />}
            label="Send"
            onPrimaryClick={props.onPrimaryClick}
            primaryTitle="primary"
            caretTitle="caret"
            caretAriaLabel="caret-aria"
            open={open}
            onOpenChange={setOpen}
            menuLabel="menu"
            menuWidth={380}
            render={props.render ?? (() => <div data-testid="menu-content">menu content</div>)}
        />
    );
}

beforeEach(() => {
    openState = false;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
});

function getMainButton(): HTMLButtonElement {
    return container.querySelector(".wave-split-button__main") as HTMLButtonElement;
}

function getCaretButton(): HTMLButtonElement {
    return container.querySelector(".wave-split-button__caret") as HTMLButtonElement;
}

function getMenu(): HTMLElement | null {
    return document.querySelector("[data-split-button-menu]");
}

describe("SplitButton", () => {
    it("renders one shell with main + caret segments and a divider", () => {
        act(() => root.render(<Harness onPrimaryClick={() => {}} />));
        const shell = container.querySelector(".wave-split-button");
        expect(shell).not.toBeNull();
        expect(shell!.querySelectorAll("button")).toHaveLength(2);
        expect(shell!.querySelector(".wave-split-button__divider")).not.toBeNull();
        expect(getCaretButton().getAttribute("aria-haspopup")).toBe("menu");
        expect(getCaretButton().getAttribute("aria-expanded")).toBe("false");
    });

    it("opens the menu on caret click with zIndex 1000 (above .modal-wrapper z500)", () => {
        act(() => root.render(<Harness onPrimaryClick={() => {}} />));
        expect(getMenu()).toBeNull();
        act(() => {
            getCaretButton().dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
        expect(readOpen()).toBe(true);
        const menu = getMenu();
        expect(menu).not.toBeNull();
        // 关键断言：弹层 z-index 必须高于 modal-wrapper(500)，否则会被弹窗遮住（历史 bug）
        expect(menu!.style.zIndex).toBe("var(--zindex-popover, 1000)");
        expect(menu!.getAttribute("role")).toBe("menu");
        expect(menu!.textContent).toContain("menu content");
        // 开关状态同步到 caret 的 aria-expanded
        expect(getCaretButton().getAttribute("aria-expanded")).toBe("true");
    });

    it("primary click invokes the callback and does NOT open the menu", () => {
        const onPrimaryClick = vi.fn();
        act(() => root.render(<Harness onPrimaryClick={onPrimaryClick} />));
        act(() => {
            getMainButton().dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
        expect(onPrimaryClick).toHaveBeenCalledTimes(1);
        expect(readOpen()).toBe(false);
        expect(getMenu()).toBeNull();
    });

    it("closes on outside pointerdown", () => {
        act(() => root.render(<Harness onPrimaryClick={() => {}} />));
        act(() => {
            getCaretButton().dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
        expect(getMenu()).not.toBeNull();
        act(() => {
            document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
        });
        expect(readOpen()).toBe(false);
        expect(getMenu()).toBeNull();
    });

    it("closes on Escape and returns focus to the caret", () => {
        act(() => root.render(<Harness onPrimaryClick={() => {}} />));
        act(() => {
            getCaretButton().dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
        const caret = getCaretButton();
        const menu = getMenu();
        expect(menu).not.toBeNull();
        act(() => {
            caret.focus();
            document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        });
        expect(readOpen()).toBe(false);
        expect(getMenu()).toBeNull();
        expect(document.activeElement).toBe(caret);
    });

    it("menu content gets { close } via render prop", () => {
        act(() =>
            root.render(
                <Harness
                    onPrimaryClick={() => {}}
                    render={({ close }: { close: () => void }) => (
                        <button data-testid="close-btn" onClick={close}>
                            close
                        </button>
                    )}
                />
            )
        );
        act(() => {
            getCaretButton().dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
        expect(getMenu()).not.toBeNull();
        act(() => {
            (document.querySelector('[data-testid="close-btn"]') as HTMLButtonElement).dispatchEvent(
                new MouseEvent("click", { bubbles: true })
            );
        });
        expect(readOpen()).toBe(false);
        expect(getMenu()).toBeNull();
    });
});
