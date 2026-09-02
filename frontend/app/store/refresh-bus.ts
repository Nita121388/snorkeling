// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as jotai from "jotai";
import { globalStore } from "@/store/jotaiStore";

/**
 * Central Refresh Bus — 单一事实源，驱动 AISession 与 Overview 的刷新行为。
 *
 * 替代两处独立的 setInterval 轮询，转为：
 *   1. 事件驱动：文件系统变更 / IPC 推送 → bumpRevision()
 *   2. 全局定时器：仅一个 15s tick，按需唤醒活跃视图
 *   3. 视图级按需刷新：订阅 revisionAtom，仅在 active && visible 时真正发起请求
 *
 * 使用方式：
 *   - 导入 refreshBus 单例
 *   - 在视图 useEffect 中订阅 revision → 调用 loadSessions / loadCachedSessionSummary
 *   - 在定时器 / 事件回调中调用 refreshBus.bumpRevision()
 */

// --- Atom 定义 ---

/** 单调递增的版本号，每次 bump +1。视图通过订阅此 atom 感知变更。 */
export const revisionAtom = jotai.atom(0);

/** 上一次手动刷新的时间戳（ms）。用于图标状态推导。 */
export const lastManualRefreshAtAtom = jotai.atom(0);

/** 最后一次 bump 的时间戳（ms），包括自动和手动。 */
export const lastBumpAtAtom = jotai.atom(0);

/** 自动刷新是否启用（由 settings/CLI 控制）。 */
export const autoRefreshEnabledAtom = jotai.atom(true);

/** 自动刷新间隔（ms）。默认 15_000。 */
export const autoRefreshIntervalMsAtom = jotai.atom(15_000);

// --- 操作 ---

/**
 * 手动触发一次刷新。
 * 立即 bump revision + 记录时间，供图标使用。
 */
export function bumpRevision(source: "manual" | "auto" | "event" = "manual"): void {
    const prev = globalStore.get(revisionAtom);
    globalStore.set(revisionAtom, prev + 1);
    globalStore.set(lastBumpAtAtom, Date.now());
    if (source === "manual") {
        globalStore.set(lastManualRefreshAtAtom, Date.now());
    }
}

/**
 * 视图级 hook 返回的 revision 值。
 * 视图应在此值变化时触发 loadSessions。
 */
export function getRevision(): number {
    return globalStore.get(revisionAtom);
}

/**
 * 订阅 revision 变化。
 * 返回 unsubscribe 函数。
 */
export function onRevisionChange(callback: () => void): () => void {
    return globalStore.sub(revisionAtom, callback);
}

// --- 全局定时器管理 ---

let globalTimerHandle: ReturnType<typeof setInterval> | null = null;

/**
 * 启动全局自动刷新定时器。
 * 应在应用入口处调用一次。
 * 定时器在 document.hidden 时暂停，避免无谓唤醒。
 */
export function startGlobalAutoRefreshTimer(): void {
    if (globalTimerHandle != null) return;

    globalTimerHandle = setInterval(() => {
        if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
        if (!globalStore.get(autoRefreshEnabledAtom)) return;
        bumpRevision("auto");
    }, globalStore.get(autoRefreshIntervalMsAtom));
}

/**
 * 停止全局自动刷新定时器。
 * 应用卸载或进入后台时调用。
 */
export function stopGlobalAutoRefreshTimer(): void {
    if (globalTimerHandle != null) {
        clearInterval(globalTimerHandle);
        globalTimerHandle = null;
    }
}

/**
 * 动态调整自动刷新间隔。
 * 会重启定时器以应用新间隔。
 */
export function setAutoRefreshInterval(ms: number): void {
    globalStore.set(autoRefreshIntervalMsAtom, ms);
    stopGlobalAutoRefreshTimer();
    startGlobalAutoRefreshTimer();
}
