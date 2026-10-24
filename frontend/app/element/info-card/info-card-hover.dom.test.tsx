// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// useInfoCardHover / useInfoCardDismiss 的 DOM 行为测试（jsdom）。
//
// 锁定的回归点（都是「卡片关不掉 / 关闭时机错」类问题）：
//  1. hover 目标 → 打开；指针离开且无焦点 → 延迟隐藏。
//  2. 卡片内聚焦（点过 note textarea / 复制按钮）后指针移开 → 卡片不关（编辑不能被打断）。
//  3. 聚焦钉住后点击卡片外侧 → 立即关闭（历史上这里没有路径，卡片永久停留）。
//  4. 点击卡片内部 → 不关闭。
//
// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InfoCardPortal, useInfoCardHover } from "./info-card-hover";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Harness() {
    const hover = useInfoCardHover({ hideDelayMs: 300 });
    return (
        <>
            <div data-testid="target" {...hover.targetProps}>
                target
            </div>
            <InfoCardPortal hover={hover}>
                <button data-testid="card-btn" type="button">
                    card button
                </button>
            </InfoCardPortal>
        </>
    );
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function mount() {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
        root.render(<Harness />);
    });
}

const cardEl = () => document.querySelector<HTMLDivElement>(".info-card-portal");
const targetEl = () => document.querySelector<HTMLDivElement>('[data-testid="target"]')!;

function hover(el: Element) {
    act(() => {
        // React 用 mouseover/mouseout 模拟 enter/leave
        el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, relatedTarget: null }));
    });
}
function leave(el: Element) {
    act(() => {
        el.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }));
    });
}
function pointerDown(el: Element | Document) {
    act(() => {
        el.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
    });
}

describe("useInfoCardHover (dom)", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        vi.useRealTimers();
    });

    it("hover 目标打开卡片，离开后延迟关闭", () => {
        mount();
        expect(cardEl()).toBeNull();
        hover(targetEl());
        expect(cardEl()).not.toBeNull();
        leave(targetEl());
        act(() => {
            vi.advanceTimersByTime(299);
        });
        expect(cardEl()).not.toBeNull();
        act(() => {
            vi.advanceTimersByTime(1);
        });
        expect(cardEl()).toBeNull();
    });

    it("卡片内聚焦后指针移开不关闭（编辑不被打断）", () => {
        mount();
        hover(targetEl());
        const btn = cardEl()!.querySelector<HTMLButtonElement>('[data-testid="card-btn"]')!;
        act(() => {
            btn.focus();
        });
        leave(cardEl()!);
        act(() => {
            vi.advanceTimersByTime(2000);
        });
        expect(cardEl()).not.toBeNull();
    });

    it("聚焦钉住后点击卡片外侧立即关闭", () => {
        mount();
        hover(targetEl());
        const btn = cardEl()!.querySelector<HTMLButtonElement>('[data-testid="card-btn"]')!;
        act(() => {
            btn.focus();
        });
        leave(cardEl()!);
        expect(cardEl()).not.toBeNull();
        pointerDown(document.body);
        expect(cardEl()).toBeNull();
    });

    it("点击卡片内部不关闭", () => {
        mount();
        hover(targetEl());
        const card = cardEl()!;
        const btn = card.querySelector<HTMLButtonElement>('[data-testid="card-btn"]')!;
        act(() => {
            btn.focus();
        });
        pointerDown(btn);
        expect(cardEl()).not.toBeNull();
    });

    it("点击触发元素本身不算外侧", () => {
        mount();
        hover(targetEl());
        pointerDown(targetEl());
        expect(cardEl()).not.toBeNull();
    });
});
