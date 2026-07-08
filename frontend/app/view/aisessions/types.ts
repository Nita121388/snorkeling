// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export type SourceFilter = "" | "codex" | "claude";

export type MarkedFilter = "all" | "starred" | "unstarred";

export type DatePreset = "all" | "today" | "7d" | "30d" | "custom";

export type DateRangeFilter = {
    preset: DatePreset;
    from?: number;
    to?: number;
};

export const DefaultDateRange: DateRangeFilter = { preset: "7d" };

export function dateRangeToSinceBefore(range: DateRangeFilter, now: number): { since: number; before: number } {
    if (!range || range.preset === "all") return { since: 0, before: 0 };
    if (range.preset === "custom") {
        const since = range.from ?? 0;
        const before = range.to ?? 0;
        return { since, before };
    }
    const dayMs = 24 * 60 * 60 * 1000;
    if (range.preset === "today") {
        const startOfDay = new Date(now);
        startOfDay.setHours(0, 0, 0, 0);
        return { since: startOfDay.getTime(), before: 0 };
    }
    const days = range.preset === "7d" ? 7 : 30;
    return { since: now - days * dayMs, before: 0 };
}

export const sortPreferenceStorageKey = "aisessions.sortDescending";
export const defaultVisibleMessageCount = 30;
export const visibleMessageCountStep = 30;
export const collapsibleMessageCharCount = 600;
export const collapsibleMessageLineCount = 5;
export const collapsedMessagePreviewLength = 420;
