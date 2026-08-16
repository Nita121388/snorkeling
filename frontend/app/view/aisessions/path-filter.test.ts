// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { DefaultPathFilter, PathFilterOtherRoot } from "./types";
import {
    extractPathChildren,
    extractPathRoots,
    otherRootMatcher,
    pathAncestorSegments,
    pathFilterEqual,
    pathFilterToPrefix,
    shortenPathForChip,
} from "./utils";

// Distribution helper: convert {path,count}[] — same shape as the backend
// ProjectPathSummary.
function distOf(entries: [string, number][]): ProjectPathSummary[] {
    return entries.map(([path, count]) => ({ path, count }));
}

describe("path-filter utils (v2 — distribution-driven navigation)", () => {
    it("extractPathRoots clusters by windows drive, ~ and /, with Other tail", () => {
        const dist = distOf([
            ["E:\\code\\snorkeling", 2],
            ["E:\\code\\other", 1],
            ["D:\\work", 1],
            ["~/proj", 1],
            ["", 2],
        ]);
        const roots = extractPathRoots(dist);
        const byRoot = new Map(roots.map((r) => [r.root, r]));
        expect(byRoot.get("E:\\")?.count).toBe(3);
        expect(byRoot.get("D:\\")?.count).toBe(1);
        expect(byRoot.get("~/")?.count).toBe(1);
        const other = byRoot.get(PathFilterOtherRoot);
        expect(other?.count).toBe(2);
        expect(other?.isOther).toBe(true);
        // highest-count root first
        expect(roots[0].root).toBe("E:\\");
    });

    it("extractPathRoots aggregates counts when multiple sessions share a path", () => {
        const roots = extractPathRoots(
            distOf([
                ["/a/x", 10],
                ["/b/y", 4],
                ["/a/z", 7],
            ])
        );
        const byRoot = new Map(roots.map((r) => [r.root, r]));
        expect(byRoot.get("/")?.count).toBe(21);
    });

    it("extractPathRoots collapses overflow roots into Other + adds … button", () => {
        const entries: [string, number][] = [];
        const drives = ["A", "B", "C", "D", "E", "F", "G", "H"];
        drives.forEach((d) => entries.push([`${d}:\\proj`, 1]));
        const roots = extractPathRoots(distOf(entries));
        // 6 real roots + Other (the 2 overflowed drives) + … button
        expect(roots.filter((r) => r.isMore).length).toBe(1);
        expect(roots.filter((r) => r.isOther).length).toBe(1);
        expect(roots.filter((r) => !r.isOther && !r.isMore).length).toBe(6);
        const other = roots.find((r) => r.isOther);
        expect(other?.count).toBe(2);
    });

    it("pathFilterToPrefix", () => {
        expect(pathFilterToPrefix(DefaultPathFilter)).toBe("");
        expect(pathFilterToPrefix({ root: PathFilterOtherRoot, subPath: "" })).toBe("");
        expect(pathFilterToPrefix({ root: "E:\\", subPath: "" })).toBe("E:\\");
        expect(pathFilterToPrefix({ root: "E:\\", subPath: "code\\snorkeling" })).toBe("E:\\code\\snorkeling");
        expect(pathFilterToPrefix({ root: "/", subPath: "home/me" })).toBe("/home/me");
        expect(pathFilterToPrefix({ root: "~/", subPath: "proj" })).toBe("~/proj");
    });

    it("pathFilterEqual", () => {
        expect(pathFilterEqual(DefaultPathFilter, { root: "", subPath: "" })).toBe(true);
        expect(pathFilterEqual({ root: "E:\\", subPath: "code" }, { root: "E:\\", subPath: "code" })).toBe(true);
        expect(pathFilterEqual({ root: "E:\\", subPath: "code" }, { root: "E:\\", subPath: "" })).toBe(false);
    });

    it("extractPathChildren lists direct children with aggregated counts", () => {
        const dist = distOf([
            ["/Users/nita/Primary/projects/snorkeling", 300],
            ["/Users/nita/Primary/projects/snorkeling/frontend", 200],
            ["/Users/nita/Primary/projects/snorkeling/backend", 100],
            ["/Users/nita/Primary/projects/FileDock", 280],
            ["/Users/nita/Primary/obsidians/Obsidian", 72],
            ["/tmp/project", 22],
        ]);
        const roots = extractPathChildren({ root: "/", subPath: "" }, dist);
        expect(roots).toEqual([
            { name: "Users", count: 952 },
            { name: "tmp", count: 22 },
        ]);
        const projects = extractPathChildren({ root: "/", subPath: "Users/nita/Primary/projects" }, dist);
        expect(projects).toEqual([
            { name: "snorkeling", count: 600 },
            { name: "FileDock", count: 280 },
        ]);
        const snorkeling = extractPathChildren({ root: "/", subPath: "Users/nita/Primary/projects/snorkeling" }, dist);
        // sorted by count desc
        expect(snorkeling).toEqual([
            { name: "frontend", count: 200 },
            { name: "backend", count: 100 },
        ]);
    });

    it("extractPathChildren never surfaces same-name-prefix siblings (boundary match)", () => {
        const dist = distOf([
            ["/Users/nita/Primary/projects/snorkeling", 300],
            ["/Users/nita/Primary/projects/snorkeling-light-theme", 13],
            ["/Users/nita/Primary/projects/snorkeling-imgzoom", 2],
        ]);
        const children = extractPathChildren({ root: "/", subPath: "Users/nita/Primary/projects" }, dist);
        // light-theme / imgzoom are DIRECT children of projects — they belong on
        // this level as their own chips; but once snorkeling is selected they
        // must NOT appear as children of snorkeling.
        expect(children.map((c) => c.name).sort()).toEqual(
            ["snorkeling", "snorkeling-imgzoom", "snorkeling-light-theme"].sort()
        );
        const underSnorkeling = extractPathChildren(
            { root: "/", subPath: "Users/nita/Primary/projects/snorkeling" },
            dist
        );
        expect(underSnorkeling).toEqual([]);
    });

    it("extractPathChildren handles Windows drive roots and mixed separators", () => {
        const dist = distOf([
            ["E:\\code\\snorkeling\\frontend", 5],
            ["E:\\code\\snorkeling\\backend", 4],
            ["E:\\code\\other", 3],
            ["e:/data/x", 2],
        ]);
        const roots = extractPathChildren({ root: "E:\\", subPath: "" }, dist);
        expect(roots).toEqual([
            { name: "code", count: 12 },
            { name: "data", count: 2 },
        ]);
        const codeKids = extractPathChildren({ root: "E:\\", subPath: "code" }, dist);
        expect(codeKids).toEqual([
            { name: "snorkeling", count: 9 },
            { name: "other", count: 3 },
        ]);
        // subPath uses native separator "\\"; sorted count desc
        const snorkKids = extractPathChildren({ root: "E:\\", subPath: "code\\snorkeling" }, dist);
        expect(snorkKids).toEqual([
            { name: "frontend", count: 5 },
            { name: "backend", count: 4 },
        ]);
    });

    it("pathAncestorSegments returns clickable ancestors with native-separator subPaths", () => {
        expect(pathAncestorSegments({ root: "/", subPath: "Users/nita/Primary" })).toEqual([
            { name: "Users", fullSubPath: "Users" },
            { name: "nita", fullSubPath: "Users/nita" },
            { name: "Primary", fullSubPath: "Users/nita/Primary" },
        ]);
        expect(pathAncestorSegments({ root: "E:\\", subPath: "code\\snorkeling" })).toEqual([
            { name: "code", fullSubPath: "code" },
            { name: "snorkeling", fullSubPath: "code\\snorkeling" },
        ]);
        expect(pathAncestorSegments({ root: "/", subPath: "" })).toEqual([]);
        expect(pathAncestorSegments(DefaultPathFilter)).toEqual([]);
    });

    it("shortenPathForChip keeps short paths whole, tails + … for long ones", () => {
        expect(shortenPathForChip("")).toBe("");
        expect(shortenPathForChip("/Users/nita/Primary/projects/snorkeling")).toBe(
            "/Users/nita/Primary/projects/snorkeling"
        );
        const long =
            "/Users/nita/Primary/projects/snorkeling/.runcfg/cdp/home/dev/projects/very-long-project-name/modules/core/src/features";
        expect(shortenPathForChip(long)).toBe("…/src/features");
        const mid = "/Users/nita/Primary/projects/a-really-really-long-project-name-that-pushes-over-the-limit";
        expect(shortenPathForChip(mid)).toMatch(/^…\/[^/]+$/);
        // single huge segment degrades to just that segment
        const single = "x".repeat(200);
        expect(shortenPathForChip(`/${single}`)).toBe("…/" + single);
    });

    it("otherRootMatcher keeps only empty / unrecognized projectPath", () => {
        const sessions = [
            { projectPath: "E:\\code" },
            { projectPath: "" },
            { projectPath: "relative/no-root" },
            { projectPath: "/home/me" },
        ];
        const kept = otherRootMatcher(sessions);
        expect(kept.map((s) => s.projectPath)).toEqual(["", "relative/no-root"]);
    });
});
