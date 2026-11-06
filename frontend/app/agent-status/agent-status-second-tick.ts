// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 全局秒级 tick atom — 只服务「运行时长」的秒级刷新。
//
// 与 `nowMinuteTickAtom`（60s，服务 Done elapsed）并存的第二根时钟，取舍相同：
// 模块级单例 + 模块加载即启动，不按组件挂载管理订阅引用计数 —— 换来的简单性
// 远大于"多一个 timer"的成本。不同点是这里更贵（1Hz），因此加了两条保护：
//
//   1. `document.hidden` 时跳过写入 —— 窗口在后台时没必要每秒唤醒渲染。
//      重新可见时（visibilitychange）立刻补一次，保证数字不冻结在切走那一刻。
//   2. **只有 chip 自己订阅**（`useAgentSecondTick`）。绝不允许把 tick 提到
//      SessionOverviewPanel：`now` 是面板 state，被 boardCards / timelineRows
//      两个 memo 与看板动效层 useLayoutEffect 依赖，面板级 1s tick 会退化成
//      整树重渲染 + 全量 rect 采样（见 implement.md Step 3 的性能红线）。
//
// 无订阅者时 jotai 不会重算任何下游，timer 仍每秒跑一次 `if (document.hidden) return;`
// —— 单次判断成本可忽略。

import { globalStore } from "@/app/store/jotaiStore";
import { atom } from "jotai";

let timer: ReturnType<typeof setInterval> | null = null;
let visibilityBound = false;

export const agentStatusSecondTickAtom = atom<number>(0);

function tick(): void {
    if (typeof document !== "undefined" && document.hidden === true) {
        return;
    }
    globalStore.set(agentStatusSecondTickAtom, Date.now());
}

function onVisibilityChange(): void {
    // 切回前台立刻补一次，否则数字要等到下一个整秒才动（最长 1s 的冻结感）。
    if (typeof document !== "undefined" && document.hidden !== true) {
        tick();
    }
}

function ensureTimerRunning(): void {
    if (timer != null) return;
    timer = setInterval(tick, 1000);
    if (!visibilityBound && typeof document !== "undefined" && typeof document.addEventListener === "function") {
        document.addEventListener("visibilitychange", onVisibilityChange);
        visibilityBound = true;
    }
}

export function startAgentSecondTick(): void {
    ensureTimerRunning();
}

/** 测试用：停 timer、解绑 visibilitychange、复位 atom，避免跨用例污染。 */
export function resetAgentSecondTick(): void {
    if (timer != null) {
        clearInterval(timer);
        timer = null;
    }
    if (visibilityBound && typeof document !== "undefined" && typeof document.removeEventListener === "function") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
        visibilityBound = false;
    }
    globalStore.set(agentStatusSecondTickAtom, 0);
}

// 模块首次被 import 即启动 —— chip 一挂载就有值可读。
ensureTimerRunning();
