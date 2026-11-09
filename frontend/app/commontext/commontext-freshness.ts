// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { formatSessionRelativeTime, freshnessLevel } from "@/app/view/aisessions/utils";
import type { CommonTextItem } from "./commontext-model";

/**
 * 新鲜度方块的填充高度（索引 = 档位 - 1）：1 档满格，5 档只剩一格底。
 *
 * 为什么是等差 18 个百分点（而不是线性 80/60/40/20）：12px 槽里 20% 只有 2.4px，
 * 和空槽（0%）在 1× 下分不开；抬到 28%（3.4px）才稳。等差还让「相邻两档差多少」
 * 在整个区间里保持一致，不会出现「前面挤、后面松」。
 */
export const FreshnessFillByLevel = ["100%", "82%", "64%", "46%", "28%"] as const;

/**
 * 与填充高度**同向**变化的浓度（索引同上）。双通道的作用：色弱用户只看
 * 「填了多少」也能读档位；正常视力看到的是「高度 + 明度」叠加，档位差异更大。
 */
export const FreshnessOpacityByLevel = [1, 0.84, 0.7, 0.58, 0.48] as const;

/** 方块槽尺寸（px）。12 与 aisessions 的 HeatCell 一致，两个列表才是同一套视觉语言。 */
export const FreshnessSquareSizePx = 12;

/**
 * 「建好后从未编辑过」是独立语义，不是第五档。
 *
 * 真实数据里 `createdat` 与 `updatedat` 在建条时写的是同一个 `now`
 * （`commontext-model.ts` 的 `upsertCommonTextItem`），所以严格相等即可判定；
 * 之后任何一次保存（改正文 / 改标题 / 改标签）都会把 `updatedat` bump 掉。
 */
export function isCommonTextNeverEdited(item: CommonTextItem): boolean {
    return (item.updatedat ?? 0) === (item.createdat ?? 0);
}

/**
 * 档位 → 方块状态。0 表示「从未编辑」（渲染空槽），1..5 是新鲜度档位。
 * 阈值不在这里重写：直接复用 `freshnessLevel()`（aisessions/utils.ts），
 * 两个列表「多久算旧」的口径必须一致。
 */
export function commonTextFreshnessTier(item: CommonTextItem): number {
    if (isCommonTextNeverEdited(item)) return 0;
    return freshnessLevel(item.updatedat);
}

/** 方块内部填充的样式；tier 为 0（从未编辑）时返回 null，渲染成空槽。 */
export function commonTextFreshnessFillStyle(tier: number): { height: string; opacity: number } | null {
    if (tier <= 0) return null;
    const index = Math.min(Math.max(tier, 1), FreshnessFillByLevel.length) - 1;
    return { height: FreshnessFillByLevel[index], opacity: FreshnessOpacityByLevel[index] };
}

/** 填充色：陈旧的 4/5 档用 muted，其余用 accent。 */
export function commonTextFreshnessFillClass(tier: number): string {
    return tier >= 4 ? "bg-muted" : "bg-accent";
}

/**
 * 方块右侧的极简相对时间标签：`now / 45s / 12m / 3h / 45d`。
 *
 * 为什么不是直接显示 `formatSessionRelativeTime` 的原文：右槽只有 58px，`45d ago` 比
 * `45d` 多两个字符；而 `ago` 在一列同构的行里是纯背景噪声——所有行都表示「过去」，
 * 没有对比价值。去掉词根后一个 3 字符标签就够，扫视时读的是数字不是句子。
 *
 * 阈值不在这里重写：直接从 `formatSessionRelativeTime()` 的输出改写，两个列表
 * （aisessions / commontext）「多久算旧」的口径必须一致。
 *
 * 空字符串代表「没有可读时间」（`updatedat` 缺失），调用方直接不渲染文字。
 */
export function formatCommonTextFreshnessCompact(timestamp: number | undefined, now = Date.now()): string {
    if (timestamp == null) return "";
    const relative = formatSessionRelativeTime(timestamp, now);
    if (relative === "never") return "";
    if (relative === "just now") return "now";
    return relative.endsWith(" ago") ? relative.slice(0, -4) : relative;
}
