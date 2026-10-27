// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export type SourceFilter = "" | "codex" | "claude" | "opencode" | "pi";

// Key of the transient "new chat" placeholder shown in the session list until
// the backend assigns a real session id (first message) and List picks it up.
export const NewSessionKey = "__new__";

export type MarkedFilter = "all" | "starred" | "unstarred";

// Tag-presence filter. "any" = no constraint (default). "untagged" = sessions
// whose normalized tag list is empty (note may still contain a "#" token that
// fails isSessionTagRune, but if any valid tag parsed it counts as tagged).
// Mutually exclusive with a non-empty tagFilters list at the UI layer; the
// ViewModel enforces the reset on either side, and the backend defends again.
export type TagPresenceFilter = "any" | "untagged";

export const DefaultTagPresence: TagPresenceFilter = "any";

export type DatePreset = "all" | "today" | "7d" | "30d" | "custom";

export type DateRangeFilter = {
    preset: DatePreset;
    from?: number;
    to?: number;
};

// Path filter: root is the disk/home-prefix cluster short name (e.g. "E:\\", "~/"),
// "" means All, "other" is the catch-all bucket for empty / unrecognized projectPath.
// subPath is the further-narrowed prefix under root (without the root part).
// Matching is delegated to backend `project` field (case-insensitive substring on projectPath).
export type PathFilter = {
    root: string;
    subPath: string;
};

export const DefaultPathFilter: PathFilter = { root: "", subPath: "" };

// "__other__" is the sentinel the backend understands (aisessions.ProjectFilterOther):
// sessions whose projectPath is empty / not an absolute path. With multi-select the
// frontend can no longer post-filter the response (the server only returns the
// selected prefixes), so the sentinel travels as a normal prefix value.
export const PathFilterOtherRoot = "__other__";

/** 包含侧已选目录前缀集合（可含 PathFilterOtherRoot）。 */
export const DefaultPathSelections: string[] = [];

/** 排除侧目录前缀集合。 */
export const DefaultPathExcludes: string[] = [];

/** 排除侧标签集合。 */
export const DefaultExcludeTags: string[] = [];

export const DefaultDateRange: DateRangeFilter = { preset: "7d" };

export function dateRangeToSinceBefore(range: DateRangeFilter, now: number): { since: number; before: number } {
    if (!range || range.preset === "all") return { since: 0, before: 0 };
    if (range.preset === "custom") {
        const since = range.from ?? 0;
        const before = range.to ?? 0;
        return { since, before };
    }
    const dayMs = 24 * 60 * 60 * 1000;
    if (range.preset === "today") {
        const startOfDay = new Date(now);
        startOfDay.setHours(0, 0, 0, 0);
        return { since: startOfDay.getTime(), before: 0 };
    }
    const days = range.preset === "7d" ? 7 : 30;
    return { since: now - days * dayMs, before: 0 };
}

export const sortPreferenceStorageKey = "aisessions.sortDescending";
export const sortChainStorageKey = "aisessions.sortChain";
export const groupPreferenceStorageKey = "aisessions.groupMode";
/** 列表工具栏「展开全部标签」的全局偏好（方案 B）。 */
export const expandAllTagsStorageKey = "aisessions.expandAllTags";
export type SessionGroupMode = "project" | "time";

/**
 * 筛选结果的父子上下文补带模式。
 *
 * - off      精确：只显示自身命中筛选的行（改动前的行为）
 * - both     智能：命中子代理时补带父，命中父代理时带出子代理（默认）
 * - children 只带出子代理：命中父才展开子，命中子不回填父
 */
export type AttachMode = "off" | "both" | "children";

export const DefaultAttachMode: AttachMode = "both";
export const attachModeStorageKey = "aisessions.attachMode";

/**
 * AI Sessions 排序链。
 *
 * 多键排序：链项前者优先级高，全相等时用隐式 `updatedAt` 降序 + `key` 升序兜底
 * （见 utils.ts → makeSessionComparator）。
 */
export type SessionSortField = "time" | "messages" | "subagents";

export type SessionSortKey = {
    field: SessionSortField;
    /** true = 降序（新→旧 / 多→少）；false = 升序。 */
    desc: boolean;
};

export type SessionSortChain = SessionSortKey[];

/** 链最多几项：足够表达「子会话数 → 消息数 → 时间」，再多列表就难读了。 */
export const MaxSortChainLength = 3;

/** 默认排序：等价改造前的「新→旧」。 */
export const DefaultSortChain: SessionSortChain = [{ field: "time", desc: true }];

const SortFields: ReadonlySet<string> = new Set(["time", "messages", "subagents"]);

function isSortField(value: unknown): value is SessionSortField {
    return typeof value === "string" && SortFields.has(value);
}

/**
 * 把任意来源（localStorage / 用户操作）的排序链规整成可用值。
 *
 * - 非法 field 丢弃；同 field 只保留第一次出现（避免「消息数降 + 消息数升」互相抵消）。
 * - 截断到 MaxSortChainLength。
 * - 空链回落到 DefaultSortChain，保证列表永远有确定的顺序。
 */
export function sanitizeSortChain(raw: unknown): SessionSortChain {
    const list = Array.isArray(raw) ? raw : [];
    const out: SessionSortChain = [];
    const seen = new Set<SessionSortField>();
    for (const item of list) {
        if (item == null || typeof item !== "object") continue;
        const record = item as Record<string, unknown>;
        const field = record.field;
        if (!isSortField(field) || seen.has(field)) continue;
        seen.add(field);
        out.push({ field, desc: record.desc !== false });
        if (out.length >= MaxSortChainLength) break;
    }
    return out.length > 0 ? out : DefaultSortChain.map((key) => ({ ...key }));
}

/**
 * 读排序链。
 *
 * 迁移顺序：新键 `aisessions.sortChain` → 旧键 `aisessions.sortDescending`（布尔方向）
 * → DefaultSortChain。旧键只在没有新键时生效，保证升级用户无感。
 */
export function readSortChain(): SessionSortChain {
    if (typeof window === "undefined") return DefaultSortChain.map((key) => ({ ...key }));
    const rawChain = window.localStorage.getItem(sortChainStorageKey);
    if (rawChain != null) {
        try {
            return sanitizeSortChain(JSON.parse(rawChain));
        } catch {
            // 坏 JSON 当作没配置，继续走旧键 / 默认。
        }
    }
    const legacy = window.localStorage.getItem(sortPreferenceStorageKey);
    if (legacy != null) {
        return [{ field: "time", desc: legacy !== "0" }];
    }
    return DefaultSortChain.map((key) => ({ ...key }));
}

export function writeSortChain(chain: SessionSortChain): void {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(sortChainStorageKey, JSON.stringify(sanitizeSortChain(chain)));
}
