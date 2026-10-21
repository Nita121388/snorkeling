// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * 会话详情时间线的虚拟化纯逻辑。
 *
 * 为什么需要阈值：绝大多数会话只有几十条消息，全量渲染完全够快；只有
 * 几千条消息的大会话才会把 5000+ 个 DOM 节点塞进滚动容器，导致"拉到最开头
 * 就卡住"。小会话保持原有渲染路径，等价于不改变默认行为。
 *
 * 这里只放不依赖 react / DOM 的纯函数，方便直接单测：
 * - shouldVirtualize：是否启用虚拟化
 * - buildSeqToIndex：消息 seq → 虚拟行号的映射（搜索/批注跳转用）
 * - activeSeqFromVirtualItems：大纲轨 active 刻度（不再依赖 getElementById）
 */

import type { SessionDetailTimelineItem } from "./utils";

/** 超过这个行数才启用虚拟化；等于或小于时走原有全量渲染。 */
export const VirtualizeThreshold = 60;

/** 虚拟行的初始估算高度（px）。真实高度由 measureElement 测得后替换。 */
export const EstimatedRowHeight = 96;

/** 虚拟行可视区上下各多渲染几行，避免快速滚动出现空白。 */
export const VirtualOverscan = 6;

export function shouldVirtualize(itemCount: number): boolean {
    return itemCount > VirtualizeThreshold;
}

/**
 * 消息 seq → 时间线行号。只映射 kind === "message" 的行（搜索、批注、
 * 大纲跳转都以消息 seq 为目标）。同 seq 只保留第一次出现的行号。
 */
export function buildSeqToIndex(items: SessionDetailTimelineItem[]): Map<number, number> {
    const map = new Map<number, number>();
    items.forEach((item, index) => {
        if (item.kind === "message" && !map.has(item.message.seq)) {
            map.set(item.message.seq, index);
        }
    });
    return map;
}

/**
 * 由可见虚拟项推导当前 active 的消息 seq（大纲轨高亮）。
 *
 * 虚拟化后不可视的行没有 DOM 节点，不能再逐个 getBoundingClientRect。
 * 这里用可见项的序号与高度信息：取最后一个"起点位于探针之上"的可见项，
 * 若可见项里没有消息项（例如当前全是工具行），则回退到 promptSeqs 第一项。
 *
 * @param virtualItems 可见虚拟项（index + start），index 即时间线行号
 * @param itemSeqs 每行对应的消息 seq（非消息行为 null）
 * @param probeOffset 探针相对滚动容器顶部的偏移（通常是容器高度的 1/4）
 */
export function activeSeqFromVirtualItems(
    virtualItems: ReadonlyArray<{ index: number; start: number }>,
    itemSeqs: ReadonlyArray<number | null>,
    probeOffset: number,
    fallbackSeq: number | null
): number | null {
    let current: number | null = null;
    for (const item of virtualItems) {
        const seq = itemSeqs[item.index];
        if (seq == null) continue;
        if (item.start <= probeOffset) {
            current = seq;
        } else {
            break;
        }
    }
    return current ?? fallbackSeq;
}

/**
 * 滚动到某个 seq 的目标滚动位置。
 *
 * 已测量的行用真实 start；未测量的（尚未进入过视区）用估算高度算一个近似值，
 * 调用方应在下一帧用真实值再修正一次，避免用户看到跳动。
 */
export function scrollTargetForSeq(
    rowStart: number | null,
    rowIndex: number,
    estimatedRowHeight: number = EstimatedRowHeight
): number {
    return rowStart ?? Math.max(0, rowIndex) * estimatedRowHeight;
}

/** 是否已接近底部：用于"跳到最新"胶囊与底部增量拉取判定。 */
export function isNearBottom(totalSize: number, scrollTop: number, clientHeight: number, threshold = 120): boolean {
    if (clientHeight <= 0) return true;
    return totalSize - scrollTop - clientHeight < threshold;
}

/**
 * 渲染 key：消息行用 seq（稳定、可跳转），工具行用 anchorSeq+seq+行号
 * （同一锚点下可能挂多个工具行）。
 */
export function timelineItemKey(item: SessionDetailTimelineItem, index: number): string {
    if (item.kind === "message") {
        return `message-${item.message.seq}`;
    }
    return `tool-${item.anchorSeq}-${item.toolCall.seq}-${index}`;
}

/**
 * 虚拟滚动渲染时的 probe 探针位置：容器高度的 1/4 处。
 * 与全量渲染路径（session-outline-rail 的 useActiveOutlineSeq）保持一致。
 */
export function outlineProbeOffset(clientHeight: number): number {
    if (clientHeight <= 0) return 0;
    return clientHeight * 0.25;
}
