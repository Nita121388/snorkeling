// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * 会话列表后台扫描进度的纯逻辑（无 react / jotai 依赖，可直接单测）。
 *
 * 后端在 `<index>:scanstatus` 事件里推送 `{scanned,total,running,done,partial}`。
 * 这里负责三件容易出错的事，集中在一处：
 *
 * 1. 只接受本地连接的事件（远程连接的事件带 connection，由对应视图自己消费）
 * 2. 事件乱序/重放时不让进度倒退（`total` 回退、旧批次重复送达）
 * 3. `done` 每个扫描周期只触发一次回调（多 provider 会成批发 done）
 */

export type ScanStatus = {
    scanned: number;
    total: number;
    running: boolean;
    done: boolean;
    partial: boolean;
};

export const InitialScanStatus: ScanStatus = {
    scanned: 0,
    total: 0,
    running: false,
    done: false,
    partial: false,
};

/**
 * 把一条事件 payload 归一化成 ScanStatus。
 * 返回 null 表示这条事件不该被本地列表消费（空数据或远程连接）。
 */
export function normalizeScanStatusEvent(data: ScanStatusEvent | null | undefined): ScanStatus | null {
    if (data == null || typeof data !== "object") {
        return null;
    }
    if (data.connection != null && data.connection !== "") {
        return null;
    }
    return {
        scanned: Math.max(0, Number(data.scanned) || 0),
        total: Math.max(0, Number(data.total) || 0),
        running: Boolean(data.running),
        done: Boolean(data.done),
        partial: Boolean(data.partial),
    };
}

/**
 * 归并进度。规则：
 * - 同一周期内 scanned 只增不减（晚到的旧批次不覆盖新进度）
 * - total 为 0 的中间态不清空已知总数（避免进度条从 "320/1617" 闪成 "320/0"）
 * - 新一轮扫描（incoming.running 且上轮已 done）重新计时
 */
export function reduceScanStatus(prev: ScanStatus, incoming: ScanStatus): ScanStatus {
    if (incoming.running && prev.done) {
        return incoming;
    }
    const next: ScanStatus = { ...incoming };
    if (next.scanned < prev.scanned && next.done === prev.done) {
        next.scanned = prev.scanned;
    }
    if (next.total === 0 && prev.total > 0) {
        next.total = prev.total;
    }
    if (prev.done && !next.running && next.scanned <= prev.scanned) {
        // 上一轮已结束、本条是同批冗余事件：保持结束态，避免 UI 重新出现骨架行
        next.done = true;
    }
    return next;
}

/**
 * 合并「List 响应快照」与「事件实时进度」。UI 只需要一个状态源时用它，
 * 避免快照（旧）覆盖掉事件（新）推来的进度。
 */
export function mergeScanStatus(snapshot: ScanStatus, live: ScanStatus): ScanStatus {
    const liveUseful = live.running || live.total > 0;
    if (!liveUseful) {
        return snapshot;
    }
    const snapshotUseful = snapshot.running || snapshot.total > 0;
    if (!snapshotUseful) {
        return live;
    }
    // 同一周期内 scanned 单调递增，取更靠后的那条。
    return live.scanned >= snapshot.scanned ? live : snapshot;
}

/** 是否应该触发「扫描结束」回调：每个周期只触发一次。 */
export function shouldNotifyScanDone(prev: ScanStatus, incoming: ScanStatus | null): boolean {
    return incoming != null && incoming.done && !prev.done;
}
