// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    KEY_DOWN,
    KEY_HOME,
    KEY_RIGHT,
    KEY_UP,
    cellFromClientXY,
    planCursorMoveKeys,
    synthesizeClickKeys,
} from "./click-synthesize";

describe("planCursorMoveKeys", () => {
    it("moves right within the current line", () => {
        expect(planCursorMoveKeys(5, 10, { row: 5, col: 3 })).toBe(KEY_HOME + KEY_RIGHT.repeat(3));
    });

    it("starts of a line with col 0 emits just Home", () => {
        expect(planCursorMoveKeys(5, 10, { row: 5, col: 0 })).toBe(KEY_HOME);
    });

    it("switches to a lower line before moving right", () => {
        expect(planCursorMoveKeys(2, 4, { row: 5, col: 3 })).toBe(KEY_DOWN.repeat(3) + KEY_HOME + KEY_RIGHT.repeat(3));
    });

    it("switches to an upper line before moving right", () => {
        expect(planCursorMoveKeys(7, 4, { row: 2, col: 1 })).toBe(KEY_UP.repeat(5) + KEY_HOME + KEY_RIGHT);
    });

    it("clamps negative column to zero", () => {
        expect(planCursorMoveKeys(0, 0, { row: 0, col: -1 })).toBe(KEY_HOME);
    });

    it("leaves col movement empty when already at start", () => {
        expect(planCursorMoveKeys(3, 0, { row: 3, col: 0 })).toBe(KEY_HOME);
    });
});

describe("cellFromClientXY", () => {
    const rect = { left: 10, top: 20, right: 250, bottom: 100, width: 240, height: 80 } as DOMRect;

    it("returns null outside the terminal area", () => {
        expect(cellFromClientXY({ cols: 80, rows: 24 }, rect, 5, 5)).toBeNull();
    });

    it("maps a click to a buffer cell using viewport dimensions", () => {
        const terminal = {
            cols: 120,
            rows: 24,
            _core: { viewport: { dimensions: { cw: 8, ch: 16 } } },
        };
        // (clientX=10, clientY=20) is cell (0,0); click 2 rows down, 4 cols right.
        expect(cellFromClientXY(terminal, rect, 10 + 4 * 8, 20 + 2 * 16)).toEqual({ row: 2, col: 4 });
    });

    it("falls back to geometric estimation without the internal viewport", () => {
        const terminal = { cols: 60, rows: 15 };
        // 240px wide / 60 cols = 4px per col; 80px tall / 15 rows ≈ 5.33px per row.
        expect(cellFromClientXY(terminal, rect, 10 + 20, 20 + 10)).toEqual({ row: 1, col: 5 });
    });

    it("clamps out-of-range cells to the buffer edges", () => {
        const terminal = { cols: 10, rows: 5, _core: { viewport: { dimensions: { cw: 8, ch: 16 } } } };
        expect(cellFromClientXY(terminal, rect, rect.right - 1, rect.bottom - 1).row).toBeLessThan(5);
        expect(cellFromClientXY(terminal, rect, rect.right - 1, rect.bottom - 1).col).toBeLessThan(10);
    });
});
describe("synthesizeClickKeys", () => {
    it("maps a click to keys when inside the terminal", () => {
        const terminal = { cols: 120, rows: 24, _core: { viewport: { dimensions: { cw: 8, ch: 16 } } } };
        const rect = { left: 10, top: 20, right: 250, bottom: 100, width: 240, height: 80 } as DOMRect;
        const keys = synthesizeClickKeys({
            terminal,
            containerRect: rect,
            clientX: 10 + 3 * 8,
            clientY: 20 + 0 * 16,
            cursorRow: 0,
            cursorCol: 10,
        });
        expect(keys).toBe(KEY_HOME + KEY_RIGHT.repeat(3));
    });

    it("returns null when the click lands outside the terminal", () => {
        const terminal = { cols: 80, rows: 24 };
        const rect = { left: 10, top: 20, right: 250, bottom: 100, width: 240, height: 80 } as DOMRect;
        expect(
            synthesizeClickKeys({
                terminal,
                containerRect: rect,
                clientX: 2,
                clientY: 2,
                cursorRow: 0,
                cursorCol: 0,
            })
        ).toBeNull();
    });
});
