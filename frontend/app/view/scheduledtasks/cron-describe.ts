// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Human-readable description for the 5-field POSIX cron syntax that the
// scheduler supports (see pkg/scheduler/cronexpr.go). Used to help users who
// are not familiar with cron understand when a task actually runs.

const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MON = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
];

const DOW_NAME: Record<string, number> = {
    sun: 0, sunday: 0,
    mon: 1, monday: 1,
    tue: 2, tuesday: 2,
    wed: 3, wednesday: 3,
    thu: 4, thursday: 4,
    fri: 5, friday: 5,
    sat: 6, saturday: 6,
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
                if (!seen.has(v)) { seen.add(v); out.push(v); }
            }
        } else if (part.includes("-")) {
            const [a, b] = part.split("-");
            const av = numOf(a);
            const bv = numOf(b);
            if (av === null || bv === null) return null;
            let x = av, y = bv;
            if (x > y) { [x, y] = [y, x]; }
            for (let v = x; v <= y; v++) {
                if (v >= lo && v <= hi && !seen.has(v)) { seen.add(v); out.push(v); }
            }
        } else {
            const v = numOf(part);
            if (v === null || v < lo || v > hi) return null;
            if (!seen.has(v)) { seen.add(v); out.push(v); }
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
    if (key === "1,2,3,4,5") return "every weekday (Mon–Fri)";
    if (key === "6,0" || key === "0,6") return "every weekend";
    if (dows.length === 1) return `every ${DOW[dows[0]]}`;
    if (isConsecutive(dows)) return `${DOW[dows[0]]} through ${DOW[dows[dows.length - 1]]}`;
    return `on ${dows.map((d) => DOW[d].slice(0, 3)).join(", ")}`;
}

function describeDom(doms: number[]): string | null {
    if (doms.length === 31) return null;
    if (doms.length === 1) return `on the ${ordinal(doms[0])} of the month`;
    if (isConsecutive(doms) && doms.length > 1) return `on days ${doms[0]}–${doms[doms.length - 1]} of the month`;
    return `on day-of-month ${doms.join(", ")}`;
}

function describeMon(mons: number[]): string | null {
    if (mons.length === 12) return null;
    if (mons.length === 1) return `in ${MON[mons[0] - 1]}`;
    if (isConsecutive(mons)) return `from ${MON[mons[0] - 1]} through ${MON[mons[mons.length - 1] - 1]}`;
    return `in ${mons.map((m) => MON[m - 1].slice(0, 3)).join(", ")}`;
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
        const minTxt = allM || m0 ? "" : ` at minute${minutes.length > 1 ? "s" : ""} ${minutes.map(pad).join(", ")}`;
        return `Every ${hourF.slice(2)} hours${minTxt}`;
    }
    // "*/N" minute step across all hours → "Every N minutes"
    if (allH && /^\*\//.test(minF)) return `Every ${minF.slice(2)} minutes`;

    // Time text.
    let timeTxt: string;
    if (allH) {
        timeTxt = allM ? "" : `at minute${minutes.length > 1 ? "s" : ""} ${minutes.map(pad).join(", ")}`;
    } else {
        const times: string[] = [];
        for (const h of hours) for (const m of minutes) times.push(`${pad(h)}:${pad(m)}`);
        timeTxt = `at ${times.join(", ")}`;
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
        if (!timeTxt) return "Every minute";
        return `Daily ${timeTxt}`;
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
    if (fields.length !== 5) return "Needs 5 fields: minute hour day-of-month month weekday";
    const [minF, hourF, domF, monF, dowF] = fields;
    const minutes = parseField(minF, 0, 59, false);
    const hours = parseField(hourF, 0, 23, false);
    const doms = parseField(domF, 1, 31, false);
    const mons = parseField(monF, 1, 12, false);
    const dows = parseField(dowF, 0, 6, true);
    if (!minutes || !hours || !doms || !mons || !dows) {
        return "Can't parse this expression — check the 5 fields";
    }
    return build(minutes, hours, doms, mons, dows, minF, hourF);
}
