// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { initI18n } from "@/i18n/config";
import { beforeEach, describe, expect, it } from "vitest";
import {
    AnnotationKindMetaTable,
    UnknownBucketKey,
    anchorHash,
    annotationCountBySeq,
    annotationKindMeta,
    annotationsForSeq,
    bucketOf,
    buildAnnotationAnchors,
    buildRailItems,
    buildTimeBuckets,
    clusterRailItems,
    messageAnchorKey,
    seqFromSyntheticAnchorKey,
    type AnnotationLike,
    type AnnotationRailItem,
} from "./annotation-model";

function annotation(overrides: Partial<AnnotationLike> & { id: number; seq: number }): AnnotationLike {
    return {
        sessionKey: "s1",
        anchorKey: `e${overrides.seq}:m0`,
        kind: "note",
        title: "",
        body: "",
        status: "accepted",
        source: "user",
        ...overrides,
    };
}

describe("annotation-model", () => {
    it("groups by node, drops nodes without annotations, keeps order", () => {
        const items = buildRailItems([
            annotation({ id: 2, seq: 5 }),
            annotation({ id: 1, seq: 2 }),
            annotation({ id: 3, seq: 5, status: "draft" }),
        ]);
        expect(items.map((item) => item.seq)).toEqual([2, 5]);
        expect(items[1].annotations).toHaveLength(2);
        expect(items[1].hasDraft).toBe(true);
        expect(items[1].hasAccepted).toBe(true);
    });

    it("merges multiple annotations on the same node", () => {
        const items = buildRailItems([annotation({ id: 1, seq: 2 }), annotation({ id: 2, seq: 2, orphaned: true })]);
        expect(items).toHaveLength(1);
        expect(items[0].hasOrphan).toBe(true);
    });

    it("clusters above the slot limit and keeps chronological order", () => {
        const items = buildRailItems(
            Array.from({ length: 100 }, (_, index) => annotation({ id: index + 1, seq: index + 1 }))
        );
        const clusters = clusterRailItems(items, 40);
        expect(clusters).toHaveLength(40);
        expect(clusters[0].items[0].seq).toBe(1);
        expect(clusters[clusters.length - 1].items.at(-1)!.seq).toBe(100);
        // Every item belongs to exactly one cluster.
        const flattened = clusters.flatMap((cluster) => cluster.items);
        expect(flattened).toHaveLength(100);
    });

    it("returns one cluster per item under the limit", () => {
        const items = buildRailItems([annotation({ id: 1, seq: 1 }), annotation({ id: 2, seq: 2 })]);
        const clusters = clusterRailItems(items, 40);
        expect(clusters).toHaveLength(2);
        expect(clusters[0].items).toHaveLength(1);
    });

    it("counts and looks up annotations per seq", () => {
        const list = [annotation({ id: 1, seq: 3 }), annotation({ id: 2, seq: 3 }), annotation({ id: 3, seq: 7 })];
        expect(annotationsForSeq(list, 3)).toHaveLength(2);
        const counts = annotationCountBySeq(list);
        expect(counts.get(3)).toBe(2);
        expect(counts.get(7)).toBe(1);
        expect(counts.get(4)).toBeUndefined();
    });

    it("anchorHash normalizes whitespace and is stable", () => {
        expect(anchorHash("hello   world\n\nsecond")).toBe(anchorHash("  hello world second "));
        expect(anchorHash("   ")).toBe("0");
        expect(anchorHash("")).toBe("0");
        expect(anchorHash("a")).not.toBe(anchorHash("b"));
    });

    it("builds anchors from messages and tool calls", () => {
        const anchors = buildAnnotationAnchors(
            [
                { itemKey: "e1:m0", seq: 1, role: "user", text: "hi" },
                // provider 为工具行产出的锚点消息（seq 才是时间线真实行号）
                { itemKey: "e1:t0", seq: 2, role: "tool", text: "bash ls" },
            ],
            [{ itemKey: "e1:t0", seq: 1, name: "bash", summary: "ls" }]
        );
        expect(anchors).toHaveLength(2);
        expect(anchors[1].role).toBe("tool");
        expect(anchors[0].hash).toBe(anchorHash("hi"));
    });

    it("tool anchors reuse the mirroring message seq, never ToolCall.seq", () => {
        // ToolCall.seq 只是单次加载内的顺序计数；拿它当行号会把跳转带到无关消息上。
        const anchors = buildAnnotationAnchors(
            [
                { itemKey: "e1:m0", seq: 1, role: "user", text: "hi" },
                { itemKey: "e1:t0", seq: 7, role: "tool", text: "bash ls" },
            ],
            [{ itemKey: "e1:t0", seq: 1, name: "bash", summary: "ls" }]
        );
        const toolAnchors = anchors.filter((anchor) => anchor.anchorKey === "e1:t0");
        expect(toolAnchors).toHaveLength(1);
        expect(toolAnchors[0].seq).toBe(7);
    });

    it("drops tool anchors without a mirroring message", () => {
        const anchors = buildAnnotationAnchors(
            [{ itemKey: "e1:m0", seq: 1, role: "user", text: "hi" }],
            [{ itemKey: "e1:t9", seq: 3, name: "bash", summary: "ls" }]
        );
        expect(anchors.map((anchor) => anchor.anchorKey)).toEqual(["e1:m0"]);
    });
});

describe("messageAnchorKey", () => {
    it("uses the provider ItemKey when present", () => {
        expect(messageAnchorKey({ itemKey: "e1:m0", seq: 12 })).toBe("e1:m0");
    });

    it("falls back to a stable synthetic key when the cache lost the ItemKey", () => {
        // 缓存消息 (ai_session_messages) 没有 item_key 列 -> 手动加批注的入口不能消失
        expect(messageAnchorKey({ seq: 12 })).toBe("seq:12");
        expect(messageAnchorKey({ itemKey: "   ", seq: 7 })).toBe("seq:7");
    });

    it("seqFromSyntheticAnchorKey round-trips", () => {
        expect(seqFromSyntheticAnchorKey("seq:12")).toBe(12);
        expect(seqFromSyntheticAnchorKey("e1:m0")).toBeNull();
        expect(seqFromSyntheticAnchorKey(undefined)).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// 时间桶（design/plans/aisessions-annotation-timeline-v2.md §3.2）
// ---------------------------------------------------------------------------

function railItem(seq: number, anchorKey?: string): AnnotationRailItem {
    // buildRailItems 的产物就是 buildTimeBuckets 的输入；这里直接构造，避免每个用例都绕一遍分组。
    const key = anchorKey ?? `e${seq}:m0`;
    return {
        key: `${key}|${seq}`,
        anchorKey: key,
        seq,
        annotations: [
            {
                id: seq,
                sessionKey: "s1",
                anchorKey: key,
                seq,
                kind: "note",
                title: "",
                body: "",
                status: "accepted",
                source: "user",
            },
        ],
        hasAccepted: true,
        hasDraft: false,
        hasOrphan: false,
    };
}

/** 本地日历构造时间戳（日界线语义与实现同源：new Date(y, m, d, ...)）。 */
function at(year: number, monthIndex: number, day: number, hour = 12, minute = 0): number {
    return new Date(year, monthIndex, day, hour, minute).getTime();
}

beforeEach(async () => {
    // 默认桶 label 走 i18n key；先初始化到英文，断言用英文文案。
    await initI18n("en");
});

describe("buildTimeBuckets", () => {
    it("single annotation: one bucket, gapDaysBefore 0", () => {
        const buckets = buildTimeBuckets([railItem(3)], () => at(2026, 10, 11));
        expect(buckets).toHaveLength(1);
        expect(buckets[0].dateKey).toBe("2026-11-11");
        expect(buckets[0].gapDaysBefore).toBe(0);
        expect(buckets[0].count).toBe(1);
        expect(buckets[0].label).toBe("11-11");
    });

    it("splits buckets at local calendar midnight", () => {
        const tsBySeq = new Map<number, number>([
            [1, at(2026, 10, 11, 23, 30)],
            [2, at(2026, 10, 12, 0, 30)],
        ]);
        const buckets = buildTimeBuckets([railItem(1), railItem(2)], (seq) => tsBySeq.get(seq));
        expect(buckets.map((bucket) => bucket.dateKey)).toEqual(["2026-11-11", "2026-11-12"]);
        // 相邻日：没跳过任何天
        expect(buckets[1].gapDaysBefore).toBe(0);
    });

    it("empty days are not generated, only counted in gapDaysBefore", () => {
        // 11-03 与 11-06 两个桶：跳过 11-04 / 11-05 = 2 天
        const tsBySeq = new Map<number, number>([
            [1, at(2026, 10, 3)],
            [2, at(2026, 10, 6)],
        ]);
        const buckets = buildTimeBuckets([railItem(1), railItem(2)], (seq) => tsBySeq.get(seq));
        expect(buckets.map((bucket) => bucket.dateKey)).toEqual(["2026-11-03", "2026-11-06"]);
        expect(buckets[1].gapDaysBefore).toBe(2);
        // 首桶无更早邻居
        expect(buckets[0].gapDaysBefore).toBe(0);
    });

    it("DST spring-forward (US East 2026-03-08): calendar day wins over ms arithmetic", () => {
        // 美东区 2026-03-08 02:00 EST → 03:00 EDT，当天只有 23 小时。
        // 两个锚点：03-07 23:00 与 03-09 00:30（墙钟差 25.5h，毫秒算术 floor(25.5h/24h)=1 天）：
        // 按本地日历是差 2 天（跳过 03-08），gap 必须是 1 而不是 0。
        // 非夏令时时区里这个用例同样成立（日历差 2 天、墙钟差 25.5h 不变），
        // 所以它是一个「禁止 ts/86400000 反推日界线」的恒定回归闸。
        const tsBySeq = new Map<number, number>([
            [1, at(2026, 2, 7, 23, 0)],
            [2, at(2026, 2, 9, 0, 30)],
        ]);
        const buckets = buildTimeBuckets([railItem(1), railItem(2)], (seq) => tsBySeq.get(seq));
        expect(buckets.map((bucket) => bucket.dateKey)).toEqual(["2026-03-07", "2026-03-09"]);
        expect(buckets[1].gapDaysBefore).toBe(1);
    });

    it("DST spring-forward: 1 wall-clock hour across the 2→3 AM jump stays in the same day", () => {
        // 美东区 03-08 01:30（跳变前）与 03:30（跳变后）只差 1 个墙钟小时（UTC 差 1h？不，跳变前 EST=UTC-5、
        // 跳变后 EDT=UTC-4，01:30 EST=06:30Z、03:30 EDT=07:30Z，恰好 1h）——但都是同一个本地日历日。
        const tsBySeq = new Map<number, number>([
            [1, at(2026, 2, 8, 1, 30)],
            [2, at(2026, 2, 8, 3, 30)],
        ]);
        const buckets = buildTimeBuckets([railItem(1), railItem(2)], (seq) => tsBySeq.get(seq));
        expect(buckets).toHaveLength(1);
        expect(buckets[0].dateKey).toBe("2026-03-08");
    });

    it("DST fall-back (US East 2026-11-01): 25h day still counts as one calendar day", () => {
        // 美东区 2026-11-01 02:00 EDT → 01:00 EST，当天有 25 小时：
        // 11-01 00:30（EDT）与 11-01 23:30（EST）墙钟差 23h —— 仍同属一个日历日。
        const tsBySeq = new Map<number, number>([
            [1, at(2026, 10, 1, 0, 30)],
            [2, at(2026, 10, 1, 23, 30)],
        ]);
        const buckets = buildTimeBuckets([railItem(1), railItem(2)], (seq) => tsBySeq.get(seq));
        expect(buckets).toHaveLength(1);
        expect(buckets[0].dateKey).toBe("2026-11-01");
    });

    it("DST fall-back: gap across the 25h day is still calendar-accurate", () => {
        // 11-01 23:00（EST）与 11-03 00:30：墙钟差 25.5h，日历差 2 天（跳过 11-02）。
        const tsBySeq = new Map<number, number>([
            [1, at(2026, 10, 1, 23, 0)],
            [2, at(2026, 10, 3, 0, 30)],
        ]);
        const buckets = buildTimeBuckets([railItem(1), railItem(2)], (seq) => tsBySeq.get(seq));
        expect(buckets.map((bucket) => bucket.dateKey)).toEqual(["2026-11-01", "2026-11-03"]);
        expect(buckets[1].gapDaysBefore).toBe(1);
    });

    it("missing ts goes to the unknown bucket, sorted last, never dropped", () => {
        const tsBySeq = new Map<number, number>([
            [1, at(2026, 10, 11)],
            // seq 2 / 3 未命中消息（tsOf 返回 undefined）
        ]);
        const buckets = buildTimeBuckets([railItem(2), railItem(1), railItem(3)], (seq) => tsBySeq.get(seq));
        expect(buckets.map((bucket) => bucket.dateKey)).toEqual(["2026-11-11", UnknownBucketKey]);
        expect(buckets[1].label).toBe("Unknown time");
        expect(buckets[1].count).toBe(2);
        // unknown 没有日历位置：不记跳天天数
        expect(buckets[1].gapDaysBefore).toBe(0);
        expect(buckets[1].items.map((item) => item.seq)).toEqual([2, 3]);
    });

    it("all timestamps missing: a single unknown bucket", () => {
        const buckets = buildTimeBuckets([railItem(1), railItem(2)], () => undefined);
        expect(buckets).toHaveLength(1);
        expect(buckets[0].dateKey).toBe(UnknownBucketKey);
    });

    it("invalid ts (NaN / 0) is treated as unknown, not as epoch 1970", () => {
        const buckets = buildTimeBuckets([railItem(1), railItem(2)], (seq) => (seq === 1 ? Number.NaN : 0));
        expect(buckets).toHaveLength(1);
        expect(buckets[0].dateKey).toBe(UnknownBucketKey);
    });

    it("items on the same seq with different anchors share one bucket and sort by anchorKey", () => {
        const ts = at(2026, 10, 11);
        const buckets = buildTimeBuckets([railItem(5, "e5:m1"), railItem(5, "e5:m0"), railItem(4)], () => ts);
        expect(buckets).toHaveLength(1);
        expect(buckets[0].count).toBe(3);
        expect(buckets[0].items.map((item) => item.anchorKey)).toEqual(["e4:m0", "e5:m0", "e5:m1"]);
    });

    it("accepts unordered input: buckets and items come out deterministically ordered", () => {
        const tsBySeq = new Map<number, number>([
            [9, at(2026, 10, 12)],
            [3, at(2026, 10, 11)],
            [1, at(2026, 10, 3)],
            [5, at(2026, 10, 12)],
        ]);
        const buckets = buildTimeBuckets([railItem(9), railItem(3), railItem(1), railItem(5)], (seq) =>
            tsBySeq.get(seq)
        );
        expect(buckets.map((bucket) => bucket.dateKey)).toEqual(["2026-11-03", "2026-11-11", "2026-11-12"]);
        expect(buckets[2].items.map((item) => item.seq)).toEqual([5, 9]);
        expect(buckets[2].gapDaysBefore).toBe(0);
    });

    it("labels today / yesterday relative to opts.now (fixed now, i18n en)", () => {
        const now = at(2026, 10, 11, 15, 0);
        const tsBySeq = new Map<number, number>([
            [1, at(2026, 10, 11, 9, 0)],
            [2, at(2026, 10, 10, 9, 0)],
            [3, at(2026, 10, 9, 9, 0)],
        ]);
        const buckets = buildTimeBuckets([railItem(1), railItem(2), railItem(3)], (seq) => tsBySeq.get(seq), { now });
        expect(buckets.map((bucket) => bucket.label)).toEqual(["11-09", "Yesterday", "Today"]);
    });

    it("labels follow the injected labelFor (11-02 datetime-format-config injection point)", () => {
        const now = at(2026, 10, 11, 15, 0);
        const buckets = buildTimeBuckets([railItem(1)], () => at(2026, 10, 11, 9, 0), {
            now,
            labelFor: (dateKey, relative) =>
                relative === "today" ? `今日 ${dateKey}` : dateKey === UnknownBucketKey ? "不明" : dateKey,
        });
        expect(buckets[0].label).toBe("今日 2026-11-11");

        const unknown = buildTimeBuckets([railItem(2)], () => undefined, {
            now,
            labelFor: (dateKey, relative) =>
                relative === "today" ? `今日 ${dateKey}` : dateKey === UnknownBucketKey ? "不明" : dateKey,
        });
        expect(unknown[0].label).toBe("不明");
    });

    it("yesterday across a month boundary is computed by calendar construction", () => {
        // now = 2026-12-01，昨天 = 11-30（月/年回退由 Date 的日历构造处理）
        const now = at(2026, 11, 1, 15, 0);
        const tsBySeq = new Map<number, number>([[1, at(2026, 10, 30, 9, 0)]]);
        const buckets = buildTimeBuckets([railItem(1)], (seq) => tsBySeq.get(seq), { now });
        expect(buckets[0].label).toBe("Yesterday");
        expect(buckets[0].dateKey).toBe("2026-11-30");
    });

    it("normalizes second-granularity timestamps", () => {
        // seqToTimestamp 供 ms，但历史调用方可能传秒；口径对齐 ./utils.ts 的 normalizeTimestamp。
        const seconds = at(2026, 10, 11, 9, 0) / 1000;
        const buckets = buildTimeBuckets([railItem(1)], () => seconds);
        expect(buckets[0].dateKey).toBe("2026-11-11");
    });
});

describe("bucketOf", () => {
    const tsBySeq = new Map<number, number>([
        [1, at(2026, 10, 3)],
        [2, at(2026, 10, 11)],
        [3, at(2026, 10, 11)],
    ]);
    const buckets = () => buildTimeBuckets([railItem(1), railItem(2), railItem(3)], (seq) => tsBySeq.get(seq));

    it("finds the bucket containing a seq", () => {
        expect(bucketOf(buckets(), 2)?.dateKey).toBe("2026-11-11");
        expect(bucketOf(buckets(), 1)?.dateKey).toBe("2026-11-03");
    });

    it("returns null for a seq outside all buckets", () => {
        expect(bucketOf(buckets(), 42)).toBeNull();
        expect(bucketOf([], 1)).toBeNull();
    });

    it("finds the unknown bucket for missing-ts items", () => {
        const mixed = buildTimeBuckets([railItem(1), railItem(9)], (seq) => (seq === 1 ? at(2026, 10, 11) : undefined));
        expect(bucketOf(mixed, 9)?.dateKey).toBe(UnknownBucketKey);
    });
});

describe("annotation kind metadata", () => {
    it("exposes all five kinds including node, ordered note → node", () => {
        expect(AnnotationKindMetaTable.map((meta) => meta.kind)).toEqual([
            "note",
            "milestone",
            "decision",
            "question",
            "node",
        ]);
        // 排序序与表序一致，元数据自身不矛盾
        const orders = AnnotationKindMetaTable.map((meta) => meta.order);
        expect(orders).toEqual([...orders].sort((a, b) => a - b));
    });

    it("node is the only diamond shape; the four annotation kinds are dots", () => {
        const shapes = AnnotationKindMetaTable.map((meta) => meta.shape);
        expect(shapes.filter((shape) => shape === "diamond")).toEqual(["diamond"]);
        expect(AnnotationKindMetaTable.at(-1)?.kind).toBe("node");
        expect(annotationKindMeta("node")?.shape).toBe("diamond");
    });

    it("every meta carries a labelKey and an existing color token name", () => {
        for (const meta of AnnotationKindMetaTable) {
            expect(meta.labelKey).toMatch(/^aisessions:annotationCard\.kind\./);
            // 主题 token 必须真实存在（quality-guidelines：引用不存在的 token = 静默失效）
            expect(meta.colorToken).toMatch(/^--(secondary|accent|warning|error|grey)-?[a-z-]*color$/);
        }
        expect(annotationKindMeta("milestone")?.colorToken).toBe("--accent-color");
    });

    it("returns null for unknown kinds instead of silently mapping to note", () => {
        expect(annotationKindMeta("note")).not.toBeNull();
        expect(annotationKindMeta("bookmark")).toBeNull();
    });
});
