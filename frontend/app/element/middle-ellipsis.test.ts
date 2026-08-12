// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { maxFitLength } from "./middle-ellipsis";

describe("maxFitLength", () => {
    it("returns the largest n satisfying a monotonic predicate", () => {
        expect(maxFitLength(0, 50, (n) => n <= 20)).toBe(20);
        expect(maxFitLength(0, 50, (n) => n <= 500)).toBe(50);
    });

    it("converges to the lower bound when nothing satisfies fits", () => {
        expect(maxFitLength(0, 1, () => false)).toBe(0);
        expect(maxFitLength(2, 8, (n) => n <= 1)).toBe(2);
    });

    it("handles trivial ranges", () => {
        expect(maxFitLength(0, 0, () => true)).toBe(0);
        expect(maxFitLength(0, 1, (n) => n === 1)).toBe(1);
        expect(maxFitLength(0, 1, (n) => n >= 1)).toBe(1);
    });
});
