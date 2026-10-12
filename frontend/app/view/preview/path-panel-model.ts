// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import {
    PathUsageFrequentLimit,
    PathUsageRecentLimit,
    selectFrequentPaths,
    selectRecentPaths,
    usageEntryKey,
    type PathUsageKind,
} from "@/app/view/preview/path-usage";
import { basename } from "@/util/util";

export type PathSelection = { path: string; connection?: string };

export type PathPanelRow = {
    key: string;
    path: string;
    connection?: string;
    kind: PathUsageKind;
    label: string;
    displayPath: string;
    count?: number;
    pinned: boolean;
};

export type PathPanelSection = {
    id: "search" | "pinned" | "frequent" | "recent";
    title: string;
    icon: string;
    rows: PathPanelRow[];
    emptyHint?: string;
};

/** Middle-ellipsis path formatting shared by the panel rows. */
export function formatPath(path: string): string {
    if (path.startsWith("~")) return path;
    if (path.length > 40) {
        const parts = path.replace(/\\/g, "/").split("/");
        if (parts.length > 3) return parts[0] + "/…/" + parts.slice(-2).join("/");
    }
    return path;
}

function rowLabel(path: string, label?: string): string {
    if (label != null && label !== "") {
        return label;
    }
    const base = basename(path);
    return base === "" ? path : base;
}

function pinnedRow(pinned: PinnedDirectoryType): PathPanelRow {
    return {
        key: usageEntryKey(pinned.path, undefined),
        path: pinned.path,
        connection: undefined,
        kind: "dir",
        label: rowLabel(pinned.path, pinned.label),
        displayPath: formatPath(pinned.path),
        pinned: true,
    };
}

function usageRow(entry: PathUsageEntryType, pinnedKeys: ReadonlySet<string>): PathPanelRow {
    const key = usageEntryKey(entry.path, entry.connection);
    return {
        key,
        path: entry.path,
        connection: entry.connection,
        kind: entry.kind === "file" ? "file" : "dir",
        label: rowLabel(entry.path),
        displayPath: formatPath(entry.path),
        count: entry.count,
        pinned: pinnedKeys.has(key),
    };
}

function searchRank(row: PathPanelRow, query: string): number {
    const needle = query.toLowerCase();
    const path = row.path.toLowerCase();
    const base = basename(row.path).toLowerCase();
    if (base.startsWith(needle)) return 0;
    if (path.startsWith(needle)) return 1;
    if (base.includes(needle)) return 2;
    if (path.includes(needle)) return 3;
    return -1;
}

export function buildPathPanelSections(input: {
    pinnedDirs: PinnedDirectoryType[];
    usage: PathUsageEntryType[];
    query: string;
    now: number;
}): PathPanelSection[] {
    const pinnedDirs = input.pinnedDirs ?? [];
    const usage = input.usage ?? [];
    const query = (input.query ?? "").trim();
    const pinnedKeys = new Set(pinnedDirs.map((p) => usageEntryKey(p.path, undefined)));

    if (query !== "") {
        const byKey = new Map<string, PathPanelRow>();
        for (const pinned of pinnedDirs) {
            const row = pinnedRow(pinned);
            byKey.set(row.key, row);
        }
        for (const entry of usage) {
            const row = usageRow(entry, pinnedKeys);
            const existing = byKey.get(row.key);
            if (existing == null) {
                byKey.set(row.key, row);
            } else if (existing.pinned) {
                // Keep the pinned row but attach the usage count for context.
                existing.count = row.count;
            }
        }
        const rows = [...byKey.values()]
            .map((row, index) => ({ row, index, rank: searchRank(row, query) }))
            .filter((r) => r.rank >= 0)
            .sort((a, b) => a.rank - b.rank || a.index - b.index)
            .map((r) => r.row);
        return [
            {
                id: "search",
                title: "Search",
                icon: "fa-solid fa-magnifying-glass",
                rows,
                emptyHint: rows.length === 0 ? "No matching paths." : undefined,
            },
        ];
    }

    const frequentEntries = selectFrequentPaths(usage, PathUsageFrequentLimit, input.now);
    const frequentKeys = new Set(frequentEntries.map((e) => usageEntryKey(e.path, e.connection)));
    const excludeRecent = new Set<string>([...pinnedKeys, ...frequentKeys]);
    const recentEntries = selectRecentPaths(usage, excludeRecent, PathUsageRecentLimit);

    const pinnedSection: PathPanelSection = {
        id: "pinned",
        title: "Pinned",
        icon: "fa-solid fa-star",
        rows: pinnedDirs.map(pinnedRow),
    };
    const frequentSection: PathPanelSection = {
        id: "frequent",
        title: "Frequent",
        icon: "fa-solid fa-fire",
        rows: frequentEntries.map((e) => usageRow(e, pinnedKeys)),
        emptyHint: frequentEntries.length === 0 ? "Paths you use often will show up here." : undefined,
    };
    const recentSection: PathPanelSection = {
        id: "recent",
        title: "Recent",
        icon: "fa-regular fa-clock",
        rows: recentEntries.map((e) => usageRow(e, pinnedKeys)),
        emptyHint:
            recentEntries.length === 0 ? "Directories and files you open will show up here." : undefined,
    };
    return [pinnedSection, frequentSection, recentSection];
}

export function flattenPanelRows(sections: PathPanelSection[]): PathPanelRow[] {
    return sections.flatMap((section) => section.rows);
}
