// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 会话标题内联编辑的共享视觉常量。
//
// 抽出来的原因：`session-detail.tsx` 的详情头栏与 agent 卡片（悬浮卡 + 放大弹窗）
// 共用同一套"改名输入框"视觉。两处各写一份 class 字符串，必然漂移
// （宽度/高度/圆角任一处改动就会让两个入口看起来不是同一个交互）。
//
// 改这里 = 同时改详情头栏与 agent 卡片，这是有意的。

/** 改名输入框的 class：h-6 + accent 描边 + surface 底，与详情头栏一致。 */
export const RenameTitleInputClass =
    "h-6 min-w-0 flex-1 rounded border border-accent bg-surface px-1.5 text-sm font-medium text-primary outline-none";
