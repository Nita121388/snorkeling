// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { AISessionsServiceType } from "@/app/store/services";
import debug from "debug";

// UserOutline 前端缓存：让「多个组件各自拉 outline」收敛为「同一会话共享一份」，
// 并用 TTL + 在途合并避免重复/并发请求。模式对齐 session-overview-session-cache。
// 会话大纲是低实时性数据（最近几条用户消息），TTL 内旧几十秒完全可接受；
// 用户主动展开会话条时走 forceRefresh，保证看到最新。
// 30s TTL: 平衡 "hover/重渲染不重复打后端" 与 "大纲不过期太旧"。

const dlog = debug("wave:outlinecache");

type CacheEntry = {
    value: AISessionsUserOutlineResponse | null;
    loadedAt: number;
    promise: Promise<AISessionsUserOutlineResponse | null> | null;
};

const OutlineTtlMs = 30_000;

const outlineCache = new Map<string, CacheEntry>();

function normalizeConnection(connection: string | null | undefined): string {
    return typeof connection === "string" && connection.trim() !== "" ? connection.trim() : "";
}

// 同一 sessionId 可能出现在不同 connection 上，键需带上 connection 隔离。
function cacheKey(sessionId: string, connection?: string | null): string {
    return `${normalizeConnection(connection)}|${sessionId}`;
}

function getEntry(key: string): CacheEntry {
    let entry = outlineCache.get(key);
    if (entry == null) {
        entry = { value: null, loadedAt: 0, promise: null };
        outlineCache.set(key, entry);
    }
    return entry;
}

function isFresh(entry: CacheEntry): boolean {
    return entry.value != null && Date.now() - entry.loadedAt < OutlineTtlMs;
}

export function getCachedUserOutline(
    sessionId: string,
    connection?: string | null
): AISessionsUserOutlineResponse | null {
    if (!sessionId) {
        return null;
    }
    return getEntry(cacheKey(sessionId, connection)).value;
}

export function invalidateUserOutline(sessionId: string, connection?: string | null): void {
    if (!sessionId) {
        return;
    }
    outlineCache.delete(cacheKey(sessionId, connection));
}

// 仅供测试使用：清空模块级缓存。
export function resetUserOutlineCache(): void {
    outlineCache.clear();
}

export type LoadUserOutlineOpts = {
    connection?: string | null;
    forceRefresh?: boolean;
    limit?: number;
};

export function loadUserOutline(
    service: AISessionsServiceType,
    sessionId: string,
    opts: LoadUserOutlineOpts = {}
): Promise<AISessionsUserOutlineResponse | null> {
    if (!sessionId) {
        return Promise.resolve(null);
    }
    const key = cacheKey(sessionId, opts.connection);
    const entry = getEntry(key);
    if (!opts.forceRefresh && isFresh(entry)) {
        dlog("outline cache hit", { sessionId, ageMs: Date.now() - entry.loadedAt });
        return Promise.resolve(entry.value);
    }
    if (!opts.forceRefresh && entry.promise != null) {
        dlog("outline in-flight reuse", { sessionId });
        return entry.promise;
    }
    dlog("outline request", { sessionId, forceRefresh: opts.forceRefresh === true });
    const request = service
        .UserOutline({
            id: sessionId,
            connection: opts.connection,
            limit: opts.limit ?? 20,
            refresh: opts.forceRefresh === true,
        })
        .then((outline) => {
            entry.value = outline;
            entry.loadedAt = Date.now();
            entry.promise = null;
            return outline;
        })
        .catch((err) => {
            entry.promise = null;
            throw err;
        });
    entry.promise = request;
    return request;
}
