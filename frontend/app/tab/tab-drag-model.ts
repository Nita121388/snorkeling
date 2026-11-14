// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Tab 栏拖拽判定的纯函数（无 React / 无 DOM）。
//
// 抽离自 tabbar.tsx（R8，见 .trellis/tasks/10-26-tab-startup-restore）。
// 旧实现的三个错判来源：
//   1. engage 阈值 5px 单帧 —— 手抖/触控板微移就进入拖拽态；
//   2. 落点比较依赖缓存的 dragStartPositions（ResizeObserver / reinitVersion 等
//      调用点只刷新一半）—— stale 位置下小位移就被判跨过邻居中点；
//   3. 方向状态（prevDelta/prevDragDirection）放在模块级 —— 多窗口/多实例串扰。

export type DragDirection = "+" | "-";

/** 进入拖拽态的位移阈值（CSS px；按 zoomFactor 折算成恒定物理距离）。 */
export const DragEngageThresholdPx = 8;
/** engage 需要连续越过阈值的 mousemove 次数（过滤单次抖动）。 */
export const DragEngageMoveCount = 2;
/** mouseup 时持久化换位的位移阈值（沿用旧实现的 50px）。 */
export const DragPersistThresholdPx = 50;

/** 当前位移是否越过 engage 阈值（zoom 非法时按 1 处理）。 */
export function isBeyondEngageThreshold(deltaPx: number, zoomFactor: number): boolean {
    const zoom = Number.isFinite(zoomFactor) && zoomFactor > 0 ? zoomFactor : 1;
    return Math.abs(deltaPx) >= DragEngageThresholdPx / zoom;
}

/** 是否进入拖拽态：位移与连续次数双条件。 */
export function shouldEngageDrag(args: { deltaPx: number; consecutiveMoves: number; zoomFactor: number }): boolean {
    return args.consecutiveMoves >= DragEngageMoveCount && isBeyondEngageThreshold(args.deltaPx, args.zoomFactor);
}

/**
 * 方向判定。与旧实现语义一致：
 * - 首帧（prevX 未知）返回 prevDirection（通常为 null，不换位）；
 * - 与上一帧相同位置时沿用上一方向。
 */
export function computeDragDirection(
    currentX: number,
    prevX: number | null,
    prevDirection: DragDirection | null
): DragDirection | null {
    if (prevX == null) {
        return prevDirection;
    }
    if (currentX > prevX) {
        return "+";
    }
    if (currentX < prevX) {
        return "-";
    }
    return prevDirection;
}

export interface DragIndexInput {
    /** 被拖 Tab 当前左缘（与 startPositions 同一参照系）。 */
    currentX: number;
    /** 单个 Tab 的布局宽度。 */
    tabWidth: number;
    /** 最近一次方向；null（首帧）时不换位。 */
    dragDirection: DragDirection | null;
    /** 拖拽中的工作顺序（含被拖 Tab）。必须是 `tabIds` 的副本，不得传 React state 原引用。 */
    order: readonly string[];
    draggedTabId: string;
    /** 各 Tab 在拖拽开始（mousedown）时的左缘位置，实时测量。 */
    startPositions: ReadonlyMap<string, number>;
}

/**
 * 计算被拖 Tab 在 order 中的新序号。
 * 不满足换位条件时返回它当前在 order 中的序号；未知 tabId 返回 -1。
 * 比较基于 startPositions（tabId → 位置），与 order 的下标无关 —— 消灭
 * 「splice 后下标错位」「stale 缓存位置」两类错判。
 */
export function computeNewTabIndex(input: DragIndexInput): number {
    const curIndex = input.order.indexOf(input.draggedTabId);
    if (curIndex < 0) {
        return -1;
    }
    if (input.dragDirection == null) {
        return curIndex;
    }
    const { currentX, tabWidth, order, startPositions } = input;
    let newIndex = curIndex;
    if (input.dragDirection === "+") {
        for (let i = curIndex + 1; i < order.length; i++) {
            const otherStart = startPositions.get(order[i]);
            if (otherStart == null) {
                continue;
            }
            if (currentX + tabWidth > otherStart + tabWidth / 2) {
                newIndex = i;
            }
        }
    } else {
        for (let i = curIndex - 1; i >= 0; i--) {
            const otherStart = startPositions.get(order[i]);
            if (otherStart == null) {
                continue;
            }
            if (currentX < otherStart + tabWidth - tabWidth / 2) {
                newIndex = i;
            }
        }
    }
    return newIndex;
}
