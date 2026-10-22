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

/**
 * Files 目录树节点悬浮信息 Tooltip 的打开延迟（毫秒）。
 *
 * 取值依据：树是高频浏览区域，鼠标会连续扫过大量行，hover-intent 必须比普通 tooltip 更长，
 * 否则“扫过”被误读成“停留”。700ms 接近人眼判断“有意停顿”的阈值（~500ms）再留一点余量，
 * 又不至于让真正想看信息的用户觉得迟钝。
 *
 * 与 `LaunchHoverOpenDelayMs`（150ms，用于打开二级选择浮窗）刻意不同：
 * 前者是“主动点击式菜单”，需要即时反馈；后者是“只读信息提示”，需要过滤误触。
 */
export const FileTooltipHoverDelayMs = 700;
