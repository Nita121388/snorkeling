// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Tab 悬浮卡的「重对账」（task 11-23-overview-refresh-1123，S3 变体）。
//
// 背景：每个 Tab 是一个独立 renderer（emain/emain-window.ts），Tab 栏在各自 renderer
// 各渲染一份，悬浮卡读的是**本 renderer 的 WOS 缓存**。缓存靠 waveobj:update 广播续命：
// 广播漏一条（连接竞态 / 重连窗口 / 迟到 null 覆盖）后，那个 renderer 对目标 Tab 的
// blockids / block meta 就长期停留在旧快照——用户看到「从 Tab c 悬浮有 agent、切回
// Tab a 再悬浮就没了」。响应式订阅（11-20 修复）只在事件抵达时有效，救不了「事件
// 从没到过这个 renderer」。
//
// 修法：卡片是冷读面，打开时对目标做一次**重对账**——
//  1. reload 目标 tab 对象（blockids 是 agent 清单的唯一来源）；
//  2. reload 后的 blockids（顶层 + subblockids）整批 prime（`{ force: true }`，
//     单批 GetObjects + version guard，不会回退新版本）。
// 幂等且限流：同一 tab 2s 内只对账一次；数据本来新鲜时走 version guard 零变化。

import { expandBlockIdsWithSubblocks } from "./tab-block-collect";
import * as WOS from "@/app/store/wos";

/** 对账执行接口（单测注入 mock；生产绑 WOS）。 */
export type TabCardReconcileExec = {
    makeORef: (otype: string, oid: string) => string;
    reloadWaveObject: (oref: string) => Promise<any>;
    getObjectValue: (oref: string) => any;
    primeWaveObjects: (orefs: string[], opts?: { force?: boolean }) => Promise<void>;
};

const defaultExec: TabCardReconcileExec = {
    makeORef: WOS.makeORef,
    reloadWaveObject: WOS.reloadWaveObject,
    getObjectValue: WOS.getObjectValue,
    primeWaveObjects: WOS.primeWaveObjects,
};

/** 同一 tab 的对账节流窗口。 */
export const TabCardReconcileThrottleMs = 2000;

const lastReconcileTs = new Map<string, number>();
/** workspace 单独一条节流：扫过一排 tab 时不必每个 tab 都重拉同一个 workspace。 */
const lastWorkspaceReconcileTs = new Map<string, number>();

/** 测试专用：清对账节流表。 */
export function __resetTabCardReconcileForTests(): void {
    lastReconcileTs.clear();
    lastWorkspaceReconcileTs.clear();
}

/**
 * 打开悬浮卡时的重对账。返回是否真正发起了对账（false = 节流窗口内跳过）。
 *
 * 不抛错：对账是读路径旁路，失败时卡片照常按现有缓存渲染（与 primeWaveObjects 同一哲学）。
 */
export async function reconcileTabCardWith(
    exec: TabCardReconcileExec,
    tabId: string,
    workspaceId?: string,
    opts?: { nowMs?: number }
): Promise<boolean> {
    const key = `${tabId}|${workspaceId ?? ""}`;
    const nowMs = opts?.nowMs ?? Date.now();
    const last = lastReconcileTs.get(key);
    if (last != null && nowMs - last < TabCardReconcileThrottleMs) {
        return false;
    }
    lastReconcileTs.set(key, nowMs);

    // workspace 图标/名称也是冷读面的一部分；失败不影响主链路。
    // 单独节流：同一 workspace 在窗口内只重拉一次（扫过一排 tab 不重复打 RPC）。
    if (workspaceId != null) {
        const wsKey = workspaceId;
        const lastWs = lastWorkspaceReconcileTs.get(wsKey);
        if (lastWs == null || nowMs - lastWs >= TabCardReconcileThrottleMs) {
            lastWorkspaceReconcileTs.set(wsKey, nowMs);
            void exec.reloadWaveObject(exec.makeORef("workspace", workspaceId)).catch(() => null);
        }
    }

    // 1) tab 对象：blockids 的唯一来源。
    const fetchedTab = await exec.reloadWaveObject(exec.makeORef("tab", tabId)).catch(() => null);
    const tab = fetchedTab ?? exec.getObjectValue(exec.makeORef("tab", tabId));

    // 2) 展开后的块全集整批重拉（force：已解析的陈旧快照也要修正）。
    const blockIds = expandBlockIdsWithSubblocks(tab?.blockids ?? [], (blockId) =>
        exec.getObjectValue(exec.makeORef("block", blockId))
    );
    if (blockIds.length > 0) {
        await exec
            .primeWaveObjects(
                blockIds.map((blockId) => exec.makeORef("block", blockId)),
                { force: true }
            )
            .catch(() => null);
    }
    return true;
}

/** 生产入口（绑 WOS）。 */
export function reconcileTabCard(tabId: string, workspaceId?: string): Promise<boolean> {
    return reconcileTabCardWith(defaultExec, tabId, workspaceId);
}
