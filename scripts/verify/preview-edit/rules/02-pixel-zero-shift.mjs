// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 文字零位移（像素侧）：DOM 数字对不代表"看起来对"。
// 用"逐文本行最左墨迹 x"剖面比较同一块区域的编辑前/编辑中截图 —— 不需要 golden baseline，
// 阅读态自己就是基准。

const MAX_SHIFT_PX = 1.5;

export default {
    id: "pixel-zero-shift",
    why: "像素级验证文字没位移/没被裁：逐文本行比较最左墨迹 x（≤1.5px），编辑态行数不得少于阅读态",
    run({ observation, ctx }) {
        const { crop, textAreaCrop, images } = observation;
        if (images?.before == null || images?.during == null) {
            return { pass: false, detail: "缺少截图" };
        }
        const before = ctx.readPng(images.before);
        const during = ctx.readPng(images.during);

        // textAreaCrop 是绝对坐标，截图是 crop 坐标系 → 转成相对坐标
        const rel = {
            x: textAreaCrop.x - crop.x,
            y: textAreaCrop.y - crop.y,
            width: textAreaCrop.width,
            height: textAreaCrop.height,
        };
        const beforeText = ctx.cropPng(before, rel);
        const duringText = ctx.cropPng(during, rel);

        const result = ctx.compareInkProfiles(beforeText, duringText, { maxShiftPx: MAX_SHIFT_PX });

        // 差异图（人复核用）
        const diff = ctx.diffPng(before, during);
        const diffPath = images.before.replace(/-before\.png$/, "-diff.png");
        ctx.writePng(diffPath, diff.png);

        return {
            pass: result.pass,
            detail: `${result.detail}；差异像素 ${diff.diffCount}/${diff.total}`,
            evidence: { ...result.evidence, diffPath, diffCount: diff.diffCount, diffTotal: diff.total },
        };
    },
};
