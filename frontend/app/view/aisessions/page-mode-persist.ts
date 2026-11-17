// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// AISessions 会话详情「分页方式」持久化（每个 block 一份，键 = connection + sessionKey）。
//
// 背景（主文档 §4.2c-1）：分页方式的选择要「切 tab / 重开不丢」，且同一块里换会话时
// 每个会话记自己那份（同一块可以先后看很多会话）。所以落点是 block meta 里的一张表：
//   { version: 1, sessions: { "<connection>\0<sessionKey>": PersistedPageMode } }
// meta 随布局持久化、随 block 关闭清理；写入走 SetMetaCommand（debounce）。
//
// 与 `filter-state-persist.ts` 同一套范式：**纯函数**（解析 / 降级 / 等价判定）+
// 模块级内存热缓存（meta 写入是异步 RPC，块卸载后立刻切回来可能读到未落地的旧 meta）。
// 本模块不 import jotai / electron，因此可直接单测。
//
// 分页状态只记「用户选择」，不记瞬时态（当前页下标 / 翻页动画）：页下标随数据变化
// 重新夹取，落盘反而会恢复到一个已经不存在或语义错位的页。

import { CountDefaultSize, IntervalDefaultHours, type PageMode } from "./annotation-model";

/** block meta 键：值为 JSON 字符串，写入走 SetMetaCommand。 */
export const PageModeMetaKey = "aisessions:pagemode:v1";
/** 状态变化 → 落盘的合并窗口（与 10-29 筛选状态同一量级）。 */
export const PageModeWriteDebounceMs = 400;
/** 单 block 记忆的会话上限：超过按插入顺序淘汰最旧的一条（防止 meta 无限增长）。 */
export const MaxPersistedPageModes = 40;

export type PersistedPageMode = {
    mode: PageMode;
    /** interval 模式窗口小时数（脏值夹取到 [1, 24]）。 */
    intervalHours: number;
    /** count 模式每页条数（脏值夹取到 [1, 500]）。 */
    countSize: number;
    /** 用户是否手动选过分页方式：false = 允许 autoPageMode 按消息量覆盖（§4.2c-1）。 */
    userSet: boolean;
};

/** 持久化表：状态键（见 pageModeStateKey）→ 该会话的分页选择。 */
export type PersistedPageModeMap = Record<string, PersistedPageMode>;

/** 没有任何历史记录时的取值（全部分页 = 显示全部）。 */
export const DefaultPersistedPageMode: PersistedPageMode = {
    mode: "all",
    intervalHours: IntervalDefaultHours,
    countSize: CountDefaultSize,
    userSet: false,
};

const PageModes: readonly PageMode[] = ["all", "day", "turn", "interval", "count"];

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
    const numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(Math.max(Math.floor(numeric), min), max);
}

/**
 * 单条状态降级：mode 不在枚举 → 全部；intervalHours / countSize 越界 → 夹取
 * （不报错：持久化/跨版本数据可能带旧档位或脏值，UI 仍要能开）。
 */
export function sanitizePersistedPageMode(raw: unknown): PersistedPageMode {
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return { ...DefaultPersistedPageMode };
    const record = raw as Record<string, unknown>;
    const mode = typeof record.mode === "string" && PageModes.includes(record.mode as PageMode)
        ? (record.mode as PageMode)
        : DefaultPersistedPageMode.mode;
    return {
        mode,
        intervalHours: clampNumber(record.intervalHours, DefaultPersistedPageMode.intervalHours, 1, 24),
        countSize: clampNumber(record.countSize, DefaultPersistedPageMode.countSize, 1, 500),
        // 非布尔一律按「用户没选过」处理：宁可让 autoPageMode 生效，也不要假装用户选过。
        userSet: record.userSet === true,
    };
}

/**
 * 持久化键：connection + sessionKey。
 * 本地连接存在 "" / "local" / "local:*" 三种拼写，先归一化再拼，避免同一会话记成多份。
 */
export function pageModeStateKey(connection: string | undefined, sessionKey: string): string {
    const session = (sessionKey ?? "").trim();
    if (session === "") return "";
    const rawConnection = (connection ?? "").trim();
    const canonical =
        rawConnection === "" || rawConnection === "local" || rawConnection.startsWith("local:")
            ? "local"
            : rawConnection;
    return `${canonical}\u0000${session}`;
}

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
 * 解析 meta 里的分页快照。
 * 缺失 / 坏 JSON / 非对象 → null（调用方保持默认）；单条坏数据 → 该条降级，其余保留。
 */
export function parsePageModeMeta(value: unknown): PersistedPageModeMap | null {
    const payload = parsePayload(value);
    if (payload == null || typeof payload !== "object" || Array.isArray(payload)) return null;
    const record = payload as Record<string, unknown>;
    // 信封形状 { version, sessions }；也接受裸 map（早期手写数据 / 测试直给）。
    const sessions = record.sessions;
    const source =
        sessions != null && typeof sessions === "object" && !Array.isArray(sessions)
            ? (sessions as Record<string, unknown>)
            : record;
    const map: PersistedPageModeMap = {};
    for (const [key, entry] of Object.entries(source)) {
        if (key === "version" || key === "sessions") continue;
        if (entry == null || typeof entry !== "object") continue;
        map[key] = sanitizePersistedPageMode(entry);
    }
    return map;
}

/** 生成写入 meta 的 JSON 字符串（写入前再 sanitize 一次，防止瞬时脏值落盘）。 */
export function buildPageModeMeta(map: PersistedPageModeMap): string {
    const sessions: PersistedPageModeMap = {};
    for (const [key, entry] of Object.entries(map)) {
        if (key === "") continue;
        sessions[key] = sanitizePersistedPageMode(entry);
    }
    return JSON.stringify({ version: 1, sessions });
}

/** 取某个会话的记录；没有则 null（调用方回落到 autoPageMode 默认值）。 */
export function getPersistedPageMode(
    map: PersistedPageModeMap | null | undefined,
    key: string
): PersistedPageMode | null {
    if (key === "" || map == null) return null;
    const entry = map[key];
    return entry == null ? null : { ...entry };
}

/**
 * 写入一条记录并返回新表（不改原表）。
 * 已有的键保留原插入顺序（更新不算新增），超过上限淘汰最旧的一条。
 */
export function withPersistedPageMode(
    map: PersistedPageModeMap | null | undefined,
    key: string,
    state: PersistedPageMode,
    maxEntries: number = MaxPersistedPageModes
): PersistedPageModeMap {
    const next: PersistedPageModeMap = {};
    if (key === "") return { ...(map ?? {}) };
    for (const [existingKey, entry] of Object.entries(map ?? {})) {
        if (existingKey === key) continue;
        next[existingKey] = entry;
    }
    next[key] = sanitizePersistedPageMode(state);
    const limit = Math.max(1, Math.floor(maxEntries));
    const keys = Object.keys(next);
    if (keys.length > limit) {
        for (const staleKey of keys.slice(0, keys.length - limit)) delete next[staleKey];
    }
    return next;
}

/** 两份记录是否等价（用于跳过无意义的 meta 写入）。 */
export function pageModeEqual(
    left: PersistedPageMode | null | undefined,
    right: PersistedPageMode | null | undefined
): boolean {
    if (left == null || right == null) return left === right;
    return (
        left.mode === right.mode &&
        left.intervalHours === right.intervalHours &&
        left.countSize === right.countSize &&
        left.userSet === right.userSet
    );
}

// ── 内存热缓存 ────────────────────────────────────────────────────
// SetMetaCommand 是异步 RPC：块卸载后立刻切回来时，meta 可能还没落地。
// 用一张按 blockId 的热缓存兜住这一瞬间（meta 仍负责跨重启持久化）。

const MaxCachedBlocks = 20;
const pageModeCache = new Map<string, PersistedPageModeMap>();

function copyMap(map: PersistedPageModeMap): PersistedPageModeMap {
    const copy: PersistedPageModeMap = {};
    for (const [key, entry] of Object.entries(map)) copy[key] = { ...entry };
    return copy;
}

/** 记住某个 block 的最新分页表（纯内存，不触发 IO）。 */
export function rememberPageModeMap(blockId: string, map: PersistedPageModeMap): void {
    if (blockId === "") return;
    pageModeCache.delete(blockId);
    pageModeCache.set(blockId, copyMap(map));
    while (pageModeCache.size > MaxCachedBlocks) {
        const oldest = pageModeCache.keys().next();
        if (oldest.done === true) break;
        pageModeCache.delete(oldest.value);
    }
}

/** 取内存里的最新分页表；没有则 null（调用方回落到 block meta）。 */
export function recallPageModeMap(blockId: string): PersistedPageModeMap | null {
    const cached = pageModeCache.get(blockId);
    return cached == null ? null : copyMap(cached);
}

/** 仅测试用：清空热缓存。 */
export function clearPageModeCache(): void {
    pageModeCache.clear();
}
