// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// `buildSessionMetrics` 的锁：档位边界 / 缺数据组合 / live 跨度 / 跨年日期。
//
// 为什么这些边界值得单独锁：度量轨是"扫一眼比大小"的图形，档位错一档用户看不出来，
// 但会稳定地把"100 条消息"和"500 条消息"画成同样高度；缺数据规则错则会出现
// "空占位格"或"卡片高度跳动"。这些都属于肉眼难发现、回归后又真实伤人的类型。

import { describe, expect, it } from "vitest";
import {
    buildSessionMetrics,
    formatCompactSpan,
    formatMessageCount,
    formatSpanDetail,
    SpanHeatThresholds,
} from "./session-metrics-view";

const Now = new Date(2026, 10, 9, 12, 0, 0).getTime(); // 2026-11-09 12:00 本地时间
const Minute = 60_000;
const Hour = 3_600_000;
const Day = 24 * Hour;

function levelOf(value: number, thresholds: readonly number[]): number {
    let level = 1;
    for (const threshold of thresholds) {
        if (value >= threshold) level += 1;
    }
    return Math.min(level, thresholds.length + 1);
}

describe("buildSessionMetrics — 全缺返回 null", () => {
    it("四格都没数据时返回 null（整条轨道不渲染）", () => {
        expect(buildSessionMetrics({ nowMs: Now })).toBeNull();
        expect(buildSessionMetrics({ nowMs: Now, messageCount: 0, size: 0, createdAt: 0, updatedAt: 0 })).toBeNull();
    });
});

describe("buildSessionMetrics — 消息数档位", () => {
    const levelAt = (count: number) => buildSessionMetrics({ nowMs: Now, messageCount: count })?.message?.level;

    it("档位边界：4/5/6 条", () => {
        expect(levelAt(4)).toBe(1);
        expect(levelAt(5)).toBe(2);
        expect(levelAt(6)).toBe(2);
    });

    it("档位边界：99/100/101 条", () => {
        expect(levelAt(99)).toBe(3);
        expect(levelAt(100)).toBe(4);
        expect(levelAt(101)).toBe(4);
    });

    it("档位边界：499/500/501 条", () => {
        expect(levelAt(499)).toBe(4);
        expect(levelAt(500)).toBe(5);
        expect(levelAt(501)).toBe(5);
    });

    it("填充比例 = 档位 × 20%", () => {
        expect(buildSessionMetrics({ nowMs: Now, messageCount: 500 })?.message?.fillPct).toBe(100);
        expect(buildSessionMetrics({ nowMs: Now, messageCount: 1 })?.message?.fillPct).toBe(20);
    });

    it("≥10000 走 k 缩写", () => {
        expect(formatMessageCount(10_000)).toBe("10.0k");
        expect(formatMessageCount(12_345)).toBe("12.3k");
        expect(formatMessageCount(9_999)).toBe("9999");
    });
});

describe("buildSessionMetrics — 体积档位", () => {
    const levelAt = (size: number) => buildSessionMetrics({ nowMs: Now, size })?.size?.level;

    it("档位边界：99K/100K/101K", () => {
        expect(levelAt(99 * 1024)).toBe(1);
        expect(levelAt(100 * 1024)).toBe(2);
        expect(levelAt(101 * 1024)).toBe(2);
    });

    it("文本去掉单位前的空格（窄列省 4px）", () => {
        expect(buildSessionMetrics({ nowMs: Now, size: 2.4 * 1024 * 1024 })?.size?.text).toBe("2.4MB");
    });
});

describe("buildSessionMetrics — 活跃跨度", () => {
    const spanLevelAt = (spanMs: number) => {
        const view = buildSessionMetrics({ nowMs: Now, createdAt: Now - spanMs, updatedAt: Now, live: false });
        return view?.span?.level;
    };

    it("档位阀值：9m/10m/11m", () => {
        expect(spanLevelAt(9 * Minute)).toBe(1);
        expect(spanLevelAt(10 * Minute)).toBe(2);
        expect(spanLevelAt(11 * Minute)).toBe(2);
    });

    it("档位阀值：59m/60m", () => {
        expect(spanLevelAt(59 * Minute)).toBe(2);
        expect(spanLevelAt(60 * Minute)).toBe(3);
    });

    it("档位阀值：7h59m / 8h", () => {
        expect(spanLevelAt(8 * Hour - Minute)).toBe(3);
        expect(spanLevelAt(8 * Hour)).toBe(4);
    });

    it("档位阀值：23h59m / 24h", () => {
        expect(spanLevelAt(Day - Minute)).toBe(4);
        expect(spanLevelAt(Day)).toBe(5);
    });

    it("每个档位阈值与 heatLevel 同源（不是第四份阈值表）", () => {
        for (const threshold of SpanHeatThresholds) {
            expect(spanLevelAt(threshold)).toBe(levelOf(threshold, SpanHeatThresholds));
        }
    });

    it("非 live：跨度停在 updatedAt，不再随 now 增长", () => {
        const view = buildSessionMetrics({ nowMs: Now, createdAt: Now - 3 * Hour, updatedAt: Now - 2 * Hour });
        expect(view?.span?.text).toBe("1h");
    });

    it("live：跨度走到 now", () => {
        const view = buildSessionMetrics({
            nowMs: Now,
            createdAt: Now - 3 * Hour,
            updatedAt: Now - 2 * Hour,
            live: true,
        });
        expect(view?.span?.text).toBe("3h");
    });

    it("live 时 tooltip 的终点写「现在」", () => {
        const view = buildSessionMetrics({ nowMs: Now, createdAt: Now - Hour, updatedAt: Now - Hour, live: true });
        expect(view?.span?.title).toContain("→ 现在");
    });

    it("updatedAt 早于 createdAt（脏数据）钳到 0，不画负跨度", () => {
        const view = buildSessionMetrics({ nowMs: Now, createdAt: Now, updatedAt: Now - Hour });
        expect(view?.span?.text).toBe("<1m");
        expect(view?.span?.level).toBe(1);
    });

    it("缺 createdAt → 跨度与创建日期都不渲染", () => {
        const view = buildSessionMetrics({ nowMs: Now, messageCount: 7, updatedAt: Now - Hour });
        expect(view?.span).toBeUndefined();
        expect(view?.created).toBeUndefined();
        expect(view?.message?.level).toBe(2);
    });

    it("`↔` 与数值分开返回（符号要单独做样式），不能混在 text 里", () => {
        const view = buildSessionMetrics({ nowMs: Now, createdAt: Now - Day, updatedAt: Now });
        expect(view?.span?.mark).toBe("↔");
        expect(view?.span?.text).toBe("1d");
    });
});

describe("buildSessionMetrics — 创建日期", () => {
    it("同年只给 MM-DD", () => {
        const createdAt = new Date(2026, 9, 28, 9, 12, 33).getTime();
        const view = buildSessionMetrics({ nowMs: Now, createdAt });
        expect(view?.created?.text).toBe("10-28");
    });

    it("跨年带年份", () => {
        const createdAt = new Date(2025, 11, 11, 9, 12, 33).getTime();
        const view = buildSessionMetrics({ nowMs: Now, createdAt });
        expect(view?.created?.text).toBe("2025-12-11");
    });

    it("tooltip 精确到秒", () => {
        const createdAt = new Date(2026, 9, 28, 9, 12, 33).getTime();
        const view = buildSessionMetrics({ nowMs: Now, createdAt });
        expect(view?.created?.title).toBe("创建：2026-10-28 09:12:33");
    });
});

describe("缺一格的组合", () => {
    it("只缺体积：其余三格照常，count 由调用方按存在性统计", () => {
        const view = buildSessionMetrics({
            nowMs: Now,
            messageCount: 12,
            createdAt: Now - 2 * Hour,
            updatedAt: Now - Hour,
        });
        expect(view?.message).toBeDefined();
        expect(view?.size).toBeUndefined();
        expect(view?.span).toBeDefined();
        expect(view?.created).toBeDefined();
    });
});

describe("时长格式化", () => {
    it("formatCompactSpan 四档", () => {
        expect(formatCompactSpan(30 * 1000)).toBe("<1m");
        expect(formatCompactSpan(37 * Minute)).toBe("37m");
        expect(formatCompactSpan(3 * Hour)).toBe("3h");
        expect(formatCompactSpan(3 * Day)).toBe("3d");
    });

    it("formatSpanDetail 带分/时", () => {
        expect(formatSpanDetail(37 * Minute)).toBe("37m");
        expect(formatSpanDetail(Hour + 5 * Minute)).toBe("1h05m");
        expect(formatSpanDetail(3 * Day + 4 * Hour)).toBe("3d4h");
    });
});
