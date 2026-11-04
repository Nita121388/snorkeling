// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 不裁剪：编辑态内容必须完全落在覆盖层的可视区内。
// 两重判定：滚动高度（overflow 容器）+ 子元素实际外延（paint containment 裁剪会绕过高）。

const TOL = 1.5;

export default {
    id: "no-clip",
    why: "内容不能被裁：overlay.scrollHeight ≤ clientHeight，且所有子元素都落在 overlay 可视区之内",
    run({ observation }) {
        const ov = observation.during?.overlay;
        if (ov == null) return { pass: false, detail: "缺少 overlay 几何" };
        const scrollOk = ov.scrollHeight <= ov.clientHeight + TOL;
        const extent = observation.during?.childExtent ?? {};
        const bottomOk = !Number.isFinite(extent.maxChildBottom) || extent.maxChildBottom <= ov.padBox.bottom + TOL;
        const rightOk = !Number.isFinite(extent.maxChildRight) || extent.maxChildRight <= ov.padBox.right + TOL;
        return {
            pass: scrollOk && bottomOk && rightOk,
            detail:
                `scrollHeight=${ov.scrollHeight} clientHeight=${ov.clientHeight}` +
                `，子元素底边=${fmt(extent.maxChildBottom)}（可视底 ${fmt(ov.padBox.bottom)}）` +
                `，子元素右边=${fmt(extent.maxChildRight)}（可视右 ${fmt(ov.padBox.right)}）`,
            evidence: { scrollOk, bottomOk, rightOk, overlay: ov, childExtent: extent },
        };
    },
};

function fmt(v) {
    return Number.isFinite(v) ? v.toFixed(1) : "n/a";
}
