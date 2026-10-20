// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * 共享的 hover-intent 打开延迟（毫秒）。
 *
 * 用于「悬浮 WidgetsBar 的 Terminal/Agent 卡片」与「Tab 组右上角 + 菜单里悬浮
 * Terminal/Agent 菜单项」两处打开二级选择浮窗的计时器。
 *
 * 取值依据：hover-intent 的常见区间是 100–200ms。500ms 会让用户感觉弹窗"慢一拍"；
 * 150ms 既不会在快速横扫时误开，也能让有意停顿感觉即时。两处必须一致，因此抽到这里。
 */
export const LaunchHoverOpenDelayMs = 150;