// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    commonTextFreshnessFillClass,
    commonTextFreshnessFillStyle,
    commonTextFreshnessTier,
    formatCommonTextFreshnessCompact,
    isCommonTextNeverEdited,
} from "./commontext-freshness";
import type { CommonTextItem } from "./commontext-model";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function makeItem(updatedAgoMs: number, overrides: Partial<CommonTextItem> = {}): CommonTextItem {
    const now = Date.now();
    return {
        id: "ct-1",
        title: "Title",
        text: "Text",
        tags: [],
        pinned: false,
        createdat: now - 90 * DAY,
        updatedat: now - updatedAgoMs,
        usagecount: 0,
        ...overrides,
    } as CommonTextItem;
}

describe("commonTextFreshnessTier", () => {
    it("maps the same thresholds as aisessions freshnessLevel", () => {
        expect(commonTextFreshnessTier(makeItem(10 * MINUTE))).toBe(1);
        expect(commonTextFreshnessTier(makeItem(5 * HOUR))).toBe(2);
        expect(commonTextFreshnessTier(makeItem(2 * DAY))).toBe(3);
        expect(commonTextFreshnessTier(makeItem(12 * DAY))).toBe(4);
        expect(commonTextFreshnessTier(makeItem(45 * DAY))).toBe(5);
    });

    it("returns 0 for an item that was never edited since it was created", () => {
        const created = Date.now() - 40 * DAY;
        const item = makeItem(0, { createdat: created, updatedat: created });
        // 「从未编辑」与「很久以前编辑过」必须分开：前者是空槽，后者是 5 档 30% 填充。
        expect(commonTextFreshnessTier(item)).toBe(0);
        expect(isCommonTextNeverEdited(item)).toBe(true);
        expect(commonTextFreshnessTier(makeItem(45 * DAY))).toBe(5);
    });

    it("does not treat a freshly created item as edited when the edit bumps updatedat", () => {
        const created = Date.now() - 40 * DAY;
        const item = makeItem(1 * MINUTE, { createdat: created });
        expect(isCommonTextNeverEdited(item)).toBe(false);
        expect(commonTextFreshnessTier(item)).toBe(1);
    });
});

describe("commonTextFreshnessFillStyle", () => {
    it("fills less as the item gets staler", () => {
        const heights = [1, 2, 3, 4, 5].map((tier) => Number.parseInt(commonTextFreshnessFillStyle(tier)!.height, 10));
        expect(heights).toEqual([100, 82, 64, 46, 28]);
        // 相邻档位等差 18 个百分点：12px 槽里就是 2.16px，1× 下肉眼可分。
        for (let i = 1; i < heights.length; i++) {
            expect(heights[i - 1] - heights[i]).toBeGreaterThanOrEqual(18);
        }
    });

    it("returns null for the never-edited tier so the slot renders empty", () => {
        expect(commonTextFreshnessFillStyle(0)).toBeNull();
    });

    it("dims and desaturates together so the encoding is not height-only", () => {
        const opacities = [1, 2, 3, 4, 5].map((tier) => commonTextFreshnessFillStyle(tier)!.opacity);
        for (let i = 1; i < opacities.length; i++) {
            expect(opacities[i - 1]).toBeGreaterThan(opacities[i]);
        }
    });

    it("clamps out-of-range tiers instead of throwing", () => {
        expect(commonTextFreshnessFillStyle(99)).toEqual({ height: "28%", opacity: 0.48 });
        expect(commonTextFreshnessFillStyle(-3)).toBeNull();
    });
});

describe("commonTextFreshnessFillClass", () => {
    it("keeps accent for fresh tiers and switches to muted for the two stale ones", () => {
        expect(commonTextFreshnessFillClass(1)).toBe("bg-accent");
        expect(commonTextFreshnessFillClass(3)).toBe("bg-accent");
        expect(commonTextFreshnessFillClass(4)).toBe("bg-muted");
        expect(commonTextFreshnessFillClass(5)).toBe("bg-muted");
    });
});

describe("formatCommonTextFreshnessCompact", () => {
    // 固定 now：相对时间随真实时钟走会让断言在跨秒/跨分钟的瞬间变红。
    const now = Date.UTC(2026, 10, 9, 12, 0, 0);

    it("keeps the granularity of formatSessionRelativeTime but drops the `ago` noise", () => {
        expect(formatCommonTextFreshnessCompact(now - 5 * 1000, now)).toBe("now");
        expect(formatCommonTextFreshnessCompact(now - 45 * 1000, now)).toBe("45s");
        expect(formatCommonTextFreshnessCompact(now - 12 * MINUTE, now)).toBe("12m");
        expect(formatCommonTextFreshnessCompact(now - 5 * HOUR, now)).toBe("5h");
        expect(formatCommonTextFreshnessCompact(now - 12 * DAY, now)).toBe("12d");
        expect(formatCommonTextFreshnessCompact(now - 45 * DAY, now)).toBe("45d");
    });

    it("returns an empty label when there is no usable timestamp", () => {
        // 空串 = 调用方直接不渲染文字，而不是留一个 "never" 占位。
        expect(formatCommonTextFreshnessCompact(undefined, now)).toBe("");
        expect(formatCommonTextFreshnessCompact(0, now)).toBe("");
    });

    it("stays narrow enough for the 58px right slot", () => {
        // 右槽 = 12px 方块 + 4px gap + 文字："365d" 是最长的正常输出（≥1 年）。
        const longest = formatCommonTextFreshnessCompact(now - 400 * DAY, now);
        expect(longest.length).toBeLessThanOrEqual(4);
        expect(12 + 4 + longest.length * 6).toBeLessThanOrEqual(58);
    });
});
