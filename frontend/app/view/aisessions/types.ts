// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export type SourceFilter = "" | "codex" | "claude" | "opencode" | "pi";

// Key of the transient "new chat" placeholder shown in the session list until
// the backend assigns a real session id (first message) and List picks it up.
export const NewSessionKey = "__new__";

export type MarkedFilter = "all" | "starred" | "unstarred";

// Tag-presence filter. "any" = no constraint (default). "untagged" = sessions
// whose normalized tag list is empty (note may still contain a "#" token that
// fails isSessionTagRune, but if any valid tag parsed it counts as tagged).
// Mutually exclusive with a non-empty tagFilters list at the UI layer; the
// ViewModel enforces the reset on either side, and the backend defends again.
export type TagPresenceFilter = "any" | "untagged";

export const DefaultTagPresence: TagPresenceFilter = "any";

export type DatePreset = "all" | "today" | "7d" | "30d" | "custom";

export type DateRangeFilter = {
    preset: DatePreset;
    from?: number;
    to?: number;
};

// Path filter: root is the disk/home-prefix cluster short name (e.g. "E:\\", "~/"),
// "" means All, "other" is the catch-all bucket for empty / unrecognized projectPath.
// subPath is the further-narrowed prefix under root (without the root part).
// Matching is delegated to backend `project` field (case-insensitive substring on projectPath).
export type PathFilter = {
    root: string;
    subPath: string;
};

export const DefaultPathFilter: PathFilter = { root: "", subPath: "" };

export const PathFilterOtherRoot = "other";

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
