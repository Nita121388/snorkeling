// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// info-card 定位的判据：卡片必须整卡落在视口内。
//
// 校准（L3 红绿对照）：legacyCardPos（历史公式，无钳位）在同一组夹具上必须出界，
// 否则说明判据是瞎的。改这里之前先读 INFO-CARD 的 incident：Tab 悬浮弹窗被截断。

import { describe, expect, it } from "vitest";
import {
    CARD_GAP,
    computeCardPos,
    isFullyInside,
    legacyCardPos,
    VIEWPORT_MARGIN,
    type InfoCardViewport,
} from "./info-card-pos";

const WIDE: InfoCardViewport = { width: 1920, height: 1030 };
const NARROW: InfoCardViewport = { width: 900, height: 700 };
const CARD = { width: 400, height: 320 };

describe("info-card 定位：整卡不出视口", () => {
    it("居中目标：沿用首选位（下方，左对齐）", () => {
        const rect = { top: 8, bottom: 40, left: 300, right: 420 };
        const pos = computeCardPos({ rect, card: CARD, viewport: WIDE, placement: "bottom" });
        expect(pos).toEqual({ top: 40 + CARD_GAP, left: 300 });
        expect(isFullyInside(pos, CARD, WIDE)).toBe(true);
    });

    it("靠右的 Tab：左边缘夹进视口，不再溢出右边", () => {
        const rect = { top: 8, bottom: 40, left: 1700, right: 1840 };
        const pos = computeCardPos({ rect, card: CARD, viewport: WIDE, placement: "bottom" });
        expect(isFullyInside(pos, CARD, WIDE)).toBe(true);
        expect(pos.left).toBe(WIDE.width - VIEWPORT_MARGIN - CARD.width);
    });

    it("靠下的目标：翻到上方而不是被窗口底部裁掉", () => {
        const viewport: InfoCardViewport = { width: 1200, height: 500 };
        const rect = { top: 440, bottom: 470, left: 100, right: 240 };
        const pos = computeCardPos({ rect, card: CARD, viewport, placement: "bottom" });
        expect(pos.top).toBe(440 - CARD_GAP - CARD.height);
        expect(isFullyInside(pos, CARD, viewport)).toBe(true);
    });

    it("上下都放不下：夹进可用区间，仍整卡可见", () => {
        const viewport: InfoCardViewport = { width: 1200, height: 420 };
        const rect = { top: 180, bottom: 220, left: 100, right: 240 };
        const pos = computeCardPos({ rect, card: CARD, viewport, placement: "bottom" });
        expect(isFullyInside(pos, CARD, viewport)).toBe(true);
    });

    it("placement=right 且目标贴右墙：翻到左侧", () => {
        const rect = { top: 200, bottom: 240, left: 1820, right: 1900 };
        const pos = computeCardPos({ rect, card: CARD, viewport: WIDE, placement: "right" });
        expect(pos.left).toBe(1820 - VIEWPORT_MARGIN - CARD.width);
        expect(isFullyInside(pos, CARD, WIDE)).toBe(true);
    });

    it("窄窗口：目标靠右时仍夹到可用区间", () => {
        const card = { width: 400, height: 200 };
        const rect = { top: 8, bottom: 40, left: 700, right: 860 };
        const pos = computeCardPos({ rect, card, viewport: NARROW, placement: "bottom" });
        expect(pos.left).toBe(NARROW.width - VIEWPORT_MARGIN - card.width);
        expect(isFullyInside(pos, card, NARROW)).toBe(true);
    });

    it("卡片比视口还宽：保住左边缘，坐标仍是有限值（退化不死循环）", () => {
        const card = { width: 400, height: 200 };
        const viewport: InfoCardViewport = { width: 300, height: 900 };
        const rect = { top: 8, bottom: 40, left: 120, right: 260 };
        const pos = computeCardPos({ rect, card, viewport, placement: "bottom" });
        expect(pos.left).toBe(VIEWPORT_MARGIN);
        expect(Number.isFinite(pos.top)).toBe(true);
        expect(pos.top).toBeGreaterThanOrEqual(VIEWPORT_MARGIN);
    });

    describe("校准：旧公式在同样的夹具上必须出界", () => {
        it("靠右的 Tab → 旧公式右溢出（这正是被截断的原因）", () => {
            const rect = { top: 8, bottom: 40, left: 1700, right: 1840 };
            const legacy = legacyCardPos(rect, "bottom");
            expect(isFullyInside(legacy, CARD, WIDE)).toBe(false);
            expect(legacy.left + CARD.width).toBeGreaterThan(WIDE.width);
        });

        it("靠下的目标 → 旧公式底溢出", () => {
            const viewport: InfoCardViewport = { width: 1200, height: 500 };
            const rect = { top: 440, bottom: 470, left: 100, right: 240 };
            expect(isFullyInside(legacyCardPos(rect, "bottom"), CARD, viewport)).toBe(false);
        });

        it("placement=right 贴右墙 → 旧公式右溢出", () => {
            const rect = { top: 200, bottom: 240, left: 1820, right: 1900 };
            expect(isFullyInside(legacyCardPos(rect, "right"), CARD, WIDE)).toBe(false);
        });
    });
});
