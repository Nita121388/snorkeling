// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Overview 独立「定时任务」区的纯投影模块（N-1123-hero-sched-ui）。
//
// 职责：ScheduledTaskType[] → 渲染项（hero emoji / 任务名 / 下次运行 / 上次状态 / 启停），
// 不碰 React、不碰 RPC —— 排序与 nextRun 计算都可以被单测钉死。
//
// nextRun 计算口径对齐 pkg/scheduler/scheduler.go GetNextRunTime：
//   cron → 5 字段 POSIX cron 的下一个匹配分钟（与 NextCronTime 同算法，包括 dom/dow 交集语义）；
//   interval → now + intervalMs；daily/weekly → 本地时间下一个 timeOfDay（weekly 取下一个 dayOfWeek）；
//   once → 未来 runAt，已过期 / 缺字段为 0（= 未知，排序时排在能计算的任务之后）。
// 已知偏差：后端按 task.Schedule.Timezone 计算，本模块按浏览器本地时区计算；
// Overview 是展示面（点击卡片进编辑弹窗才是权威编辑口），该偏差仅影响横条上的展示时间。
//
// 文案口径：nextRunLabel 复用 aisessions/utils.formatSessionDateCompact(..., withTime=true)，
// 不另写时间格式。

import { formatSessionDateCompact } from "@/app/view/aisessions/utils";
import type { HeroRosterEntry } from "@/app/workspace/hero-launch";

/** 后端 ScheduledTaskType（gotypes 尚未带 hero 字段；core 包已可读写，前端用交叉类型补齐）。 */
/** hero 绑定字段已在 gotypes（卷一 11-23 core 包合入后重新生成），无需交叉类型补位。 */
export type ScheduledTaskWithHero = ScheduledTaskType;

export type ScheduledTaskCard = {
    taskId: string;
    name: string;
    /** 绑定的 hero id（未绑定 = 空串）。 */
    heroId: string;
    /** hero emoji；未绑定 / 名册里没有 emoji = 空串（渲染层不画该 span）。 */
    heroEmoji: string;
    /** hero 展示名；名册缺失时回落到 hero id。 */
    heroName: string;
    /** 下次运行的 epoch ms；0 = 算不出（排序时排在同类之后）。 */
    nextRunAt: number;
    /** 复用既有格式化的下次运行文案（"MM-DD HH:mm"）；算不出为空串。 */
    nextRunLabel: string;
    /** 上次运行的 epoch ms（无 = 0）。 */
    lastRunAt: number;
    /** 上次运行状态（lastRunStatus 透传，缺失 = 空串）。 */
    lastStatus: string;
    enabled: boolean;
};

export type BuildScheduledTaskCardsOpts = {
    /** hero 名册（HeroRoster RPC 的 heroes 数组），用于解析 emoji / 名称。 */
    heroes?: HeroRosterEntry[];
    /** 计算基准时间（默认 Date.now()）；单测用固定值钉死排序。 */
    now?: number;
};

/**
 * 投影 + 排序：enabled 优先，其次 nextRun 升序，算不出 nextRun 的排最后，
同类内按 taskId 兜底保证稳定。数量守恒：disabled 任务保留（置灰），不丢弃。
 */
export function buildScheduledTaskCards(
    tasks: ScheduledTaskWithHero[] | null | undefined,
    opts: BuildScheduledTaskCardsOpts = {}
): ScheduledTaskCard[] {
    if (tasks == null || tasks.length === 0) {
        return [];
    }
    const now = opts.now ?? Date.now();
    const heroes = opts.heroes ?? [];
    const cards = tasks.map((task): ScheduledTaskCard => {
        const heroId = (task as ScheduledTaskWithHero).hero ?? "";
        const entry = heroId === "" ? null : (heroes.find((h) => h.id === heroId) ?? null);
        const nextRunAt = computeNextRunAt(task, now);
        return {
            taskId: task.id,
            name: task.name,
            heroId,
            heroEmoji: entry?.emoji ?? "",
            heroName: heroId === "" ? "" : entry?.name || heroId,
            nextRunAt,
            nextRunLabel: nextRunLabel(nextRunAt, now),
            lastRunAt: parseIsoMs(task.lastRunAt),
            lastStatus: task.lastRunStatus ?? "",
            enabled: task.enabled !== false,
        };
    });
    return cards.sort(compareCards);
}

function compareCards(a: ScheduledTaskCard, b: ScheduledTaskCard): number {
    if (a.enabled !== b.enabled) {
        return a.enabled ? -1 : 1;
    }
    const av = a.nextRunAt > 0 ? a.nextRunAt : Number.POSITIVE_INFINITY;
    const bv = b.nextRunAt > 0 ? b.nextRunAt : Number.POSITIVE_INFINITY;
    if (av !== bv) {
        return av - bv;
    }
    // 同一任务列表里 taskId 唯一；用它兜底保证排序稳定。
    return a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0;
}

function nextRunLabel(nextRunAt: number, now: number): string {
    if (!nextRunAt || !Number.isFinite(nextRunAt)) {
        return "";
    }
    return formatSessionDateCompact(nextRunAt, now, true);
}

function parseIsoMs(iso: string | undefined | null): number {
    if (!iso) return 0;
    const ms = new Date(iso).getTime();
    return Number.isFinite(ms) ? ms : 0;
}

// ---------------------------------------------------------------------------
// computeNextRunAt —— 与 pkg/scheduler GetNextRunTime 同口径的浏览器端实现
// ---------------------------------------------------------------------------

const DOW_NAMES: Record<string, number> = {
    sun: 0,
    sunday: 0,
    mon: 1,
    monday: 1,
    tue: 2,
    tuesday: 2,
    wed: 3,
    wednesday: 3,
    thu: 4,
    thursday: 4,
    fri: 5,
    friday: 5,
    sat: 6,
    saturday: 6,
};

const MON_NAMES: Record<string, number> = {
    jan: 1,
    january: 1,
    feb: 2,
    february: 2,
    mar: 3,
    march: 3,
    apr: 4,
    april: 4,
    may: 5,
    jun: 6,
    june: 6,
    jul: 7,
    july: 7,
    aug: 8,
    august: 8,
    sep: 9,
    september: 9,
    oct: 10,
    october: 10,
    nov: 11,
    november: 11,
    dec: 12,
    december: 12,
};

/** 下次运行的 epoch ms；0 = 未知（算不出 / 已过期 / 缺字段）。 */
export function computeNextRunAt(task: ScheduledTaskWithHero | null | undefined, now = Date.now()): number {
    if (task == null) return 0;
    const schedule = (task as ScheduledTaskType).schedule;
    if (schedule == null) return 0;
    switch (schedule.type) {
        case "cron":
            return nextCronTime(schedule.cronExpr ?? "", now);
        case "interval":
            return schedule.intervalMs != null && schedule.intervalMs > 0 ? now + schedule.intervalMs : 0;
        case "daily":
        case "weekly":
            return nextDailyWeekly(schedule, now);
        case "once":
            return nextOnce(schedule, now);
        default:
            return 0;
    }
}

/** once：未来的 runAt（RFC3339）→ 时间点；过去 / 缺失 → 0。 */
function nextOnce(schedule: ScheduledTaskScheduleType, now: number): number {
    if (!schedule.runAt) return 0;
    const ts = new Date(schedule.runAt).getTime();
    if (!Number.isFinite(ts)) return 0;
    return ts >= now ? ts : 0;
}

/** daily/weekly：本地时间下一个 timeOfDay；weekly 再对齐下一个 dayOfWeek。 */
function nextDailyWeekly(schedule: ScheduledTaskScheduleType, now: number): number {
    const [hour, minute] = splitHHMM(schedule.timeOfDay);
    if (hour == null || minute == null) return 0;
    const start = new Date(now);
    let target = new Date(start.getFullYear(), start.getMonth(), start.getDate(), hour, minute, 0, 0);
    if (schedule.type === "weekly") {
        const wd = schedule.dayOfWeek ?? 0;
        let daysAhead = (wd - start.getDay() + 7) % 7;
        if (daysAhead === 0 && target.getTime() <= now) {
            daysAhead = 7;
        }
        target = new Date(target.getTime() + daysAhead * 86_400_000);
    } else {
        if (target.getTime() <= now) {
            target = new Date(target.getTime() + 86_400_000);
        }
    }
    return target.getTime();
}

function splitHHMM(timeOfDay: string | undefined | null): [number | null, number | null] {
    if (!timeOfDay) return [null, null];
    const match = /^(\d{1,2}):(\d{1,2})$/.exec(timeOfDay.trim());
    if (match == null) return [null, null];
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) return [null, null];
    return [hour, minute];
}

/**
 * cron：5 字段 POSIX cron 的下一个匹配分钟（对齐 pkg/scheduler NextCronTime）。
 * 搜索空间与后端一致（366 天 × 24 × 60 分钟），逐分钟扫描；匹配不上（如 2 月 30 日）返回 0。
 */
function nextCronTime(expr: string, now: number): number {
    const fields = expr.trim().split(/\s+/);
    if (fields.length !== 5 || fields.some((f) => f === "")) {
        return 0;
    }
    const minutes = expandField(fields[0], 0, 59, null);
    const hours = expandField(fields[1], 0, 23, null);
    const daysOfMonth = expandField(fields[2], 1, 31, null);
    const months = expandField(fields[3], 1, 12, MON_NAMES);
    const daysOfWeek = expandField(fields[4], 0, 6, DOW_NAMES);
    if (minutes.length === 0 || hours.length === 0 || months.length === 0) {
        return 0;
    }
    // 对齐后端：cursor 从 after 的下一分钟开始，匹配的 minute 严格大于 now 所在分钟。
    let cursor = new Date(now);
    cursor = new Date(
        cursor.getFullYear(),
        cursor.getMonth(),
        cursor.getDate(),
        cursor.getHours(),
        cursor.getMinutes(),
        0,
        0
    );
    cursor = new Date(cursor.getTime() + 60_000);
    const minuteSet = new Set(minutes);
    const hourSet = new Set(hours);
    const domSet = new Set(daysOfMonth);
    const monthSet = new Set(months);
    const dowSet = new Set(daysOfWeek);
    for (let i = 0; i < 366 * 24 * 60; i++) {
        if (
            monthSet.has(cursor.getMonth() + 1) &&
            domSet.has(cursor.getDate()) &&
            dowSet.has(cursor.getDay()) &&
            hourSet.has(cursor.getHours()) &&
            minuteSet.has(cursor.getMinutes())
        ) {
            return cursor.getTime();
        }
        cursor = new Date(cursor.getTime() + 60_000);
    }
    return 0;
}

/** 对齐后端 expandField：*、逗号、区间、步长、单值（含星期/月份英文名）；空结果回落整段。 */
function expandField(field: string, minVal: number, maxVal: number, names: Record<string, number> | null): number[] {
    const out = new Set<number>();
    const parseVal = (s: string, def: number): number => {
        const trimmed = s.trim().toLowerCase();
        const named = names?.[trimmed];
        if (named != null) return named;
        const n = Number(trimmed);
        return Number.isFinite(n) ? n : def;
    };
    const addRange = (a: number, b: number) => {
        if (a > b) [a, b] = [b, a];
        for (let v = a; v <= b; v++) out.add(v);
    };
    if (field.trim() === "*") {
        addRange(minVal, maxVal);
    } else {
        for (const part of field.split(",")) {
            const trimmed = part.trim();
            if (trimmed === "") continue;
            if (trimmed.includes("/")) {
                const [startPart, stepPart] = trimmed.split("/", 2);
                const start =
                    startPart.trim() === "*" || startPart.trim() === "" ? minVal : parseVal(startPart, minVal);
                const step = parseVal(stepPart, 1);
                const stepSafe = step > 0 ? step : 1;
                for (let v = start; v <= maxVal; v += stepSafe) out.add(v);
            } else if (trimmed.includes("-")) {
                const [aPart, bPart] = trimmed.split("-", 2);
                addRange(parseVal(aPart, minVal), parseVal(bPart, maxVal));
            } else {
                out.add(parseVal(trimmed, minVal));
            }
        }
    }
    const filtered = [...out].filter((v) => v >= minVal && v <= maxVal).sort((a, b) => a - b);
    return filtered.length === 0 ? rangeSlice(minVal, maxVal) : filtered;
}

function rangeSlice(minVal: number, maxVal: number): number[] {
    const out: number[] = [];
    for (let v = minVal; v <= maxVal; v++) out.push(v);
    return out;
}
