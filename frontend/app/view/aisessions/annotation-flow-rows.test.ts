// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 页内过滤 + 日分段头 / GapRow 插入的纯函数测试（v2 §4.2c / §3.2 / §4.1）。
//
// 两条回归底线单独锁：
//   1. all 模式（page=null / buckets 空）**返回同一引用** —— flow 与改造前逐字节等价；
//   2. 分段头只在「有批注锚定的日子」出现，且插在首个 anchorSeq ≥ 桶首条 seq 的行前
//      （与 rail gutter 标记同一对齐语义）。

import { describe, expect, it } from "vitest";
import {
    bucketHeaderAbsoluteLabel,
    bucketKindCounts,
    dateKeyOfTimestamp,
    filterTimelineItemsToPage,
    insertBucketHeaders,
    relativeOfDateKey,
    rowAnchorSeq,
} from "./annotation-flow-rows";
import type { AnnotationLike, AnnotationRailItem, TimeBucket } from "./annotation-model";
import type { SessionDetailTimelineItem } from "./utils";

function messageItem(seq: number): SessionDetailTimelineItem {
    return { kind: "message", message: { seq, role: "assistant", text: `m${seq}`, charCount: 1 } };
}

function toolItem(seq: number): SessionDetailTimelineItem {
    return { kind: "tool", toolCall: { seq, name: "bash" }, anchorSeq: seq };
}

function annotation(id: number, seq: number, kind = "note"): AnnotationLike {
    return {
        id,
        sessionKey: "sess",
        anchorKey: `seq:${seq}`,
        seq,
        kind,
        title: "",
        body: "",
        status: "accepted",
        source: "user",
    };
}

function railItem(seq: number, annotations: AnnotationLike[]): AnnotationRailItem {
    return {
        key: `rail-${seq}`,
        anchorKey: `seq:${seq}`,
        seq,
        annotations,
        hasAccepted: annotations.length > 0,
        hasDraft: false,
        hasOrphan: false,
    };
}

function bucket(dateKey: string, items: AnnotationRailItem[], gapDaysBefore = 0): TimeBucket {
    return {
        dateKey,
        label: dateKey,
        gapDaysBefore,
        count: items.length,
        items,
    };
}

const Nov11 = new Date(2026, 10, 11, 12, 0, 0).getTime();

describe("rowAnchorSeq", () => {
    it("uses the message seq for message rows and the anchor seq for tool rows", () => {
        expect(rowAnchorSeq(messageItem(7))).toBe(7);
        expect(rowAnchorSeq(toolItem(9))).toBe(9);
    });
});

describe("filterTimelineItemsToPage", () => {
    const items = [messageItem(1), toolItem(2), messageItem(3), toolItem(4), messageItem(5)];

    it("returns the SAME reference for the all mode (page = null)", () => {
        // all 模式逐字节等价现状：不是「等值」，是同一个数组引用。
        expect(filterTimelineItemsToPage(items, null)).toBe(items);
        expect(filterTimelineItemsToPage(items, undefined)).toBe(items);
    });

    it("keeps only the rows inside the page seq range (tool rows use anchorSeq)", () => {
        const filtered = filterTimelineItemsToPage(items, { startSeq: 2, endSeq: 3 });
        expect(filtered).toHaveLength(2);
        expect(filtered[0]).toBe(items[1]); // tool@2（区间边界包含）
        expect(filtered[1]).toBe(items[2]); // message@3
    });

    it("keeps live-turn rows (seq >= alwaysIncludeFromSeq) even when outside the page", () => {
        const live: SessionDetailTimelineItem = {
            kind: "message",
            message: { seq: 10_000_001, role: "assistant", text: "streaming", charCount: 9 },
        };
        const filtered = filterTimelineItemsToPage([...items, live], { startSeq: 1, endSeq: 1 }, {
            alwaysIncludeFromSeq: 10_000_000,
        });
        expect(filtered).toHaveLength(2);
        expect(filtered[1]).toBe(live);
    });

    it("returns an empty array when the range misses every row", () => {
        expect(filterTimelineItemsToPage(items, { startSeq: 100, endSeq: 200 })).toHaveLength(0);
    });
});

describe("insertBucketHeaders", () => {
    const rows = [messageItem(1), messageItem(2), toolItem(3), messageItem(4), messageItem(5)];

    it("returns the SAME reference when there is no window data (empty / loading)", () => {
        expect(insertBucketHeaders(rows, [])).toBe(rows);
    });

    it("inserts a header before the first row whose anchorSeq >= bucket first seq", () => {
        const flow = insertBucketHeaders(rows, [bucket("2026-11-11", [railItem(4, [annotation(1, 4)])])], {
            now: Nov11,
        });
        // 5 行 + 1 个分段头
        expect(flow).toHaveLength(6);
        const headerIdx = flow.findIndex((row) => row.kind === "bucketHeader");
        expect(headerIdx).toBe(3); // #1 #2 tool#3 [header] #4 ...
        const header = flow[headerIdx];
        if (header.kind !== "bucketHeader") throw new Error("expected bucketHeader");
        expect(header.dateKey).toBe("2026-11-11");
        expect(header.relative).toBe("today");
        expect(header.count).toBe(1);
        expect(header.kindCounts).toEqual([{ kind: "note", count: 1 }]);
    });

    it("keeps row order and never mutates the input array", () => {
        const flow = insertBucketHeaders(rows, [bucket("2026-11-11", [railItem(2, [annotation(1, 2)])])], {
            now: Nov11,
        });
        const rowSeq = flow.map((row) => (row.kind === "gapRow" || row.kind === "bucketHeader" ? null : rowAnchorSeq(row)));
        expect(rowSeq.filter((seq): seq is number => seq != null)).toEqual([1, 2, 3, 4, 5]);
        expect(rows).toHaveLength(5);
    });

    it("emits a gap row between two visible headers (calendar days, not 24h arithmetic)", () => {
        const flow = insertBucketHeaders(
            rows,
            [
                bucket("2026-11-10", [railItem(1, [annotation(1, 1)])]),
                bucket("2026-11-13", [railItem(5, [annotation(2, 5)])]),
            ],
            { now: Nov11 }
        );
        const gapIndexes = flow.flatMap((row, index) => (row.kind === "gapRow" ? [index] : []));
        expect(gapIndexes).toHaveLength(1);
        const gap = flow[gapIndexes[0]];
        if (gap.kind !== "gapRow") throw new Error("expected gapRow");
        // 11-10 → 11-13 中间跳过 11-11 / 11-12 两天
        expect(gap.gapDays).toBe(2);
        // 第一个可见头之前不画 GapRow
        expect(flow[0].kind).toBe("bucketHeader");
    });

    it("scopes counts to the current page and drops buckets with no scoped items", () => {
        const scopeSeqs = new Set([5]);
        const flow = insertBucketHeaders(
            rows,
            [
                bucket("2026-11-10", [railItem(1, [annotation(1, 1), annotation(2, 1)])]),
                bucket("2026-11-11", [railItem(5, [annotation(3, 5)])]),
            ],
            { scopeSeqs, now: Nov11 }
        );
        const headers = flow.filter((row) => row.kind === "bucketHeader");
        expect(headers).toHaveLength(1);
        const header = headers[0];
        if (header.kind !== "bucketHeader") throw new Error("expected bucketHeader");
        expect(header.dateKey).toBe("2026-11-11");
        expect(header.count).toBe(1);
        // 首桶被作用域滤掉 → 11-11 前不出现「跳过 N 天」
        expect(flow.some((row) => row.kind === "gapRow")).toBe(false);
    });

    it("skips buckets whose anchors are all unresolved (seq = 0 drafts)", () => {
        const flow = insertBucketHeaders(rows, [bucket("unknown", [railItem(0, [annotation(1, 0)])])]);
        expect(flow).toBe(rows);
    });

    it("skips buckets whose first anchor seq is past the last rendered row", () => {
        const flow = insertBucketHeaders(rows, [bucket("2026-11-11", [railItem(99, [annotation(1, 99)])])], {
            now: Nov11,
        });
        expect(flow).toBe(rows);
    });

    it("orders headers by anchor seq even when bucket timestamps are out of order", () => {
        const flow = insertBucketHeaders(
            rows,
            [
                bucket("2026-11-09", [railItem(4, [annotation(1, 4)])]),
                bucket("2026-11-08", [railItem(2, [annotation(2, 2)])]),
            ],
            { now: Nov11 }
        );
        const headerSeqs = flow.flatMap((row, index) =>
            row.kind === "bucketHeader"
                ? [{ index, dateKey: row.dateKey }]
                : []
        );
        expect(headerSeqs.map((entry) => entry.dateKey)).toEqual(["2026-11-08", "2026-11-09"]);
        expect(headerSeqs[0].index).toBeLessThan(headerSeqs[1].index);
    });

    it("marks unknown-day buckets as unknown and keeps them after dated ones", () => {
        const flow = insertBucketHeaders(
            rows,
            [
                bucket("2026-11-11", [railItem(2, [annotation(1, 2)])]),
                bucket("unknown", [railItem(5, [annotation(2, 5)])]),
            ],
            { now: Nov11 }
        );
        const headers = flow.filter((row) => row.kind === "bucketHeader");
        expect(headers).toHaveLength(2);
        const last = headers[1];
        if (last.kind !== "bucketHeader") throw new Error("expected bucketHeader");
        expect(last.dateKey).toBe("unknown");
        expect(last.relative).toBe(null);
    });
});

describe("bucketKindCounts", () => {
    it("orders kinds by the metadata table and drops zero counts", () => {
        const counts = bucketKindCounts([
            railItem(3, [annotation(1, 3, "question"), annotation(2, 3, "node")]),
            railItem(4, [annotation(3, 4, "milestone"), annotation(4, 4, "question")]),
        ]);
        expect(counts).toEqual([
            { kind: "milestone", count: 1 },
            { kind: "question", count: 2 },
            { kind: "node", count: 1 },
        ]);
    });

    it("keeps unknown kinds last instead of dropping them", () => {
        const counts = bucketKindCounts([railItem(1, [annotation(1, 1, "weird-kind")])]);
        expect(counts).toEqual([{ kind: "weird-kind", count: 1 }]);
    });
});

describe("date helpers", () => {
    it("maps local calendar days to today / yesterday / null", () => {
        expect(relativeOfDateKey("2026-11-11", Nov11)).toBe("today");
        expect(relativeOfDateKey("2026-11-10", Nov11)).toBe("yesterday");
        expect(relativeOfDateKey("2026-11-09", Nov11)).toBe(null);
        expect(relativeOfDateKey("unknown", Nov11)).toBe(null);
    });

    it("computes today across a month boundary (calendar construction, not -86400000)", () => {
        // 2026-12-01 的「昨天」是 11-30
        const dec1 = new Date(2026, 11, 1, 9, 0, 0).getTime();
        expect(relativeOfDateKey("2026-11-30", dec1)).toBe("yesterday");
    });

    it("dateKeyOfTimestamp reads the local calendar day", () => {
        expect(dateKeyOfTimestamp(Nov11)).toBe("2026-11-11");
    });

    it("bucketHeaderAbsoluteLabel uses the shared compact format (same year omits the year)", () => {
        expect(bucketHeaderAbsoluteLabel("2026-11-11", Nov11)).toBe("11-11");
        const nextYear = new Date(2027, 0, 2, 9, 0, 0).getTime();
        expect(bucketHeaderAbsoluteLabel("2027-01-02", nextYear)).toBe("01-02");
    });
});
