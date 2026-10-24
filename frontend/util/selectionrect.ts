// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 框选（rubber band）几何：AI Sessions 列表与 Files 目录表共用。
// 纯函数、无 DOM 依赖（只接收已取好的 rect / 元素），可直接单测。
// 两个视图的「行标识属性名」不同（data-session-key vs data-rowindex），
// 所以 keysUnderRect 接收调用方准备好的 {key, el}，不自己 querySelector。

export type Rect = {
    left: number;
    top: number;
    right: number;
    bottom: number;
};

/** 拖拽位移超过该值即视为框选，否则按点击处理。 */
export const DragThresholdPx = 4;

/**
 * 两矩形是否相交。边贴边不算相交（a.right === b.left 视为不相交），
 * 否则鼠标抖动会让选区闪烁。
 */
export function rectsIntersect(a: Rect, b: Rect): boolean {
    if (a.right <= b.left || b.right <= a.left) {
        return false;
    }
    if (a.bottom <= b.top || b.bottom <= a.top) {
        return false;
    }
    return true;
}

/**
 * 从行 DOM 列表里筛出与 rect 相交的行标识，保持传入顺序
 * （顺序决定批量复制产物的行序，不能乱）。
 */
export function keysUnderRect(rect: Rect, rows: { key: string; el: HTMLElement }[]): string[] {
    const hit: string[] = [];
    for (const row of rows) {
        const el = row.el;
        if (el == null) continue;
        const bounds = el.getBoundingClientRect();
        const rowRect: Rect = {
            left: bounds.left,
            top: bounds.top,
            right: bounds.right,
            bottom: bounds.bottom,
        };
        if (rectsIntersect(rect, rowRect)) {
            hit.push(row.key);
        }
    }
    return hit;
}

/** 位移是否达到「这是拖拽不是点击」的阈值。 */
export function isDragMovement(dx: number, dy: number): boolean {
    return Math.max(Math.abs(dx), Math.abs(dy)) >= DragThresholdPx;
}

/**
 * 把 viewport 坐标的矩形转成「文档坐标」：框选期间容器可能滚动，
 * 用文档坐标存起点，每帧按当前 scrollTop 重算可见部分，选区才不会漂。
 */
export function toDocumentRect(rect: Rect, scrollTop: number): Rect {
    return {
        left: rect.left,
        top: rect.top + scrollTop,
        right: rect.right,
        bottom: rect.bottom + scrollTop,
    };
}

/** 文档坐标矩形 → 当前视口坐标（供 rectsIntersect 与行 rect 比较）。 */
export function toViewportRect(rect: Rect, scrollTop: number): Rect {
    return {
        left: rect.left,
        top: rect.top - scrollTop,
        right: rect.right,
        bottom: rect.bottom - scrollTop,
    };
}

/** 供 overlay 渲染用的 CSS（left/top/width/height，基于视口坐标）。 */
export function rectToCss(rect: Rect): { left: number; top: number; width: number; height: number } {
    return {
        left: rect.left,
        top: rect.top,
        width: Math.max(0, rect.right - rect.left),
        height: Math.max(0, rect.bottom - rect.top),
    };
}
