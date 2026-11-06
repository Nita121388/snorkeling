// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// available-session-tags — 全局标签清单的单一来源。
//
// 为什么要这个模块：`Tags` RPC 早就返回 `SessionTagSummary{tag, count}`（后端按 ListOptions 统计），
// 但前端只有 aisessions 筛选面板消费它。agent 卡片上的 Tags 编辑器
// （element/property-editor/tag-editor.tsx）因此只能拿到「本会话自己的标签」当候选，
// 用户看不到别的会话用过什么标签。
//
// 约定（与 session-note-cache.ts 同模式）：
//   - 按 (connection, origin) 分桶，不跨机器混标签；
//   - 只传最小过滤：卡片上的 count 是「全局出现次数」，不能被 aisessions 的临时筛选污染；
//   - in-flight 合并 + 成功缓存 + 失败不缓存（失败退化为空清单，UI 自然回落旧候选池）；
//   - 快照同一性：只有内容真的变了才换引用，否则 useSyncExternalStore 会无限重渲染。

import { AISessionsServiceType } from "@/app/store/services";

/** 清单桶键：同一台机器（connection）下按 origin 再分。 */
export type AvailableTagsKey = {
    connection: string;
    origin: string;
};

type TagsEntry = {
    snapshot: SessionTagSummary[];
    /** 内容版本：只有清单真的变化时才递增（快照同一性）。 */
    version: number;
    loadedAt: number;
    promise: Promise<SessionTagSummary[]> | null;
    listeners: Set<() => void>;
};

/** 清单软过期时间。hover 卡是高频挂载组件，没有 TTL 会被 hover 风暴打穿 RPC。 */
const AvailableTagsTtlMs = 60_000;

/** 空清单常量：让「未加载 / 失败 / 空结果」共用同一个引用。 */
const EmptyTags: SessionTagSummary[] = [];

const cache = new Map<string, TagsEntry>();

function normalizeConnection(connection: string | null | undefined): string {
    return typeof connection === "string" ? connection.trim() : "";
}

function normalizeOrigin(origin: string | null | undefined): string {
    return typeof origin === "string" ? origin.trim() : "";
}

/**
 * 桶键。用 `\u0000` 分隔，避免 connection / origin 里出现分隔符时互相串桶。
 * （connection 可能是 ssh 目标串，含 `:` `.` `@`，不能拿它们当分隔符。）
 */
export function availableTagsCacheKey(key: AvailableTagsKey): string {
    return `${normalizeConnection(key.connection)}\u0000${normalizeOrigin(key.origin)}`;
}

function getEntry(key: AvailableTagsKey): TagsEntry {
    const cacheKeyValue = availableTagsCacheKey(key);
    let entry = cache.get(cacheKeyValue);
    if (entry == null) {
        entry = {
            snapshot: EmptyTags,
            version: 0,
            loadedAt: 0,
            promise: null,
            listeners: new Set(),
        };
        cache.set(cacheKeyValue, entry);
    }
    return entry;
}

function notify(entry: TagsEntry): void {
    for (const listener of entry.listeners) {
        listener();
    }
}

/** 稳定快照：内容未变时保持同一引用。 */
export function getAvailableTagsSnapshot(key: AvailableTagsKey): SessionTagSummary[] {
    return getEntry(key).snapshot;
}

/** 订阅某桶的清单变化；返回 unsubscribe。 */
export function subscribeAvailableTags(key: AvailableTagsKey, listener: () => void): () => void {
    const entry = getEntry(key);
    entry.listeners.add(listener);
    return () => {
        entry.listeners.delete(listener);
    };
}

/** 两个清单的 tag 数 + 每个 tag 的 count 全等。用于决定要不要换快照引用。 */
function tagsEqual(left: SessionTagSummary[], right: SessionTagSummary[]): boolean {
    if (left === right) return true;
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i++) {
        if (left[i].tag !== right[i].tag || left[i].count !== right[i].count) return false;
    }
    return true;
}

function applyTags(entry: TagsEntry, next: SessionTagSummary[]): SessionTagSummary[] {
    entry.loadedAt = Date.now();
    if (!tagsEqual(entry.snapshot, next)) {
        entry.snapshot = next;
        entry.version++;
        notify(entry);
    }
    return entry.snapshot;
}

/** 是否是「够新」的缓存：已加载过且未过期。 */
function isFresh(entry: TagsEntry): boolean {
    return entry.loadedAt > 0 && Date.now() - entry.loadedAt <= AvailableTagsTtlMs;
}

export type EnsureAvailableTagsOptions = {
    /** 强制绕过 TTL 重新拉取（旧快照继续展示）。 */
    refresh?: boolean;
    /** 注入服务实例（单测用；缺省 new AISessionsServiceType()）。 */
    service?: AISessionsServiceType;
};

/**
 * 触发一次拉取。返回该桶的最新清单（失败时为空清单，不缓存错误态）。
 *
 * - `refresh` 未给：命中 TTL 直接返回；否则发一次 RPC。
 * - `refresh === true`：无条件重发（并发时仍合并到同一个 in-flight 请求）。
 */
export async function ensureAvailableTags(
    key: AvailableTagsKey,
    opts: EnsureAvailableTagsOptions = {}
): Promise<SessionTagSummary[]> {
    const entry = getEntry(key);
    if (opts.refresh !== true && isFresh(entry)) {
        return entry.snapshot;
    }
    if (entry.promise != null) {
        return entry.promise;
    }

    const service = opts.service ?? new AISessionsServiceType();
    const connection = normalizeConnection(key.connection);
    const origin = normalizeOrigin(key.origin);

    const promise = (async () => {
        try {
            // 最小过滤：只带 connection / origin。
            // 不带 since / before / marked / tagFilters / excludeTags / projects ——
            // 那些是 aisessions 的临时筛选，混进来会让卡片上的 count 忽大忽小。
            const response = await service.Tags({
                connection: connection || undefined,
                origin: origin || undefined,
                refresh: opts.refresh === true,
            });
            const tags = Array.isArray(response?.tags) ? response.tags : [];
            return applyTags(entry, tags);
        } catch {
            // 失败不缓存：下一次 ensure 会重新尝试；调用方拿到空清单（宿主的旧快照仍可用）。
            return entry.snapshot;
        } finally {
            entry.promise = null;
        }
    })();

    entry.promise = promise;
    return promise;
}

/** 单测用：清空所有桶（含 in-flight 句柄）。生产代码不要调用。 */
export function __resetAvailableTagsCacheForTest(): void {
    cache.clear();
}
