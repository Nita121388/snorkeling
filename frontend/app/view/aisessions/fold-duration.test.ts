// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { durationBarFraction, formatDuration, subagentDurationMs, toolGroupDurationMs } from "./fold-duration";

describe("formatDuration", () => {
    it("formats sub-second durations in milliseconds", () => {
        expect(formatDuration(850)).toBe("850ms");
        expect(formatDuration(0)).toBe("1ms");
    });

    it("formats seconds with one decimal under a minute", () => {
        expect(formatDuration(3400)).toBe("3.4s");
        expect(formatDuration(59_900)).toBe("59.9s");
    });

    it("formats minutes and hours", () => {
        expect(formatDuration(123_000)).toBe("2m 3s");
        expect(formatDuration(120_000)).toBe("2m");
        expect(formatDuration(3_840_000)).toBe("1h 4m");
        expect(formatDuration(3_600_000)).toBe("1h");
    });

    it("returns empty for invalid values", () => {
        expect(formatDuration(Number.NaN)).toBe("");
        expect(formatDuration(-1)).toBe("");
    });
});

describe("durationBarFraction", () => {
    it("returns 0 for non-positive durations", () => {
        expect(durationBarFraction(0, 1000)).toBe(0);
        expect(durationBarFraction(-5, 1000)).toBe(0);
    });

    it("normalizes against the session max", () => {
        expect(durationBarFraction(5000, 10_000)).toBe(0.5);
        expect(durationBarFraction(10_000, 10_000)).toBe(1);
    });

    it("keeps a minimum visible width for tiny durations", () => {
        expect(durationBarFraction(1, 1_000_000)).toBe(0.06);
    });

    it("falls back to full width when max is unknown", () => {
        expect(durationBarFraction(1234, 0)).toBe(1);
    });
});

describe("toolGroupDurationMs", () => {
    const map = new Map<number, number>([
        [1, 1000],
        [2, 4500],
        [3, 4500],
    ]);

    it("returns the timestamp span between start and end anchors", () => {
        expect(toolGroupDurationMs(map, 1, 2)).toBe(3500);
    });

    it("returns undefined when a timestamp is missing", () => {
        expect(toolGroupDurationMs(map, 1, 99)).toBeUndefined();
        expect(toolGroupDurationMs(undefined, 1, 2)).toBeUndefined();
    });

    it("returns undefined for non-positive spans", () => {
        expect(toolGroupDurationMs(map, 2, 3)).toBeUndefined();
        expect(toolGroupDurationMs(map, 2, 1)).toBeUndefined();
    });
});

describe("subagentDurationMs", () => {
    it("returns the update minus dispatch delta", () => {
        expect(subagentDurationMs(1000, 61_000)).toBe(60_000);
    });

    it("returns undefined for missing or invalid inputs", () => {
        expect(subagentDurationMs(undefined, 1000)).toBeUndefined();
        expect(subagentDurationMs(1000, undefined)).toBeUndefined();
        expect(subagentDurationMs(2000, 1000)).toBeUndefined();
        expect(subagentDurationMs(0, 1000)).toBeUndefined();
    });
});
