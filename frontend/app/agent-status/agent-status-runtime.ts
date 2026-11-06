// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Agent chip 运行时长的格式化与显示条件。
//
// 与 `formatCompactDuration`（"5m" / "2h" / "3d"）不同：这里要的是秒级可读的
// 精确时长（"03:21"），因为运行中的 agent 用户关心的是"跑了多久了"。
// 已读 Done 态仍沿用分钟级 elapsed（`agentStatusViewLabel`），秒级跳动是噪音。
//
// 性能说明（为什么可以秒级）：
//   本函数是纯计算，无分配热点，单次 ≈2µs；刷新由 `agentStatusSecondTickAtom`
//   驱动且**只有 chip 自身订阅**（React.memo 包裹），可见 chip ≤ 40 时
//   约 2–4 ms/s CPU。绝不允许把 tick 提到 SessionOverviewPanel —— `now` 被
//   boardCards / timelineRows 两个 memo 与看板 useLayoutEffect 依赖，
//   面板级 1s tick 会退化成整树重渲染 + 全量 rect 采样。

import type { AgentStatus } from "./agent-status-types";

const MsPerMinute = 60_000;
const MsPerHour = 60 * MsPerMinute;
const MsPerDay = 24 * MsPerHour;

/**
 * `< 60s` → `7s`；`< 60min` → `3min21s`；`< 24h` → `1h12min`；`>= 24h` → `2d3h`。
 *
 * 为什么不用 `mm:ss`：`00:07` / `03:21` 读起来像计时器或时钟，不像"跑了多久"；
 * 带单位的 `7s` / `3min21s` 一眼就知道量级，也不用在脑子里换算。
 *
 * 非法起点（0 / 负数 / NaN）与时钟回退（start 在 now 之后）一律返回空串：
 * 宁可显示"未知"，也不显示 `-3d` 这类负数时长。
 */
export function formatAgentChipRuntime(startMs: number, nowMs: number): string {
    if (!Number.isFinite(startMs) || !Number.isFinite(nowMs) || startMs <= 0) {
        return "";
    }
    const elapsed = nowMs - startMs;
    if (elapsed < 0) {
        return "";
    }
    if (elapsed < MsPerMinute) {
        return `${Math.floor(elapsed / 1000)}s`;
    }
    if (elapsed < MsPerHour) {
        const minutes = Math.floor(elapsed / MsPerMinute);
        const seconds = Math.floor((elapsed % MsPerMinute) / 1000);
        return `${minutes}min${seconds}s`;
    }
    if (elapsed < MsPerDay) {
        const hours = Math.floor(elapsed / MsPerHour);
        const minutes = Math.floor((elapsed % MsPerHour) / MsPerMinute);
        return `${hours}h${minutes}min`;
    }
    const days = Math.floor(elapsed / MsPerDay);
    const hours = Math.floor((elapsed % MsPerDay) / MsPerHour);
    return `${days}d${hours}h`;
}

/**
 * 只有活跃态才需要秒级跑时。
 *
 * done 态故意排除：完成态的 "Done 3m" 沿用分钟级 elapsed（`agentStatusViewLabel`），
 * 秒级跳动对"已经跑完了"这件事是纯噪音。
 */
export function needsAgentChipRuntime(status: AgentStatus | null | undefined): boolean {
    if (status == null) {
        return false;
    }
    return status.state === "working" || status.state === "blocked" || status.state === "stale";
}
