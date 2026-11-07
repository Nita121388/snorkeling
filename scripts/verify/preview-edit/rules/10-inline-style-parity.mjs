// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 词级内联样式奇偶校验（DOM 签名比对）。
//
// 为什么单独一条规则：像素/结构化度量对**词级**变化是被稀释的
// （一个词丢粗体只占整块墨迹 2~5%，mass/lum 阈值内不可见），但
// 「`code` 丢等宽字体、`strong` 丢字重」正是这条链路历史上真实踩到的回归
// （见 62b92ce7）。所以内联标记的字体/字重/样式/颜色必须在 DOM 层直接断言，
// 零像素噪声，不怕稀释。
//
// 数据来源：阅读态签名 = observation.target.inline（probeTargetJs 采集），
// 编辑态签名 = observation.during.inline（describeDuringJs 采集，作用域是 overlay）。

const norm = (s) => String(s ?? "").replace(/\s+/g, "");

function keyOf(t) {
    return `${t.tag}::${norm(t.text)}`;
}

export default {
    id: "inline-style-parity",
    why: "内联标记（code/strong/em/…）的字体、字重、样式、颜色在编辑态必须与阅读态一致（词级回归不靠像素）",
    run({ observation }) {
        const before = observation.target?.inline;
        const during = observation.during?.inline;
        if (!Array.isArray(before) || !Array.isArray(during)) {
            return { skipped: true, detail: "本 case 无内联标记（或采集失败），跳过" };
        }
        if (before.length === 0 && during.length === 0) {
            return { skipped: true, detail: "目标内没有内联标记，跳过" };
        }

        const problems = [];
        const beforeMap = new Map(before.map((t) => [keyOf(t), t]));
        const duringMap = new Map(during.map((t) => [keyOf(t), t]));

        // 1. 标记不能丢/多：编辑器必须原样镜像所有内联标记
        for (const [k, t] of beforeMap) {
            if (!duringMap.has(k)) {
                problems.push(`编辑态丢失内联标记: ${k}`);
            }
        }
        for (const [k] of duringMap) {
            if (!beforeMap.has(k)) {
                problems.push(`编辑态多出内联标记: ${k}`);
            }
        }

        // 2. 每个标记的样式签名必须一致
        for (const [k, a] of beforeMap) {
            const b = duringMap.get(k);
            if (b == null) continue;
            if (a.font !== b.font) {
                problems.push(`${k}: 字体不一致 阅读=${a.font.slice(0, 40)} 编辑=${b.font.slice(0, 40)}`);
            }
            if (a.weight !== b.weight) {
                problems.push(`${k}: 字重不一致 阅读=${a.weight} 编辑=${b.weight}`);
            }
            if (a.style !== b.style) {
                problems.push(`${k}: 斜体不一致 阅读=${a.style} 编辑=${b.style}`);
            }
            if (a.color !== b.color) {
                problems.push(`${k}: 颜色不一致 阅读=${a.color} 编辑=${b.color}`);
            }
        }

        if (problems.length > 0) {
            return {
                pass: false,
                detail: `${problems.length} 处内联样式差异: ${problems.slice(0, 4).join("；")}${problems.length > 4 ? " …" : ""}`,
                evidence: { problems, before, during },
            };
        }
        const n = before.length;
        return {
            pass: true,
            detail: `${n} 个内联标记的字体/字重/样式/颜色全部一致`,
            evidence: { before, during },
        };
    },
};
