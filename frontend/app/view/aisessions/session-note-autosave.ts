// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * 自动保存 Note 的统一配置与判定，三处编辑入口共用：
 * 列表行（session-row）、详情面板（session-detail）、Note 弹窗（aisessionnotemodal）。
 * ponytail: 防抖延迟与判定条件同源，避免各处漂移；弹窗是最早的生产验证实现，
 * 另外两处与其对齐。判定为纯布尔组合，可单元自检。
 */
export const NoteAutoSaveDelayMs = 3000;

export function shouldAutoSaveNote(opts: {
    loaded: boolean;
    visible: boolean;
    unchanged: boolean;
    saving: boolean;
}): boolean {
    return opts.loaded && opts.visible && !opts.unchanged && !opts.saving;
}