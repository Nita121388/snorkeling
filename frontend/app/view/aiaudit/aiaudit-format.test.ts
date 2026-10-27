// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    AuditStalledMs,
    bucketHeights,
    dayKey,
    dayLabel,
    formatClock,
    formatDuration,
    groupByDay,
    isStalled,
    resultLabel,
    sessionTitle,
    shortSessionKey,
    stateLabel,
    stateMeta,
} from "./aiaudit-format";

describe("formatDuration", () => {
    it("renders sub-second, second and minute ranges", () => {
        expect(formatDuration(0)).toBe("—");
        expect(formatDuration(-5)).toBe("—");
        expect(formatDuration(420)).toBe("420ms");
        expect(formatDuration(1200)).toBe("1.2s");
        expect(formatDuration(46_900)).toBe("46.9s");
        expect(formatDuration(125_000)).toBe("2m5s");
        expect(formatDuration(120_000)).toBe("2m");
    });
});

describe("state helpers", () => {
    it("maps known states and falls back for unknown ones", () => {
        expect(stateMeta("failed").textClass).toBe("text-error");
        expect(stateMeta("done").textClass).toBe("text-success");
        expect(stateMeta("weird").label).toBe("weird");
    });

    it("flags queued rows older than the stall window", () => {
        const now = 1_000_000_000;
        expect(isStalled({ state: "queued", createdAt: now - AuditStalledMs - 1 }, now)).toBe(true);
        expect(isStalled({ state: "queued", createdAt: now - 1000 }, now)).toBe(false);
        expect(isStalled({ state: "done", createdAt: now - 10 * 60 * 1000 }, now)).toBe(false);
    });

    it("labels stalled entries distinctly from queued", () => {
        const now = 1_000_000_000;
        expect(stateLabel({ state: "queued", createdAt: now - AuditStalledMs - 1 }, now)).toBe("stalled");
        expect(stateLabel({ state: "queued", createdAt: now }, now)).toBe("queued");
        expect(stateLabel({ state: "failed", createdAt: now }, now)).toBe("failed");
    });
});

describe("time formatting", () => {
    it("uses clock-only for today and date+clock for older rows", () => {
        const now = new Date(2026, 2, 4, 15, 0, 0).getTime();
        const today = new Date(2026, 2, 4, 9, 5, 7).getTime();
        const older = new Date(2026, 1, 27, 18, 42, 0).getTime();
        expect(formatClock(today, now)).toBe("09:05:07");
        expect(formatClock(older, now)).toBe("02-27 18:42");
        expect(formatClock(0, now)).toBe("—");
    });

    it("labels days relative to now", () => {
        const now = new Date(2026, 2, 4, 15, 0, 0).getTime();
        expect(dayLabel(new Date(2026, 2, 4, 1, 0, 0).getTime(), now)).toBe("Today");
        expect(dayLabel(new Date(2026, 2, 3, 23, 0, 0).getTime(), now)).toBe("Yesterday");
        expect(dayLabel(new Date(2026, 1, 27).getTime(), now)).toBe("Feb 27");
    });

    it("groups consecutive entries by local day", () => {
        const today = new Date(2026, 2, 4, 10, 0, 0).getTime();
        const yesterday = new Date(2026, 2, 3, 10, 0, 0).getTime();
        const groups = groupByDay([{ createdAt: today }, { createdAt: today - 60_000 }, { createdAt: yesterday }]);
        expect(groups).toHaveLength(2);
        expect(groups[0].key).toBe(dayKey(today));
        expect(groups[0].items).toHaveLength(2);
        expect(groups[1].key).toBe(dayKey(yesterday));
    });
});

describe("session helpers", () => {
    it("shortens provider prefixed GUID keys", () => {
        expect(shortSessionKey("pi:db0b044e-0642-41d4-8f43-c012a8861234")).toBe("db0b044e…c012a8861234");
        expect(shortSessionKey("k2")).toBe("k2");
        expect(shortSessionKey("")).toBe("");
    });

    it("falls back to a readable title when sessionTitle is blank", () => {
        expect(sessionTitle({ sessionTitle: "  ", sessionKey: "pi:x" })).toBe("Untitled session");
        expect(sessionTitle({ sessionTitle: "Refactor", sessionKey: "pi:x" })).toBe("Refactor");
    });
});

describe("resultLabel", () => {
    it("describes results and anchor retention", () => {
        expect(resultLabel({ resultCount: 0, anchorTotal: 0, anchorKept: 0 }).primary).toBe("—");
        const label = resultLabel({ resultCount: 3, anchorTotal: 5, anchorKept: 1 });
        expect(label.primary).toBe("3");
        expect(label.secondary).toBe("1/5");
        expect(label.title).toContain("3 results");
        expect(label.title).toContain("anchors kept 1/5");
    });
});

describe("bucketHeights", () => {
    it("always returns 24 bars with a minimum height", () => {
        expect(bucketHeights(undefined, 18)).toHaveLength(24);
        const heights = bucketHeights([{ count: 0 }, { count: 5 }, { count: 10 }], 20);
        expect(heights[0]).toBe(2);
        expect(heights[1]).toBe(10);
        expect(heights[2]).toBe(20);
    });
});
