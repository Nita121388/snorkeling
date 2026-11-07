// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    BoardMotionDefaults,
    diffBoardLayout,
    type BoardSnapshot,
    type BoardSnapshotItem,
} from "./overview-board-motion";

function item(left: number, top: number, status: string, width = 200, height = 80): BoardSnapshotItem {
    return { rect: { left, top, width, height }, status };
}

function snapshot(
    items: Record<string, BoardSnapshotItem>,
    containerWidth = 1200,
    columns: readonly string[] = ["status:working", "status:done", "status:idle"]
): BoardSnapshot {
    return { containerWidth, columns, items };
}

const VIEWPORT = { viewportWidth: 1600, viewportHeight: 900 };

describe("diffBoardLayout", () => {
    it("returns nothing without a previous snapshot", () => {
        const next = snapshot({ a: item(10, 10, "working") });
        expect(diffBoardLayout(null, next, VIEWPORT)).toEqual([]);
    });

    it("returns nothing when the container width changed (resize, not a card move)", () => {
        const prev = snapshot({ a: item(10, 10, "working") }, 1200);
        const next = snapshot({ a: item(500, 10, "working") }, 900);
        expect(diffBoardLayout(prev, next, VIEWPORT)).toEqual([]);
    });

    it("returns nothing when the column key set changed (grouping mode switch)", () => {
        // status ⇄ tab ⇄ provider：所有卡片都会“跨列”，但那是布局切换，不是卡片移动。
        const prev = snapshot({ a: item(10, 120, "status:working") }, 1200, [
            "status:working",
            "status:done",
        ]);
        const next = snapshot({ a: item(410, 40, "tab:t1") }, 1200, ["tab:t1", "tab:t2"]);
        expect(diffBoardLayout(prev, next, VIEWPORT)).toEqual([]);
    });

    it("treats a reordered-but-equal column key set as unchanged", () => {
        const prev = snapshot({ a: item(10, 10, "status:working") }, 1200, [
            "status:done",
            "status:working",
        ]);
        const next = snapshot({ a: item(10, 10, "status:working") }, 1200, [
            "status:working",
            "status:done",
        ]);
        expect(diffBoardLayout(prev, next, VIEWPORT)).toEqual([]);
    });

    it("marks a status-column change as a move with the rect delta", () => {
        const prev = snapshot({ a: item(10, 120, "working") });
        const next = snapshot({ a: item(410, 40, "done") });
        expect(diffBoardLayout(prev, next, VIEWPORT)).toEqual([
            { blockId: "a", kind: "move", dx: 400, dy: -80 },
        ]);
    });

    it("marks a positional shift without a status change as a reflow", () => {
        const prev = snapshot({ a: item(10, 120, "working") });
        const next = snapshot({ a: item(10, 40, "working") });
        expect(diffBoardLayout(prev, next, VIEWPORT)).toEqual([
            { blockId: "a", kind: "reflow", dx: 0, dy: -80 },
        ]);
    });

    it("marks a block absent from the previous snapshot as an enter (no delta)", () => {
        const prev = snapshot({ a: item(10, 10, "working") });
        const next = snapshot({ a: item(10, 10, "working"), b: item(10, 120, "idle") });
        expect(diffBoardLayout(prev, next, VIEWPORT)).toEqual([
            { blockId: "b", kind: "enter", dx: 0, dy: 0 },
        ]);
    });

    it("drops blocks that disappeared instead of animating them", () => {
        const prev = snapshot({ a: item(10, 10, "working"), gone: item(10, 120, "idle") });
        const next = snapshot({ a: item(10, 10, "working") });
        expect(diffBoardLayout(prev, next, VIEWPORT)).toEqual([]);
    });

    it("ignores sub-pixel drift", () => {
        const prev = snapshot({ a: item(10, 10, "working") });
        const next = snapshot({ a: item(10.4, 10.4, "working") });
        expect(diffBoardLayout(prev, next, VIEWPORT)).toEqual([]);
        expect(BoardMotionDefaults.minDeltaPx).toBe(1.5);
    });

    it("ignores per-axis displacement larger than the viewport (layout rebuild, not a move)", () => {
        const prev = snapshot({ a: item(10, 10, "working") });
        const next = snapshot({ a: item(10 + 1600 * 1.6, 10, "done") });
        expect(diffBoardLayout(prev, next, VIEWPORT)).toEqual([]);
    });

    it("demotes moves beyond maxMoves to reflow instead of dropping them", () => {
        const prevItems: Record<string, BoardSnapshotItem> = {};
        const nextItems: Record<string, BoardSnapshotItem> = {};
        for (let i = 0; i < 15; i++) {
            prevItems[`b${i}`] = item(10, 10 + i * 90, "working");
            nextItems[`b${i}`] = item(410, 10 + i * 90, "done");
        }
        const moves = diffBoardLayout(snapshot(prevItems), snapshot(nextItems), {
            ...VIEWPORT,
            maxMoves: 12,
        });
        expect(moves).toHaveLength(15);
        expect(moves.filter((m) => m.kind === "move")).toHaveLength(12);
        expect(moves.filter((m) => m.kind === "reflow")).toHaveLength(3);
    });

    it("emits moves before reflows and enters", () => {
        const prev = snapshot({
            shift: item(10, 10, "working"),
            fly: item(10, 100, "working"),
        });
        const next = snapshot({
            shift: item(10, 190, "working"),
            fly: item(410, 100, "done"),
            fresh: item(810, 10, "idle"),
        });
        const kinds = diffBoardLayout(prev, next, VIEWPORT).map((m) => m.kind);
        expect(kinds).toEqual(["move", "reflow", "enter"]);
    });
});
