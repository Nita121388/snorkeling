// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 无 measure 抖动：inline-edit 的 measureOverlay 历史上出过
// focus → auto-scroll → scroll-listener → re-measure → 再滚 的反馈环。
// 数字上看不出来（位置最终收敛），但用户会看到框在抖。
// 证据来自 window.__inlineEditLog（需 localStorage.snorkelingInlineEditDebug=1）。

const MAX_MEASURE_EVENTS = 12;

export default {
    id: "no-measure-loop",
    why: "不得出现重测量抖动：一次编辑会话内 measure 事件 ≤ 12 且无 target-lost",
    run({ observation }) {
        const log = observation.during?.inlineEditLog;
        if (log == null || log.length === 0) {
            // attach 模式下复用页面时没 reload，调试环不会开启 → 这条规则降级为 warn，
            // 不因为"没证据"就判失败（否则每次 attach 都假红）。
            return {
                skipped: true,
                detail: "调试环为空/未开启（需要 localStorage.snorkelingInlineEditDebug=1 + reload 一次）",
            };
        }
        const measures = log.filter((e) => String(e.msg).startsWith("measure")).length;
        const targetLost = log.filter((e) => String(e.msg).includes("target lost")).length;
        return {
            pass: measures <= MAX_MEASURE_EVENTS && targetLost === 0,
            detail: `窗口内 measure=${measures}（阈值 ${MAX_MEASURE_EVENTS}）target-lost=${targetLost}`,
            evidence: { measures, targetLost, sample: log.slice(-12) },
        };
    },
};
