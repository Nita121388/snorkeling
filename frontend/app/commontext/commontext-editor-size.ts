// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// CommonText compose 弹窗里展开态 Editor 的上限高度：随弹窗高度按比例放大，
// 而不是钉死一个固定像素值（原来 max-h-[280px]）。弹窗被拖大时 Editor 跟着变大，
// 同时保留下限/封顶防止小弹窗被撑爆或超大弹窗吃满全屏。

export const EDITOR_MAX_HEIGHT_MIN_PX = 280; // 小弹窗保底：不低于现状(280px)
export const EDITOR_MAX_HEIGHT_RATIO = 0.5; // 弹窗高度的一半
export const EDITOR_MAX_HEIGHT_VIEWPORT_CAP = 0.55; // 视口高度封顶 55%

export function computeEditorMaxHeight(modalHeight: number, viewportHeight: number): number {
    return Math.max(
        EDITOR_MAX_HEIGHT_MIN_PX,
        Math.min(
            Math.round(modalHeight * EDITOR_MAX_HEIGHT_RATIO),
            Math.round(viewportHeight * EDITOR_MAX_HEIGHT_VIEWPORT_CAP)
        )
    );
}
