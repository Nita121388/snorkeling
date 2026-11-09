// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { commonTextFreshnessFillClass, commonTextFreshnessFillStyle } from "./commontext-freshness";

type CommonTextFreshnessSquareProps = {
    /** 档位 0..5，见 `commonTextFreshnessTier`：0 = 建好后从未编辑 */
    tier: number;
    /** 悬浮提示：`Updated 03-15 09:34` */
    title: string;
    /** 读屏文案：必须说清楚是新还是旧，可以带相对时间 */
    ariaLabel: string;
    className?: string;
};

/**
 * 更新时间的热力方块：12×12 槽，内部从底部往上填。
 *
 * 结构照搬 `frontend/app/view/aisessions/session-row.tsx` 的 `HeatCell` —— 同一个原语、
 * 同一个尺寸，两个列表的「时间有多新」才是同一套视觉语言。
 *
 * 槽必须显形：5 档只填 30% 时若没有槽底，图形等于消失。用比行底色差一档的
 * surface-strong 当槽，而不是描边（描边会让填充看起来像「被框住的窗口」）。
 *
 * 用户看到的只有「满 / 大半 / 一半 / 小半 / 一格底 / 空」，精确时间在 tooltip 与
 * aria-label 里 —— 列表要的是扫视比较，不是读时间戳。
 */
export function CommonTextFreshnessSquare({ tier, title, ariaLabel, className }: CommonTextFreshnessSquareProps) {
    const fill = commonTextFreshnessFillStyle(tier);
    return (
        <span
            role="img"
            aria-label={ariaLabel}
            title={title}
            data-commontext-freshness={tier === 0 ? "never-edited" : tier}
            className={cn(
                "inline-flex h-3 w-3 shrink-0 items-end justify-center overflow-hidden rounded-[3px] bg-surface-strong/70",
                className
            )}
        >
            {fill == null ? null : (
                <span className={cn("block w-full rounded-[1px]", commonTextFreshnessFillClass(tier))} style={fill} />
            )}
        </span>
    );
}
