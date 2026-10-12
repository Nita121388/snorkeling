// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import {
    isNoiseUsagePath,
    normalizeUsagePath,
    PathUsageMaxEntries,
    pathUsageScore,
    recordPathUsageEntry,
    removePathUsageEntry,
    resolvePathUsageKind,
    selectFrequentPaths,
    selectRecentPaths,
    usageEntryKey,
} from "@/app/view/preview/path-usage";
import { describe, expect, it } from "vitest";

const DAY = 24 * 60 * 60 * 1000;

function entry(path: string, count: number, lastAt: number, connection?: string): PathUsageEntryType {
    return { path, connection, kind: "dir", count, lastAt };
}

describe("normalizeUsagePath", () => {
    it("trims surrounding whitespace", () => {
        expect(normalizeUsagePath("  /home/user/docs  ")).toBe("/home/user/docs");
    });

    it("unifies backslashes to forward slashes", () => {
        expect(normalizeUsagePath("C:\\Users\\nita\\docs")).toBe("C:/Users/nita/docs");
    });

    it("drops trailing slashes except roots", () => {
        expect(normalizeUsagePath("/home/user/docs/")).toBe("/home/user/docs");
        expect(normalizeUsagePath("/")).toBe("/");
        expect(normalizeUsagePath("C:/")).toBe("C:/");
    });

    it("keeps tilde semantics untouched", () => {
        expect(normalizeUsagePath("~/projects/")).toBe("~/projects");
    });
});

describe("usageEntryKey", () => {
    it("isolates the same path across connections", () => {
        expect(usageEntryKey("/srv/app", "local")).not.toBe(usageEntryKey("/srv/app", "remote"));
    });

    it("treats empty and undefined connection as local", () => {
        expect(usageEntryKey("/srv/app", undefined)).toBe(usageEntryKey("/srv/app", ""));
    });

    it("treats local connection spellings as the same machine", () => {
        expect(usageEntryKey("/srv/app", "local")).toBe(usageEntryKey("/srv/app", undefined));
        expect(usageEntryKey("/srv/app", "local:abc")).toBe(usageEntryKey("/srv/app", ""));
    });
});

describe("isNoiseUsagePath", () => {
    it("filters temp paths", () => {
        expect(isNoiseUsagePath("/tmp/build")).toBe(true);
        expect(isNoiseUsagePath("/var/folders/ab/cd")).toBe(true);
    });

    it("filters dependency and vcs internals", () => {
        expect(isNoiseUsagePath("/repo/node_modules/react")).toBe(true);
        expect(isNoiseUsagePath("/repo/.git/objects")).toBe(true);
    });

    it("keeps home, drive roots and normal directories", () => {
        expect(isNoiseUsagePath("~")).toBe(false);
        expect(isNoiseUsagePath("C:/")).toBe(false);
        expect(isNoiseUsagePath("/home/nita/projects")).toBe(false);
        expect(isNoiseUsagePath("~/projects/app")).toBe(false);
    });

    it("filters empty and pure-symbol paths", () => {
        expect(isNoiseUsagePath("")).toBe(true);
        expect(isNoiseUsagePath("   ")).toBe(true);
        expect(isNoiseUsagePath("/")).toBe(true);
    });
});

describe("recordPathUsageEntry", () => {
    it("inserts a first visit with count 1", () => {
        const next = recordPathUsageEntry([], { path: "/a", kind: "dir", now: 1000 });
        expect(next).toHaveLength(1);
        expect(next[0]).toMatchObject({ path: "/a", kind: "dir", count: 1, lastAt: 1000 });
    });

    it("increments count and refreshes lastAt on repeat visits", () => {
        const first = recordPathUsageEntry([], { path: "/a", kind: "dir", now: 1000 });
        const second = recordPathUsageEntry(first, { path: "/a", kind: "dir", now: 2000 });
        expect(second).toHaveLength(1);
        expect(second[0]).toMatchObject({ count: 2, lastAt: 2000 });
        expect(second).not.toBe(first);
    });

    it("takes the latest kind", () => {
        const first = recordPathUsageEntry([], { path: "/a", kind: "file", now: 1000 });
        const second = recordPathUsageEntry(first, { path: "/a", kind: "dir", now: 2000 });
        expect(second[0].kind).toBe("dir");
    });

    it("isolates connections into separate entries", () => {
        const first = recordPathUsageEntry([], { path: "/srv/app", kind: "dir", connection: "local", now: 1000 });
        const second = recordPathUsageEntry(first, {
            path: "/srv/app",
            kind: "dir",
            connection: "remote",
            now: 2000,
        });
        expect(second).toHaveLength(2);
        const keys = second.map((e) => usageEntryKey(e.path, e.connection));
        expect(new Set(keys).size).toBe(2);
    });

    it("records a local-spelled visit into the existing local entry", () => {
        const first = recordPathUsageEntry([], { path: "/a", kind: "dir", now: 1000 });
        const second = recordPathUsageEntry(first, { path: "/a", kind: "dir", connection: "local", now: 2000 });
        expect(second).toHaveLength(1);
        expect(second[0]).toMatchObject({ count: 2, lastAt: 2000 });
    });

    it("returns the original reference for noise paths", () => {
        const base = [entry("/a", 1, 1000)];
        expect(recordPathUsageEntry(base, { path: "/tmp/x", kind: "dir", now: 2000 })).toBe(base);
        expect(recordPathUsageEntry(base, { path: "  ", kind: "dir", now: 2000 })).toBe(base);
    });

    it("evicts the lowest-scored entry beyond the cap", () => {
        const now = 100 * DAY;
        const base: PathUsageEntryType[] = [];
        for (let i = 0; i < PathUsageMaxEntries; i++) {
            base.push(entry(`/dir-${i}`, 1, now - i * DAY));
        }
        const next = recordPathUsageEntry(base, { path: "/fresh", kind: "dir", now });
        expect(next).toHaveLength(PathUsageMaxEntries);
        // the newest high-score path is retained
        expect(next.some((e) => e.path === "/fresh")).toBe(true);
        // the oldest low-score entry is dropped
        expect(next.some((e) => e.path === `/dir-${PathUsageMaxEntries - 1}`)).toBe(false);
    });
});

describe("removePathUsageEntry", () => {
    it("removes exactly one entry and keeps the rest", () => {
        const base = [entry("/a", 1, 1000), entry("/b", 1, 2000), entry("/c", 1, 3000)];
        const next = removePathUsageEntry(base, "/b");
        expect(next.map((e) => e.path)).toEqual(["/a", "/c"]);
    });

    it("only removes the matching connection", () => {
        const base = [entry("/srv", 1, 1000, "local"), entry("/srv", 1, 2000, "remote")];
        const next = removePathUsageEntry(base, "/srv", "remote");
        expect(next).toHaveLength(1);
        expect(next[0].connection).toBe("local");
    });

    it("returns the original reference when nothing matches", () => {
        const base = [entry("/a", 1, 1000)];
        expect(removePathUsageEntry(base, "/zzz")).toBe(base);
    });
});

describe("pathUsageScore", () => {
    it("halves the score after one half-life", () => {
        const now = 100 * DAY;
        const fresh = pathUsageScore(entry("/a", 4, now), now);
        const halfLife = pathUsageScore(entry("/a", 4, now - 14 * DAY), now);
        expect(fresh).toBeCloseTo(4);
        expect(halfLife).toBeCloseTo(2);
    });

    it("ranks a recently used path above an older one with equal count", () => {
        const now = 100 * DAY;
        const recent = pathUsageScore(entry("/recent", 3, now), now);
        const older = pathUsageScore(entry("/older", 3, now - 7 * DAY), now);
        expect(recent).toBeGreaterThan(older);
    });
});

describe("resolvePathUsageKind", () => {
    it("uses the stat result when the stat succeeded", () => {
        expect(resolvePathUsageKind(true, undefined)).toBe("dir");
        expect(resolvePathUsageKind(false, undefined)).toBe("file");
    });

    it("prefers the stat result over the meta hint when both are present", () => {
        expect(resolvePathUsageKind(true, false)).toBe("dir");
        expect(resolvePathUsageKind(false, true)).toBe("file");
    });

    it("falls back to meta preview:pathisdir when the stat failed", () => {
        expect(resolvePathUsageKind(undefined, true)).toBe("dir");
        expect(resolvePathUsageKind(undefined, false)).toBe("file");
    });

    it("defaults to file when neither the stat nor the meta hint is known", () => {
        expect(resolvePathUsageKind(undefined, undefined)).toBe("file");
    });
});

describe("selectFrequentPaths", () => {
    it("excludes one-off visits", () => {
        const now = 100 * DAY;
        const entries = [entry("/one", 1, now), entry("/two", 2, now)];
        const frequent = selectFrequentPaths(entries, undefined, now);
        expect(frequent.map((e) => e.path)).toEqual(["/two"]);
    });

    it("orders by score and honors the limit", () => {
        const now = 100 * DAY;
        const entries = [entry("/a", 5, now - 20 * DAY), entry("/b", 5, now), entry("/c", 9, now - 30 * DAY)];
        const frequent = selectFrequentPaths(entries, 2, now);
        expect(frequent.map((e) => e.path)).toEqual(["/b", "/c"]);
    });
});

describe("selectRecentPaths", () => {
    it("orders by lastAt descending", () => {
        const entries = [entry("/a", 1, 1000), entry("/b", 1, 3000), entry("/c", 1, 2000)];
        expect(selectRecentPaths(entries, new Set()).map((e) => e.path)).toEqual(["/b", "/c", "/a"]);
    });

    it("excludes keys that are already shown elsewhere", () => {
        const entries = [entry("/a", 1, 1000), entry("/b", 1, 3000)];
        const excluded = new Set([usageEntryKey("/b")]);
        expect(selectRecentPaths(entries, excluded).map((e) => e.path)).toEqual(["/a"]);
    });

    it("honors the limit", () => {
        const entries = [entry("/a", 1, 1000), entry("/b", 1, 3000), entry("/c", 1, 2000)];
        expect(selectRecentPaths(entries, new Set(), 2).map((e) => e.path)).toEqual(["/b", "/c"]);
    });
});
