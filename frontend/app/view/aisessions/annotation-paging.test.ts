// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 分页模式纯函数的单测（design/plans/aisessions-annotation-timeline-v2.md §4.2c / §4.2c-1）：
// computePages 五模式（all/day/turn/interval/count）、页 id 稳定、count 尾锚定 prepend 不变、
// autoPageMode 默认规则、scopeSeqs / pageIndexOfSeq / clampPageIndex / pageLabel 结构化字段。

import { describe, expect, it } from "vitest";
import {
    AutoPageModeThreshold,
    UnknownBucketKey,
    autoPageMode,
    clampPageIndex,
    computePages,
    pageIndexOfSeq,
    pageLabel,
    scopeSeqs,
    type PagingRow,
} from "./annotation-model";

/** 本地时区的某个时刻（ms）。day 页日界线在本地日历日上切（对齐 §3.2 桶）。 */
function at(year: number, month: number, day: number, hour = 0, minute = 0): number {
    return new Date(year, month, day, hour, minute).getTime();
}

/** rows(1, 2) → assistant 行；rows([1, "user"], 2) → 指定 role。 */
function rows(...entries: Array<number | [seq: number, role: string]>): PagingRow[] {
    return entries.map((entry) =>
        typeof entry === "number" ? { seq: entry, role: "assistant" } : { seq: entry[0], role: entry[1] }
    );
}

/** tsOf 注入：seq → 时间戳（缺省 undefined = 缺锚点时间）。 */
function tsOfOf(map: Record<number, number | undefined>): (seq: number) => number | undefined {
    return (seq) => map[seq];
}

describe("computePages · all", () => {
    it("empty input produces no pages", () => {
        expect(computePages([], () => undefined, { mode: "all" })).toEqual([]);
    });

    it("single row becomes one all page with accurate bounds", () => {
        const pages = computePages(rows(7), () => undefined, { mode: "all" });
        expect(pages).toHaveLength(1);
        expect(pages[0].id).toBe("all");
        expect(pages[0].mode).toBe("all");
        expect(pages[0].startSeq).toBe(7);
        expect(pages[0].endSeq).toBe(7);
        expect(pages[0].messageCount).toBe(1);
        expect(pages[0].seqs).toEqual([7]);
    });

    it("keeps every message in one page regardless of timestamps or roles", () => {
        const input = rows([1, "user"], 2, [3, "user"]);
        const pages = computePages(input, tsOfOf({ 1: at(2026, 10, 9), 3: at(2026, 10, 11) }), { mode: "all" });
        expect(pages).toHaveLength(1);
        expect(pages[0].seqs).toEqual([1, 2, 3]);
        expect(pages[0].dateKey).toBeNull();
        expect(pages[0].windowStartTs).toBeNull();
        expect(pages[0].turnStartSeq).toBeNull();
    });
});

describe("computePages · day", () => {
    it("splits across a local-midnight boundary and orders pages old → new", () => {
        const input = rows(1, 2);
        const ts = tsOfOf({ 1: at(2026, 10, 10, 23, 50), 2: at(2026, 10, 11, 0, 10) });
        const pages = computePages(input, ts, { mode: "day" });
        expect(pages.map((page) => page.id)).toEqual(["d:2026-11-10", "d:2026-11-11"]);
        expect(pages[0].seqs).toEqual([1]);
        expect(pages[1].seqs).toEqual([2]);
        expect(pages[0].dateKey).toBe("2026-11-10");
    });

    it("messages in the same calendar day share one page with accurate counts", () => {
        const input = rows(1, 2, 3);
        const ts = tsOfOf({ 1: at(2026, 10, 11, 8, 0), 2: at(2026, 10, 11, 12, 0), 3: at(2026, 10, 11, 23, 0) });
        const pages = computePages(input, ts, { mode: "day" });
        expect(pages).toHaveLength(1);
        expect(pages[0].id).toBe("d:2026-11-11");
        expect(pages[0].startSeq).toBe(1);
        expect(pages[0].endSeq).toBe(3);
        expect(pages[0].messageCount).toBe(3);
    });

    it("rows without an anchor timestamp go to a trailing unknown page, never dropped", () => {
        const input = rows(1, 2, 3);
        const ts = tsOfOf({ 1: at(2026, 10, 11), 3: at(2026, 10, 11) }); // seq 2 缺时间
        const pages = computePages(input, ts, { mode: "day" });
        expect(pages.map((page) => page.id)).toEqual(["d:2026-11-11", `d:${UnknownBucketKey}`]);
        expect(pages[1].seqs).toEqual([2]);
        expect(pages[1].dateKey).toBe(UnknownBucketKey);
    });

    it("normalizes second-granularity timestamps like buildTimeBuckets", () => {
        const ts = tsOfOf({ 1: at(2026, 10, 11, 9, 0) / 1000 });
        const pages = computePages(rows(1), ts, { mode: "day" });
        expect(pages[0].id).toBe("d:2026-11-11");
    });

    it("sorts rows by seq first (pure function does not trust caller order)", () => {
        const input = rows(3, 1);
        const ts = tsOfOf({ 1: at(2026, 10, 11), 3: at(2026, 10, 9) });
        const pages = computePages(input, ts, { mode: "day" });
        // 页序按日历日（旧 → 新），页内 seq 升序
        expect(pages.map((page) => page.id)).toEqual(["d:2026-11-09", "d:2026-11-11"]);
        expect(pages[1].seqs).toEqual([1]);
    });
});

describe("computePages · turn", () => {
    it("a user message starts a turn that lasts until the next user message", () => {
        const input = rows([1, "user"], 2, 3, [4, "user"], 5);
        const pages = computePages(input, () => undefined, { mode: "turn" });
        expect(pages.map((page) => page.id)).toEqual(["t:1", "t:4"]);
        expect(pages[0].seqs).toEqual([1, 2, 3]);
        expect(pages[1].seqs).toEqual([4, 5]);
        expect(pages[0].turnStartSeq).toBe(1);
        expect(pages[1].turnStartSeq).toBe(4);
        expect(pages[1].startSeq).toBe(4);
        expect(pages[1].endSeq).toBe(5);
    });

    it("rows before the first user message form their own leading page", () => {
        const input = rows(1, 2, [3, "user"], 4);
        const pages = computePages(input, () => undefined, { mode: "turn" });
        expect(pages.map((page) => page.id)).toEqual(["t:1", "t:3"]);
        expect(pages[0].seqs).toEqual([1, 2]);
        expect(pages[0].turnStartSeq).toBe(1); // 引导页取页首条 seq，保证 id 唯一稳定
        expect(pages[1].seqs).toEqual([3, 4]);
    });

    it("a single user message is one complete page", () => {
        const pages = computePages(rows([1, "user"]), () => undefined, { mode: "turn" });
        expect(pages).toHaveLength(1);
        expect(pages[0].id).toBe("t:1");
        expect(pages[0].messageCount).toBe(1);
    });
});

describe("computePages · interval", () => {
    it("a window boundary timestamp belongs to the window it opens", () => {
        const windowMs = 6 * 3_600_000;
        const before = at(2026, 10, 11, 8, 30);
        const windowStart = Math.floor(before / windowMs) * windowMs;
        const boundary = windowStart + windowMs; // 下一个窗口起点；整除 ts 属于新窗口（floor 语义）
        const input = rows(1, 2);
        const pages = computePages(input, tsOfOf({ 1: before, 2: boundary }), { mode: "interval", intervalHours: 6 });
        expect(pages.map((page) => page.id)).toEqual([`i:${windowStart}`, `i:${boundary}`]);
        expect(pages[0].windowStartTs).toBe(windowStart);
        expect(pages[1].windowStartTs).toBe(boundary);
        expect(pages[1].seqs).toEqual([2]);
    });

    it("timestamps inside the same window share one page", () => {
        const windowMs = 6 * 3_600_000;
        const start = Math.floor(at(2026, 10, 11, 3, 0) / windowMs) * windowMs;
        const input = rows(1, 2);
        const pages = computePages(
            input,
            tsOfOf({ 1: start + 1000, 2: start + windowMs - 1 }),
            { mode: "interval", intervalHours: 6 }
        );
        expect(pages).toHaveLength(1);
        expect(pages[0].windowStartTs).toBe(start);
        expect(pages[0].messageCount).toBe(2);
    });

    it("defaults to a 24h window when intervalHours is omitted", () => {
        const ts = at(2026, 10, 11, 12, 0);
        const pages = computePages(rows(1), tsOfOf({ 1: ts }), { mode: "interval" });
        expect(pages).toHaveLength(1);
        expect(pages[0].windowStartTs).toBe(Math.floor(ts / (24 * 3_600_000)) * 24 * 3_600_000);
    });

    it("rows without timestamps land in a trailing unknown page", () => {
        const input = rows(1, 2);
        const pages = computePages(input, tsOfOf({ 1: at(2026, 10, 11) }), { mode: "interval", intervalHours: 1 });
        expect(pages.map((page) => page.id)).toEqual([`i:${at(2026, 10, 11)}`, `i:${UnknownBucketKey}`]);
        expect(pages[1].windowStartTs).toBeNull();
        expect(pages[1].seqs).toEqual([2]);
    });
});

describe("computePages · count", () => {
    it("chunks of exactly countSize, tail-anchored from the newest end", () => {
        const input = rows(...Array.from({ length: 40 }, (_, index) => index + 1));
        const pages = computePages(input, () => undefined, { mode: "count", countSize: 20 });
        expect(pages).toHaveLength(2);
        expect(pages[0].id).toBe("c:1");
        expect(pages[0].seqs).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
        expect(pages[1].id).toBe("c:21");
        expect(pages[1].seqs).toEqual(Array.from({ length: 20 }, (_, index) => index + 21));
        expect(pages[1].messageCount).toBe(20);
    });

    it("the oldest chunk is partial and keeps its own page", () => {
        const input = rows(...Array.from({ length: 27 }, (_, index) => index + 1));
        const pages = computePages(input, () => undefined, { mode: "count", countSize: 20 });
        expect(pages.map((page) => page.id)).toEqual(["c:1", "c:8"]);
        expect(pages[0].messageCount).toBe(7);
        expect(pages[1].messageCount).toBe(20);
    });

    it("prepending older rows leaves the newest page members and id unchanged", () => {
        const original = rows(...Array.from({ length: 27 }, (_, index) => 100 + index)); // seq 100..126
        const before = computePages(original, () => undefined, { mode: "count", countSize: 20 });
        const prepended = rows(...Array.from({ length: 30 }, (_, index) => 70 + index)).concat(original); // 70..99
        const after = computePages(prepended, () => undefined, { mode: "count", countSize: 20 });
        // 尾锚定：从最新端数起的整页（id = 页首条 seq）成员不变；更早内容只在前面新增页
        expect(after.length).toBe(before.length + 1);
        const beforeNewest = before[before.length - 1];
        const afterNewest = after[after.length - 1];
        expect(afterNewest.id).toBe(beforeNewest.id);
        expect(afterNewest.seqs).toEqual(beforeNewest.seqs);
        // 已知取舍：最旧端的半页会吸收 prepend 的行（id 随页首条变化），不在此断言原位不变。
    });

    it("already-full pages keep their ids and members when older content is prepended", () => {
        const original = rows(...Array.from({ length: 40 }, (_, index) => 100 + index)); // seq 100..139
        const before = computePages(original, () => undefined, { mode: "count", countSize: 20 });
        const prepended = rows(...Array.from({ length: 20 }, (_, index) => 80 + index)).concat(original); // 80..99
        const after = computePages(prepended, () => undefined, { mode: "count", countSize: 20 });
        expect(after.map((page) => page.id)).toEqual(["c:80", "c:100", "c:120"]);
        expect(after.slice(1).map((page) => page.id)).toEqual(before.map((page) => page.id));
        expect(after.slice(1).map((page) => page.seqs)).toEqual(before.map((page) => page.seqs));
    });
});

describe("computePages · 页 id 稳定性", () => {
    it("the same input (in any order) always yields the same page ids and members", () => {
        const input = rows([1, "user"], 2, [3, "user"], 4);
        const ts = tsOfOf({ 1: at(2026, 10, 9, 10, 0), 2: at(2026, 10, 9, 11, 0), 3: at(2026, 10, 11, 9, 0), 4: at(2026, 10, 11, 10, 0) });
        for (const mode of ["all", "day", "turn", "interval", "count"] as const) {
            const first = computePages(input, ts, { mode, countSize: 2, intervalHours: 6 });
            const second = computePages([...input].reverse(), ts, { mode, countSize: 2, intervalHours: 6 });
            expect(second.map((page) => page.id)).toEqual(first.map((page) => page.id));
            expect(second.map((page) => page.seqs)).toEqual(first.map((page) => page.seqs));
        }
    });
});

describe("autoPageMode", () => {
    it("small sessions default to all", () => {
        expect(autoPageMode(0, false, "all")).toBe("all");
        expect(autoPageMode(AutoPageModeThreshold, false, "day")).toBe("all");
    });

    it("large sessions default to day", () => {
        expect(autoPageMode(AutoPageModeThreshold + 1, false, "all")).toBe("day");
        expect(autoPageMode(10_000, false, "all")).toBe("day");
    });

    it("never overrides a user-picked mode", () => {
        expect(autoPageMode(10_000, true, "turn")).toBe("turn");
        expect(autoPageMode(10, true, "count")).toBe("count");
    });
});

describe("scopeSeqs", () => {
    it("returns the current page seq set", () => {
        const pages = computePages(rows([1, "user"], 2, [3, "user"]), () => undefined, { mode: "turn" });
        expect(scopeSeqs(pages[1])).toEqual(new Set([3]));
    });

    it("returns an empty set for a missing page", () => {
        expect(scopeSeqs(null)).toEqual(new Set());
        expect(scopeSeqs(undefined)).toEqual(new Set());
    });
});

describe("pageIndexOfSeq", () => {
    it("finds the page containing the seq", () => {
        const input = rows([1, "user"], 2, [3, "user"], 4);
        const pages = computePages(input, () => undefined, { mode: "turn" });
        expect(pageIndexOfSeq(pages, 2)).toBe(0);
        expect(pageIndexOfSeq(pages, 4)).toBe(1);
    });

    it("returns -1 for a seq that no page contains (even inside start/end bounds)", () => {
        // 页内 seq 有洞（被过滤的消息）：startSeq=1、endSeq=5，但 3 不在页里
        const pages = computePages(rows(1, 2, 5), () => undefined, { mode: "all" });
        expect(pages[0].startSeq).toBe(1);
        expect(pages[0].endSeq).toBe(5);
        expect(pageIndexOfSeq(pages, 3)).toBe(-1);
        expect(pageIndexOfSeq(pages, 99)).toBe(-1);
        expect(pageIndexOfSeq([], 1)).toBe(-1);
    });
});

describe("clampPageIndex", () => {
    it("clamps into [0, pageCount-1]", () => {
        expect(clampPageIndex(-1, 3)).toBe(0);
        expect(clampPageIndex(5, 3)).toBe(2);
        expect(clampPageIndex(1, 3)).toBe(1);
    });

    it("returns -1 when there are no pages and falls back to 0 for NaN", () => {
        expect(clampPageIndex(0, 0)).toBe(-1);
        expect(clampPageIndex(NaN, 3)).toBe(0);
    });
});

describe("pageLabel", () => {
    const now = at(2026, 11, 1, 15, 0); // 2026-12-01

    it("marks today/yesterday for day pages relative to opts.now", () => {
        const today = computePages(rows(1), tsOfOf({ 1: at(2026, 11, 1, 9, 0) }), { mode: "day" })[0];
        const yesterday = computePages(rows(1), tsOfOf({ 1: at(2026, 10, 30, 9, 0) }), { mode: "day" })[0]; // 11-30
        expect(pageLabel(today, { now, index: 1, total: 2 }).relative).toBe("today");
        const yesterdayLabel = pageLabel(yesterday, { now, index: 1, total: 2 });
        expect(yesterdayLabel.relative).toBe("yesterday");
        expect(yesterdayLabel.dateKey).toBe("2026-11-30");
        expect(yesterdayLabel.messageCount).toBe(1);
        expect(yesterdayLabel.index).toBe(1);
        expect(yesterdayLabel.total).toBe(2);
    });

    it("keeps structured absolute-day data (no final string is composed here)", () => {
        const older = computePages(rows(1), tsOfOf({ 1: at(2026, 10, 6, 9, 0) }), { mode: "day" })[0];
        const label = pageLabel(older, { now, index: 2, total: 3 });
        expect(label.relative).toBeNull();
        expect(label.dateKey).toBe("2026-11-06");
    });

    it("returns null index/total for the all page (no pager bar)", () => {
        const page = computePages(rows(1, 2), () => undefined, { mode: "all" })[0];
        const label = pageLabel(page, { index: 1, total: 1 });
        expect(label.mode).toBe("all");
        expect(label.index).toBeNull();
        expect(label.total).toBeNull();
    });

    it("passes through mode-specific fields for interval and turn pages", () => {
        const intervalPage = computePages(rows(1), tsOfOf({ 1: at(2026, 10, 11, 9, 0) }), {
            mode: "interval",
            intervalHours: 6,
        })[0];
        const intervalLabel = pageLabel(intervalPage, { index: 1, total: 2 });
        expect(intervalLabel.windowStartTs).toBe(intervalPage.windowStartTs);
        expect(intervalLabel.dateKey).toBeNull();

        const turnPage = computePages(rows([1, "user"], 2), () => undefined, { mode: "turn" })[0];
        const turnLabel = pageLabel(turnPage, { index: 1, total: 2 });
        expect(turnLabel.turnStartSeq).toBe(1);
        expect(turnLabel.messageCount).toBe(2);
        expect(turnLabel.windowStartTs).toBeNull();
    });
});
