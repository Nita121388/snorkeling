// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// reinitWave 减负的执行器层 (task 11-19-reinitwave-relief).
//
// 决策在 reinit-wave-plan.ts（纯函数），本文件只负责「按批次把 reload 发出去」，
// 并且把 WOS 的两个依赖（makeORef / reloadWaveObject）作为参数注入，
// 这样执行器本身可以脱离 jotai / WOS / Electron 直接单测：
// 用可计数的 mock reload 就能断言「调用次数 / 顺序 / 并行批次」这些字面数字。
//
// wave.ts 只在调用侧传 WOS，不含任何批次判定逻辑（PRD R3）。
// 行为与改造前的内联执行器逐项一致：批间串行，批内 Promise.all 并行，
// workspace 依赖 window.workspaceid、layout 依赖 tab.layoutstate。

import { forEachTabToReload, type ReloadKind } from "./reinit-wave-plan";

/** 执行器需要的 WOS 最小接口（便于注入 mock）。 */
export interface ReloadExecutor {
    makeORef: (otype: string, oid: string) => string;
    reloadWaveObject: (oref: string) => Promise<any>;
}

export interface ReinitExecutorDeps {
    clientId: string;
    windowId: string;
    tabId: string;
}

/** 只用到结果对象的这两个字段；结构化类型避免依赖全局 WaveObj 声明。 */
type WindowLike = { workspaceid?: string } | undefined;
type TabLike = { layoutstate?: string } | undefined;

/**
 * 按 plan 的批次执行 reload：批间串行，批内并行。
 * 结果按 kind 存 map，供后续批次取依赖（window → workspace / tab → layout）。
 * 依赖字段缺失时 oref 为 null，按现状直接跳过该次 reload。
 */
export async function executeReinitReloads(
    batches: readonly (readonly ReloadKind[])[],
    deps: ReinitExecutorDeps,
    exec: ReloadExecutor
): Promise<Map<ReloadKind, any>> {
    const results = new Map<ReloadKind, any>();
    for (const batch of batches) {
        await Promise.all(
            batch.map(async (kind) => {
                let oref: string;
                switch (kind) {
                    case "client":
                        oref = exec.makeORef("client", deps.clientId);
                        break;
                    case "window":
                        oref = exec.makeORef("window", deps.windowId);
                        break;
                    case "workspace": {
                        const waveWindow = results.get("window") as WindowLike;
                        oref = exec.makeORef("workspace", waveWindow?.workspaceid);
                        break;
                    }
                    case "tab":
                        oref = exec.makeORef("tab", deps.tabId);
                        break;
                    case "layout": {
                        const initialTab = results.get("tab") as TabLike;
                        oref = exec.makeORef("layout", initialTab?.layoutstate);
                        break;
                    }
                }
                if (oref == null) {
                    return;
                }
                const val = await exec.reloadWaveObject(oref);
                results.set(kind, val);
            })
        );
    }
    return results;
}

/**
 * 重刷 workspace 的所有 tab（每个 tab 一次 RPC），与改造前 reloadAllWorkspaceTabs 等价。
 * tabIds 为 null 时一次都不发 —— 抽到这里让「调用次数为 0」可被执行器级单测断言。
 * 不 await：与改造前一样是 fire-and-forget。
 */
export function executeWorkspaceTabReloads(tabIds: readonly string[] | null, exec: ReloadExecutor): void {
    forEachTabToReload(tabIds, (tabid) => {
        exec.reloadWaveObject(exec.makeORef("tab", tabid));
    });
}
