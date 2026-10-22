// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// InfoCardMarquee（卡片内长标题走马灯）测试。
//
// 覆盖三件事：
//   1. 溢出判定的边界（文本比可视宽度长多少才算溢出）；
//   2. 滚动周期时长与速度的关系；
//   3. 渲染结构：两份副本、第二份对屏幕阅读器隐藏、完整文本进 title 提示。

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InfoCardMarquee, isMarqueeNeeded, marqueeDurationSec } from "./marquee";

describe("isMarqueeNeeded", () => {
    it("does not scroll when the text fits", () => {
        expect(isMarqueeNeeded(100, 200)).toBe(false);
    });

    it("scrolls when the text exceeds the visible width", () => {
        expect(isMarqueeNeeded(300, 200)).toBe(true);
    });

    it("ignores sub-pixel differences", () => {
        expect(isMarqueeNeeded(200.5, 200)).toBe(false);
    });

    it("never scrolls while the container has no measurable width", () => {
        // 隐藏 / 尚未布局时宽度为 0：不能因为「装不下」就误开动画。
        expect(isMarqueeNeeded(300, 0)).toBe(false);
    });
});

describe("marqueeDurationSec", () => {
    it("keeps a constant speed regardless of the text length", () => {
        // 距离 / 速度 = 时长
        expect(marqueeDurationSec(900, 45)).toBeCloseTo(20, 5);
    });

    it("honours a custom speed", () => {
        expect(marqueeDurationSec(600, 30)).toBeCloseTo(20, 5);
    });

    it("never drops below the minimum duration", () => {
        expect(marqueeDurationSec(10, 45)).toBeGreaterThanOrEqual(4);
    });

    it("falls back to the minimum duration for invalid input", () => {
        expect(marqueeDurationSec(0, 45)).toBe(4);
        expect(marqueeDurationSec(600, 0)).toBe(4);
    });
});

describe("InfoCardMarquee", () => {
    it("renders the full text in a tooltip", () => {
        const html = renderToStaticMarkup(<InfoCardMarquee text="一个很长的会话名称" />);
        expect(html).toContain('title="一个很长的会话名称"');
    });

    it("renders two copies so the scroll can loop seamlessly", () => {
        const html = renderToStaticMarkup(<InfoCardMarquee text="session-name" />);
        // 只数文本节点（title 属性里也有一份，不算副本）。
        expect(html.match(/>session-name</g)?.length).toBe(2);
    });

    it("hides the duplicate copy from assistive tech", () => {
        const html = renderToStaticMarkup(<InfoCardMarquee text="session-name" />);
        expect(html).toContain('aria-hidden="true"');
    });

    it("keeps the info-card title styling on the container", () => {
        const html = renderToStaticMarkup(<InfoCardMarquee text="session-name" />);
        expect(html).toContain("info-card-title");
        expect(html).toContain("info-card-marquee");
    });

    it("renders empty text without a scroll state", () => {
        const html = renderToStaticMarkup(<InfoCardMarquee text="" />);
        expect(html).not.toContain("is-scrolling");
    });
});
