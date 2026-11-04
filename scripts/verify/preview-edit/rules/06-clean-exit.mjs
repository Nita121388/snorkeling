// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 干净退出：Esc 后覆盖层消失、隐藏类清理干净、块几何复原。
// 覆盖 "编辑完内容没了 / 块高度塌了 / 残留空白" 这类退出期 bug。

const GEOM_TOL = 1;

export default {
    id: "clean-exit",
    why: "退出编辑必须干净：overlay 消失、inline-edit-hidden/active 无残留、块几何复原（±1px）",
    run({ observation }) {
        const after = observation.afterEsc;
        const before = observation.target?.rect;
        if (after == null) return { pass: false, detail: "缺少退出后观察" };

        const geomOk =
            before == null ||
            after.rect == null ||
            (Math.abs(after.rect.x - before.x) <= GEOM_TOL &&
                Math.abs(after.rect.y - before.y) <= GEOM_TOL &&
                Math.abs(after.rect.w - before.w) <= GEOM_TOL &&
                Math.abs(after.rect.h - before.h) <= GEOM_TOL);

        return {
            pass: after.overlayGone && after.hiddenLeft === 0 && after.activeLeft === 0 && geomOk,
            detail:
                `overlayGone=${after.overlayGone} hiddenLeft=${after.hiddenLeft} activeLeft=${after.activeLeft}` +
                (before != null && after.rect != null
                    ? `，块 rect 复原 Δ=(${(after.rect.x - before.x).toFixed(1)}, ${(after.rect.y - before.y).toFixed(1)}, ` +
                      `${(after.rect.w - before.w).toFixed(1)}, ${(after.rect.h - before.h).toFixed(1)})`
                    : ""),
            evidence: { after, before },
        };
    },
};
