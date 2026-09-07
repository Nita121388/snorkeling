// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Ctrl+Hover Block 快速创建的放置状态 store。
// 独立于布局引擎与 react-dnd，只描述"鼠标停在哪个 Block 的什么相对位置"，
// 具体插入仍复用现有 createBlockSplitVertically / addBlockToInlineTab 原语。

export type PlacementKind = "before" | "after" | "group";

export type PlacementTarget = {
    // 目标 Block 的 blockId（插入锚点）
    blockId: string;
    // 相对目标 Block 的插入位置
    kind: PlacementKind;
    // 鼠标在视口内的坐标（用于预览定位）
    x: number;
    y: number;
    // 目标 Block 的视口矩形（用于预览缩略尺寸）
    rect: { top: number; left: number; width: number; height: number };
};
