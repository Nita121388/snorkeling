// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 全局「独占悬浮信息卡」管理器（单例 mutex）。
//
// 问题背景: tab 卡 / block 卡 / sidebar 卡 / agent block header 卡都是独立的组件,
// 各自持本地 isOpen state 和各自的隐藏延迟(200/300ms)。鼠标滑过多个目标时,
// 前一个已 mouseleave 但还在隐藏等待期, 后一个又 mouseenter 打开了新卡,
// 导致同一瞬间多张卡同时存在。
//
// 解决: 全局只允许一张 info card 处于打开状态。任一 surface 打开(claim)时,
// 立即顶掉其它所有 surface 的卡片(它们被通知后立刻关闭, 跳过隐藏延迟)。
//
// 用法: 每个唤起实例持有一个唯一 token(Symbol)。open 时 claim(token),
// 订阅 subscribe(), 当 isInfoCardClaimedBy(token) 不再是 true 时表示被顶掉,
// 应立即强制关闭自身(清空定时器)。

type Listener = () => void;

let activeToken: symbol | null = null;
const listeners = new Set<Listener>();

function notify(): void {
    for (const l of [...listeners]) {
        l();
    }
}

/** 尝试抢占成为当前活动卡。返回 true 表示该 token 现为活动方。 */
export function claimInfoCard(token: symbol): boolean {
    if (activeToken !== token) {
        activeToken = token;
        notify();
    }
    return activeToken === token;
}

/** 释放占用(仅当 token 仍是活动方时生效)。 */
export function releaseInfoCard(token: symbol): void {
    if (activeToken === token) {
        activeToken = null;
        notify();
    }
}

/** 该 token 是否仍是当前活动卡(用于被顶掉判定)。 */
export function isInfoCardClaimedBy(token: symbol): boolean {
    return activeToken === token;
}

/** 订阅全局变化, 返回取消订阅函数。 */
export function subscribeInfoCard(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}