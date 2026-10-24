// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    DragThresholdPx,
    isDragMovement,
    keysUnderRect,
    rectsIntersect,
    rectToCss,
    toDocumentRect,
    toViewportRect,
    type Rect,
} from "./selectionrect";

function rect(left: number, top: number, right: number, bottom: number): Rect {
    return { left, top, right, bottom };
}

// 造一个只实现 getBoundingClientRect 的假行元素。
function fakeRow(bounds: Rect): HTMLElement {
    return { getBoundingClientRect: () => bounds } as unknown as HTMLElement;
}

describe("rectsIntersect", () => {
    it("detects containment and partial overlap", () => {
        expect(rectsIntersect(rect(0, 0, 100, 100), rect(10, 10, 20, 20))).toBe(true);
        expect(rectsIntersect(rect(10, 10, 20, 20), rect(0, 0, 100, 100))).toBe(true);
        expect(rectsIntersect(rect(0, 0, 50, 50), rect(25, 25, 75, 75))).toBe(true);
        expect(rectsIntersect(rect(0, 0, 100, 10), rect(20, 5, 30, 40))).toBe(true);
    });

    it("returns false for fully separated rects", () => {
        expect(rectsIntersect(rect(0, 0, 10, 10), rect(20, 20, 30, 30))).toBe(false);
        expect(rectsIntersect(rect(0, 0, 10, 10), rect(-30, -30, -20, -20))).toBe(false);
    });

    it("treats a shared edge as NOT intersecting (no flicker on jitter)", () => {
        expect(rectsIntersect(rect(0, 0, 10, 10), rect(10, 0, 20, 10))).toBe(false); // touching right
        expect(rectsIntersect(rect(0, 0, 10, 10), rect(-10, 0, 0, 10))).toBe(false); // touching left
        expect(rectsIntersect(rect(0, 0, 10, 10), rect(0, 10, 10, 20))).toBe(false); // touching bottom
        expect(rectsIntersect(rect(0, 0, 10, 10), rect(0, -10, 10, 0))).toBe(false); // touching top
    });
});

describe("keysUnderRect", () => {
    const rows = [
        { key: "row-1", el: fakeRow(rect(0, 0, 100, 20)) },
        { key: "row-2", el: fakeRow(rect(0, 20, 100, 40)) },
        { key: "row-3", el: fakeRow(rect(0, 40, 100, 60)) },
        { key: "row-4", el: fakeRow(rect(0, 60, 100, 80)) },
    ];

    it("returns every row but keeps the incoming order", () => {
        expect(keysUnderRect(rect(-10, -10, 200, 200), rows)).toEqual(["row-1", "row-2", "row-3", "row-4"]);
    });

    it("returns nothing when the rect misses every row", () => {
        expect(keysUnderRect(rect(500, 500, 600, 600), rows)).toEqual([]);
        expect(keysUnderRect(rect(0, 200, 100, 300), rows)).toEqual([]);
    });

    it("returns only the rows the rect crosses", () => {
        expect(keysUnderRect(rect(0, 10, 100, 50), rows)).toEqual(["row-1", "row-2", "row-3"]);
        expect(keysUnderRect(rect(50, 45, 60, 75), rows)).toEqual(["row-3", "row-4"]);
    });

    it("preserves order regardless of DOM order in the array", () => {
        const reversed = [...rows].reverse();
        expect(keysUnderRect(rect(0, 10, 100, 50), reversed)).toEqual(["row-3", "row-2", "row-1"]);
    });

    it("ignores entries with a null element", () => {
        const withNull = [
            { key: "row-1", el: fakeRow(rect(0, 0, 100, 20)) },
            { key: "row-null", el: null as unknown as HTMLElement },
        ];
        expect(keysUnderRect(rect(0, 0, 100, 30), withNull)).toEqual(["row-1"]);
    });
});

describe("isDragMovement", () => {
    it("uses the DragThresholdPx boundary on both axes", () => {
        expect(isDragMovement(0, 0)).toBe(false);
        expect(isDragMovement(DragThresholdPx - 1, 0)).toBe(false);
        expect(isDragMovement(0, -(DragThresholdPx - 1))).toBe(false);
        expect(isDragMovement(DragThresholdPx, 0)).toBe(true);
        expect(isDragMovement(0, DragThresholdPx)).toBe(true);
        expect(isDragMovement(-DragThresholdPx, -DragThresholdPx)).toBe(true);
        expect(isDragMovement(100, 1)).toBe(true);
    });
});

describe("scroll compensation", () => {
    it("round-trips between viewport and document coordinates", () => {
        const viewport = rect(10, 100, 200, 140);
        const doc = toDocumentRect(viewport, 500);
        expect(doc).toEqual(rect(10, 600, 200, 640));
        expect(toViewportRect(doc, 500)).toEqual(viewport);
    });

    it("keeps the same rows selected when the container scrolls mid-drag", () => {
        // 起点在文档 y=600。容器从 scrollTop=500 滚到 460（内容整体下移 40px），
        // 行 DOM 的视口 rect 随之 +40。文档坐标起点让矩形跟着内容走，命中不变。
        const startDoc = toDocumentRect(rect(10, 100, 200, 140), 500);
        const before = keysUnderRect(toViewportRect(startDoc, 500), [
            { key: "row-a", el: fakeRow(rect(0, 100, 300, 140)) },
            { key: "row-b", el: fakeRow(rect(0, 500, 300, 540)) },
        ]);
        const after = keysUnderRect(toViewportRect(startDoc, 460), [
            { key: "row-a", el: fakeRow(rect(0, 140, 300, 180)) },
            { key: "row-b", el: fakeRow(rect(0, 540, 300, 580)) },
        ]);
        expect(before).toEqual(["row-a"]);
        expect(after).toEqual(["row-a"]);
    });

    it("normalizes a drag that goes up-left into a positive-size css box", () => {
        expect(rectToCss(rect(200, 300, 100, 100))).toEqual({ left: 200, top: 300, width: 0, height: 0 });
        expect(rectToCss(rect(10, 20, 110, 70))).toEqual({ left: 10, top: 20, width: 100, height: 50 });
    });
});
