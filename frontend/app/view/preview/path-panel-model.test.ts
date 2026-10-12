// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { buildPathPanelSections, flattenPanelRows } from "@/app/view/preview/path-panel-model";
import { describe, expect, it } from "vitest";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 100 * DAY;

function usage(path: string, count: number, lastAt: number, connection?: string): PathUsageEntryType {
    return { path, connection, kind: "dir", count, lastAt };
}

function pinned(path: string, label?: string): PinnedDirectoryType {
    return { path, label, addedAt: 1 };
}

describe("buildPathPanelSections (empty query)", () => {
    it("returns pinned/frequent/recent in a fixed order", () => {
        const sections = buildPathPanelSections({
            pinnedDirs: [pinned("/home/nita")],
            usage: [usage("/a", 3, NOW), usage("/b", 1, NOW - DAY)],
            query: "",
            now: NOW,
        });
        expect(sections.map((s) => s.id)).toEqual(["pinned", "frequent", "recent"]);
    });

    it("keeps frequent and recent mutually exclusive", () => {
        const sections = buildPathPanelSections({
            pinnedDirs: [],
            usage: [usage("/frequent", 4, NOW), usage("/recent", 1, NOW - DAY)],
            query: "",
            now: NOW,
        });
        const frequent = sections.find((s) => s.id === "frequent");
        const recent = sections.find((s) => s.id === "recent");
        expect(frequent.rows.map((r) => r.path)).toEqual(["/frequent"]);
        expect(recent.rows.map((r) => r.path)).toEqual(["/recent"]);
    });

    it("also excludes pinned keys from recent", () => {
        const sections = buildPathPanelSections({
            pinnedDirs: [pinned("/pinned")],
            usage: [usage("/pinned", 1, NOW)],
            query: "",
            now: NOW,
        });
        const recent = sections.find((s) => s.id === "recent");
        expect(recent.rows).toHaveLength(0);
    });

    it("dedups pinned dirs against local-spelled usage entries", () => {
        const sections = buildPathPanelSections({
            pinnedDirs: [pinned("/pinned")],
            usage: [usage("/pinned", 4, NOW, "local")],
            query: "",
            now: NOW,
        });
        const frequent = sections.find((s) => s.id === "frequent");
        const recent = sections.find((s) => s.id === "recent");
        // Frequent may repeat a pinned path (design 2.5), but it must be flagged pinned.
        expect(frequent.rows).toHaveLength(1);
        expect(frequent.rows[0].pinned).toBe(true);
        // Recent must never repeat a pinned path.
        expect(recent.rows).toHaveLength(0);
    });

    it("provides empty hints for empty frequent/recent sections", () => {
        const sections = buildPathPanelSections({ pinnedDirs: [], usage: [], query: "", now: NOW });
        expect(sections.find((s) => s.id === "frequent").emptyHint).toBe(
            "Paths you use often will show up here."
        );
        expect(sections.find((s) => s.id === "recent").emptyHint).toBe(
            "Directories and files you open will show up here."
        );
    });

    it("marks pinned rows and usage rows that are pinned", () => {
        const sections = buildPathPanelSections({
            pinnedDirs: [pinned("/pinned")],
            usage: [usage("/pinned", 2, NOW), usage("/other", 1, NOW)],
            query: "",
            now: NOW,
        });
        const pinnedSection = sections.find((s) => s.id === "pinned");
        expect(pinnedSection.rows[0].pinned).toBe(true);
        const recent = sections.find((s) => s.id === "recent");
        const other = recent.rows.find((r) => r.path === "/other");
        expect(other.pinned).toBe(false);
    });
});

describe("buildPathPanelSections (search query)", () => {
    it("returns a single search section and no partitioned blocks", () => {
        const sections = buildPathPanelSections({
            pinnedDirs: [pinned("/home/nita")],
            usage: [usage("/home/nita/projects", 3, NOW)],
            query: "nita",
            now: NOW,
        });
        expect(sections).toHaveLength(1);
        expect(sections[0].id).toBe("search");
    });

    it("matches path or basename case-insensitively", () => {
        const sections = buildPathPanelSections({
            pinnedDirs: [],
            usage: [usage("/home/nita/Documents", 1, NOW), usage("/var/log", 1, NOW)],
            query: "documents",
            now: NOW,
        });
        expect(sections[0].rows.map((r) => r.path)).toEqual(["/home/nita/Documents"]);
    });

    it("deduplicates pinned and usage into one row", () => {
        const sections = buildPathPanelSections({
            pinnedDirs: [pinned("/home/nita")],
            usage: [usage("/home/nita", 2, NOW, "local")],
            query: "nita",
            now: NOW,
        });
        expect(sections[0].rows).toHaveLength(1);
        expect(sections[0].rows[0].pinned).toBe(true);
        expect(sections[0].rows[0].count).toBe(2);
    });

    it("ranks basename matches ahead of deep path matches", () => {
        const sections = buildPathPanelSections({
            pinnedDirs: [],
            usage: [usage("/deep/nested/projects/notes", 1, NOW), usage("/projects", 1, NOW)],
            query: "pro",
            now: NOW,
        });
        expect(sections[0].rows.map((r) => r.path)).toEqual(["/projects", "/deep/nested/projects/notes"]);
    });

    it("returns an empty search section with a hint when nothing matches", () => {
        const sections = buildPathPanelSections({
            pinnedDirs: [],
            usage: [usage("/home/nita", 1, NOW)],
            query: "zzz",
            now: NOW,
        });
        expect(sections[0].rows).toHaveLength(0);
        expect(sections[0].emptyHint).toBeTruthy();
    });
});

describe("flattenPanelRows", () => {
    it("preserves section order", () => {
        const sections = buildPathPanelSections({
            pinnedDirs: [pinned("/pinned")],
            usage: [usage("/frequent", 4, NOW), usage("/recent", 1, NOW - DAY)],
            query: "",
            now: NOW,
        });
        expect(flattenPanelRows(sections).map((r) => r.path)).toEqual(["/pinned", "/frequent", "/recent"]);
    });
});
