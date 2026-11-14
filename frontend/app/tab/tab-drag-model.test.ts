// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    DragEngageMoveCount,
    DragEngageThresholdPx,
    DragPersistThresholdPx,
    computeDragDirection,
    computeNewTabIndex,
    isBeyondEngageThreshold,
    shouldEngageDrag,
} from "./tab-drag-model";

describe("tab drag engage threshold", () => {
    it("treats a small hand tremor as a click (below 8px)", () => {
        expect(isBeyondEngageThreshold(5, 1)).toBe(false);
        expect(isBeyondEngageThreshold(-7, 1)).toBe(false);
        expect(shouldEngageDrag({ deltaPx: 5, consecutiveMoves: 5, zoomFactor: 1 })).toBe(false);
    });

    it("requires both distance and consecutive mousemove count", () => {
        expect(shouldEngageDrag({ deltaPx: 12, consecutiveMoves: 1, zoomFactor: 1 })).toBe(false);
        expect(shouldEngageDrag({ deltaPx: 12, consecutiveMoves: DragEngageMoveCount, zoomFactor: 1 })).toBe(true);
    });

    it("scales the threshold by zoom factor and survives bad zoom values", () => {
        // zoom 2 → 8px 物理距离 = 4 CSS px
        expect(isBeyondEngageThreshold(4.5, 2)).toBe(true);
        expect(isBeyondEngageThreshold(3.5, 2)).toBe(false);
        expect(isBeyondEngageThreshold(DragEngageThresholdPx, 0)).toBe(true);
        expect(isBeyondEngageThreshold(DragEngageThresholdPx - 0.5, Number.NaN)).toBe(false);
    });

    it("keeps the 50px persist threshold", () => {
        expect(DragPersistThresholdPx).toBe(50);
    });
});

describe("computeDragDirection", () => {
    it("returns null on the first frame and keeps the previous direction afterwards", () => {
        expect(computeDragDirection(100, null, null)).toBeNull();
        expect(computeDragDirection(110, 100, null)).toBe("+");
        expect(computeDragDirection(90, 100, null)).toBe("-");
        expect(computeDragDirection(0, 0, "-")).toBe("-");
    });
});

describe("computeNewTabIndex", () => {
    const positions = new Map([
        ["a", 0],
        ["b", 100],
        ["c", 200],
    ]);
    const order = ["a", "b", "c"];

    it("keeps the index when movement stays inside the slot", () => {
        // 6px 小位移：不换位（旧实现用 stale 位置时这里会误换位）
        expect(
            computeNewTabIndex({
                currentX: 6,
                tabWidth: 100,
                dragDirection: "+",
                order,
                draggedTabId: "a",
                startPositions: positions,
            })
        ).toBe(0);
        expect(
            computeNewTabIndex({
                currentX: 94,
                tabWidth: 100,
                dragDirection: "-",
                order,
                draggedTabId: "b",
                startPositions: positions,
            })
        ).toBe(1);
        // 首帧无方向 → 不换位
        expect(
            computeNewTabIndex({
                currentX: 180,
                tabWidth: 100,
                dragDirection: null,
                order,
                draggedTabId: "a",
                startPositions: positions,
            })
        ).toBe(0);
    });

    it("moves right only after crossing the neighbour midpoint", () => {
        expect(
            computeNewTabIndex({
                currentX: 60,
                tabWidth: 100,
                dragDirection: "+",
                order,
                draggedTabId: "a",
                startPositions: positions,
            })
        ).toBe(1);
        expect(
            computeNewTabIndex({
                currentX: 160,
                tabWidth: 100,
                dragDirection: "+",
                order,
                draggedTabId: "a",
                startPositions: positions,
            })
        ).toBe(2);
    });

    it("moves left only after crossing the neighbour midpoint", () => {
        expect(
            computeNewTabIndex({
                currentX: 140,
                tabWidth: 100,
                dragDirection: "-",
                order,
                draggedTabId: "c",
                startPositions: positions,
            })
        ).toBe(1);
        expect(
            computeNewTabIndex({
                currentX: 20,
                tabWidth: 100,
                dragDirection: "-",
                order,
                draggedTabId: "c",
                startPositions: positions,
            })
        ).toBe(0);
    });

    it("follows the working order instead of the original tabIds indexes", () => {
        const moving = ["b", "a", "c"];
        expect(
            computeNewTabIndex({
                currentX: 250,
                tabWidth: 100,
                dragDirection: "+",
                order: moving,
                draggedTabId: "a",
                startPositions: positions,
            })
        ).toBe(2);
    });

    it("returns -1 for an unknown tab id", () => {
        expect(
            computeNewTabIndex({
                currentX: 0,
                tabWidth: 100,
                dragDirection: "+",
                order,
                draggedTabId: "ghost",
                startPositions: positions,
            })
        ).toBe(-1);
    });
});
