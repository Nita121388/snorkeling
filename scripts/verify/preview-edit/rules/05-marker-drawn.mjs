// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// marker 必须真的在画，且画在覆盖层内。
// 覆盖的不是"数字好不好看"，而是"编辑态丢失了序号/圆点"或"序号被 overlay 左边界裁掉"。

const TOL = 1.5;

export default {
    id: "marker-drawn",
    why: "编辑态必须画出序号/圆点，且 marker 列完整落在覆盖层内（不能被左边界裁掉）",
    run({ observation }) {
        const list = observation.during?.firstList;
        if (list == null) {
            return { skipped: true, detail: "该 case 的编辑态没有列表，跳过" };
        }
        const marker = observation.during?.marker;
        if (marker == null) return { pass: false, detail: "找不到 li::before（marker 未绘制）" };

        const content = String(marker.content ?? "");
        const drawn = content !== "none" && content !== "" && content !== '""' && content !== "normal";
        const widthOk = marker.width > 1;
        const positioned = marker.position === "absolute";
        const ov = observation.during.overlay;
        const insideLeft = marker.rect.x >= ov.padBox.left - TOL;
        const insideRight = marker.rect.x + marker.rect.w <= ov.padBox.right + TOL;

        return {
            pass: drawn && widthOk && positioned && insideLeft && insideRight,
            detail:
                `content=${content} width=${marker.width}px position=${marker.position}` +
                `，marker 列 x ∈ [${marker.rect.x.toFixed(1)}, ${(marker.rect.x + marker.rect.w).toFixed(1)}]` +
                `，overlay 可视区 x ∈ [${ov.padBox.left.toFixed(1)}, ${ov.padBox.right.toFixed(1)}]`,
            evidence: { marker, padBox: ov.padBox, drawn, widthOk, positioned, insideLeft, insideRight },
        };
    },
};
