// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// InfoCardMarquee 的 DOM 行为测试（jsdom）。
//
// jsdom 没有排版引擎，宽度全部打桩：文本宽度按「字符数 × 10px」算，
// 容器可视宽度固定 200px。用它验证的是组件的**判定与状态切换**，
// 真实几何（不溢出 / 无缝衔接）由 info-card.scss + 浏览器实测保证。
//
// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InfoCardMarquee } from "./marquee";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ContainerWidth = 200;
const CharWidth = 10;

class StubResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
}

function mountMarquee(text: string): { container: HTMLElement } {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
        root.render(<InfoCardMarquee text={text} />);
    });
    return { container };
}

describe("InfoCardMarquee (dom)", () => {
    beforeEach(() => {
        vi.stubGlobal("ResizeObserver", StubResizeObserver);
        // 文本宽度：按字符数估算；容器可视宽度：固定值。
        vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
            this: Element
        ) {
            const width = (this.textContent ?? "").length * CharWidth;
            return {
                width,
                height: 14,
                top: 0,
                left: 0,
                right: width,
                bottom: 14,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            } as DOMRect;
        });
        vi.spyOn(Element.prototype, "clientWidth", "get").mockReturnValue(ContainerWidth);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        document.body.innerHTML = "";
    });

    it("starts scrolling when the text is wider than the card", () => {
        const { container } = mountMarquee("x".repeat(40));
        const marquee = container.querySelector(".info-card-marquee") as HTMLElement;
        expect(marquee.classList.contains("is-scrolling")).toBe(true);
    });

    it("publishes the scroll distance and duration as CSS variables", () => {
        const { container } = mountMarquee("x".repeat(40));
        const marquee = container.querySelector(".info-card-marquee") as HTMLElement;
        const shift = marquee.style.getPropertyValue("--info-card-marquee-shift");
        const duration = marquee.style.getPropertyValue("--info-card-marquee-duration");
        expect(shift).not.toBe("");
        expect(Number.parseFloat(shift)).toBeGreaterThan(0);
        expect(Number.parseFloat(duration)).toBeGreaterThanOrEqual(4);
    });

    it("does not scroll when the text fits", () => {
        const { container } = mountMarquee("short");
        const marquee = container.querySelector(".info-card-marquee") as HTMLElement;
        expect(marquee.classList.contains("is-scrolling")).toBe(false);
        expect(marquee.style.getPropertyValue("--info-card-marquee-shift")).toBe("");
    });

    it("falls back to the ellipsis when the user prefers reduced motion", () => {
        vi.spyOn(window, "matchMedia").mockImplementation(
            (query: string) =>
                ({
                    matches: query.includes("prefers-reduced-motion"),
                    media: query,
                    onchange: null,
                    addListener: () => {},
                    removeListener: () => {},
                    addEventListener: () => {},
                    removeEventListener: () => {},
                    dispatchEvent: () => false,
                }) as unknown as MediaQueryList
        );
        const { container } = mountMarquee("x".repeat(40));
        const marquee = container.querySelector(".info-card-marquee") as HTMLElement;
        expect(marquee.classList.contains("is-scrolling")).toBe(false);
    });

    it("keeps the full text in the tooltip for hover reading", () => {
        const { container } = mountMarquee("会话标题");
        const marquee = container.querySelector(".info-card-marquee") as HTMLElement;
        expect(marquee.getAttribute("title")).toBe("会话标题");
    });
});
