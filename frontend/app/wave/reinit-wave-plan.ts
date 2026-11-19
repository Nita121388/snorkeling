// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// reinitWave 减负的纯决策层 (task 11-19-reinitwave-relief).
//
// 本文件只描述「该发哪些 reload、按什么依赖分批、要不要重刷 workspace tabs」，
// 不执行 RPC、不碰 DOM、不 import jotai / react / WOS，因此可以直接单测。
// 执行器在 frontend/wave.ts 的 reinitWave()。
//
// 回滚：把 REINITWAVE_RELIEF_ENABLED 改 false —— 批次数回到 5 次逐项串行，
// workspace tabs 永远重刷，逐项等价改造前的行为。

/** 主开关。false = 与改造前逐项一致的串行路径。 */
export const REINITWAVE_RELIEF_ENABLED = true;

export type ReloadKind = "client" | "window" | "workspace" | "tab" | "layout";

export type SideEffect =
    | "nohover"
    | "title"
    | "waveReady"
    | "reinitVersion"
    | "updaterSync"
    | "refocus"
    | "reloadWorkspaceTabs";

/**
 * 副作用执行顺序，与 wave.ts 的 reinitWave() 实际执行顺序一致。
 * nohover 在 reload 前；reloadWorkspaceTabs 在 reload 后、收尾副作用前。
 * 两条路径共用这一份清单，避免开关切换时漏掉某个副作用。
 */
export const SIDE_EFFECT_ORDER: readonly SideEffect[] = [
    "nohover",
    "reloadWorkspaceTabs",
    "title",
    "waveReady",
    "reinitVersion",
    "updaterSync",
    "refocus",
];

export interface Deps {
    clientId: string;
    windowId: string;
    tabId: string;
}

export interface Plan {
    /** 逐批执行；批内并行，批间串行。 */
    batches: ReloadKind[][];
    /** 必须保留的副作用清单（同集同序，两条路径一致）。 */
    sideEffects: readonly SideEffect[];
    /** 是否走减负路径。执行器可用它决定额外断言。 */
    relief: boolean;
}

/**
 * 规划 reload 批次。
 *
 * 依赖边只有两条：window → workspace（要 workspaceid）、tab → layout（要 layoutstate）。
 * client 独立。所以最优是 batch0=[client,window,tab] 并行，batch1=[workspace,layout] 并行。
 * off 路径退回 5 次逐项串行（改造前的顺序），作为回归锁。
 */
export function planReinitWave(deps: Deps, enabled: boolean = REINITWAVE_RELIEF_ENABLED): Plan {
    const batches: ReloadKind[][] = enabled
        ? [
              ["client", "window", "tab"],
              ["workspace", "layout"],
          ]
        : [["client"], ["window"], ["workspace"], ["tab"], ["layout"]];
    return { batches, sideEffects: SIDE_EFFECT_ORDER, relief: enabled };
}

/**
 * 执行决策：只对 planWorkspaceTabReload 给出的 id 发 reload。
 * tabIds 为 null 时一次都不发 —— 抽成函数是为了让「调用次数为 0」可单测。
 */
export function forEachTabToReload(
    tabIds: readonly string[] | null,
    reload: (tabId: string) => void
): void {
    if (tabIds == null) {
        return;
    }
    for (const tabId of tabIds) {
        reload(tabId);
    }
}

/**
 * 决定本次是否重刷 workspace 的所有 tab（每个 tab 一次 RPC）。
 *
 * - 返回 null：跳过（tabids 未变，无需重刷）。
 * - 返回数组：逐个 reload（首帧 / tabids 变化 / 开关 off）。
 *
 * 比较用浅层逐项相等，不排序：tabids 是物理序，顺序变化也算变化。
 */
export function planWorkspaceTabReload(
    prevWsTabIds: readonly string[] | undefined,
    wsTabIds: readonly string[] | undefined,
    enabled: boolean = REINITWAVE_RELIEF_ENABLED
): readonly string[] | null {
    if (!enabled) {
        return wsTabIds ?? [];
    }
    if (prevWsTabIds === undefined) {
        return wsTabIds ?? [];
    }
    const current = wsTabIds ?? [];
    if (prevWsTabIds.length !== current.length) {
        return current;
    }
    for (let i = 0; i < current.length; i++) {
        if (prevWsTabIds[i] !== current[i]) {
            return current;
        }
    }
    return null;
}
