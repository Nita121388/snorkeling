// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    OverviewTimelineMaxRows,
    OverviewTimelineRangeDefault,
    OverviewTimelineRangeStorageKey,
    OverviewTimelineRanges,
    buildTimelineBar,
    buildTimelineRows,
    buildTimelineTicks,
    formatTimelineRangeLabel,
    readOverviewTimelineRange,
    splitTimelineRows,
    timelineRangeToMs,
    writeOverviewTimelineRange,
    type OverviewTimelineCardLike,
} from "./overview-timeline-model";

const NOW = new Date("2026-11-05T12:00:00").getTime();
const H = 3_600_000;

function card(blockId: string, sessionId = `s-${blockId}`): OverviewTimelineCardLike {
    return {
        blockId,
        sessionId,
        title: `session ${blockId}`,
        avatar: { kind: "emoji", emoji: "🦊" },
        providerLabel: "Claude",
        projectName: "snorkeling",
    };
}

function sessions(
    map: Record<string, { createdAt?: number; updatedAt?: number; messageCount?: number; live?: boolean }>
) {
    return map;
}

describe("formatTimelineRangeLabel / timelineRangeToMs", () => {
    it("labels hours and days", () => {
        expect(formatTimelineRangeLabel(2)).toBe("2h");
        expect(formatTimelineRangeLabel(8)).toBe("8h");
        expect(formatTimelineRangeLabel(24)).toBe("1d");
        expect(formatTimelineRangeLabel(168)).toBe("7d");
    });

    it("converts hours to ms", () => {
        expect(timelineRangeToMs(8)).toBe(8 * H);
    });
});

describe("buildTimelineRows", () => {
    it("sorts by last activity desc and drops sessions outside the window", () => {
        const rows = buildTimelineRows([card("a"), card("b"), card("old")], {
            nowMs: NOW,
            windowMs: 8 * H,
            sessions: sessions({
                "s-a": { createdAt: NOW - 2 * H, updatedAt: NOW - 10 * 60_000, messageCount: 12 },
                "s-b": { createdAt: NOW - 5 * H, updatedAt: NOW - 2 * H, messageCount: 3 },
                "s-old": { createdAt: NOW - 30 * H, updatedAt: NOW - 20 * H },
            }),
            states: { a: "working", b: "done", old: "idle" },
        });
        expect(rows.map((row) => row.blockId)).toEqual(["a", "b"]);
        expect(rows[0].state).toBe("working");
        expect(rows[0].messageCount).toBe(12);
    });

    it("marks missing createdAt as startUnknown and starts at updatedAt", () => {
        const rows = buildTimelineRows([card("a")], {
            nowMs: NOW,
            windowMs: 8 * H,
            sessions: sessions({ "s-a": { updatedAt: NOW - 2 * H } }),
            states: {},
        });
        expect(rows).toHaveLength(1);
        expect(rows[0].startUnknown).toBe(true);
        expect(rows[0].startedAt).toBe(NOW - 2 * H);
        expect(rows[0].endedAt).toBe(NOW - 2 * H);
    });

    it("extends live sessions to now", () => {
        const rows = buildTimelineRows([card("a")], {
            nowMs: NOW,
            windowMs: 8 * H,
            sessions: sessions({ "s-a": { createdAt: NOW - 3 * H, updatedAt: NOW - H, live: true } }),
            states: { a: "working" },
        });
        expect(rows[0].endedAt).toBe(NOW);
        expect(rows[0].live).toBe(true);
    });

    it("uses AgentStatus.activeSince as the start when the session summary is missing", () => {
        const rows = buildTimelineRows([card("a")], {
            nowMs: NOW,
            windowMs: 8 * H,
            sessions: sessions({ "s-a": { updatedAt: NOW } }),
            states: { a: "working" },
            activeSince: { a: NOW - 90 * 60_000 },
        });
        expect(rows[0].startedAt).toBe(NOW - 90 * 60_000);
        expect(rows[0].startUnknown).toBe(true);
    });

    it("keeps sessions without any timestamp visible (falls back to now)", () => {
        const rows = buildTimelineRows([card("a")], {
            nowMs: NOW,
            windowMs: 2 * H,
            sessions: sessions({}),
            states: {},
        });
        expect(rows).toHaveLength(1);
        expect(rows[0].startUnknown).toBe(true);
        expect(rows[0].endedAt).toBe(NOW);
    });

    it("returns nothing for empty input", () => {
        expect(buildTimelineRows([], { nowMs: NOW, windowMs: 8 * H, sessions: {}, states: {} })).toEqual([]);
    });
});

describe("buildTimelineBar", () => {
    const row = (overrides: Partial<Parameters<typeof buildTimelineBar>[0]> = {}) => ({
        blockId: "a",
        sessionId: "s-a",
        title: "session a",
        avatar: { kind: "emoji" as const, emoji: "🦊" },
        providerLabel: "Claude",
        projectName: "snorkeling",
        messageCount: 3,
        state: "working",
        startedAt: NOW - 2 * H,
        startUnknown: false,
        endedAt: NOW,
        lastActivityAt: NOW,
        live: true,
        ...overrides,
    });

    it("places a full-width window bar from 0% to 100%", () => {
        const bar = buildTimelineBar(row(), { nowMs: NOW, windowMs: 2 * H });
        expect(bar).not.toBeNull();
        expect(bar!.leftPct).toBe(0);
        expect(bar!.widthPct).toBe(100);
    });

    it("clips bars that start before the window", () => {
        // 起点在窗外、终点落在窗口中间 → 左边界裁到 0%，右边界保持 50%。
        const bar = buildTimelineBar(row({ startedAt: NOW - 10 * H, endedAt: NOW - H }), {
            nowMs: NOW,
            windowMs: 2 * H,
        });
        expect(bar!.leftPct).toBe(0);
        expect(bar!.widthPct).toBeCloseTo(50, 5);
    });

    it("drops bars that end exactly at the window start (zero width)", () => {
        expect(buildTimelineBar(row({ endedAt: NOW - 2 * H }), { nowMs: NOW, windowMs: 2 * H })).toBeNull();
    });

    it("keeps a visible tail for live work and no tail when the state is unknown", () => {
        const live = buildTimelineBar(row({ startedAt: NOW - 10 * 60_000 }), { nowMs: NOW, windowMs: 8 * H });
        expect(live!.tailPct).toBeGreaterThan(0);
        const unknown = buildTimelineBar(row({ state: null }), { nowMs: NOW, windowMs: 8 * H });
        expect(unknown!.tailPct).toBe(0);
    });

    it("keeps a minimum visible width for zero-span sessions and colours it with the state", () => {
        const bar = buildTimelineBar(row({ startedAt: NOW, endedAt: NOW, live: true }), {
            nowMs: NOW,
            windowMs: 8 * H,
        });
        expect(bar).not.toBeNull();
        expect(bar!.widthPct).toBeGreaterThan(0.5);
        expect(bar!.leftPct + bar!.widthPct).toBeLessThanOrEqual(100.0001);
        expect(bar!.tailPct).toBe(100);
        const unknown = buildTimelineBar(row({ startedAt: NOW, endedAt: NOW, state: null }), {
            nowMs: NOW,
            windowMs: 8 * H,
        });
        expect(unknown!.tailPct).toBe(0);
    });

    it("returns null when the bar ends before the window", () => {
        expect(buildTimelineBar(row({ endedAt: NOW - 5 * H }), { nowMs: NOW, windowMs: 2 * H })).toBeNull();
    });
});

describe("buildTimelineTicks", () => {
    it("spans the window with a now tick at 100%", () => {
        const ticks = buildTimelineTicks(8, NOW);
        expect(ticks).toHaveLength(9);
        expect(ticks[0].leftPct).toBe(0);
        expect(ticks[ticks.length - 1].leftPct).toBe(100);
    });

    it("uses HH:MM for short ranges and MM/DD HH:MM for long ranges", () => {
        const shortTick = buildTimelineTicks(2, NOW)[1];
        expect(shortTick.label).toMatch(/^\d{2}:\d{2}$/);
        const longTick = buildTimelineTicks(168, NOW)[1];
        expect(longTick.label).toMatch(/^\d{2}\/\d{2} \d{2}:\d{2}$/);
    });
});

describe("timeline range persistence", () => {
    function fakeStorage(initial: Record<string, string> = {}) {
        const data = { ...initial };
        return {
            data,
            getItem: (key: string) => data[key] ?? null,
            setItem: (key: string, value: string) => {
                data[key] = value;
            },
            removeItem: (key: string) => {
                delete data[key];
            },
        };
    }

    it("defaults to 8h for missing / corrupt / unimplemented ranges", () => {
        expect(OverviewTimelineRangeDefault).toBe(8);
        expect(readOverviewTimelineRange(null)).toBe(8);
        expect(readOverviewTimelineRange(fakeStorage())).toBe(8);
        expect(readOverviewTimelineRange(fakeStorage({ [OverviewTimelineRangeStorageKey]: "5" }))).toBe(8);
        expect(readOverviewTimelineRange(fakeStorage({ [OverviewTimelineRangeStorageKey]: "abc" }))).toBe(8);
    });

    it("round-trips every documented range and rejects unknown writes", () => {
        const storage = fakeStorage();
        for (const range of OverviewTimelineRanges) {
            expect(writeOverviewTimelineRange(storage, range)).toBe(range);
            expect(readOverviewTimelineRange(storage)).toBe(range);
        }
        expect(writeOverviewTimelineRange(storage, 5 as never)).toBeNull();
    });
});

describe("splitTimelineRows", () => {
    const rows = Array.from({ length: 55 }, (_, i) => ({ blockId: `b${i}` }));

    it("keeps everything when under the cap", () => {
        const split = splitTimelineRows(rows.slice(0, 10));
        expect(split.visible).toHaveLength(10);
        expect(split.hiddenCount).toBe(0);
    });

    it("caps visible rows and reports the hidden count", () => {
        const split = splitTimelineRows(rows);
        expect(split.visible).toHaveLength(OverviewTimelineMaxRows);
        expect(split.hiddenCount).toBe(55 - OverviewTimelineMaxRows);
        // 保留的都是"最新的"（rows 已按最后活动倒序）
        expect(split.visible[0].blockId).toBe("b0");
        expect(split.visible[split.visible.length - 1].blockId).toBe(`b${OverviewTimelineMaxRows - 1}`);
    });

    it("does not mutate the input and handles degenerate caps", () => {
        const original = [...rows];
        expect(splitTimelineRows(rows, 0).hiddenCount).toBe(55);
        expect(splitTimelineRows(rows, 0).visible).toHaveLength(0);
        expect(splitTimelineRows(rows, Number.NaN).hiddenCount).toBe(0);
        expect(rows).toEqual(original);
    });
});
