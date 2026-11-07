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

        // after.rect == null 不再放行：Esc 后重解析目标不该消失。
        // 真实事故：真实键盘 Escape 落到 app 全局处理会把整个 preview block 关掉，
        // 那时 rect 为 null；旧逻辑把 null 当"复原"放行 → 本 case 假绿，
        // 灾难推迟到下一个 case 才以 no-root 爆出（错误信息离根因隔一整个 case）。
        const geomOk =
            after.rect != null &&
            (before == null ||
                (Math.abs(after.rect.x - before.x) <= GEOM_TOL &&
                    Math.abs(after.rect.y - before.y) <= GEOM_TOL &&
                    Math.abs(after.rect.w - before.w) <= GEOM_TOL &&
                    Math.abs(after.rect.h - before.h) <= GEOM_TOL));

        return {
            pass: after.overlayGone && after.hiddenLeft === 0 && after.activeLeft === 0 && geomOk,
            detail:
                `overlayGone=${after.overlayGone} hiddenLeft=${after.hiddenLeft} activeLeft=${after.activeLeft}` +
                (after.rect == null ? "，⚠ Esc 后目标元素消失（block 可能被关掉了）" : "") +
                (before != null && after.rect != null
                    ? `，块 rect 复原 Δ=(${(after.rect.x - before.x).toFixed(1)}, ${(after.rect.y - before.y).toFixed(1)}, ` +
                      `${(after.rect.w - before.w).toFixed(1)}, ${(after.rect.h - before.h).toFixed(1)})`
                    : ""),
            evidence: { after, before },
        };
    },
};
