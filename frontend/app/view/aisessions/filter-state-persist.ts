// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// AISessions 筛选状态持久化（每个 block 一份）。
//
// 背景：InlineTabBlock 只挂载当前激活的子 block（block.tsx），切 tab 会卸载旧块并
// dispose 它的 ViewModel，切回来是全新 VM，筛选 atom 全部回默认值。这里把当前筛选
// 快照写进 block meta（随布局持久化、随 block 关闭清理），VM 构造时读回。
//
// 快照口径与 Filter Presets 完全一致（不落 query / pathFilter / 选中行等瞬时态），
// 复用 sanitizeFilterPresetFilter 做降级，坏数据一律退回默认值，绝不抛错。

import {
    DefaultFilterPresetFilter,
    filterPresetFilterEqual,
    sanitizeFilterPresetFilter,
    type FilterPresetFilter,
} from "./filter-presets";

/** block meta 键：值为 JSON 字符串，写入走 SetMetaCommand。 */
export const FilterStateMetaKey = "aisessions:filterstate:v1";

export type PersistedFilterState = {
    filter: FilterPresetFilter;
    /** 当前绑定的筛选方案 id；空串 = 未绑定。 */
    activePresetId: string;
};

export const DefaultPersistedFilterState: PersistedFilterState = {
    filter: DefaultFilterPresetFilter,
    activePresetId: "",
};

function parsePayload(value: unknown): unknown {
    if (typeof value !== "string") return value;
    if (value.trim() === "") return null;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

/**
 * 解析 meta 里的筛选快照。
 * 缺失 / 坏 JSON / 非对象 → null（调用方保持默认筛选）；字段非法 → 逐项降级。
 */
export function parseFilterStateMeta(value: unknown): PersistedFilterState | null {
    const payload = parsePayload(value);
    if (payload == null || typeof payload !== "object" || Array.isArray(payload)) return null;
    const record = payload as Record<string, unknown>;
    const rawPresetId = typeof record.activePresetId === "string" ? record.activePresetId.trim() : "";
    return {
        filter: sanitizeFilterPresetFilter(record.filter),
        activePresetId: rawPresetId,
    };
}

/** 生成写入 meta 的 JSON 字符串（写入前再 sanitize 一次，防止瞬时脏值落盘）。 */
export function buildFilterStateMeta(state: PersistedFilterState): string {
    return JSON.stringify({
        filter: sanitizeFilterPresetFilter(state.filter),
        activePresetId: typeof state.activePresetId === "string" ? state.activePresetId : "",
    });
}

/** 两份快照是否等价（筛选字段顺序无关；方案 id 精确比较）。 */
export function filterStateEqual(a: PersistedFilterState | null, b: PersistedFilterState | null): boolean {
    if (a == null || b == null) return a === b;
    if (a.activePresetId !== b.activePresetId) return false;
    return filterPresetFilterEqual(a.filter, b.filter);
}

/**
 * 方案 id 校验：meta 里的 id 可能指向已被删除的方案。
 * 找不到时清空绑定，避免工具栏显示一个不存在的方案。
 */
export function resolveRestoredPresetId(savedId: string, availableIds: readonly string[]): string {
    if (savedId === "") return "";
    return availableIds.includes(savedId) ? savedId : "";
}

// ── 内存热缓存 ────────────────────────────────────────────────────
// meta 写入是异步 RPC：块卸载时刚发出去的 SetMetaCommand 可能在用户快速切回来之前
// 还没落到 block 对象上。用一张按 blockId 的热缓存兜住这一瞬间，保证「切走立刻切回」
// 也能拿到最新筛选（meta 仍然负责跨重启持久化）。

const MaxCachedFilterStates = 50;
const filterStateCache = new Map<string, PersistedFilterState>();

function copyFilterState(state: PersistedFilterState): PersistedFilterState {
    return {
        filter: {
            ...state.filter,
            dateRange: { ...state.filter.dateRange },
            tagFilters: [...state.filter.tagFilters],
            excludeTags: [...state.filter.excludeTags],
            pathSelections: [...state.filter.pathSelections],
            pathExcludes: [...state.filter.pathExcludes],
        },
        activePresetId: state.activePresetId,
    };
}

/** 记住某个 block 的最新筛选（纯内存，不触发 IO）。 */
export function rememberFilterState(blockId: string, state: PersistedFilterState): void {
    if (blockId === "") return;
    filterStateCache.delete(blockId);
    filterStateCache.set(blockId, copyFilterState(state));
    while (filterStateCache.size > MaxCachedFilterStates) {
        const oldest = filterStateCache.keys().next();
        if (oldest.done === true) break;
        filterStateCache.delete(oldest.value);
    }
}

/** 取内存里的最新筛选；没有则返回 null（调用方回落到 block meta）。 */
export function recallFilterState(blockId: string): PersistedFilterState | null {
    const cached = filterStateCache.get(blockId);
    return cached == null ? null : copyFilterState(cached);
}

/** 仅测试用：清空热缓存。 */
export function clearFilterStateCache(): void {
    filterStateCache.clear();
}
