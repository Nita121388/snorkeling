// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    isTermSelectionDrag,
    shouldRoutePlainTermGesture,
    shouldSuppressTermMouseMove,
} from "./term-selection-gesture";

describe("terminal selection gesture routing", () => {
    it("routes an unmodified macOS primary gesture when terminal mouse tracking is active", () => {
        expect(shouldRoutePlainTermGesture("darwin", "any", 0, false, false, false, false)).toBe(true);
        expect(shouldRoutePlainTermGesture("darwin", "none", 0, false, false, false, false)).toBe(false);
        expect(shouldRoutePlainTermGesture("linux", "any", 0, false, false, false, false)).toBe(false);
    });

    it("preserves modified clicks and secondary buttons", () => {
        expect(shouldRoutePlainTermGesture("darwin", "any", 2, false, false, false, false)).toBe(false);
        expect(shouldRoutePlainTermGesture("darwin", "any", 0, true, false, false, false)).toBe(false);
        expect(shouldRoutePlainTermGesture("darwin", "any", 0, false, true, false, false)).toBe(false);
        expect(shouldRoutePlainTermGesture("darwin", "any", 0, false, false, true, false)).toBe(false);
        expect(shouldRoutePlainTermGesture("darwin", "any", 0, false, false, false, true)).toBe(false);
    });

    it("starts selection only after the pointer crosses the drag threshold", () => {
        expect(isTermSelectionDrag(10, 10, 13, 12)).toBe(false);
        expect(isTermSelectionDrag(10, 10, 14, 10)).toBe(true);
    });

    it("keeps hover movement away from the terminal application while a selection exists", () => {
        expect(shouldSuppressTermMouseMove(true, 0)).toBe(true);
        expect(shouldSuppressTermMouseMove(true, 1)).toBe(false);
        expect(shouldSuppressTermMouseMove(false, 0)).toBe(false);
    });
});
