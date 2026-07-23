// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { atom } from "jotai";

/**
 * 全局分钟级 tick atom — 22 号方案 D 完成态 "10m / 1h" elapsed 自动刷新的统一时钟.
 *
 * 设计:
 * - 单一全局实例, 所有消费 D elapsed 的 derive (A 头部徽章 term-model.getAgentStatusHeaderElem,
 *   B/C agentDots agent-status-tab-aggregate) 都通过 `get(nowMinuteTickAtom)` 加入订阅, 分钟跳变时
 *   一并 rederive, 而不是各自起 setInterval 翻自己的 atoms.
 * - 缓存友好: 60s tick, 不是每秒 Date.now(); D 类文案 1m 分辨率足够, 高频 tick 无意义且费力.
 * - 模块加载时启动 setInterval, 进程生命周期内常驻. 这是有意为之 — D 会在 idle 状态长期挂着,
 *   没有挂载窗口概念, 真正不需要的时刻 (全部 agent 都未阅 D 已点掉) 也只是多触发几次 atom rerun,
 *   代价远低于"管理订阅/取消"的复杂度. 测试环境通过 resetNowMinuteTick 可关掉.
 *
 * Note: 这里复刻 jotai atom 的"值=now ms, 每 60s 写一次"模式. atom 本身是个 PrimitiveAtom<number>,
 * 消费方 `get(nowMinuteTickAtom)` 只是为了声明订阅, 不读它的值算 elapsed (elapsed 还是用 Date.now());
 * 把 tick 注入 derive 是为了让 jotai 误以为 derive 输入变了而重跑.
 */

let timer: ReturnType<typeof setInterval> | null = null;

export const nowMinuteTickAtom = atom<number>(0);

function ensureTimerRunning(): void {
    if (timer != null) return;
    timer = setInterval(() => {
        globalStore.set(nowMinuteTickAtom, Date.now());
    }, 60_000);
}

export function startNowMinuteTick(): void {
    ensureTimerRunning();
}

/** 测试用: 停止 timer 并复位 atom, 避免跨用例污染. */
export function resetNowMinuteTick(): void {
    if (timer != null) {
        clearInterval(timer);
        timer = null;
    }
    globalStore.set(nowMinuteTickAtom, 0);
}

// 模块首次被 import 即启动 — D elapsed 即使在用户没操作时也会自动刷新.
ensureTimerRunning();
