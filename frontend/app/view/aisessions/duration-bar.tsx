// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import { durationBarFraction } from "./fold-duration";

/**
 * 折叠组头部的迷你时长条。
 *
 * 宽度按「本会话最长折叠组」归一化（`durationBarFraction`），极短时长也有
 * 最小可见宽度；精确时长与条目数放在原生 `title` 里，鼠标悬浮即可看到。
 * 纯展示组件，不做任何计算或 DOM 测量。
 */
export function DurationBar({
    durationMs,
    maxDurationMs = 0,
    label,
    fillColor = "var(--accent-color)",
    trackClassName = "bg-border/60",
}: {
    durationMs: number;
    maxDurationMs?: number;
    label: string;
    fillColor?: string;
    trackClassName?: string;
}) {
    const fraction = durationBarFraction(durationMs, maxDurationMs);
    if (fraction <= 0) return null;
    return (
        <span
            className="group/dur flex shrink-0 items-center"
            title={label}
            aria-label={label}
            data-duration-ms={Math.round(durationMs)}
        >
            <span className={`relative h-1 w-10 overflow-hidden rounded-full ${trackClassName}`}>
                <span
                    className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-300 ease-out"
                    style={{ width: `${Math.round(fraction * 100)}%`, backgroundColor: fillColor }}
                />
            </span>
        </span>
    );
}
