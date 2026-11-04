// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 整体视觉一致性：编辑态必须"看起来就是同一段文字"。
// 只比文字起点 x 会漏掉字体/内联标记/字重/行高等差异——真实踩到：
// 编辑器里 `code` 丢了等宽字体、`strong` 字重不同，而起点完全一致。

const MAX_DIFF_RATIO = 0.02; // 2%：文字抗锯齿的抖动远低于这个量级

export default {
    id: "pixel-visual-parity",
    why: "编辑态与阅读态必须视觉一致（差异像素 ≤ 2%）：字体、内联标记、字重、行高都算在内",
    run({ observation, ctx }) {
        const { crop, textAreaCrop, images } = observation;
        if (images?.before == null || images?.during == null) {
            return { pass: false, detail: "缺少截图" };
        }
        const rel = {
            x: textAreaCrop.x - crop.x,
            y: textAreaCrop.y - crop.y,
            width: textAreaCrop.width,
            height: textAreaCrop.height,
        };
        const before = ctx.cropPng(ctx.readPng(images.before), rel);
        const during = ctx.cropPng(ctx.readPng(images.during), rel);
        const res = ctx.diffRatio(before, during, { tol: 24 });
        return {
            pass: res.ratio <= MAX_DIFF_RATIO,
            detail:
                `差异像素 ${res.diffPixels}/${res.total} = ${(res.ratio * 100).toFixed(2)}%` +
                `（阈值 ${(MAX_DIFF_RATIO * 100).toFixed(1)}%，已剔除镀层列 ${res.chromeColumns}）`,
            evidence: { ...res, maxDiffRatio: MAX_DIFF_RATIO },
        };
    },
};
