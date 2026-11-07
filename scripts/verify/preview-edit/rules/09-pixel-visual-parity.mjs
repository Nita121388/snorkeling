// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 整体视觉一致性：编辑态必须"看起来就是同一段文字"。
//
// 度量的选择（2026-11-04 用 --legacy-css 已知坏样本标定过）：
//   ✗ 逐像素差异比例 —— 亚像素 paint 取整会让抗锯齿边缘整片抖动（多行文本 5~12%
//     假红，而字形/位置/颜色全部一致；单行 case 只有 0.01%）。正常态与坏样本的
//     像素比例区间重叠（6.6% vs 7.2%），无法设阈值。
//   ✓ 结构化墨迹比较（compareInkStructure）—— 行数、墨迹质量比、平均墨迹亮度、
//     行带左右边缘。正常态质量比 1.00~1.11；坏样本 0.51 / 0.74 / 1.33，分离度极大。
//
// ⚠ 本规则的盲区（如实声明，由 rules/10-inline-style-parity.mjs 单独兜底）：
//   整图级质量/亮度阈值对**词级**内联变化是被稀释的 —— 单个词丢粗体只占整块墨迹
//   2~5%，落在阈值内。所以 code/strong/em 这类词级样式回归不由本规则负责，
//   由 DOM 签名比对的第 10 条规则抓（零像素噪声、不怕稀释）。
//
// 像素比例仍然计算并留档（作为证据 + 15% 的灾难阈值），但不作为主判定。

export default {
    id: "pixel-visual-parity",
    why: "编辑态与阅读态必须视觉一致：行数、墨迹质量、亮度、边缘都要对得上（字体/字重/颜色回归都能抓）",
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

        const res = ctx.compareInkStructure(before, during);

        // 证据留档：±1px 最优对齐后的逐像素比例（灾难兜底，正常亚像素噪声 ≈5~12%，
        // 真实的整体位移/内容错乱会远超 15%）
        const inset = 2;
        const base = {
            x: inset,
            y: inset,
            width: Math.max(4, before.width - inset * 2),
            height: Math.max(4, before.height - inset * 2),
        };
        let bestPix = null;
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                const d = ctx.cropPng(during, {
                    x: base.x + dx,
                    y: base.y + dy,
                    width: base.width,
                    height: base.height,
                });
                const p = ctx.diffRatio(ctx.cropPng(before, base), d, { tol: 24 });
                if (bestPix == null || p.ratio < bestPix.ratio) bestPix = { dx, dy, ...p };
            }
        }
        const pixOk = bestPix.ratio <= 0.15;

        const detail =
            `行带 ${res.linesBefore}→${res.linesDuring}` +
            `，墨迹质量比 ${res.massRatio.toFixed(3)}（阈值 0.82~1.18）` +
            `，亮度差 ${(res.lumRatio * 100).toFixed(1)}%（阈值 8.0%）` +
            `，像素差异（对齐后）${(bestPix.ratio * 100).toFixed(2)}% dx=${bestPix.dx} dy=${bestPix.dy}` +
            `（灾难阈值 15.0%）`;
        return {
            pass: res.pass && pixOk,
            detail: `结构化判定${res.pass ? "通过" : "不通过"}：${detail}`,
            evidence: { structure: res, pixel: bestPix },
        };
    },
};
