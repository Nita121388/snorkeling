// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure formatting/derivation helpers for the AI Audit view. Kept React-free so
// the presentation rules are unit-testable without a DOM.

export const AuditStalledMs = 2 * 60 * 1000;

export type AuditStateMeta = {
    label: string;
    dotClass: string;
    textClass: string;
    pillClass: string;
};

const StateMetaMap: Record<string, { label: string; dot: string; text: string; pill: string }> = {
    done: {
        label: "done",
        dot: "bg-success",
        text: "text-success",
        pill: "border-success/30 bg-success/10",
    },
    failed: {
        label: "failed",
        dot: "bg-error",
        text: "text-error",
        pill: "border-error/40 bg-error/10",
    },
    cancelled: {
        label: "cancelled",
        dot: "bg-secondary",
        text: "text-secondary",
        pill: "border-border bg-hover",
    },
    running: {
        label: "running",
        dot: "bg-accent",
        text: "text-accent",
        pill: "border-accent/40 bg-accent/10",
    },
    queued: {
        label: "queued",
        dot: "bg-warning",
        text: "text-warning",
        pill: "border-warning/40 bg-warning/10",
    },
};

export function stateMeta(state: string): AuditStateMeta {
    const meta = StateMetaMap[state] ?? {
        label: state || "unknown",
        dot: "bg-secondary",
        text: "text-secondary",
        pill: "border-border bg-hover",
    };
    return { label: meta.label, dotClass: meta.dot, textClass: meta.text, pillClass: meta.pill };
}

/** queued rows never transition to running (AuditBegin runs at execution start),
 * so a queued row older than a couple of minutes is stalled, not in flight. */
export function isStalled(entry: { state: string; createdAt: number }, now: number): boolean {
    if (entry.state !== "queued") return false;
    return now - entry.createdAt > AuditStalledMs;
}

export function stateLabel(entry: { state: string; createdAt: number }, now: number): string {
    if (isStalled(entry, now)) return "stalled";
    return stateMeta(entry.state).label;
}

export function formatDuration(ms: number): string {
    if (!ms || ms <= 0) return "—";
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    const minutes = Math.floor(ms / 60_000);
    const seconds = Math.round((ms % 60_000) / 1000);
    return `${minutes}m${seconds > 0 ? `${seconds}s` : ""}`;
}

function pad(value: number): string {
    return String(value).padStart(2, "0");
}

/** Time column: HH:MM:SS for today, MM-DD HH:MM otherwise (keeps columns narrow). */
export function formatClock(ms: number, now: number = Date.now()): string {
    if (!ms) return "—";
    const date = new Date(ms);
    const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    if (dayKey(ms) === dayKey(now)) return clock;
    return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatTimestamp(ms: number): string {
    if (!ms) return "—";
    const date = new Date(ms);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
        date.getMinutes()
    )}:${pad(date.getSeconds())}`;
}

export function dayKey(ms: number): string {
    const date = new Date(ms);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const MonthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function dayLabel(ms: number, now: number = Date.now()): string {
    const key = dayKey(ms);
    if (key === dayKey(now)) return "Today";
    if (key === dayKey(now - 24 * 60 * 60 * 1000)) return "Yesterday";
    const date = new Date(ms);
    const yearSuffix = date.getFullYear() === new Date(now).getFullYear() ? "" : ` ${date.getFullYear()}`;
    return `${MonthNames[date.getMonth()]} ${date.getDate()}${yearSuffix}`;
}

/** Group consecutive entries (already sorted desc) by local calendar day. */
export function groupByDay<T extends { createdAt: number }>(
    entries: T[]
): { key: string; label: string; items: T[] }[] {
    const now = Date.now();
    const groups: { key: string; label: string; items: T[] }[] = [];
    for (const entry of entries) {
        const key = dayKey(entry.createdAt);
        const last = groups[groups.length - 1];
        if (last != null && last.key === key) {
            last.items.push(entry);
        } else {
            groups.push({ key, label: dayLabel(entry.createdAt, now), items: [entry] });
        }
    }
    return groups;
}

/** `pi:db0b044e-0642-41d4-8f43-c012a886…` -> `db0b044e…c012a886` */
export function shortSessionKey(key: string): string {
    if (!key) return "";
    let body = key;
    const colon = body.indexOf(":");
    if (colon >= 0 && colon < body.length - 1) {
        body = body.slice(colon + 1);
    }
    const parts = body.split("-").filter((part) => part.length > 0);
    if (parts.length < 2) return body.length > 12 ? `${body.slice(0, 6)}…${body.slice(-4)}` : body;
    const head = parts[0];
    const tail = parts[parts.length - 1];
    return `${head}…${tail}`;
}

export function sessionTitle(entry: { sessionTitle?: string; sessionKey: string }): string {
    const title = (entry.sessionTitle ?? "").trim();
    if (title) return title;
    return entry.sessionKey ? "Untitled session" : "No session";
}

export function resultLabel(entry: { resultCount: number; anchorTotal: number; anchorKept: number }): {
    primary: string;
    secondary: string;
    title: string;
} {
    if (entry.resultCount <= 0 && entry.anchorTotal <= 0) {
        return { primary: "—", secondary: "", title: "No results recorded" };
    }
    const parts: string[] = [];
    if (entry.resultCount > 0) parts.push(`${entry.resultCount} result${entry.resultCount === 1 ? "" : "s"}`);
    const secondary = entry.anchorTotal > 0 ? `${entry.anchorKept}/${entry.anchorTotal}` : "";
    if (entry.anchorTotal > 0) parts.push(`anchors kept ${entry.anchorKept}/${entry.anchorTotal}`);
    return {
        primary: entry.resultCount > 0 ? String(entry.resultCount) : "—",
        secondary,
        title: parts.join(" · "),
    };
}

export const AuditBucketCount = 24;

/** Normalize hourly buckets to bar heights in px (min 2px so empty hours stay visible). */
export function bucketHeights(hourly: { count: number }[] | undefined, maxPx: number): number[] {
    if (hourly == null || hourly.length === 0) {
        return new Array(AuditBucketCount).fill(2);
    }
    const max = Math.max(1, ...hourly.map((bucket) => bucket.count));
    return hourly.map((bucket) => {
        if (bucket.count <= 0) return 2;
        return Math.max(3, Math.round((bucket.count / max) * maxPx));
    });
}

export function auditFeatureHoursLabel(hour: number): string {
    const date = new Date(hour);
    return `${pad(date.getHours())}:00`;
}
