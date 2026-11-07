// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 文字零位移（DOM 侧）：编辑态第一个字符的墨迹与阅读态必须重合。
// 这是用户报的"文字位置偏移"最直接的判定。

const MAX_SHIFT_PX = 1;

export default {
    id: "text-zero-shift",
    why: "进入编辑时文字不能跳位：编辑器内第一个字符的墨迹必须落在阅读态的同一坐标（≤1px）",
    run({ observation }) {
        const before = observation.target?.ink;
        const during = observation.during?.ink;
        if (before == null || during == null) {
            return { pass: false, detail: "缺少墨迹基准（before 或 during 为空）" };
        }
        const dx = during.x - before.x;
        const dy = during.y - before.y;
        const pass = Math.abs(dx) <= MAX_SHIFT_PX && Math.abs(dy) <= MAX_SHIFT_PX;
        return {
            pass,
            detail:
                `Δx=${dx.toFixed(2)}px Δy=${dy.toFixed(2)}px（阈值 ${MAX_SHIFT_PX}px）` +
                ` before=(${before.x.toFixed(1)}, ${before.y.toFixed(1)}) during=(${during.x.toFixed(1)}, ${during.y.toFixed(1)})`,
            evidence: { dx, dy, maxShiftPx: MAX_SHIFT_PX, before, during },
        };
    },
};
