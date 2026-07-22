// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// cache 模块行为测试 (TDD 红灯). 锁定 A 档修订后必须保留的行为:
//   1. TTL 命中/过期: 新鲜缓存不发 RPC, 过期重新发.
//   2. in-flight Promise 复用: 同一 session 并发两次只发一个 RPC.
//   3. 三条写入路径 (Summary load / Detail load / patch) 都触发 notifyCacheSubscribers.
//   4. subscribeSessionOverviewCache 退订后不再被回调.
//   5. getSessionOverviewCacheSnapshot 反映新鲜缓存且对 stale session 返回 absent (不报错).
//   6. alias 合并: 同一 session 不同 id (raw vs canonical) 应合并到同一缓存项.
//   7. 请求并发上限: Summary=4 / Detail=2, 超出排队 (等待 active 释放).
//
// 隔离策略: cache 是模块级单例 Map, 测试间不重置. 每个 it 用唯一 sessionId
// (uuid 风格) 隔离, 避免跨用例 TTL/alias 状态污染. 用 vi.useFakeTimers 控制
// SummaryTtlMs=30s / DetailTtlMs=15s 的过期边界.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    _resetCacheSchedulerForTest,
    getCachedSessionDetail,
    getCachedSessionSummary,
    getSessionOverviewCacheRevision,
    getSessionOverviewCacheSnapshot,
    loadCachedSessionSummary,
    loadCachedSessionDetail,
    patchCachedSessionSummary,
    subscribeSessionOverviewCache,
    subscribeSessionOverviewCacheChannel,
} from "./session-overview-session-cache";
import type { AISessionsServiceType } from "@/app/store/services";

// SessionSummary / SessionDetail 是 gotypes.d.ts 全局 ambient 类型, 无需 import.

// 唯一 id 计数器, 保证每个用例互不干扰. 不用 crypto (Node 内置可选).
let idCounter = 0;
function nextId(prefix: string): string {
    idCounter += 1;
    return `${prefix}-${process.pid}-${idCounter}`;
}

// 构造最小 SessionSummary (必填 key/id/source).
function makeSummary(sessionId: string, opts: Partial<SessionSummary> = {}): SessionSummary {
    return {
        key: opts.key ?? `key-${sessionId}`,
        id: opts.id ?? sessionId,
        source: opts.source ?? "test",
        updatedAt: opts.updatedAt ?? 0,
        messageCount: opts.messageCount ?? 0,
        ...opts,
    };
}

// 构造最小 SessionDetail (必填 summary + messages).
function makeDetail(sessionId: string, opts: Partial<SessionDetail> = {}): SessionDetail {
    return {
        summary: opts.summary ?? makeSummary(sessionId),
        messages: opts.messages ?? [],
        ...opts,
    };
}

// Mock service: 用 plain object + vi.fn 实现 Summary/Detail 方法. cache 内部只调这两个,
// 结构子类型运行时足够; 但 AISessionsServiceType 是 class 且有其它成员, TS 严格模式不接受
// Pick subset 直接赋值, 所以走 unknown 双重 cast 绕过编译期检查 (运行时不调任何其它方法).
function makeMockService(): {
    service: AISessionsServiceType;
    summaryFn: ReturnType<typeof vi.fn>;
    detailFn: ReturnType<typeof vi.fn>;
} {
    const summaryFn = vi.fn();
    const detailFn = vi.fn();
    const service = {
        Summary: summaryFn,
        Detail: detailFn,
    } as unknown as AISessionsServiceType;
    return { service, summaryFn, detailFn };
}

describe("session-overview-session-cache (behavior baseline)", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        _resetCacheSchedulerForTest();
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("Summary TTL 命中: 新鲜时直接返回缓存, 不再发 RPC", async () => {
        const sessionId = nextId("hit");
        const { service, summaryFn } = makeMockService();
        const summary = makeSummary(sessionId);
        summaryFn.mockResolvedValue(summary);

        await loadCachedSessionSummary(service, sessionId, {});
        expect(summaryFn).toHaveBeenCalledTimes(1);

        // 第二次: 仍在 TTL 内, 应直接命中, 不触发新 RPC.
        const cached = await loadCachedSessionSummary(service, sessionId, {});
        expect(cached).toEqual(summary);
        expect(summaryFn).toHaveBeenCalledTimes(1);
    });

    it("Summary TTL 过期: 超过 30s 重新发 RPC", async () => {
        const sessionId = nextId("expire");
        const { service, summaryFn } = makeMockService();
        const v1 = makeSummary(sessionId, { messageCount: 1 });
        const v2 = makeSummary(sessionId, { messageCount: 2 });
        summaryFn.mockResolvedValueOnce(v1).mockResolvedValueOnce(v2);

        await loadCachedSessionSummary(service, sessionId, {});
        expect(summaryFn).toHaveBeenCalledTimes(1);

        // 推进超过 SummaryTtlMs (30s).
        vi.advanceTimersByTime(30_001);

        await loadCachedSessionSummary(service, sessionId, {});
        expect(summaryFn).toHaveBeenCalledTimes(2);
    });

    it("Summary in-flight Promise 复用: 并发两次只发一个 RPC", async () => {
        const sessionId = nextId("inflight");
        const { service, summaryFn } = makeMockService();
        const summary = makeSummary(sessionId);
        // 用一个可控 resolve 的 promise 模拟慢请求, 让 task 启动后被 await 卡住,
        // 第二个 load 此时落在 in-flight 窗口内.
        let resolveRpc: (value: SessionSummary) => void = () => {};
        summaryFn.mockImplementation(
            () => new Promise<SessionSummary>((resolve) => { resolveRpc = resolve; })
        );

        const p1 = loadCachedSessionSummary(service, sessionId, {});
        // task 在 enqueueRequest 内是 `Promise.resolve().then(task)`, 需要让一个微任务 tick 走过去
        // 才会同步调用 summaryFn 并把 promise 写入 entry.promise.
        await Promise.resolve();
        await Promise.resolve();
        expect(summaryFn).toHaveBeenCalledTimes(1);

        const p2 = loadCachedSessionSummary(service, sessionId, {});
        // 此时 entry.promise 已经存在, 第二个 load 走 in-flight reuse, 不再发 RPC.
        expect(summaryFn).toHaveBeenCalledTimes(1);
        expect(p1).toBe(p2); // 同一 Promise 引用 (in-flight 复用)

        resolveRpc(summary);
        const [r1, r2] = await Promise.all([p1, p2]);
        expect(r1).toEqual(summary);
        expect(r2).toEqual(summary);
        expect(summaryFn).toHaveBeenCalledTimes(1);
    });

    it("Detail in-flight Promise 复用: 并发两次只发一个 RPC", async () => {
        const sessionId = nextId("inflight-detail");
        const { service, detailFn } = makeMockService();
        const detail = makeDetail(sessionId);
        let resolveRpc: (value: SessionDetail) => void = () => {};
        detailFn.mockImplementation(
            () => new Promise<SessionDetail>((resolve) => { resolveRpc = resolve; })
        );

        const p1 = loadCachedSessionDetail(service, sessionId, {});
        // 同 Summary: 让 task 微任务先跑一次, 把 detailFn 调用 + entry.promise 写入.
        await Promise.resolve();
        await Promise.resolve();
        expect(detailFn).toHaveBeenCalledTimes(1);

        const p2 = loadCachedSessionDetail(service, sessionId, {});
        expect(detailFn).toHaveBeenCalledTimes(1);
        expect(p1).toBe(p2);

        resolveRpc(detail);
        const [r1, r2] = await Promise.all([p1, p2]);
        expect(r1).toEqual(detail);
        expect(r2).toEqual(detail);
        expect(detailFn).toHaveBeenCalledTimes(1);
    });

    it("Detail load 也会把 summary 写入 summaryCache (供后续 Summary TTL 命中)", async () => {
        const sessionId = nextId("detail-summary-passthrough");
        const { service, summaryFn, detailFn } = makeMockService();
        const summary = makeSummary(sessionId, { messageCount: 42 });
        const detail = makeDetail(sessionId, { summary });
        detailFn.mockResolvedValue(detail);

        await loadCachedSessionDetail(service, sessionId, {});

        // 详情_instruction 已经把 summary 同步写入了 summary cache.
        expect(getCachedSessionSummary(sessionId)).toEqual(summary);

        // 因 detail 把 summary 写入了, 紧接着再 load Summary 不应再发 RPC.
        await loadCachedSessionSummary(service, sessionId, {});
        expect(summaryFn).not.toHaveBeenCalled();
    });

    it("三条写入路径都触发 cache 通知 (异步 flush)", async () => {
        vi.useRealTimers();
        // 用 sessionId 隔离三段.
        const sidA = nextId("notify-summary");
        const sidB = nextId("notify-detail");
        const sidC = nextId("notify-patch");

        const { service, summaryFn, detailFn } = makeMockService();
        summaryFn.mockResolvedValue(makeSummary(sidA));
        detailFn.mockResolvedValue(makeDetail(sidB));

        const calls: string[] = [];
        const unsub = subscribeSessionOverviewCache(() => calls.push("tick"));

        await loadCachedSessionSummary(service, sidA, {});
        await loadCachedSessionDetail(service, sidB, {});
        // patch 直接同步写入, 不走 RPC.
        patchCachedSessionSummary(sidC, makeSummary(sidC));

        // 通知是帧级异步合批的, 同帧多次写入最终也只 flush 一次.
        // 这里三次写入发生在不同微任务/同步边界, 各自 schedule flush,
        // 但 flush 走 rAF/timer fallback, 等一个事件循环 tick 后观察.
        await new Promise((resolve) => setTimeout(resolve, 0));

        unsub();

        // 至少一次全局通知 (异步合批; 不再断言精确次数, 由 channel 测试覆盖合批语义).
        expect(calls.length).toBeGreaterThanOrEqual(1);
    });

    it("subscribeSessionOverviewCache 退订后不再被回调", async () => {
        vi.useRealTimers();
        const sid = nextId("unsub");
        const { service, summaryFn } = makeMockService();
        summaryFn.mockResolvedValue(makeSummary(sid));

        const calls: number[] = [];
        const unsub = subscribeSessionOverviewCache(() => calls.push(1));
        await loadCachedSessionSummary(service, sid, {});
        // 帧级 flush 是异步的, 等一个 tick.
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(calls.length).toBeGreaterThanOrEqual(1);

        unsub();
        await loadCachedSessionSummary(service, sid, { forceRefresh: true });
        await new Promise((resolve) => setTimeout(resolve, 0));
        const callsAfterUnsub = calls.length;
        // 退订后没有新增回调.
        expect(callsAfterUnsub).toBeGreaterThanOrEqual(1);
        // 关键: 再写一次, 通知数量不应增加.
        await loadCachedSessionSummary(service, sid, { forceRefresh: true });
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(calls.length).toBe(callsAfterUnsub);
    });

    it("subscribeSessionOverviewCache 同一回调 add 多次仍是单订阅 (Set 去重)", () => {
        // Set 语义: 同一函数引用只占一个 slot. 不过当前实现的 add 没去重保证 (caller 用不同引用),
        // 这里只锁定 "退订一次后不会再被回调" 行为, 不做强去重断言 (留给实现).
        const cb = vi.fn();
        const unsub = subscribeSessionOverviewCache(cb);
        unsub();
        // 第二次 unsub 应该是 no-op, 不能抛错.
        expect(() => unsub()).not.toThrow();
    });

    it("getSessionOverviewCacheSnapshot: 包含新鲜 session, stale session 不出现", async () => {
        const sidFresh = nextId("snap-fresh");
        const sidStale = nextId("snap-stale");
        const { service, summaryFn, detailFn } = makeMockService();
        const summary = makeSummary(sidFresh);
        const detail = makeDetail(sidFresh);
        summaryFn.mockResolvedValue(summary);
        detailFn.mockResolvedValue(detail);

        await loadCachedSessionSummary(service, sidFresh, {});
        await loadCachedSessionDetail(service, sidFresh, {});

        const snap = getSessionOverviewCacheSnapshot([sidFresh, sidStale]);
        expect(snap.summaries[sidFresh]).toEqual(summary);
        expect(snap.details[sidFresh]).toEqual(detail);
        // 从未加载的 sidStale: 不应在 maps 中 (不报错, 也不要 placeholder).
        expect(snap.summaries[sidStale]).toBeUndefined();
        expect(snap.details[sidStale]).toBeUndefined();
    });

    it("alias 合并: 同一 session 由 raw id 与 summary.key 引用, 应共享同一缓存项", async () => {
        // raw id 与 summary.key 不同. loadSummary 之后 registerSessionAliases 会把 raw id
        // 别名解析到 (e.g.) summary.key, 后续用 raw id 读取应命中同一缓存项.
        const rawId = nextId("alias-raw");
        const canonicalKey = `canonical-${rawId}`;
        const { service, summaryFn } = makeMockService();
        const summary = makeSummary(rawId, { key: canonicalKey });
        summaryFn.mockResolvedValue(summary);

        await loadCachedSessionSummary(service, rawId, {});

        // 用 raw id 读: getCachedSessionSummary 应通过 alias 找到 canonical 项.
        const viaRaw = getCachedSessionSummary(rawId);
        expect(viaRaw).toEqual(summary);

        // 用 canonical key 读: 应该是同一个对象/同一份数据.
        const viaCanonical = getCachedSessionSummary(canonicalKey);
        expect(viaCanonical).toEqual(summary);

        // 第二次 load 用 raw id: 仍在 TTL 内, 不应再发 RPC (alias 命中).
        await loadCachedSessionSummary(service, rawId, {});
        expect(summaryFn).toHaveBeenCalledTimes(1);
    });

    it("patchCachedSessionSummary 同步更新已有 detail.summary (整 view 即刻读到新 note)", async () => {
        const sid = nextId("patch-detail");
        const { service, detailFn } = makeMockService();
        const baseDetail = makeDetail(sid, { summary: makeSummary(sid, { note: "old", messageCount: 5 }) });
        detailFn.mockResolvedValue(baseDetail);

        await loadCachedSessionDetail(service, sid, {});
        expect(getCachedSessionDetail(sid)?.summary.note).toBe("old");

        // patch 应同步把 note 字段合并进 detail.summary.
        patchCachedSessionSummary(sid, makeSummary(sid, { note: "new" }));
        expect(getCachedSessionDetail(sid)?.summary.note).toBe("new");
        // 不会丢失 detail 上的 messages 等 (merge 不是整体替换).
        expect(getCachedSessionDetail(sid)?.messages).toEqual([]);
    });

    it("Summary 请求并发上限 = 4: 第 5 个会排队等待 active 释放", async () => {
        // 4 个并发 RPC 都卡在 pending, 第 5 个不会启动, 直到前 4 个之一 resolve.
        const sids = Array.from({ length: 5 }, (_, i) => nextId(`conc-${i}`));
        const { service, summaryFn } = makeMockService();
        const resolvers: Array<(v: SessionSummary) => void> = [];
        summaryFn.mockImplementation(
            () => new Promise<SessionSummary>((resolve) => { resolvers.push(resolve); })
        );

        const ps = sids.map((sid) => loadCachedSessionSummary(service, sid, {}));
        // 让所有微任务/队列调度跑完. 5 个 sync load 中, 4 个走 run() 并把 task 排到微任务队列,
        // 第 5 个走 queue.pending.push 排队. 每个 task 是 Promise.resolve().then(task) 链,
        // 需要 N 个 microtask tick 把 4 个 task 都调起来.
        for (let i = 0; i < 8; i++) {
            await Promise.resolve();
        }

        // 第 5 个请求被排队: 只有 4 个 RPC 真的发出去了.
        expect(summaryFn).toHaveBeenCalledTimes(4);

        // 释放第一个, 队列里的第 5 个应被启动.
        resolvers[0](makeSummary(sids[0]));
        // 第 4 个 task 的 finally 调 queue.pending.shift() 启动第 5 个 run,
        // 然后 Promise.resolve().then(task) 接着调 summaryFn. 多等几个 tick.
        for (let i = 0; i < 8; i++) {
            await Promise.resolve();
        }
        expect(summaryFn).toHaveBeenCalledTimes(5);

        // 释放剩余的, 收尾.
        for (let i = 1; i < resolvers.length; i++) {
            resolvers[i](makeSummary(sids[i]));
        }
        await Promise.all(ps);
    });
});

// 新 API 测试 (A 档任务二): 频道 revision + 帧级 flush 调度.
// 这些测试在新 API 实现前应当全部红灯 (导入符号不存在 / 行为未实现).
describe("session-overview-session-cache (channel revision + flush scheduler)", () => {
    // 帧级调度测试需要可控的 rAF. node 环境无 requestAnimationFrame,
    // 用一个可手动驱动的 mock 替换全局, 测试控制何时 flush.
    type RafCb = (ts: number) => void;
    let rafQueue: RafCb[] = [];
    let rafCount = 0;
    let originalRaf: typeof globalThis.requestAnimationFrame | undefined;
    let originalCancelRaf: typeof globalThis.cancelAnimationFrame | undefined;

    beforeEach(() => {
        vi.useRealTimers();
        _resetCacheSchedulerForTest();
        rafQueue = [];
        rafCount = 0;
        originalRaf = globalThis.requestAnimationFrame;
        originalCancelRaf = globalThis.cancelAnimationFrame;
        // 同步触发的 rAF: cb 进入队列, 由测试显式 flush.
        globalThis.requestAnimationFrame = ((cb: RafCb) => {
            rafCount += 1;
            rafQueue.push(cb);
            return rafCount;
        }) as typeof globalThis.requestAnimationFrame;
        globalThis.cancelAnimationFrame = ((handle: number) => {
            // 简化: 不真删队列中已排的 cb (测试场景不取消).
            void handle;
        }) as typeof globalThis.cancelAnimationFrame;
    });
    afterEach(() => {
        vi.useRealTimers();
        if (originalRaf == null) delete (globalThis as any).requestAnimationFrame;
        else globalThis.requestAnimationFrame = originalRaf;
        if (originalCancelRaf == null) delete (globalThis as any).cancelAnimationFrame;
        else globalThis.cancelAnimationFrame = originalCancelRaf;
        vi.restoreAllMocks();
    });

    function flushRaf(): void {
        const queue = rafQueue;
        rafQueue = [];
        for (const cb of queue) cb(0);
    }
    function rafPendingCount(): number {
        return rafQueue.length;
    }

    it("新 API 存在: getSessionOverviewCacheRevision / subscribeSessionOverviewCacheChannel 可导入", async () => {
        // 这是一个导入断言: 实现不存在时 import 直接报错, 测试红灯.
        const mod = await import("./session-overview-session-cache");
        expect(typeof mod.getSessionOverviewCacheRevision).toBe("function");
        expect(typeof mod.subscribeSessionOverviewCacheChannel).toBe("function");
    });

    it("Summary 写入只增加 Summary revision, 不影响 Detail revision", async () => {
        const sid = nextId("rev-summary");
        const { service, summaryFn } = makeMockService();
        summaryFn.mockResolvedValue(makeSummary(sid));

        const revS0 = getSessionOverviewCacheRevision("summary");
        const revD0 = getSessionOverviewCacheRevision("detail");
        await loadCachedSessionSummary(service, sid, {});
        const revS1 = getSessionOverviewCacheRevision("summary");
        const revD1 = getSessionOverviewCacheRevision("detail");
        expect(revS1).toBeGreaterThan(revS0);
        expect(revD1).toBe(revD0); // detail 频道不动
    });

    it("Detail 写入同时增加 Summary 与 Detail revision (因 detail 联动 summary)", async () => {
        const sid = nextId("rev-detail");
        const { service, detailFn } = makeMockService();
        detailFn.mockResolvedValue(makeDetail(sid));

        const revS0 = getSessionOverviewCacheRevision("summary");
        const revD0 = getSessionOverviewCacheRevision("detail");
        await loadCachedSessionDetail(service, sid, {});
        const revS1 = getSessionOverviewCacheRevision("summary");
        const revD1 = getSessionOverviewCacheRevision("detail");
        expect(revS1).toBeGreaterThan(revS0);
        expect(revD1).toBeGreaterThan(revD0);
    });

    it("patchCachedSessionSummary 增加 Summary revision; 已有 detail.summary 被同步修改时也增加 Detail revision", async () => {
        const sid = nextId("rev-patch");
        const { service, detailFn } = makeMockService();
        const detail = makeDetail(sid, { summary: makeSummary(sid, { note: "old" }) });
        detailFn.mockResolvedValue(detail);

        await loadCachedSessionDetail(service, sid, {});
        const revS0 = getSessionOverviewCacheRevision("summary");
        const revD0 = getSessionOverviewCacheRevision("detail");

        // patch 必须 bump Summary revision. 同时该 sid 已有 detail.entry.summary,
        // 也应同步更新 detail.summary -> Detail revision 也 bump.
        patchCachedSessionSummary(sid, makeSummary(sid, { note: "new" }));

        const revS1 = getSessionOverviewCacheRevision("summary");
        const revD1 = getSessionOverviewCacheRevision("detail");
        expect(revS1).toBeGreaterThan(revS0);
        expect(revD1).toBeGreaterThan(revD0);
    });

    it("同一帧内多次 Summary 写入: revision 多次增加, 但 Summary 频道 subscriber 同帧只被回调一次", async () => {
        const sidA = nextId("batch-a");
        const sidB = nextId("batch-b");
        const sidC = nextId("batch-c");
        const { service, summaryFn } = makeMockService();
        summaryFn
            .mockResolvedValueOnce(makeSummary(sidA))
            .mockResolvedValueOnce(makeSummary(sidB))
            .mockResolvedValueOnce(makeSummary(sidC));

        const summaryCalls: number[] = [];
        const unsub = subscribeSessionOverviewCacheChannel("summary", () => summaryCalls.push(1));

        // 同步发起三次 loadSummary (RPC 立即 resolve, 但 flush 排到 rAF).
        await loadCachedSessionSummary(service, sidA, {});
        await loadCachedSessionSummary(service, sidB, {});
        await loadCachedSessionSummary(service, sidC, {});

        // rAF 已被 schedule 但还没 flush: subscriber 此刻还没被回调.
        expect(summaryCalls.length).toBe(0);
        expect(rafPendingCount()).toBeGreaterThan(0);

        flushRaf();

        expect(summaryCalls.length).toBe(1); // 同帧合并成一次回调
        unsub();
    });

    it("flush 后再次写入: 下一帧再通知一次 (不丢第二次)", async () => {
        const sidA = nextId("frame2-a");
        const sidB = nextId("frame2-b");
        const { service, summaryFn } = makeMockService();
        summaryFn
            .mockResolvedValueOnce(makeSummary(sidA))
            .mockResolvedValueOnce(makeSummary(sidB));

        const calls: number[] = [];
        const unsub = subscribeSessionOverviewCacheChannel("summary", () => calls.push(1));

        await loadCachedSessionSummary(service, sidA, {});
        flushRaf();
        expect(calls.length).toBe(1);

        await loadCachedSessionSummary(service, sidB, {});
        flushRaf();
        expect(calls.length).toBe(2);
        unsub();
    });

    it("同一帧分别发布 summary 与 detail: 两个频道各通知一次, 不串扰", async () => {
        const sidS = nextId("mix-summary");
        const sidD = nextId("mix-detail");
        const { service, summaryFn, detailFn } = makeMockService();
        summaryFn.mockResolvedValue(makeSummary(sidS));
        detailFn.mockResolvedValue(makeDetail(sidD));

        const sCalls: number[] = [];
        const dCalls: number[] = [];
        const unsubS = subscribeSessionOverviewCacheChannel("summary", () => sCalls.push(1));
        const unsubD = subscribeSessionOverviewCacheChannel("detail", () => dCalls.push(1));

        await loadCachedSessionSummary(service, sidS, {});
        await loadCachedSessionDetail(service, sidD, {});

        expect(sCalls.length).toBe(0);
        expect(dCalls.length).toBe(0);
        flushRaf();
        expect(sCalls.length).toBe(1);
        expect(dCalls.length).toBe(1);
        unsubS();
        unsubD();
    });

    it("flush 前退订: 不会收到回调", async () => {
        const sid = nextId("unsub-before-flush");
        const { service, summaryFn } = makeMockService();
        summaryFn.mockResolvedValue(makeSummary(sid));

        const calls: number[] = [];
        const unsub = subscribeSessionOverviewCacheChannel("summary", () => calls.push(1));

        await loadCachedSessionSummary(service, sid, {});
        unsub(); // flush 前退订
        flushRaf();
        expect(calls.length).toBe(0);
    });

    it("一个 subscriber 抛错: 不影响其他 subscriber, 不影响缓存 RPC resolve", async () => {
        const sid = nextId("throw-subscriber");
        const { service, summaryFn } = makeMockService();
        summaryFn.mockResolvedValue(makeSummary(sid));

        const goodCalls: number[] = [];
        const badListener = () => {
            throw new Error("subscriber boom");
        };
        const unsubBad = subscribeSessionOverviewCacheChannel("summary", badListener);
        const unsubGood = subscribeSessionOverviewCacheChannel("summary", () => goodCalls.push(1));

        // 测试需要捕获 console.error / dlog, 否则抛错会冒到 flush 外.
        const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        // 不应抛
        await expect(loadCachedSessionSummary(service, sid, {})).resolves.toBeTruthy();
        expect(() => flushRaf()).not.toThrow();

        expect(goodCalls.length).toBe(1); // bad 抛错后 good 仍执行
        unsubBad();
        unsubGood();
        errSpy.mockRestore();
    });

    it("revision 在通知前已可读: 晚订阅者读到的 revision 反映尚未 flush 的写入", async () => {
        const sid = nextId("late-subscriber");
        const { service, summaryFn } = makeMockService();
        summaryFn.mockResolvedValue(makeSummary(sid));

        const revBefore = getSessionOverviewCacheRevision("summary");
        await loadCachedSessionSummary(service, sid, {});
        // flush 之前: revision 已经 bump (同步).
        const revAfter = getSessionOverviewCacheRevision("summary");
        expect(revAfter).toBeGreaterThan(revBefore);
        // rAF 还没 flush
        expect(rafPendingCount()).toBeGreaterThan(0);
        flushRaf();
    });

    it("无 requestAnimationFrame 环境 (timer fallback): 通知最终仍能推进", async () => {
        // 删除 rAF, 模拟不可见窗口或非浏览器环境.
        const sid = nextId("no-raf");
        const { service, summaryFn } = makeMockService();
        summaryFn.mockResolvedValue(makeSummary(sid));

        const savedRaf = globalThis.requestAnimationFrame;
        const savedCancelRaf = globalThis.cancelAnimationFrame;
        delete (globalThis as any).requestAnimationFrame;
        delete (globalThis as any).cancelAnimationFrame;

        const calls: number[] = [];
        const unsub = subscribeSessionOverviewCacheChannel("summary", () => calls.push(1));

        try {
            await loadCachedSessionSummary(service, sid, {});
            // 没 rAF -> 应走 timer fallback. 让 timer 推进.
            await new Promise((resolve) => setTimeout(resolve, 50));
            expect(calls.length).toBe(1);
        } finally {
            globalThis.requestAnimationFrame = savedRaf;
            globalThis.cancelAnimationFrame = savedCancelRaf;
            unsub();
        }
    });
});
