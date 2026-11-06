// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// property-editor — 属性值编辑器共享层。
//
// md 预览属性卡（preview/plugins/md-properties）与 AI 会话属性面板
// （view/aisessions/property/property-list）共用同一套浮层编辑器，
// 避免「同一个标签在 md 预览是 Wolai 风格、在 agent 卡是逗号输入框」的漂移。
//
// 内容：
//  - tag-editor：已选 chips + 内联搜索 + 候选 toggle / 创建（多选与单选同源）
//  - value-popover：floating-ui 浮层外壳（定位 / 尺寸 / 关闭语义），portal 到 body
//  - tag-palette：12 色系 + 文本 hash 选色（不落盘存储颜色）

export * from "./tag-editor";
export * from "./tag-palette";
export * from "./value-popover";
