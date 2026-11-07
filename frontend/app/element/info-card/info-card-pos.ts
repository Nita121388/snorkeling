// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// info-card 的定位计算（纯函数，可单测，不碰 DOM）。
//
// 为什么单独抽出来：卡片历史上只做「相对目标偏移」——
//   bottom: top = rect.bottom + 2, left = rect.left
//   right : top = rect.top,        left = rect.right + 8
// 没有视口钳位也没有翻转，靠右 / 靠下的目标会把整卡顶出窗口被裁掉
// （nita 2026-11-05 截图：Tab 悬浮弹窗被截断）。定位是对 viewport 的几何约束，
// 属于纯计算，抽出来才能在 jsdom 里用数字判死，而不是靠肉眼看运气。

export type InfoCardRect = { top: number; bottom: number; left: number; right: number };
export type InfoCardSize = { width: number; height: number };
export type InfoCardViewport = { width: number; height: number };
export type InfoCardPos = { top: number; left: number };
export type InfoCardPlacement = "right" | "bottom";

/** 卡片与目标之间的缝隙（px）。 */
export const CARD_GAP = 2;
/** 卡片与视口边缘之间必须保留的安全距离（px）。 */
export const VIEWPORT_MARGIN = 8;

/**
 * 旧公式：只做相对偏移，不钳位。
 * 产品代码不得再调用；保留它是为了让单测能拿它当「已知坏样本」证明判据看得见 bug。
 */
export function legacyCardPos(rect: InfoCardRect, placement: InfoCardPlacement): InfoCardPos {
    return placement === "bottom"
        ? { top: rect.bottom + CARD_GAP, left: rect.left }
        : { top: rect.top, left: rect.right + VIEWPORT_MARGIN };
}

function clamp(v: number, min: number, max: number): number {
    if (max < min) {
        // 视口比卡片还小：优先保住左/上边，至少让内容开头可见。
        return min;
    }
    return Math.min(Math.max(v, min), max);
}

/**
 * 首选位放得下就用首选位；放不下就翻到对侧；两侧都放不下就夹进视口。
 * 返回的坐标保证：卡片整卡落在视口内（除非卡片本身比视口还大）。
 */
export function computeCardPos(opts: {
    rect: InfoCardRect;
    card: InfoCardSize;
    viewport: InfoCardViewport;
    placement: InfoCardPlacement;
}): InfoCardPos {
    const { rect, card, viewport, placement } = opts;
    const maxLeft = viewport.width - VIEWPORT_MARGIN - card.width;
    const maxTop = viewport.height - VIEWPORT_MARGIN - card.height;

    if (placement === "bottom") {
        const below = rect.bottom + CARD_GAP;
        const above = rect.top - CARD_GAP - card.height;
        const fitsBelow = below <= maxTop;
        const fitsAbove = above >= VIEWPORT_MARGIN;
        // 放不下时翻到上方；两侧都不行就贴着空间更大的一侧夹住。
        const preferred = fitsBelow || !fitsAbove ? below : above;
        return {
            top: clamp(preferred, VIEWPORT_MARGIN, maxTop),
            left: clamp(rect.left, VIEWPORT_MARGIN, maxLeft),
        };
    }

    const toRight = rect.right + VIEWPORT_MARGIN;
    const toLeft = rect.left - VIEWPORT_MARGIN - card.width;
    const fitsRight = toRight <= maxLeft;
    const fitsLeft = toLeft >= VIEWPORT_MARGIN;
    const preferred = fitsRight || !fitsLeft ? toRight : toLeft;
    return {
        top: clamp(rect.top, VIEWPORT_MARGIN, maxTop),
        left: clamp(preferred, VIEWPORT_MARGIN, maxLeft),
    };
}

/** 判定辅助：位置 + 尺寸是否整卡落在视口内（含安全距离）。单测与自检共用。 */
export function isFullyInside(
    pos: InfoCardPos,
    card: InfoCardSize,
    viewport: InfoCardViewport,
    margin = VIEWPORT_MARGIN
): boolean {
    return (
        pos.left >= margin - 0.5 &&
        pos.top >= margin - 0.5 &&
        pos.left + card.width <= viewport.width - margin + 0.5 &&
        pos.top + card.height <= viewport.height - margin + 0.5
    );
}
