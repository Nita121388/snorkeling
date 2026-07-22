// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { AISessionsServiceType } from "@/app/store/services";
import debug from "debug";

type CacheEntry<T> = {
    value: T | null;
    loadedAt: number;
    promise: Promise<T> | null;
};

export type SessionOverviewCacheSnapshot = {
    summaries: Record<string, SessionSummary>;
    details: Record<string, SessionDetail>;
};

type RequestQueue = {
    active: number;
    limit: number;
    pending: Array<() => void>;
};

const SummaryTtlMs = 30_000;
const DetailTtlMs = 15_000;
const SummaryRequestConcurrency = 4;
const DetailRequestConcurrency = 2;
const StatRequestConcurrency = 4;

const summaryCache = new Map<string, CacheEntry<SessionSummary>>();
const detailCache = new Map<string, CacheEntry<SessionDetail>>();
const sessionAliases = new Map<string, string>();
// 旧的全局 cache 订阅集合, 与新频道订阅共存. 任何频道 dirty 都会同步通知全局订阅者,
// 保证尚未迁移到 channel API 的消费者 (例如外部 useSessionOverviewCacheVersion) 仍能收到信号.
const cacheSubscribers = new Set<() => void>();
const summaryRequestQueue: RequestQueue = { active: 0, limit: SummaryRequestConcurrency, pending: [] };
const detailRequestQueue: RequestQueue = { active: 0, limit: DetailRequestConcurrency, pending: [] };
const statRequestQueue: RequestQueue = { active: 0, limit: StatRequestConcurrency, pending: [] };
const dlog = debug("wave:sessionoverview");

// --- 频道 revision 与帧级 flush 调度 ---
// 设计要点:
//   - revision 在 cache 写入时**同步**递增. UI 通知可以延后. 这样即使组件在 flush 前订阅,
//     或隐藏期间没订阅, 重新读取 revision 时仍能发现最新缓存状态.
//   - 一个调度窗口 (一次 rAF / fallback timer) 内每个频道最多 flush 一次; 同一频道多次写入
//     revision 会叠加, 但 subscriber 只回调一次.
//   - flush 时复制当前订阅者集合 (避免迭代中 unsubscribe 触发 Set mutation), 单 subscriber 抛错
//     不能中断其他 subscriber; 错误走 dlog, 不影响 cache 写入 Promise 的 resolve.
//   - 可见窗口用 requestAnimationFrame 做帧级合批; 没有 rAF (测试/非浏览器/不可见) 走短 timer fallback,
//     保证通知最终推进, 永不悬挂.
export type SessionOverviewCacheChannel = "summary" | "detail";

type ChannelKey = SessionOverviewCacheChannel;

const channelRevisions: Record<ChannelKey, number> = { summary: 0, detail: 0 };
const channelSubscribers: Record<ChannelKey, Set<() => void>> = {
    summary: new Set(),
    detail: new Set(),
};
const pendingFlushChannels = new Set<ChannelKey>();
let flushScheduled = false;
let flushTimerHandle: ReturnType<typeof setTimeout> | null = null;

function getRaf(): typeof requestAnimationFrame | null {
    if (typeof globalThis !== "object" || globalThis == null) return null;
    const raf = (globalThis as any).requestAnimationFrame;
    return typeof raf === "function" ? raf : null;
}

function scheduleFlush(): void {
    if (flushScheduled) return;
    flushScheduled = true;
    const raf = getRaf();
    if (raf != null) {
        // rAF 可见: 帧级合批. 失败兜底走 timer (某些环境 rAF 可能抛错而不是 undefined).
        try {
            raf.call(globalThis, flushChannels);
            return;
        } catch (err) {
            dlog("cache raf schedule failed, fallback to timer", err);
        }
    }
    // 没有 rAF / rAF 抛错: 短 timer fallback, 不悬挂.
    flushTimerHandle = setTimeout(flushChannels, 0);
}

function flushChannels(): void {
    flushScheduled = false;
    flushTimerHandle = null;
    // 收集本帧要 flush 的频道, 清 pending 让新写入可以安排下一帧.
    const channels = Array.from(pendingFlushChannels);
    pendingFlushChannels.clear();
    for (const channel of channels) {
        const subs = channelSubscribers[channel];
        if (subs.size === 0) continue;
        // 复制后迭代: subscriber 内可能退订自身或新增订阅, 不影响本轮迭代稳定性.
        const snapshot = Array.from(subs);
        for (const subscriber of snapshot) {
            try {
                subscriber();
            } catch (err) {
                dlog("cache channel subscriber threw", { channel, err });
            }
        }
    }
    // 同帧也通知旧的全局订阅者 (兼容尚未迁移的消费者).
    if (cacheSubscribers.size > 0) {
        const globalSnapshot = Array.from(cacheSubscribers);
        for (const subscriber of globalSnapshot) {
            try {
                subscriber();
            } catch (err) {
                dlog("cache global subscriber threw", err);
            }
        }
    }
}

// cache 写入路径调用: 同步 bump revision + 安排帧级 flush.
function markChannelDirty(channel: ChannelKey): void {
    channelRevisions[channel] += 1;
    pendingFlushChannels.add(channel);
    scheduleFlush();
}

// 仅供测试使用: 重置模块级调度状态. cache 数据 (summaryCache/detailCache/aliases) 不重置,
// 用唯一 sessionId 隔离数据. 调度状态必须在每个测试开头复位, 否则上一个测试未 flush 的
// schedule 残留会阻止下一个测试收到通知.
export function _resetCacheSchedulerForTest(): void {
    flushScheduled = false;
    pendingFlushChannels.clear();
    if (flushTimerHandle != null) {
        clearTimeout(flushTimerHandle);
        flushTimerHandle = null;
    }
}

export function getSessionOverviewCacheRevision(channel: SessionOverviewCacheChannel): number {
    return channelRevisions[channel];
}

export function subscribeSessionOverviewCacheChannel(
    channel: SessionOverviewCacheChannel,
    subscriber: () => void
): () => void {
    channelSubscribers[channel].add(subscriber);
    return () => {
        channelSubscribers[channel].delete(subscriber);
    };
}

function getEntry<T>(cache: Map<string, CacheEntry<T>>, key: string): CacheEntry<T> {
    key = canonicalSessionKey(key);
    return getRawEntry(cache, key);
}

function getRawEntry<T>(cache: Map<string, CacheEntry<T>>, key: string): CacheEntry<T> {
    let entry = cache.get(key);
    if (entry == null) {
        entry = { value: null, loadedAt: 0, promise: null };
        cache.set(key, entry);
    }
    return entry;
}

function normalizeSessionKey(sessionId: string | null | undefined): string {
    return sessionId?.trim() ?? "";
}

function canonicalSessionKey(sessionId: string | null | undefined): string {
    const key = normalizeSessionKey(sessionId);
    if (!key) return "";
    return sessionAliases.get(key) ?? key;
}

function aliasCandidates(sessionId: string, summary: SessionSummary | null | undefined): string[] {
    return [sessionId, summary?.id ?? "", summary?.key ?? ""]
        .map((value) => normalizeSessionKey(value))
        .filter((value, index, values) => value !== "" && values.indexOf(value) === index);
}

function mergeEntries<T>(cache: Map<string, CacheEntry<T>>, fromKey: string, toKey: string): CacheEntry<T> {
    const from = cache.get(fromKey);
    const to = getRawEntry(cache, toKey);
    if (from != null && from !== to) {
        if (to.value == null || from.loadedAt > to.loadedAt) {
            to.value = from.value;
            to.loadedAt = from.loadedAt;
        }
        to.promise ??= from.promise;
        cache.delete(fromKey);
    }
    return to;
}

function registerSessionAliases(sessionId: string, summary: SessionSummary | null | undefined): string {
    const candidates = aliasCandidates(sessionId, summary);
    if (candidates.length === 0) {
        return canonicalSessionKey(sessionId);
    }
    const existingCanonical =
        candidates.map((candidate) => sessionAliases.get(candidate)).find((candidate) => candidate != null) ??
        candidates.find((candidate) => summary?.key === candidate) ??
        candidates[0];
    for (const candidate of candidates) {
        mergeEntries(summaryCache, candidate, existingCanonical);
        mergeEntries(detailCache, candidate, existingCanonical);
    }
    for (const candidate of candidates) {
        sessionAliases.set(candidate, existingCanonical);
    }
    return existingCanonical;
}

// 兼容垫片: 旧的全局订阅 API. 现已迁到分频道 API, 但保留这个调用点不动,
// 既驱动 cacheSubscribers 的全局订阅兼容, 又保证旧调用者 (含尚未迁移的消费者)
// 仍能在每次写入后拿到信号. 内部等同于把两个频道都标记 dirty.
function notifyCacheSubscribers(): void {
    markChannelDirty("summary");
    markChannelDirty("detail");
}

export function subscribeSessionOverviewCache(subscriber: () => void): () => void {
    cacheSubscribers.add(subscriber);
    return () => {
        cacheSubscribers.delete(subscriber);
    };
}

export function getSessionOverviewCacheSnapshot(sessionIds: string[]): SessionOverviewCacheSnapshot {
    const summaries: Record<string, SessionSummary> = {};
    const details: Record<string, SessionDetail> = {};
    for (const sessionId of sessionIds) {
        const summary = getCachedSessionSummary(sessionId);
        if (summary != null) {
            summaries[sessionId] = summary;
        }
        const detail = getCachedSessionDetail(sessionId);
        if (detail != null) {
            details[sessionId] = detail;
        }
    }
    return { summaries, details };
}

function isFresh<T>(entry: CacheEntry<T>, ttlMs: number): entry is CacheEntry<T> & { value: T } {
    return entry.value != null && Date.now() - entry.loadedAt < ttlMs;
}

function enqueueRequest<T>(queue: RequestQueue, label: string, task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const queuedAt = Date.now();
        const run = () => {
            queue.active += 1;
            dlog("queue start", {
                label,
                active: queue.active,
                pending: queue.pending.length,
                queuedMs: Date.now() - queuedAt,
            });
            const start = Date.now();
            Promise.resolve()
                .then(task)
                .then((value) => {
                    dlog("queue success", {
                        label,
                        active: queue.active,
                        pending: queue.pending.length,
                        durationMs: Date.now() - start,
                    });
                    resolve(value);
                }, (error) => {
                    dlog("queue error", {
                        label,
                        active: queue.active,
                        pending: queue.pending.length,
                        durationMs: Date.now() - start,
                        error: error instanceof Error ? error.message : String(error),
                    });
                    reject(error);
                })
                .finally(() => {
                    queue.active -= 1;
                    queue.pending.shift()?.();
                });
        };

        if (queue.active < queue.limit) {
            run();
        } else {
            dlog("queue pending", { label, active: queue.active, pending: queue.pending.length + 1 });
            queue.pending.push(run);
        }
    });
}

export function getCachedSessionSummary(sessionId: string): SessionSummary | null {
    return summaryCache.get(canonicalSessionKey(sessionId))?.value ?? null;
}

export function getCachedSessionDetail(sessionId: string): SessionDetail | null {
    return detailCache.get(canonicalSessionKey(sessionId))?.value ?? null;
}

export function loadCachedSessionSummary(
    service: AISessionsServiceType,
    sessionId: string,
    opts: { forceRefresh?: boolean } = {}
): Promise<SessionSummary> {
    const cacheKey = canonicalSessionKey(sessionId);
    const entry = getEntry(summaryCache, cacheKey);
    if (!opts.forceRefresh && isFresh(entry, SummaryTtlMs)) {
        dlog("summary cache hit", { sessionId, ageMs: Date.now() - entry.loadedAt });
        return Promise.resolve(entry.value);
    }
    if (!opts.forceRefresh && entry.promise != null) {
        dlog("summary in-flight reuse", { sessionId });
        return entry.promise;
    }
    dlog("summary request", {
        sessionId,
        cacheKey,
        forceRefresh: opts.forceRefresh === true,
        hasCached: entry.value != null,
    });
    entry.promise = enqueueRequest(summaryRequestQueue, `Summary:${cacheKey}`, () =>
        service.Summary({ id: sessionId, refresh: opts.forceRefresh === true })
    )
        .then((summary) => {
            const canonicalKey = registerSessionAliases(sessionId, summary);
            const canonicalEntry = getEntry(summaryCache, canonicalKey);
            canonicalEntry.value = summary;
            canonicalEntry.loadedAt = Date.now();
            canonicalEntry.promise = null;
            dlog("summary stored", {
                sessionId,
                cacheKey: canonicalKey,
                id: summary.id,
                key: summary.key,
                updatedAt: summary.updatedAt,
                messageCount: summary.messageCount,
            });
            // Summary load 只动 summary 频道. detail 频道不受影响.
            markChannelDirty("summary");
            return summary;
        })
        .finally(() => {
            entry.promise = null;
        });
    return entry.promise;
}

export function loadCachedSessionDetail(
    service: AISessionsServiceType,
    sessionId: string,
    opts: { forceRefresh?: boolean; tail?: number } = {}
): Promise<SessionDetail> {
    const cacheKey = canonicalSessionKey(sessionId);
    const entry = getEntry(detailCache, cacheKey);
    if (!opts.forceRefresh && isFresh(entry, DetailTtlMs)) {
        dlog("detail cache hit", {
            sessionId,
            cacheKey,
            ageMs: Date.now() - entry.loadedAt,
            messageCount: entry.value.messages?.length ?? 0,
        });
        return Promise.resolve(entry.value);
    }
    if (!opts.forceRefresh && entry.promise != null) {
        dlog("detail in-flight reuse", { sessionId });
        return entry.promise;
    }
    dlog("detail request", {
        sessionId,
        cacheKey,
        tail: opts.tail ?? 100,
        forceRefresh: opts.forceRefresh === true,
        hasCached: entry.value != null,
    });
    entry.promise = enqueueRequest(detailRequestQueue, `Detail:${cacheKey}`, () =>
        service.Detail({
            id: sessionId,
            tail: opts.tail ?? 100,
            refresh: opts.forceRefresh === true,
        })
    )
        .then((detail) => {
            const canonicalKey = registerSessionAliases(sessionId, detail.summary);
            const canonicalEntry = getEntry(detailCache, canonicalKey);
            canonicalEntry.value = detail;
            canonicalEntry.loadedAt = Date.now();
            canonicalEntry.promise = null;
            const summaryEntry = getEntry(summaryCache, canonicalKey);
            summaryEntry.value = detail.summary;
            summaryEntry.loadedAt = Date.now();
            dlog("detail stored", {
                sessionId,
                cacheKey: canonicalKey,
                id: detail.summary.id,
                key: detail.summary.key,
                source: detail.summary.source,
                messageCount: detail.messages?.length ?? 0,
                summaryMessageCount: detail.summary.messageCount,
            });
            // Detail load 同时把 summary 写入 summaryCache: 两个频道都标记 dirty.
            markChannelDirty("summary");
            markChannelDirty("detail");
            return detail;
        })
        .finally(() => {
            entry.promise = null;
        });
    return entry.promise;
}

export function loadQueuedSessionStat(
    service: AISessionsServiceType,
    sessionId: string,
    filePath: string
): Promise<AISessionsStatResponse> {
    return enqueueRequest(statRequestQueue, `Stat:${sessionId}`, () => service.Stat({ id: sessionId, filePath }));
}

export function patchCachedSessionSummary(sessionId: string, summary: SessionSummary): void {
    const canonicalKey = registerSessionAliases(sessionId, summary);
    const summaryEntry = getEntry(summaryCache, canonicalKey);
    summaryEntry.value = { ...(summaryEntry.value ?? summary), ...summary };
    summaryEntry.loadedAt = Date.now();
    // Summary 频道必然 dirty.
    markChannelDirty("summary");

    const detailEntry = detailCache.get(canonicalKey);
    const hadDetail = detailEntry?.value?.summary != null;
    if (detailEntry?.value?.summary != null) {
        detailEntry.value = {
            ...detailEntry.value,
            summary: { ...detailEntry.value.summary, ...summary },
        };
        detailEntry.loadedAt = Date.now();
    }
    // 仅在已有 detail.summary 被同步修改时 bump Detail revision. 没有缓存 detail 时不打扰 detail 频道.
    if (hadDetail) {
        markChannelDirty("detail");
    }
}
