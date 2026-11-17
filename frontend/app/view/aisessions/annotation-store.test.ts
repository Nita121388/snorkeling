// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// annotation-store 窗口化契约测试（v2 设计 §3.1 游标窗口 / §3.6 失效矩阵 8 行 / §3.7 驱逐）。
//
// 锁定的不变量：
//   1. 首屏只取一页：limit=100、无 cursor；游标与两个旧端布尔都来自这一页。
//   2. 「加载更早」用旧端游标，按 (seq,id) 合并去重 → 重复加载幂等。
//   3. 失效口径：**排序键空间变了 = 失效；尾部增删 = 不失效**（矩阵 8 行逐行）。
//   4. 驱逐：MaxBuckets/MaxEntries 先到者触发、永不驱逐最新桶、
//      atEarliest 与 hasMoreOlder 分开两个布尔。
//   5. 并发：单飞 + 请求代数；失效后的迟到响应必须被丢弃。
//
// 隔离策略：store 是模块级 Map，每个用例 vi.resetModules() + 动态 import
// （见 .trellis/spec/snorkeling-docs/frontend/component-guidelines.md §5）。
// 服务端行为由 pagedAnnotations() 复刻 PageAnnotationViews 的游标语义。

import { initI18n } from "@/i18n/config";
import type { AISessionsServiceType } from "@/app/store/services";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { buildRailItems, type AnnotationAnchorRequest, type AnnotationRailItem, type TimeBucket } from "./annotation-model";

type StoreModule = typeof import("./annotation-store");

function view(id: number, seq: number, overrides: Partial<AnnotationView> = {}): AnnotationView {
    return {
        id,
        sessionKey: "s1",
        anchorKey: `seq:${seq}`,
        seq,
        kind: "note",
        title: `t${id}`,
        body: "",
        tags: [],
        status: "accepted",
        source: "user",
        userEdited: false,
        createdAt: 0,
        updatedAt: 0,
        ...overrides,
    };
}

function range(from: number, to: number): number[] {
    return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

/** 本地日历日 12:00 的时间戳（2026-11） */
function dayTs(day: number): number {
    return new Date(2026, 10, day, 12, 0, 0).getTime();
}

function compareView(left: AnnotationView, right: AnnotationView): number {
    if (left.seq !== right.seq) return left.seq - right.seq;
    return left.id - right.id;
}

/**
 * 复刻后端 PageAnnotationViews 的语义：无 cursor 取最新一页（末尾 limit 条），
 * 有 cursor 取严格更早的一页；hasMore 只表示「更早还有」，不用 OFFSET。
 */
function pagedAnnotations(all: () => AnnotationView[]) {
    return (request: AISessionsAnnotationsRequest): AISessionsAnnotationsResponse => {
        const sorted = [...all()].sort(compareView);
        const cursor = request.cursor;
        const hasCursor = cursor != null && (cursor.beforeSeq !== 0 || cursor.beforeId !== 0);
        const pool = hasCursor
            ? sorted.filter(
                  (entry) =>
                      entry.seq < cursor.beforeSeq || (entry.seq === cursor.beforeSeq && entry.id < cursor.beforeId)
              )
            : sorted;
        const limit = request.limit ?? 0;
        if (limit <= 0) return { annotations: pool, hasMore: false };
        const page = pool.slice(Math.max(0, pool.length - limit));
        const hasMore = pool.length > limit;
        return {
            annotations: page,
            hasMore,
            nextCursor: hasMore
                ? { beforeSeq: page[0].seq, beforeId: page[0].id }
                : undefined,
        };
    };
}

type FakeStoreInput = {
    annotations?: (request: AISessionsAnnotationsRequest) => AISessionsAnnotationsResponse | Promise<AISessionsAnnotationsResponse>;
    save?: (request: AISessionsAnnotationSaveRequest) => AnnotationView;
    bulkDrafts?: () => number;
};

function makeService(input: FakeStoreInput = {}) {
    const calls: AISessionsAnnotationsRequest[] = [];
    const saveCalls: AISessionsAnnotationSaveRequest[] = [];
    const deleteCalls: number[] = [];
    const service = {
        Annotations: vi.fn(async (request: AISessionsAnnotationsRequest) => {
            calls.push(request);
            if (input.annotations != null) return await input.annotations(request);
            return { annotations: [], hasMore: false } as AISessionsAnnotationsResponse;
        }),
        AnnotationSave: vi.fn(async (request: AISessionsAnnotationSaveRequest) => {
            saveCalls.push(request);
            return input.save != null ? input.save(request) : view(request.id ?? 99, request.seq ?? 0, { ...request });
        }),
        AnnotationBulkDrafts: vi.fn(async () => ({ affected: input.bulkDrafts?.() ?? 0 })),
        AnnotationDelete: vi.fn(async (id: number) => {
            deleteCalls.push(id);
        }),
    } as unknown as AISessionsServiceType;
    return { service, calls, saveCalls, deleteCalls };
}

async function freshStore(): Promise<StoreModule> {
    vi.resetModules();
    const store = await import("./annotation-store");
    store.__resetAnnotationStoreForTest();
    return store;
}

function anchor(anchorKey: string, seq: number, hash = "h1"): AnnotationAnchorRequest {
    return { anchorKey, seq, role: "user", hash };
}

/** 手工构造最小合法 TimeBucket（planWindowEviction 的纯函数用例用）。 */
function bucket(dateKey: string, seqs: number[]): TimeBucket {
    const items: AnnotationRailItem[] = seqs.map((seq) => ({
        key: `seq:${seq}`,
        anchorKey: `seq:${seq}`,
        seq,
        annotations: [view(seq, seq)],
        hasAccepted: true,
        hasDraft: false,
        hasOrphan: false,
    }));
    return { dateKey, label: dateKey, items, gapDaysBefore: 0, count: items.length };
}

beforeAll(async () => {
    await initI18n("en");
});

/**
 * 整目录并行跑时，首个用例要现做一次「resetModules + 动态 import」（模块图里带 i18n /
 * services），单文件跑 1.5s，被其它文件的转换挤占时会顶到 5s 默认超时 —— 用 20s 兜住。
 */
const test = (name: string, fn: () => void | Promise<void>) => it(name, fn, 20_000);

describe("annotation-store · 首屏与游标", () => {
    test("首屏只取一页：limit=100、无 cursor；游标与两个旧端布尔来自这一页", async () => {
        const all = range(1, 150).map((seq) => view(seq, seq));
        const { service, calls } = makeService({ annotations: pagedAnnotations(() => all) });
        const store = await freshStore();

        await store.loadAnnotationsLatest("s1", null, [], { service });

        expect(calls).toHaveLength(1);
        expect(calls[0].cursor).toBeUndefined();
        expect(calls[0].limit).toBe(100);
        const snapshot = store.getAnnotationSnapshot("s1", null);
        expect(snapshot).toHaveLength(100);
        expect(snapshot[0].seq).toBe(51);

        const win = store.getAnnotationWindow("s1", null, () => undefined);
        expect(win.oldestCursor).toEqual({ beforeSeq: 51, beforeId: 51 });
        expect(win.newestCursor).toEqual({ beforeSeq: 150, beforeId: 150 });
        expect(win.hasMoreOlder).toBe(true);
        expect(win.atEarliest).toBe(false);
    });

    test("小会话（一页装得下）= 已到最早：atEarliest 真、hasMoreOlder 假、无旧端游标", async () => {
        const all = [view(1, 10), view(2, 20)];
        const { service } = makeService({ annotations: pagedAnnotations(() => all) });
        const store = await freshStore();

        await store.loadAnnotationsLatest("s1", null, [], { service });

        const win = store.getAnnotationWindow("s1", null, () => undefined);
        expect(win.atEarliest).toBe(true);
        expect(win.hasMoreOlder).toBe(false);
        expect(win.oldestCursor).toEqual({ beforeSeq: 10, beforeId: 1 });
    });

    test("加载更早：用旧端游标；重复合并同一页幂等（重试 / 回补不出重复行）", async () => {
        const all = range(1, 150).map((seq) => view(seq, seq));
        const tsOf = (seq: number) => dayTs(10 + Math.floor(seq / 100));
        const { service, calls } = makeService({ annotations: pagedAnnotations(() => all) });
        const store = await freshStore();

        await store.loadAnnotationsLatest("s1", null, [], { service });
        const older = await store.loadOlderAnnotations("s1", null, { service, tsOf });

        expect(calls).toHaveLength(2);
        expect(calls[1].cursor).toEqual({ beforeSeq: 51, beforeId: 51 });
        expect(older?.added).toBe(50);
        expect(store.getAnnotationSnapshot("s1", null)).toHaveLength(150);
        expect(older?.hasMoreOlder).toBe(false);
        expect(older?.atEarliest).toBe(true);

        const again = await store.loadOlderAnnotations("s1", null, { service, tsOf });
        expect(again?.added).toBe(0);
        expect(store.getAnnotationSnapshot("s1", null)).toHaveLength(150);
    });

    test("页大小夹取：[20,500]，缺省/非法回落 100", async () => {
        const store = await freshStore();
        expect(store.clampAnnotationPageLimit(undefined)).toBe(100);
        expect(store.clampAnnotationPageLimit(0)).toBe(100);
        expect(store.clampAnnotationPageLimit(-7)).toBe(100);
        expect(store.clampAnnotationPageLimit(5)).toBe(20);
        expect(store.clampAnnotationPageLimit(77)).toBe(77);
        expect(store.clampAnnotationPageLimit(999)).toBe(500);

        const { service, calls } = makeService({ annotations: () => ({ annotations: [view(1, 1)], hasMore: false }) });
        await store.loadAnnotationsLatest("s1", null, [], { service, limit: 5 });
        expect(calls[0].limit).toBe(20);
        await store.loadOlderAnnotations("s1", null, { service, limit: 9999 });
        expect(calls[1].limit).toBe(500);
    });

    test("旧端游标是零值 (0,0) 时不下发（后端会把它当成最新页），直接如实报告窗口事实", async () => {
        const all = [view(0, 0, { anchorKey: "x:1" })];
        const { service, calls } = makeService({ annotations: pagedAnnotations(() => all) });
        const store = await freshStore();

        await store.loadAnnotationsLatest("s1", null, [], { service });
        expect(store.getAnnotationWindow("s1", null).oldestCursor).toBeUndefined();

        const result = await store.loadOlderAnnotations("s1", null, { service });
        expect(result).toEqual({ added: 0, hasMoreOlder: false, atEarliest: true, evicted: [], error: null });
        expect(calls).toHaveLength(1); // 没有下发零值游标
    });

    test("seq=0 但 id>0 的未解析条目：游标照常下发，空页不会产生重复行", async () => {
        const all = [view(1, 0, { anchorKey: "x:1" })];
        const { service, calls } = makeService({ annotations: pagedAnnotations(() => all) });
        const store = await freshStore();

        await store.loadAnnotationsLatest("s1", null, [], { service });
        const result = await store.loadOlderAnnotations("s1", null, { service });

        expect(calls[1].cursor).toEqual({ beforeSeq: 0, beforeId: 1 });
        expect(result?.added).toBe(0);
        expect(result?.atEarliest).toBe(true);
        expect(store.getAnnotationSnapshot("s1", null)).toHaveLength(1);
    });
});

describe("annotation-store · 失效矩阵（§3.6 共 8 行）", () => {
    test("第 1 行：新批注落在最新桶 → 就地追加，不重载、不重置窗口", async () => {
        const all = [view(1, 10), view(2, 20)];
        const { service, calls } = makeService({
            annotations: pagedAnnotations(() => all),
            save: () => view(3, 30),
        });
        const store = await freshStore();

        await store.loadAnnotationsLatest("s1", null, [], { service });
        const saved = await store.saveAnnotation({ sessionKey: "s1", anchorKey: "seq:30", seq: 30, title: "", body: "" }, { service });

        expect(saved.id).toBe(3);
        expect(calls).toHaveLength(1); // 没有整窗重载
        expect(store.getAnnotationSnapshot("s1", null).map((entry) => entry.id)).toEqual([1, 2, 3]);
        const win = store.getAnnotationWindow("s1", null, () => undefined);
        expect(win.newestCursor).toEqual({ beforeSeq: 30, beforeId: 3 });
        expect(win.atEarliest).toBe(true);
        expect(win.hasMoreOlder).toBe(false);
    });

    test("第 2 行：新批注落在窗口内历史 seq → 按序插入，桶计数即时变化", async () => {
        const all = [view(1, 10), view(2, 30)];
        const tsOf = (seq: number) => (seq === 30 ? dayTs(11) : dayTs(10));
        const { service, calls } = makeService({
            annotations: pagedAnnotations(() => all),
            save: () => view(9, 20),
        });
        const store = await freshStore();

        await store.loadAnnotationsLatest("s1", null, [], { service });
        await store.saveAnnotation({ sessionKey: "s1", anchorKey: "seq:20", seq: 20, title: "", body: "" }, { service });

        expect(calls).toHaveLength(1);
        expect(store.getAnnotationSnapshot("s1", null).map((entry) => entry.seq)).toEqual([10, 20, 30]);
        const win = store.getAnnotationWindow("s1", null, tsOf);
        expect(win.buckets.map((entry) => [entry.dateKey, entry.count])).toEqual([
            ["2026-11-10", 2],
            ["2026-11-11", 1],
        ]);
    });

    test("第 3 行：删除窗口内唯一条目 → 桶消失，不重载", async () => {
        const all = [view(1, 10), view(2, 30)];
        const tsOf = (seq: number) => (seq === 30 ? dayTs(11) : dayTs(10));
        const { service, calls, deleteCalls } = makeService({ annotations: pagedAnnotations(() => all) });
        const store = await freshStore();

        await store.loadAnnotationsLatest("s1", null, [], { service });
        await store.deleteAnnotation(1, "s1", undefined, { service });

        expect(deleteCalls).toEqual([1]);
        expect(calls).toHaveLength(1);
        expect(store.getAnnotationSnapshot("s1", null).map((entry) => entry.id)).toEqual([2]);
        const win = store.getAnnotationWindow("s1", null, tsOf);
        expect(win.buckets.map((entry) => entry.dateKey)).toEqual(["2026-11-11"]);
        expect(win.buckets[0].count).toBe(1);
    });

    test("第 4 行：AI 重生成替换 drafts → 整窗失效回最新页", async () => {
        let page = [view(1, 10), view(2, 20)];
        const { service, calls } = makeService({ annotations: pagedAnnotations(() => page) });
        const store = await freshStore();

        await store.loadAnnotationsLatest("s1", null, [], { service });
        page = [view(7, 70)];
        await store.refreshAnnotations("s1", null, { service });

        expect(calls).toHaveLength(2);
        expect(store.getAnnotationSnapshot("s1", null).map((entry) => entry.id)).toEqual([7]);
    });

    test("第 5 行：锚点重锚定改写 seq → 整窗失效；纯尾部新增锚点 → 不重载", async () => {
        const all = [view(1, 10)];
        const { service, calls } = makeService({ annotations: pagedAnnotations(() => all) });
        const store = await freshStore();

        await store.loadAnnotationsLatest("s1", null, [anchor("seq:10", 10)], { service });
        expect(calls).toHaveLength(1);

        // 尾部新增：只多出新 anchorKey → 排序键空间没变 → keep
        await store.reloadAnnotationsWithAnchors("s1", null, [anchor("seq:10", 10), anchor("seq:20", 20)], { service });
        expect(calls).toHaveLength(1);
        expect(store.getAnnotationSnapshot("s1", null).map((entry) => entry.id)).toEqual([1]);

        // 既有锚点 seq 改写 → 排序键空间变了 → reload
        await store.reloadAnnotationsWithAnchors("s1", null, [anchor("seq:10", 11, "h2")], { service });
        expect(calls).toHaveLength(2);

        // 锚点被移除同样是失效
        await store.reloadAnnotationsWithAnchors("s1", null, [anchor("seq:10", 11, "h2"), anchor("seq:20", 20)], { service });
        expect(calls).toHaveLength(2);
        await store.reloadAnnotationsWithAnchors("s1", null, [anchor("seq:20", 20)], { service });
        expect(calls).toHaveLength(3);
    });

    test("第 5 行补充：窗口里还有 seq=0 的未解析条目 → 即使锚点没变也要补拉重锚定", async () => {
        const pages = [[view(1, 0)], [view(1, 5)]];
        const { service, calls } = makeService({
            annotations: (request) => ({
                annotations: request.anchors != null && request.anchors.length > 0 ? pages[1] : pages[0],
                hasMore: false,
            }),
        });
        const store = await freshStore();

        await store.loadAnnotationsLatest("s1", null, [], { service });
        expect(store.getAnnotationSnapshot("s1", null)[0].seq).toBe(0);

        await store.reloadAnnotationsWithAnchors("s1", null, [anchor("k1", 5)], { service });
        expect(calls).toHaveLength(2);
        expect(store.getAnnotationSnapshot("s1", null)[0].seq).toBe(5);
    });

    test("第 6/7 行：会话文件重写 / 切筛选 → 清窗口；带 reload 时回最新页", async () => {
        let page = [view(1, 10), view(2, 20)];
        const { service, calls } = makeService({ annotations: pagedAnnotations(() => page) });
        const store = await freshStore();

        await store.loadAnnotationsLatest("s1", null, [], { service });
        await store.loadOlderAnnotations("s1", null, { service });

        // 切筛选：清窗口，不发请求
        await store.invalidateAnnotations("s1", null);
        expect(calls).toHaveLength(2);
        expect(store.getAnnotationSnapshot("s1", null)).toHaveLength(0);
        const cleared = store.getAnnotationWindow("s1", null);
        expect(cleared.buckets).toEqual([]);
        expect(cleared.hasMoreOlder).toBe(false); // 空窗口不报「还有更早」
        expect(cleared.atEarliest).toBe(false);

        // 会话文件重写：invalidate + 回最新页
        page = [view(42, 420)];
        await store.invalidateAnnotations("s1", null, { reload: true, service });
        expect(calls).toHaveLength(3);
        expect(store.getAnnotationSnapshot("s1", null).map((entry) => entry.id)).toEqual([42]);
    });

    test("第 8 行：切会话 / connection → 不同 cache key，互不污染", async () => {
        const all = [view(1, 10)];
        const { service } = makeService({ annotations: pagedAnnotations(() => all) });
        const store = await freshStore();

        await store.loadAnnotationsLatest("s1", null, [], { service });
        expect(store.getAnnotationSnapshot("s1", null)).toHaveLength(1);
        expect(store.getAnnotationSnapshot("s2", null)).toHaveLength(0);
        expect(store.getAnnotationSnapshot("s1", "remote")).toHaveLength(0);

        await store.loadAnnotationsLatest("s1", "remote", [], { service });
        expect(store.getAnnotationSnapshot("s1", "remote")).toHaveLength(1);
        expect(store.getAnnotationSnapshot("s1", null)).toHaveLength(1);
    });

    test("草稿批量采纳 → 只改状态，不重载（草稿条就在用户视口内）", async () => {
        const all = [view(1, 10, { status: "draft", source: "ai" }), view(2, 20)];
        const { service, calls } = makeService({ annotations: pagedAnnotations(() => all) });
        const store = await freshStore();

        await store.loadAnnotationsLatest("s1", null, [], { service });
        await store.bulkDraftAnnotations("s1", null, [], "accept", { service });

        expect(calls).toHaveLength(1);
        expect(store.getAnnotationSnapshot("s1", null).map((entry) => entry.status)).toEqual(["accepted", "accepted"]);
    });
});

describe("annotation-store · 窗口驱逐（§3.7）", () => {
    test("planWindowEviction：MaxBuckets 先到 → 驱逐距 refSeq 最远的桶，永不驱逐最新桶", async () => {
        const store = await freshStore();
        const buckets = [
            bucket("2026-11-01", [1, 2]),
            bucket("2026-11-02", [3, 4]),
            bucket("2026-11-03", [5, 6]),
            bucket("2026-11-04", [7, 8]),
            bucket("2026-11-05", [9, 10]),
            bucket("2026-11-06", [11, 12]),
        ];
        // refSeq 缺省 = 最新桶中点 → 最远的是最旧的桶
        expect(store.planWindowEviction(buckets, 12).map((step) => step.dateKey)).toEqual(["2026-11-01"]);

        // 视口在最早处：最远的是第二新的桶（最新桶受保护）
        const planNearOldest = store.planWindowEviction(buckets, 12, { refSeq: 1.5 });
        expect(planNearOldest.map((step) => step.dateKey)).toEqual(["2026-11-05"]);
        expect(planNearOldest.every((step) => step.dropIndex !== 5)).toBe(true); // 永不驱逐最新桶

        // MaxEntries：桶数没超，但条数超 → 从最旧的整桶开始砍
        const big = [bucket("2026-11-01", range(1, 5)), bucket("2026-11-02", range(6, 10)), bucket("2026-11-03", range(11, 15))];
        const planEntries = store.planWindowEviction(big, 15, { maxEntries: 8 });
        expect(planEntries.map((step) => step.dateKey)).toEqual(["2026-11-01", "2026-11-02"]);
    });

    test("planWindowEviction：只剩最新桶时停止（永不驱逐最新桶优先于 MaxEntries）", async () => {
        const store = await freshStore();
        const single = [bucket("2026-11-11", range(1, 300))];
        expect(store.planWindowEviction(single, 300)).toEqual([]);
        // 只有 unknown 桶时没有可辨识的最新桶 → 不驱逐
        expect(store.planWindowEviction([bucket("unknown", range(1, 300))], 300)).toEqual([]);
        // unknown 桶在有日期桶时可以驱逐
        const mixed = [bucket("unknown", [1, 2]), bucket("2026-11-11", [3, 4])];
        expect(store.planWindowEviction(mixed, 4, { maxBuckets: 1 }).map((step) => step.dateKey)).toEqual(["unknown"]);
    });

    test("驱逐一个更早的桶后：hasMoreOlder 翻真、atEarliest 翻假（两个布尔分开记）", async () => {
        // 6 天各 5 条，一页装下（服务端已耗尽）
        const all = range(1, 30).map((seq) => view(seq, seq));
        const tsOf = (seq: number) => dayTs(1 + Math.floor((seq - 1) / 5));
        const { service, calls } = makeService({ annotations: pagedAnnotations(() => all) });
        const store = await freshStore();

        await store.loadAnnotationsLatest("s1", null, [], { service });
        const before = store.getAnnotationWindow("s1", null, tsOf);
        expect(before.atEarliest).toBe(true);
        expect(before.hasMoreOlder).toBe(false);
        expect(before.buckets).toHaveLength(6);

        const result = await store.loadOlderAnnotations("s1", null, { service, tsOf });

        expect(calls).toHaveLength(2);
        expect(result?.added).toBe(0);
        expect(result?.evicted.map((entry) => entry.dateKey)).toEqual(["2026-11-01"]);
        expect(result?.evicted[0].count).toBe(5);
        expect(result?.hasMoreOlder).toBe(true); // 窗口外仍有更早条目（被驱逐出去了）
        expect(result?.atEarliest).toBe(false); // 窗口旧端已经不是会话最早处

        const after = store.getAnnotationWindow("s1", null, tsOf);
        expect(after.buckets).toHaveLength(5);
        expect(after.buckets.map((entry) => entry.dateKey)).not.toContain("2026-11-01");
        expect(after.buckets.map((entry) => entry.dateKey)).toContain("2026-11-06"); // 最新桶常驻
        expect(store.getAnnotationSnapshot("s1", null)).toHaveLength(25);
    });

    test("MaxEntries：多次翻页累积超限后裁到上限内，最新桶保留", async () => {
        // 3 天 × 1000 条，每页 500
        const all = range(1, 3000).map((seq) => view(seq, seq));
        const tsOf = (seq: number) => dayTs(1 + Math.floor((seq - 1) / 1000));
        const { service, calls } = makeService({ annotations: pagedAnnotations(() => all) });
        const store = await freshStore();

        await store.loadAnnotationsLatest("s1", null, [], { service });
        // 再翻 4 页 → 2500 条，触发 MaxEntries
        for (let index = 0; index < 4; index++) {
            await store.loadOlderAnnotations("s1", null, { service, tsOf });
        }

        expect(calls.length).toBe(5);
        const snapshot = store.getAnnotationSnapshot("s1", null);
        expect(snapshot.length).toBeLessThanOrEqual(2000);
        expect(snapshot.length).toBeGreaterThan(0);
        expect(snapshot[snapshot.length - 1].seq).toBe(3000); // 最新条目永不被驱逐
        const win = store.getAnnotationWindow("s1", null, tsOf);
        expect(win.buckets.length).toBeLessThanOrEqual(5);
        expect(win.buckets.map((entry) => entry.dateKey)).toContain("2026-11-03");
        expect(win.hasMoreOlder).toBe(true);
        expect(win.atEarliest).toBe(false);
    });

    test("没有 tsOf 时不做驱逐（桶边界不可知，不冒误驱逐最新桶的风险）", async () => {
        const all = range(1, 120).map((seq) => view(seq, seq));
        const { service } = makeService({ annotations: pagedAnnotations(() => all) });
        const store = await freshStore();

        await store.loadAnnotationsLatest("s1", null, [], { service });
        const result = await store.loadOlderAnnotations("s1", null, { service });
        expect(result?.added).toBe(20);
        expect(result?.evicted).toEqual([]);
        expect(store.getAnnotationSnapshot("s1", null)).toHaveLength(120);
    });
});

describe("annotation-store · 并发（单飞 + 迟到响应丢弃）", () => {
    function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
        let resolve!: (value: T) => void;
        const promise = new Promise<T>((res) => {
            resolve = res;
        });
        return { promise, resolve };
    }

    test("失效后的迟到响应必须丢弃，并用新代数重新加载", async () => {
        const first = deferred<AISessionsAnnotationsResponse>();
        const second = deferred<AISessionsAnnotationsResponse>();
        const responses = [first.promise, second.promise];
        let index = 0;
        const { service, calls } = makeService({
            annotations: () => responses[Math.min(index++, responses.length - 1)],
        });
        const store = await freshStore();

        const loading = store.loadAnnotationsLatest("s1", null, [], { service });
        expect(calls).toHaveLength(1);
        expect(store.getAnnotationSnapshot("s1", null)).toHaveLength(0);

        // 失效（AI 重生成替换 drafts）：代数 +1，回最新页排在在飞请求之后
        await store.invalidateAnnotations("s1", null, { reload: true, service });
        expect(store.getAnnotationSnapshot("s1", null)).toHaveLength(0);

        // 迟到页回来了：必须被丢弃
        first.resolve({ annotations: [view(111, 1)], hasMore: false });
        await Promise.resolve();
        await Promise.resolve();
        expect(calls).toHaveLength(2); // 收尾时补发了新代数的加载

        // 真正的新页
        second.resolve({ annotations: [view(222, 2)], hasMore: false });
        await loading;
        await Promise.resolve();

        expect(store.getAnnotationSnapshot("s1", null).map((entry) => entry.id)).toEqual([222]);
        expect(store.getAnnotationWindow("s1", null).atEarliest).toBe(true);
    });

    test("invalidate（不重载）时迟到响应同样丢弃，且不会补发请求", async () => {
        const pending = deferred<AISessionsAnnotationsResponse>();
        const { service, calls } = makeService({ annotations: () => pending.promise });
        const store = await freshStore();

        const loading = store.loadAnnotationsLatest("s1", null, [], { service });
        await store.invalidateAnnotations("s1", null);

        pending.resolve({ annotations: [view(1, 1)], hasMore: false });
        await loading;

        expect(calls).toHaveLength(1);
        expect(store.getAnnotationSnapshot("s1", null)).toHaveLength(0);
    });

    test("单飞：「加载更早」在已有请求在飞时直接返回 null", async () => {
        const pending = deferred<AISessionsAnnotationsResponse>();
        const { service, calls } = makeService({ annotations: () => pending.promise });
        const store = await freshStore();

        void store.loadAnnotationsLatest("s1", null, [], { service });
        const older = await store.loadOlderAnnotations("s1", null, { service });
        expect(older).toBeNull();
        expect(calls).toHaveLength(1);

        pending.resolve({ annotations: [view(1, 1)], hasMore: false });
        await Promise.resolve();
        await Promise.resolve();
        expect(store.getAnnotationSnapshot("s1", null)).toHaveLength(1);
    });
});

describe("annotation-store · 快照同一性", () => {
    test("窗口快照在状态不变时复用同一对象（useSyncExternalStore 要求）", async () => {
        const all = [view(1, 10)];
        const tsOf = () => dayTs(10);
        const { service } = makeService({ annotations: pagedAnnotations(() => all) });
        const store = await freshStore();

        await store.loadAnnotationsLatest("s1", null, [], { service });
        const first = store.getAnnotationWindow("s1", null, tsOf, { now: 1_800_000_000_000 });
        const second = store.getAnnotationWindow("s1", null, tsOf, { now: 1_800_000_000_000 });
        expect(second).toBe(first);

        // 状态变化（追加一条）→ 换引用
        await store.saveAnnotation({ sessionKey: "s1", anchorKey: "seq:20", seq: 20, title: "", body: "" }, {
            service: makeService({ save: () => view(2, 20) }).service,
        });
        const third = store.getAnnotationWindow("s1", null, tsOf, { now: 1_800_000_000_000 });
        expect(third).not.toBe(first);
        expect(third.buckets[0].count).toBe(2);

        // 换 tsOf 引用 → 重算
        const fourth = store.getAnnotationWindow("s1", null, () => dayTs(11), { now: 1_800_000_000_000 });
        expect(fourth).not.toBe(third);
        expect(fourth.buckets.map((entry) => entry.dateKey)).toEqual(["2026-11-11"]);
    });

    test("未加载过的会话返回稳定的空窗口快照", async () => {
        const store = await freshStore();
        const first = store.getAnnotationWindow("missing", null);
        const second = store.getAnnotationWindow("missing", null);
        expect(second).toBe(first);
        expect(first.buckets).toEqual([]);
        expect(first.hasMoreOlder).toBe(false);
        expect(store.getAnnotationSnapshot("missing", null)).toEqual([]);
    });

    test("buildRailItems 的时间桶派生（窗口 → buckets 的唯一入口）", async () => {
        const all = [view(1, 10), view(2, 10), view(3, 30)];
        const tsOf = (seq: number) => (seq === 30 ? dayTs(11) : dayTs(10));
        const { service } = makeService({ annotations: pagedAnnotations(() => all) });
        const store = await freshStore();

        await store.loadAnnotationsLatest("s1", null, [], { service });
        const win = store.getAnnotationWindow("s1", null, tsOf);
        // 同 seq 两条合成一个节点，桶 count 是节点数
        expect(win.buckets[0].count).toBe(1);
        expect(win.buckets[0].items[0].annotations).toHaveLength(2);
        expect(buildRailItems(store.getAnnotationSnapshot("s1", null))).toHaveLength(2);
    });
});
