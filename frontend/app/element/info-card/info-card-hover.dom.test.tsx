// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// useInfoCardHover / useInfoCardDismiss 的 DOM 行为测试（jsdom）。
//
// 锁定的回归点（都是「卡片关不掉 / 关闭时机错」类问题）：
//  1. hover 目标 → 打开；指针离开且无焦点 → 延迟隐藏。
//  2. 卡片内聚焦（点过 note textarea / 复制按钮）后指针移开 → 卡片不关（编辑不能被打断）。
//  3. 聚焦钉住后点击卡片外侧 → 立即关闭（历史上这里没有路径，卡片永久停留）。
//  4. 点击卡片内部 → 不关闭。
//  5. 附属浮层（attached layer）：pointerdown 在 portal 出去的浮层里不算「点击外侧」；
//     浮层 pin 住卡片期间指针移开也不收起，release 后回到常规延迟隐藏。
//
// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    InfoCardAttachedAttribute,
    isInAttachedInfoCardLayer,
    InfoCardPortal,
    useInfoCardHover,
    type InfoCardPinHandle,
} from "./info-card-hover";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let latestPin: InfoCardPinHandle | null = null;

function Harness() {
    const hover = useInfoCardHover({ hideDelayMs: 300 });
    latestPin = hover.pinHandle;
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


// ─── 附属浮层（portal 到 body 的第��方浮层，如属性值编辑浮层）───
describe("useInfoCardHover — 附属浮层保活", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        document.querySelectorAll(".attached-layer-test").forEach((el) => el.remove());
        vi.useRealTimers();
    });

    /** 造一个「portal 到 body 的附属浮层」：DOM 上不在卡片里，只有 data 标记能认出来。 */
    function makeAttachedLayer(): HTMLDivElement {
        const layer = document.createElement("div");
        layer.className = "attached-layer-test";
        layer.setAttribute(InfoCardAttachedAttribute, "true");
        const option = document.createElement("button");
        option.type = "button";
        option.textContent = "option";
        layer.appendChild(option);
        document.body.appendChild(layer);
        return layer;
    }

    it("isInAttachedInfoCardLayer 认得标记元素与其子节点", () => {
        const layer = makeAttachedLayer();
        const child = layer.querySelector("button")!;
        expect(isInAttachedInfoCardLayer(layer)).toBe(true);
        expect(isInAttachedInfoCardLayer(child)).toBe(true);
        expect(isInAttachedInfoCardLayer(child.firstChild)).toBe(true); // 文本节点走 parentElement
        expect(isInAttachedInfoCardLayer(document.body)).toBe(false);
        expect(isInAttachedInfoCardLayer(null)).toBe(false);
    });

    it("点附属浮层内部不算「点击外侧」，卡片不关闭", () => {
        mount();
        hover(targetEl());
        const layer = makeAttachedLayer();
        pointerDown(layer);
        expect(cardEl()).not.toBeNull();
    });

    it("浮层 pin 住时指针移开也不收起，release 后按常规延迟收起", () => {
        mount();
        hover(targetEl());
        expect(latestPin).not.toBeNull();
        act(() => {
            latestPin!.pin();
        });
        leave(cardEl()!);
        act(() => {
            vi.advanceTimersByTime(2000);
        });
        expect(cardEl()).not.toBeNull();

        act(() => {
            latestPin!.release();
        });
        act(() => {
            vi.advanceTimersByTime(299);
        });
        expect(cardEl()).not.toBeNull();
        act(() => {
            vi.advanceTimersByTime(1);
        });
        expect(cardEl()).toBeNull();
    });
});
