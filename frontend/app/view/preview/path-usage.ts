// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Pure path-usage logic for the Files path hub. No jotai / react / env / electron
// imports — this module must stay directly unit-testable.

export type PathUsageKind = "dir" | "file";

// The persisted DTO is the generated global `PathUsageEntryType`
// (frontend/types/gotypes.d.ts, from pkg/wconfig.PathUsageEntryType). Re-export it
// under the same name instead of duplicating the contract.
type PathUsageEntryGenerated = PathUsageEntryType;
export type { PathUsageEntryGenerated as PathUsageEntryType };

export const PathUsageHalfLifeMs = 14 * 24 * 60 * 60 * 1000;
export const PathUsageMaxEntries = 200;
export const PathUsageRecentLimit = 12;
export const PathUsageFrequentLimit = 8;
export const PathUsageMinFrequentCount = 2;

const NoisePathSegments = new Set(["node_modules", ".git", "__pycache__", "dist", ".next", ".cache"]);
const NoiseRootPrefixes = ["/tmp", "/var/tmp", "/private/var", "/var/folders"];

/**
 * Normalize a path for stable identity:
 * - trim surrounding whitespace
 * - unify `\` -> `/`
 * - drop trailing slashes (except filesystem / drive roots)
 * - keep `~` semantics untouched
 */
export function normalizeUsagePath(path: string): string {
    if (path == null) {
        return "";
    }
    let normalized = path.trim().replace(/\\/g, "/");
    if (normalized === "") {
        return "";
    }
    if (normalized === "/" || /^[A-Za-z]:\/$/.test(normalized)) {
        return normalized;
    }
    normalized = normalized.replace(/\/+$/, "");
    return normalized === "" ? "/" : normalized;
}

/**
 * Local connections appear under several spellings in block meta (`""`, `"local"`,
 * `"local:<id>"`), while pinned directories are persisted without any connection.
 * Canonicalize every local spelling to `""` so pinned/frequent/recent dedup works and
 * one path on one machine is never recorded twice.
 */
function canonicalConnection(connection?: string): string {
    const conn = (connection ?? "").trim();
    if (conn === "" || conn === "local" || conn.startsWith("local:")) {
        return "";
    }
    return conn;
}

export function usageEntryKey(path: string, connection?: string): string {
    return `${canonicalConnection(connection)}|${normalizeUsagePath(path)}`;
}

/**
 * Only filter obvious noise. Do not aggressively exclude real user directories.
 */
export function isNoiseUsagePath(path: string): boolean {
    const normalized = normalizeUsagePath(path);
    if (normalized === "") {
        return true;
    }
    if (normalized === "~") {
        return false;
    }
    for (const root of NoiseRootPrefixes) {
        if (normalized === root || normalized.startsWith(root + "/")) {
            return true;
        }
    }
    const segments = normalized.split("/");
    for (const segment of segments) {
        if (segment !== "" && NoisePathSegments.has(segment)) {
            return true;
        }
    }
    // Pure symbols (no letter, digit or `~`) carry no signal.
    if (!/[A-Za-z0-9~]/.test(normalized)) {
        return true;
    }
    return false;
}

/**
 * Decide whether a recorded path is a directory.
 *
 * `statIsDir` comes from a successful stat; when the stat failed (`undefined`) fall back to
 * the block meta `preview:pathisdir`, which the open helpers set for directories
 * (`createPreviewBlockForOpen`, `applyDirectoryNavigationMeta`) so a directory opened via
 * "Open in New Block" is not mis-recorded as a file.
 */
export function resolvePathUsageKind(statIsDir?: boolean, metaIsDir?: boolean): PathUsageKind {
    if (statIsDir != null) {
        return statIsDir ? "dir" : "file";
    }
    return metaIsDir === true ? "dir" : "file";
}

export type RecordPathUsageChange = {
    path: string;
    kind: PathUsageKind;
    connection?: string;
    now: number;
};

function pruneToMaxEntries(entries: PathUsageEntryType[], max: number, now: number): PathUsageEntryType[] {
    if (entries.length <= max) {
        return entries;
    }
    const scored = entries.map((entry, index) => ({
        entry,
        index,
        score: pathUsageScore(entry, now),
    }));
    scored.sort((a, b) => b.score - a.score || a.index - b.index);
    return scored.slice(0, max).map((s) => s.entry);
}

/**
 * Reduce one usage event into the entry list.
 * Returns the original reference when the path is noise/empty so callers can skip writes.
 */
export function recordPathUsageEntry(entries: PathUsageEntryType[], change: RecordPathUsageChange): PathUsageEntryType[] {
    const path = normalizeUsagePath(change.path);
    if (isNoiseUsagePath(path)) {
        return entries;
    }
    const connKey = canonicalConnection(change.connection);
    const storedConnection = connKey === "" ? undefined : connKey;
    const key = usageEntryKey(path, change.connection);
    let found = false;
    const next: PathUsageEntryType[] = entries.map((entry) => {
        if (!found && usageEntryKey(entry.path, entry.connection) === key) {
            found = true;
            return {
                ...entry,
                path,
                connection: storedConnection,
                kind: change.kind,
                count: entry.count + 1,
                lastAt: change.now,
            };
        }
        return entry;
    });
    if (!found) {
        next.push({
            path,
            connection: storedConnection,
            kind: change.kind,
            count: 1,
            lastAt: change.now,
        });
    }
    return pruneToMaxEntries(next, PathUsageMaxEntries, change.now);
}

export function removePathUsageEntry(
    entries: PathUsageEntryType[],
    path: string,
    connection?: string
): PathUsageEntryType[] {
    const key = usageEntryKey(path, connection);
    const next = entries.filter((entry) => usageEntryKey(entry.path, entry.connection) !== key);
    return next.length === entries.length ? entries : next;
}

export function pathUsageScore(entry: PathUsageEntryType, now: number): number {
    const elapsed = Math.max(0, now - entry.lastAt);
    return entry.count * Math.pow(0.5, elapsed / PathUsageHalfLifeMs);
}

export function selectFrequentPaths(
    entries: PathUsageEntryType[],
    limit: number = PathUsageFrequentLimit,
    now: number
): PathUsageEntryType[] {
    return entries
        .filter((entry) => entry.count >= PathUsageMinFrequentCount)
        .map((entry, index) => ({ entry, index, score: pathUsageScore(entry, now) }))
        .sort((a, b) => b.score - a.score || b.entry.lastAt - a.entry.lastAt || a.index - b.index)
        .slice(0, limit)
        .map((s) => s.entry);
}

export function selectRecentPaths(
    entries: PathUsageEntryType[],
    excludeKeys: ReadonlySet<string>,
    limit: number = PathUsageRecentLimit
): PathUsageEntryType[] {
    return entries
        .filter((entry) => !excludeKeys.has(usageEntryKey(entry.path, entry.connection)))
        .map((entry, index) => ({ entry, index }))
        .sort((a, b) => b.entry.lastAt - a.entry.lastAt || a.index - b.index)
        .slice(0, limit)
        .map((s) => s.entry);
}
