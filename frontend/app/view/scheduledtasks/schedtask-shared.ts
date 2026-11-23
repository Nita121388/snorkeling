// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 定时任务的展示口径（纯函数）——任务 11-23-schedtask-modal 收口。
//
// 背景：`scheduledtasks-view.tsx` 与 `overview-scheduled-tasks-panel.tsx` 各自持有一份
// `statusColor`（口径相同、值不同，属于重复代码），`describeSchedule` 只在 view 里且未导出，
// 而弹窗化管理面同样需要调度描述。收口到本模块：状态色只留一份语义映射（CSS 变量），
// Tailwind class 版本从同一映射派生；describeSchedule 也只留一份。
//
// 注意：describeSchedule 返回 i18n 文案（scheduledtasks 命名空间），调用方需保证 i18n 已初始化。

import { i18n } from "@/i18n/config";
import { describeCron } from "./cron-describe";

/** 上次状态 → CSS 变量色（modal / Overview 的 inline style 用）。 */
export function schedTaskStatusColorVar(status?: string): string {
    switch (status) {
        case "success":
            return "var(--success)";
        case "error":
        case "timeout":
            return "var(--error)";
        case "running":
            return "var(--accent-color)";
        default:
            return "var(--secondary-text-color)";
    }
}

/** 上次状态 → Tailwind class（scheduledtasks-view 用；与上面同一口径）。 */
export function schedTaskStatusColorClass(status?: string): string {
    switch (status) {
        case "success":
            return "text-[var(--success)]";
        case "error":
        case "timeout":
            return "text-[var(--error)]";
        case "running":
            return "text-accent";
        default:
            return "text-muted";
    }
}

/** 调度 → 人话描述（scheduledtasks block 视图与管理弹窗共用）。 */
export function describeSchedule(s: ScheduledTaskScheduleType): string {
    switch (s?.type) {
        case "cron":
            return describeCron(s.cronExpr);
        case "interval": {
            const secs = s.intervalMs ? s.intervalMs / 1000 : null;
            if (secs == null) return i18n.t("scheduledtasks:schedule.unknownInterval");
            if (secs < 60) return i18n.t("scheduledtasks:schedule.everySeconds", { count: secs });
            if (secs % 3600 === 0) return i18n.t("scheduledtasks:schedule.everyHours", { count: secs / 3600 });
            return i18n.t("scheduledtasks:schedule.everyMinutes", { count: secs / 60 });
        }
        case "daily":
            return i18n.t("scheduledtasks:schedule.dailyAt", { time: s.timeOfDay ?? "" });
        case "weekly": {
            const weekdayKeys = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
            const d = s.dayOfWeek;
            const wd = d >= 0 && d <= 6 ? i18n.t(`scheduledtasks:weekday.${weekdayKeys[d]}`) : String(d ?? "?");
            return i18n.t("scheduledtasks:schedule.weeklyOn", { day: wd, time: s.timeOfDay ?? "" });
        }
        case "once":
            return s.runAt
                ? i18n.t("scheduledtasks:schedule.onceAt", { time: s.runAt })
                : i18n.t("scheduledtasks:schedule.once");
        default:
            return s?.type ?? "-";
    }
}
