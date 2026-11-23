// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// `overview-scheduled-tasks` 的锁：把 ScheduledTaskType[] 投影成 Overview 独立「定时任务」区的渲染项。
//
// 为什么值得锁：
//   · 数量必须守恒 —— disabled 任务仍然要列出（置灰），少一个用户就会以为任务被删了；
//   · 排序必须稳定 —— enabled 优先、其次 nextRun 升序、无法计算 nextRun 的排最后，
//     否则每次刷新卡片顺序抖动，用户点错卡；
//   · nextRun 计算口径对齐 pkg/scheduler.GetNextRunTime（cron / interval / daily / weekly / once），
//     文案复用既有 `formatSessionDateCompact(..., withTime=true)`，不另写时间格式。

import { describe, expect, it } from "vitest";
import { buildScheduledTaskCards, computeNextRunAt } from "./overview-scheduled-tasks";

const NOW = new Date(2026, 10, 23, 15, 0, 0).getTime(); // 2026-11-23 15:00 本地时间

function makeTask(over: Record<string, any> = {}): ScheduledTaskType {
    return {
        id: "t1",
        name: "task",
        enabled: true,
        agentProfile: "pi",
        prompt: "p",
        schedule: { type: "interval", intervalMs: 3600_000 },
        ...over,
    } as ScheduledTaskType;
}

describe("buildScheduledTaskCards", () => {
    it("空列表 → 空数组（整区不渲染）", () => {
        expect(buildScheduledTaskCards([], { now: NOW })).toEqual([]);
        expect(buildScheduledTaskCards(null as unknown as ScheduledTaskType[], { now: NOW })).toEqual([]);
    });

    it("数量守恒：disabled 仍列出，enabled 标记为 false", () => {
        const tasks = [
            makeTask({ id: "a", name: "A", enabled: true }),
            makeTask({ id: "b", name: "B", enabled: false }),
            makeTask({ id: "c", name: "C", enabled: false }),
        ];
        const cards = buildScheduledTaskCards(tasks, { now: NOW });
        expect(cards).toHaveLength(3);
        expect(cards.map((c) => c.taskId).sort()).toEqual(["a", "b", "c"]);
        expect(cards.find((c) => c.taskId === "b").enabled).toBe(false);
    });

    it("排序：enabled 优先，其次 nextRun 升序，无法计算 nextRun 的排最后", () => {
        const tasks = [
            makeTask({ id: "disabledEarly", enabled: false, schedule: { type: "interval", intervalMs: 1000 } }),
            makeTask({ id: "enabledLate", enabled: true, schedule: { type: "interval", intervalMs: 7200_000 } }),
            makeTask({ id: "enabledEarly", enabled: true, schedule: { type: "interval", intervalMs: 60_000 } }),
            makeTask({ id: "enabledUnknown", enabled: true, schedule: { type: "cron", cronExpr: "not a cron" } }),
        ];
        const cards = buildScheduledTaskCards(tasks, { now: NOW });
        expect(cards.map((c) => c.taskId)).toEqual(["enabledEarly", "enabledLate", "enabledUnknown", "disabledEarly"]);
    });

    it("hero 名册解析 emoji + 名称；未绑定 hero 则留空", () => {
        const tasks = [makeTask({ id: "withHero", hero: "nita" }), makeTask({ id: "noHero" })];
        const cards = buildScheduledTaskCards(tasks, {
            now: NOW,
            heroes: [
                { id: "nita", name: "Nita", emoji: "🦊" },
                { id: "other", name: "Other", emoji: "🐼" },
            ],
        });
        const withHero = cards.find((c) => c.taskId === "withHero");
        expect(withHero.heroEmoji).toBe("🦊");
        expect(withHero.heroName).toBe("Nita");
        const noHero = cards.find((c) => c.taskId === "noHero");
        expect(noHero.heroEmoji).toBe("");
        expect(noHero.heroName).toBe("");
    });

    it("hero 不在名册里 → 名称回落到 hero id，emoji 留空", () => {
        const cards = buildScheduledTaskCards([makeTask({ id: "x", hero: "ghost" })], { now: NOW, heroes: [] });
        expect(cards[0].heroEmoji).toBe("");
        expect(cards[0].heroName).toBe("ghost");
    });

    it("nextRunLabel 复用既有格式化（MM-DD HH:mm）", () => {
        const cards = buildScheduledTaskCards(
            [makeTask({ id: "a", schedule: { type: "interval", intervalMs: 3600_000 } })],
            { now: NOW }
        );
        expect(cards[0].nextRunAt).toBe(NOW + 3600_000);
        expect(cards[0].nextRunLabel).toBe("11-23 16:00");
    });

    it("lastStatus 透传，缺失时为空串", () => {
        const cards = buildScheduledTaskCards([makeTask({ id: "a", lastRunStatus: "failed" }), makeTask({ id: "b" })], {
            now: NOW,
        });
        expect(cards.find((c) => c.taskId === "a").lastStatus).toBe("failed");
        expect(cards.find((c) => c.taskId === "b").lastStatus).toBe("");
    });
});

describe("computeNextRunAt（对齐 GetNextRunTime 口径）", () => {
    it("interval：now + intervalMs", () => {
        expect(computeNextRunAt(makeTask({ schedule: { type: "interval", intervalMs: 60_000 } }), NOW)).toBe(
            NOW + 60_000
        );
        expect(computeNextRunAt(makeTask({ schedule: { type: "interval" } }), NOW)).toBe(0);
        expect(computeNextRunAt(makeTask({ schedule: { type: "interval", intervalMs: 0 } }), NOW)).toBe(0);
    });

    it("daily：当天时间已过则顺延一天", () => {
        const next = computeNextRunAt(makeTask({ schedule: { type: "daily", timeOfDay: "09:00" } }), NOW);
        expect(new Date(next).getDate()).toBe(24);
        expect(new Date(next).getHours()).toBe(9);
        const later = computeNextRunAt(makeTask({ schedule: { type: "daily", timeOfDay: "18:30" } }), NOW);
        expect(new Date(later).getDate()).toBe(23);
        expect(new Date(later).getHours()).toBe(18);
        expect(new Date(later).getMinutes()).toBe(30);
    });

    it("weekly：下一个指定星期几（含当天未过）+ 时间点", () => {
        // 2026-11-23 是星期一
        const next = computeNextRunAt(
            makeTask({ schedule: { type: "weekly", timeOfDay: "09:00", dayOfWeek: 3 } }),
            NOW
        );
        expect(new Date(next).getDay()).toBe(3);
        // 当天（星期一）时间未过 → 就是今天
        const today = computeNextRunAt(
            makeTask({ schedule: { type: "weekly", timeOfDay: "18:00", dayOfWeek: 1 } }),
            NOW
        );
        expect(new Date(today).getDate()).toBe(23);
        expect(new Date(today).getHours()).toBe(18);
    });

    it("once：未来的 runAt 返回该时间点，已过期返回 0", () => {
        const future = new Date(NOW + 86_400_000).toISOString();
        expect(computeNextRunAt(makeTask({ schedule: { type: "once", runAt: future } }), NOW)).toBe(
            new Date(future).getTime()
        );
        const past = new Date(NOW - 86_400_000).toISOString();
        expect(computeNextRunAt(makeTask({ schedule: { type: "once", runAt: past } }), NOW)).toBe(0);
        expect(computeNextRunAt(makeTask({ schedule: { type: "once" } }), NOW)).toBe(0);
    });

    it("cron：下一个匹配分钟", () => {
        const everyMinute = computeNextRunAt(makeTask({ schedule: { type: "cron", cronExpr: "* * * * *" } }), NOW);
        expect(everyMinute).toBe(NOW + 60_000);

        // 每小时第 0 分：15:00 之后是 16:00
        const hourly = computeNextRunAt(makeTask({ schedule: { type: "cron", cronExpr: "0 * * * *" } }), NOW);
        expect(new Date(hourly).getHours()).toBe(16);
        expect(new Date(hourly).getMinutes()).toBe(0);

        // 每天 09:00（工作日 cron）—— 2026-11-23 15:00 之后落到次日 09:00
        const workday = computeNextRunAt(makeTask({ schedule: { type: "cron", cronExpr: "0 9 * * 1-5" } }), NOW);
        expect(new Date(workday).getDate()).toBe(24);
        expect(new Date(workday).getHours()).toBe(9);
    });

    it("非法 cron / 未知类型 / null → 0", () => {
        expect(computeNextRunAt(makeTask({ schedule: { type: "cron", cronExpr: "bogus" } }), NOW)).toBe(0);
        expect(computeNextRunAt(makeTask({ schedule: { type: "cron", cronExpr: "0 0 0" } }), NOW)).toBe(0);
        expect(computeNextRunAt(makeTask({ schedule: { type: "unknown" } }), NOW)).toBe(0);
        expect(computeNextRunAt(null as unknown as ScheduledTaskType, NOW)).toBe(0);
        expect(computeNextRunAt(makeTask({ schedule: null }), NOW)).toBe(0);
    });
});
