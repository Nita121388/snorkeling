// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * 连接使用次数（纯前端 UI 偏好）。
 *
 * 为什么在 localStorage 而不是 settings.json / 后端：
 * - 「点过几次」不是配置语义，写进 connections.json 会污染用户手写的配置，
 *   也会跟着云同步跑到别的机器上（次数是不可合并的计数器，合并只会放大噪声）；
 * - 与 widgetsBarPinned / vendorModelPreferences 同一策略：纯 UI 偏好走 localStorage，
 *   丢了最坏也就是排序回到 display:order。
 *
 * 计数只作排序权重，不做任何界面展示（唯一可见面是行序）。
 */

export const ConnUsageStorageKey = "snorkeling:connUsage";

/** 连接名 → 使用次数。 */
export type ConnUsageMap = Record<string, number>;

/** 保留上限：只记最常用的这些，避免 localStorage 单调增长（滚动淘汰）。 */
const MaxTrackedConns = 200;

function storage(): Storage | null {
    try {
        return typeof window !== "undefined" ? window.localStorage : null;
    } catch {
        // 隐私模式/被策略禁用时读 localStorage 会抛，排序退回 display:order。
        return null;
    }
}

/**
 * 读使用计数。坏数据一律当空表：这份数据只影响排序，
 * 不值得为一条脏 JSON 让连接下拉打不开。
 */
export function loadConnUsage(): ConnUsageMap {
    const store = storage();
    if (store == null) return {};
    let parsed: unknown;
    try {
        parsed = JSON.parse(store.getItem(ConnUsageStorageKey) ?? "{}");
    } catch {
        return {};
    }
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: ConnUsageMap = {};
    for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof value === "number" && Number.isFinite(value) && value > 0) {
            out[name] = value;
        }
    }
    return out;
}

function trimToLimit(map: ConnUsageMap): ConnUsageMap {
    const entries = Object.entries(map);
    if (entries.length <= MaxTrackedConns) return map;
    // 按次数倒序保留前 N 个；次数相同按名字，保证结果确定。
    entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return Object.fromEntries(entries.slice(0, MaxTrackedConns));
}

/** 记一次成功连接，返回最新计数表（调用方通常会塞回 state）。 */
export function recordConnUse(connName: string | null | undefined): ConnUsageMap {
    const name = typeof connName === "string" ? connName.trim() : "";
    if (!name) return loadConnUsage();
    const map = loadConnUsage();
    map[name] = (map[name] ?? 0) + 1;
    const trimmed = trimToLimit(map);
    try {
        storage()?.setItem(ConnUsageStorageKey, JSON.stringify(trimmed));
    } catch {
        // 写失败只影响下次启动的顺序，本次仍返回内存里的新值。
    }
    return trimmed;
}

/**
 * 按使用次数排序：次数 desc → order asc → 原始顺序（稳定）。
 *
 * order 是用户手写的 display:order（默认全 0）。它退化成「同频次的显式优先级」——
 * 这样既让常用连接上浮，又不剥夺用户把某台机器钉在前面的能力。
 *
 * 第三级用**原始下标**而不是名字升序：没有计数数据时（新装/刚清过 localStorage）
 * 排序必须与改动前完全一致 —— 后端已经按 settings > sshconfig > history 给过一个
 * 有意义的顺序，改成字母序等于把它搞丢了。
 * 返回新数组，不原地改入参（调用方常在 render 里直接用）。
 */
export function sortConnItemsByUsage<T extends { value: string }>(
    items: T[],
    usage: ConnUsageMap,
    orderOf?: (connName: string) => number
): T[] {
    const countOf = (name: string) => usage?.[name] ?? 0;
    const orderValueOf = (name: string) => {
        const raw = orderOf?.(name);
        return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
    };
    return items
        .map((item, index) => ({ item, index }))
        .sort((a, b) => {
            const byCount = countOf(b.item.value) - countOf(a.item.value);
            if (byCount !== 0) return byCount;
            const byOrder = orderValueOf(a.item.value) - orderValueOf(b.item.value);
            if (byOrder !== 0) return byOrder;
            return a.index - b.index;
        })
        .map((entry) => entry.item);
}
