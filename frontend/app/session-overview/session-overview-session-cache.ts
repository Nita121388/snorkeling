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
const cacheSubscribers = new Set<() => void>();
const summaryRequestQueue: RequestQueue = { active: 0, limit: SummaryRequestConcurrency, pending: [] };
const detailRequestQueue: RequestQueue = { active: 0, limit: DetailRequestConcurrency, pending: [] };
const statRequestQueue: RequestQueue = { active: 0, limit: StatRequestConcurrency, pending: [] };
const dlog = debug("wave:sessionoverview");

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

function notifyCacheSubscribers(): void {
    for (const subscriber of cacheSubscribers) {
        subscriber();
    }
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
            notifyCacheSubscribers();
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
            notifyCacheSubscribers();
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

    const detailEntry = detailCache.get(canonicalKey);
    if (detailEntry?.value?.summary != null) {
        detailEntry.value = {
            ...detailEntry.value,
            summary: { ...detailEntry.value.summary, ...summary },
        };
        detailEntry.loadedAt = Date.now();
    }
    notifyCacheSubscribers();
}
