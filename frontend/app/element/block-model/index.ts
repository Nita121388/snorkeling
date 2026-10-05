// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * block-model/ —— 块模型自身的语义视图与编辑控制器（P2-A 交付）。
 *
 * 与 markdown-render/ 分工：后者是 ReactMarkdown 的渲染器组件（生产渲染走它）；
 * 前者是块模型坐标之上的「语义视图（Block→renderable）」+「编辑控制器（intent→文本变换）」，
 * 供 P2-B 编辑路径收敛消费。
 */

export { createEditController, lineRangeToCharOffset, type BlockEditIntent, type EditController } from "./editor-controller";
export { BlockModelRenderer, BlockTreeRenderer } from "./render-adapter";
