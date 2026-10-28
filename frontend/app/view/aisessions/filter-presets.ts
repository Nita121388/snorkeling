// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// AISessions 保存筛选方案（Filter Presets）。
//
// 纯函数 + localStorage 存储，不依赖 React / jotai，便于单测。
// 快照范围见 prd.md：9 个筛选维度 + 可选排序链/分组模式。
// 不包含 pathFilter（浏览位置）和 query（瞬时时搜索词）。

import { normalizeSessionTags } from "./session-tags";
import type {
    AttachMode,
    DatePreset,
    DateRangeFilter,
    MarkedFilter,
    SessionGroupMode,
    SessionSortChain,
    SourceFilter,
    TagPresenceFilter,
} from "./types";
import { DefaultAttachMode, DefaultDateRange, DefaultTagPresence, sanitizeSortChain } from "./types";
import { normalizePathSelections } from "./utils";

export const FilterPresetsStorageKey = "aisessions.filterPresets.v1";
export const MaxFilterPresets = 30;
export const MaxFilterPresetNameLength = 40;

/** 参与过滤的快照字段（不含浏览位置与搜索词）。 */
export type FilterPresetFilter = {
    source: SourceFilter;
    markedFilter: MarkedFilter;
    dateRange: DateRangeFilter;
    attachMode: AttachMode;
    tagFilters: string[];
    excludeTags: string[];
    tagPresence: TagPresenceFilter;
    pathSelections: string[];
    pathExcludes: string[];
};

/** 可选的视图偏好（排序链 + 分组模式）。 */
export type FilterPresetView = {
    sortChain: SessionSortChain;
    groupMode: SessionGroupMode;
};

export type FilterPreset = {
    id: string;
    name: string;
    createdAt: number;
    updatedAt: number;
    filter: FilterPresetFilter;
    view?: FilterPresetView;
};

const SourceValues: ReadonlySet<string> = new Set(["", "codex", "claude", "opencode", "pi"]);
const MarkedValues: ReadonlySet<string> = new Set(["all", "starred", "unstarred"]);
const AttachValues: ReadonlySet<string> = new Set(["off", "both", "children"]);
const TagPresenceValues: ReadonlySet<string> = new Set(["any", "untagged"]);
const DatePresetValues: ReadonlySet<string> = new Set(["all", "today", "7d", "30d", "custom"]);
const GroupModeValues: ReadonlySet<string> = new Set(["project", "time"]);

export const DefaultFilterPresetFilter: FilterPresetFilter = {
    source: "",
    markedFilter: "all",
    dateRange: DefaultDateRange,
    attachMode: DefaultAttachMode,
    tagFilters: [],
    excludeTags: [],
    tagPresence: DefaultTagPresence,
    pathSelections: [],
    pathExcludes: [],
};

function asStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === "string");
}

function sanitizeSource(value: unknown): SourceFilter {
    return typeof value === "string" && SourceValues.has(value) ? (value as SourceFilter) : "";
}

function sanitizeMarked(value: unknown): MarkedFilter {
    return typeof value === "string" && MarkedValues.has(value) ? (value as MarkedFilter) : "all";
}

function sanitizeAttachMode(value: unknown): AttachMode {
    return typeof value === "string" && AttachValues.has(value) ? (value as AttachMode) : DefaultAttachMode;
}

function sanitizeTagPresence(value: unknown): TagPresenceFilter {
    return typeof value === "string" && TagPresenceValues.has(value)
        ? (value as TagPresenceFilter)
        : DefaultTagPresence;
}

function sanitizeGroupMode(value: unknown): SessionGroupMode {
    return typeof value === "string" && GroupModeValues.has(value) ? (value as SessionGroupMode) : "project";
}

function sanitizeDateRange(value: unknown): DateRangeFilter {
    if (value == null || typeof value !== "object") return { ...DefaultDateRange };
    const record = value as Record<string, unknown>;
    const preset =
        typeof record.preset === "string" && DatePresetValues.has(record.preset)
            ? (record.preset as DatePreset)
            : "all";
    if (preset !== "custom") return { preset };
    const from = typeof record.from === "number" && Number.isFinite(record.from) ? record.from : 0;
    const to = typeof record.to === "number" && Number.isFinite(record.to) ? record.to : 0;
    return { preset: "custom", from, to };
}

function sanitizeName(value: unknown): string {
    if (typeof value !== "string") return "";
    return value.trim().slice(0, MaxFilterPresetNameLength);
}

export function sanitizeFilterPresetFilter(value: unknown): FilterPresetFilter {
    if (value == null || typeof value !== "object") return { ...DefaultFilterPresetFilter };
    const record = value as Record<string, unknown>;
    return {
        source: sanitizeSource(record.source),
        markedFilter: sanitizeMarked(record.markedFilter),
        dateRange: sanitizeDateRange(record.dateRange),
        attachMode: sanitizeAttachMode(record.attachMode),
        tagFilters: normalizeSessionTags(asStringArray(record.tagFilters)),
        excludeTags: normalizeSessionTags(asStringArray(record.excludeTags)),
        tagPresence: sanitizeTagPresence(record.tagPresence),
        pathSelections: normalizePathSelections(asStringArray(record.pathSelections)),
        pathExcludes: normalizePathSelections(asStringArray(record.pathExcludes)),
    };
}

function sanitizeFilterPresetView(value: unknown): FilterPresetView | undefined {
    if (value == null || typeof value !== "object") return undefined;
    const record = value as Record<string, unknown>;
    return {
        sortChain: sanitizeSortChain(record.sortChain),
        groupMode: sanitizeGroupMode(record.groupMode),
    };
}

/**
 * 把任意来源（localStorage / 用户输入）规整成一条可用方案。
 * 缺 name / id 时返回 null（无法展示与去重）。
 */
export function sanitizeFilterPreset(value: unknown): FilterPreset | null {
    if (value == null || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    const id = typeof record.id === "string" && record.id.trim() !== "" ? record.id.trim() : "";
    const name = sanitizeName(record.name);
    if (id === "" || name === "") return null;
    const now = Date.now();
    const createdAt =
        typeof record.createdAt === "number" && Number.isFinite(record.createdAt) ? record.createdAt : now;
    const updatedAt =
        typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt) ? record.updatedAt : createdAt;
    const view = sanitizeFilterPresetView(record.view);
    return {
        id,
        name,
        createdAt,
        updatedAt,
        filter: sanitizeFilterPresetFilter(record.filter),
        ...(view ? { view } : {}),
    };
}

/** 规整整个列表：丢弃非法项、按 id 去重（保留首个）、截断到上限。 */
export function sanitizeFilterPresetList(value: unknown): FilterPreset[] {
    const list = Array.isArray(value) ? value : [];
    const out: FilterPreset[] = [];
    const seen = new Set<string>();
    for (const item of list) {
        const preset = sanitizeFilterPreset(item);
        if (preset == null || seen.has(preset.id)) continue;
        seen.add(preset.id);
        out.push(preset);
        if (out.length >= MaxFilterPresets) break;
    }
    return out;
}

export function readFilterPresets(): FilterPreset[] {
    if (typeof window === "undefined") return [];
    const raw = window.localStorage.getItem(FilterPresetsStorageKey);
    if (raw == null) return [];
    try {
        return sanitizeFilterPresetList(JSON.parse(raw));
    } catch {
        return [];
    }
}

export function writeFilterPresets(list: FilterPreset[]): void {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(FilterPresetsStorageKey, JSON.stringify(sanitizeFilterPresetList(list)));
    } catch {
        // localStorage 写入失败（配额 / 隐私模式）静默降级，不阻断筛选交互。
    }
}

function compareTagLists(a: readonly string[], b: readonly string[]): boolean {
    const left = normalizeSessionTags(a as string[])
        .slice()
        .sort();
    const right = normalizeSessionTags(b as string[])
        .slice()
        .sort();
    if (left.length !== right.length) return false;
    return left.every((tag, index) => tag === right[index]);
}

function comparePathLists(a: readonly string[], b: readonly string[]): boolean {
    const left = normalizePathSelections(a as string[])
        .map((item) => item.toLowerCase())
        .sort();
    const right = normalizePathSelections(b as string[])
        .map((item) => item.toLowerCase())
        .sort();
    if (left.length !== right.length) return false;
    return left.every((item, index) => item === right[index]);
}

function compareDateRange(a: DateRangeFilter, b: DateRangeFilter): boolean {
    if (a.preset !== b.preset) return false;
    if (a.preset !== "custom") return true;
    return (a.from ?? 0) === (b.from ?? 0) && (a.to ?? 0) === (b.to ?? 0);
}

/** 两套筛选条件是否等价（集合比较与顺序无关）。 */
export function filterPresetFilterEqual(a: FilterPresetFilter, b: FilterPresetFilter): boolean {
    return (
        a.source === b.source &&
        a.markedFilter === b.markedFilter &&
        a.attachMode === b.attachMode &&
        a.tagPresence === b.tagPresence &&
        compareDateRange(a.dateRange, b.dateRange) &&
        compareTagLists(a.tagFilters, b.tagFilters) &&
        compareTagLists(a.excludeTags, b.excludeTags) &&
        comparePathLists(a.pathSelections, b.pathSelections) &&
        comparePathLists(a.pathExcludes, b.pathExcludes)
    );
}

function compareSortChain(a: SessionSortChain, b: SessionSortChain): boolean {
    const left = sanitizeSortChain(a);
    const right = sanitizeSortChain(b);
    if (left.length !== right.length) return false;
    return left.every((key, index) => key.field === right[index].field && key.desc === right[index].desc);
}

/** 视图偏好是否等价（缺省视为无视图约束）。 */
export function filterPresetViewEqual(a?: FilterPresetView, b?: FilterPresetView): boolean {
    if (a == null && b == null) return true;
    if (a == null || b == null) return false;
    return a.groupMode === b.groupMode && compareSortChain(a.sortChain, b.sortChain);
}

/**
 * 当前筛选/视图相对某方案是否被修改（用于 dirty 指示）。
 * 方案没有 view（保存时未含视图）时不比较视图。
 */
export function filterPresetIsDirty(
    preset: FilterPreset,
    currentFilter: FilterPresetFilter,
    currentView?: FilterPresetView
): boolean {
    if (!filterPresetFilterEqual(preset.filter, currentFilter)) return true;
    if (preset.view == null) return false;
    return !filterPresetViewEqual(preset.view, currentView);
}

/** 新建一条方案（调用方负责写盘与上限判断）。 */
export function makeFilterPreset(
    name: string,
    filter: FilterPresetFilter,
    view?: FilterPresetView,
    now: number = Date.now()
): FilterPreset {
    return {
        id: newFilterPresetId(),
        name: sanitizeName(name),
        createdAt: now,
        updatedAt: now,
        filter: sanitizeFilterPresetFilter(filter),
        ...(view ? { view: sanitizeFilterPresetView(view) } : {}),
    };
}

function newFilterPresetId(): string {
    const cryptoObj = typeof globalThis !== "undefined" ? (globalThis.crypto as Crypto | undefined) : undefined;
    if (cryptoObj != null && typeof cryptoObj.randomUUID === "function") {
        return cryptoObj.randomUUID();
    }
    return `preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
