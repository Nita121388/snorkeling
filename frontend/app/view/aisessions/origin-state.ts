// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// AISessions origin 选择持久化（每个 block 一份）。
//
// 与 filter-state-persist 同套路：InlineTabBlock 切 tab 会 dispose VM、切回来是全新
// VM，所以把当前选中的 origin id 写进 block meta（随布局持久化、随 block 关闭清理），
// 并在内存里留一张热缓存兜住「切走立刻切回」时 meta RPC 还没落地的瞬间。
//
// 只存 id（字符串）：可用 origin 列表始终以后端 Origins RPC 为准，meta 里的 id 找不到
// 时回落到本地 origin，避免指向一个已被删除的外部根。

/** block meta 键：值为 JSON 字符串，写入走 SetMetaCommand。 */
export const OriginMetaKey = "aisessions:origin:v1";

const OriginLocalId = "local";
const MaxCachedOrigins = 50;
const originCache = new Map<string, string>();

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
 * 解析 meta 里的 origin 快照。缺失 / 坏 JSON / 非对象 / 非字符串 id → null
 * （调用方回落到本地 origin）。
 */
export function parseOriginMeta(value: unknown): string | null {
    const payload = parsePayload(value);
    if (payload == null || typeof payload !== "object" || Array.isArray(payload)) return null;
    const record = payload as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    return id === "" ? null : id;
}

/** 生成写入 meta 的 JSON 字符串。 */
export function buildOriginMeta(id: string): string {
    return JSON.stringify({ id: typeof id === "string" ? id.trim() : "" });
}

/**
 * 校验：meta / 缓存里的 id 可能指向已被删除的外部 origin。
 * 找不到时回落到本地 origin。
 */
export function resolveRestoredOriginId(savedId: string | null, availableIds: readonly string[]): string {
    if (savedId == null || savedId === "") return OriginLocalId;
    return availableIds.includes(savedId) ? savedId : OriginLocalId;
}

/** 记住某个 block 的最新 origin（纯内存，不触发 IO）。 */
export function rememberOrigin(blockId: string, id: string): void {
    if (blockId === "") return;
    originCache.delete(blockId);
    originCache.set(blockId, id);
    while (originCache.size > MaxCachedOrigins) {
        const oldest = originCache.keys().next();
        if (oldest.done === true) break;
        originCache.delete(oldest.value);
    }
}

/** 取内存里的最新 origin；没有则返回 null（调用方回落到 block meta）。 */
export function recallOrigin(blockId: string): string | null {
    return originCache.get(blockId) ?? null;
}

/** 仅测试用：清空热缓存。 */
export function clearOriginCache(): void {
    originCache.clear();
}
