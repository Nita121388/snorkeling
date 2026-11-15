// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Human-readable description for the 5-field POSIX cron syntax that the
// scheduler supports (see pkg/scheduler/cronexpr.go). Used to help users who
// are not familiar with cron understand when a task actually runs.
//
// All phrasing lives in the `scheduledtasks:cron.*` resources (en is the
// source of truth); this module only computes the numbers/labels to
// interpolate, so a `ui:locale` switch is picked up on the next call.

import { i18n } from "@/i18n/config";

const DOW_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
const MON_KEYS = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
] as const;

// Resolved per call (not cached at module load): caching here would freeze the
// locale that was active when the module was first imported.
function dowName(index: number): string {
    return i18n.t(`scheduledtasks:weekday.${DOW_KEYS[index]}`);
}
function monName(index: number): string {
    return i18n.t(`scheduledtasks:month.${MON_KEYS[index]}`);
}

const DOW_NAME: Record<string, number> = {
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

function pad(n: number): string {
    return String(n).padStart(2, "0");
}

function parseField(field: string, lo: number, hi: number, names: boolean): number[] | null {
    if (field === "*") {
        const out: number[] = [];
        for (let i = lo; i <= hi; i++) out.push(i);
        return out;
    }
    const seen = new Set<number>();
    const out: number[] = [];
    for (const rawPart of field.split(",")) {
        const part = rawPart.trim();
        if (!part) return null;
        const numOf = (s: string): number | null => {
            if (names) {
                const n = DOW_NAME[s.toLowerCase()];
                if (n !== undefined) return n;
            }
            const n = parseInt(s, 10);
            return isNaN(n) ? null : n;
        };
        if (part.includes("/")) {
            const [base, stepS] = part.split("/");
            const step = parseInt(stepS, 10);
            if (isNaN(step) || step <= 0) return null;
            let start = lo;
            if (base !== "*") {
                const startNum = numOf(base.includes("-") ? base.split("-")[0] : base);
                if (startNum === null) return null;
                start = startNum;
            }
            for (let v = start; v <= hi; v += step) {
                if (!seen.has(v)) {
                    seen.add(v);
                    out.push(v);
                }
            }
        } else if (part.includes("-")) {
            const [a, b] = part.split("-");
            const av = numOf(a);
            const bv = numOf(b);
            if (av === null || bv === null) return null;
            let x = av,
                y = bv;
            if (x > y) {
                [x, y] = [y, x];
            }
            for (let v = x; v <= y; v++) {
                if (v >= lo && v <= hi && !seen.has(v)) {
                    seen.add(v);
                    out.push(v);
                }
            }
        } else {
            const v = numOf(part);
            if (v === null || v < lo || v > hi) return null;
            if (!seen.has(v)) {
                seen.add(v);
                out.push(v);
            }
        }
    }
    if (out.length === 0) return null;
    out.sort((a, b) => a - b);
    return out;
}

function ordinal(n: number): string {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function isConsecutive(sorted: number[]): boolean {
    for (let i = 1; i < sorted.length; i++) {
        if (sorted[i] !== sorted[i - 1] + 1) return false;
    }
    return true;
}

function describeDow(dows: number[]): string | null {
    if (dows.length === 7) return null;
    const key = dows.join(",");
    if (key === "1,2,3,4,5") return i18n.t("scheduledtasks:cron.dowEveryWeekday");
    if (key === "6,0" || key === "0,6") return i18n.t("scheduledtasks:cron.dowEveryWeekend");
    if (dows.length === 1) return i18n.t("scheduledtasks:cron.dowEvery", { day: dowName(dows[0]) });
    if (isConsecutive(dows))
        return i18n.t("scheduledtasks:cron.dowFromThrough", {
            from: dowName(dows[0]),
            to: dowName(dows[dows.length - 1]),
        });
    return i18n.t("scheduledtasks:cron.dowOn", {
        days: dows.map((d) => dowName(d).slice(0, 3)).join(", "),
    });
}

function describeDom(doms: number[]): string | null {
    if (doms.length === 31) return null;
    if (doms.length === 1)
        // `day` is the raw number (zh), `ordinal` the English ordinal form (en).
        return i18n.t("scheduledtasks:cron.domOnThe", {
            day: String(doms[0]),
            ordinal: ordinal(doms[0]),
        });
    if (isConsecutive(doms) && doms.length > 1)
        return i18n.t("scheduledtasks:cron.domRange", { from: doms[0], to: doms[doms.length - 1] });
    return i18n.t("scheduledtasks:cron.domList", { days: doms.join(", ") });
}

function describeMon(mons: number[]): string | null {
    if (mons.length === 12) return null;
    if (mons.length === 1) return i18n.t("scheduledtasks:cron.monIn", { month: monName(mons[0] - 1) });
    if (isConsecutive(mons))
        return i18n.t("scheduledtasks:cron.monFrom", {
            from: monName(mons[0] - 1),
            to: monName(mons[mons.length - 1] - 1),
        });
    return i18n.t("scheduledtasks:cron.monList", {
        months: mons.map((m) => monName(m - 1).slice(0, 3)).join(", "),
    });
}

function build(
    minutes: number[],
    hours: number[],
    doms: number[],
    mons: number[],
    dows: number[],
    minF: string,
    hourF: string
): string {
    const allH = hours.length === 24;
    const allM = minutes.length === 60;

    // "*/N" hour step → "Every N hours"
    if (/^\*\//.test(hourF)) {
        const m0 = minutes.length === 1 && minutes[0] === 0;
        const minTxt =
            allM || m0 ? "" : ` ${i18n.t("scheduledtasks:cron.atMinutes", { minutes: minutes.map(pad).join(", ") })}`;
        // `count` must be numeric: i18next's plural resolution treats a string
        // count as a missing plural key and returns the raw key.
        return i18n.t("scheduledtasks:cron.everyNHours", { count: parseInt(hourF.slice(2), 10) }) + minTxt;
    }
    // "*/N" minute step across all hours → "Every N minutes"
    if (allH && /^\*\//.test(minF)) {
        return i18n.t("scheduledtasks:cron.everyNMinutes", { count: parseInt(minF.slice(2), 10) });
    }

    // Time text.
    let timeTxt: string;
    if (allH) {
        timeTxt = allM ? "" : i18n.t("scheduledtasks:cron.atMinutes", { minutes: minutes.map(pad).join(", ") });
    } else {
        const times: string[] = [];
        for (const h of hours) for (const m of minutes) times.push(`${pad(h)}:${pad(m)}`);
        timeTxt = i18n.t("scheduledtasks:cron.atTime", { times: times.join(", ") });
    }

    // Date parts.
    const parts: string[] = [];
    const domTxt = describeDom(doms);
    if (domTxt) parts.push(domTxt);
    const monTxt = describeMon(mons);
    if (monTxt) parts.push(monTxt);
    const dowTxt = describeDow(dows);
    if (dowTxt) parts.push(dowTxt);

    if (parts.length === 0) {
        if (!timeTxt) return i18n.t("scheduledtasks:cron.everyMinute");
        return i18n.t("scheduledtasks:cron.daily", { time: timeTxt });
    }
    const lead = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
    const rest = parts.slice(1).join(", ");
    const joined = rest ? `${lead}, ${rest}` : lead;
    return `${joined} ${timeTxt}`.trim();
}

/**
 * Return a short human-readable description of a 5-field cron expression.
 * Returns "" for empty input and a short explanation string when the
 * expression cannot be understood (so callers can show it as a hint).
 */
export function describeCron(expr: string | null | undefined): string {
    const s = (expr || "").trim();
    if (!s) return "";
    const fields = s.split(/\s+/);
    if (fields.length !== 5) return i18n.t("scheduledtasks:cron.needsFields");
    const [minF, hourF, domF, monF, dowF] = fields;
    const minutes = parseField(minF, 0, 59, false);
    const hours = parseField(hourF, 0, 23, false);
    const doms = parseField(domF, 1, 31, false);
    const mons = parseField(monF, 1, 12, false);
    const dows = parseField(dowF, 0, 6, true);
    if (!minutes || !hours || !doms || !mons || !dows) {
        return i18n.t("scheduledtasks:cron.unparsable");
    }
    return build(minutes, hours, doms, mons, dows, minF, hourF);
}
