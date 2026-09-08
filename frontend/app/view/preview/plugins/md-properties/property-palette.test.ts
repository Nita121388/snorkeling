// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { hashString, tagColorFor, tagColorIndexFor, tagPalette } from "./property-palette";

describe("hashString", () => {
    it("稳定：同一输入永远同一结果", () => {
        expect(hashString("进行中")).toBe(hashString("进行中"));
    });

    it("不同输入尽量不同", () => {
        expect(hashString("进行中")).not.toBe(hashString("已完成"));
    });
});

describe("tagColorIndexFor", () => {
    it("落在调色板范围内", () => {
        for (const v of ["a", "进行中", "#tag", "zzz", "0"]) {
            const i = tagColorIndexFor(v);
            expect(i).toBeGreaterThanOrEqual(0);
            expect(i).toBeLessThan(tagPalette.length);
        }
    });

    it("同一标签颜色稳定（跨调用）", () => {
        expect(tagColorFor("进行中")).toBe(tagColorFor("进行中"));
        expect(tagColorFor("进行中").base).toBe(tagColorFor("进行中").base);
    });

    it("提供亮/暗两套前景色", () => {
        const c = tagColorFor("done");
        expect(c.fgLight).toBeTruthy();
        expect(c.fgDark).toBeTruthy();
        expect(c.fgLight).not.toBe(c.fgDark);
    });
});
