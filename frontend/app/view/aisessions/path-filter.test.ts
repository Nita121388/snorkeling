// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { DefaultPathFilter, PathFilterOtherRoot } from "./types";
import {
    computeBreadcrumb,
    extractPathRoots,
    otherRootMatcher,
    pathFilterEqual,
    pathFilterToPrefix,
} from "./utils";

type S = { projectPath?: string };

describe("path-filter utils", () => {
    it("extractPathRoots clusters by windows drive, ~ and /, with Other tail", () => {
        const sessions: S[] = [
            { projectPath: "E:\\code\\snorkeling" },
            { projectPath: "E:\\code\\other" },
            { projectPath: "D:\\work" },
            { projectPath: "~/proj" },
            { projectPath: "" },
            { projectPath: "relative/no-root" },
        ];
        const roots = extractPathRoots(sessions);
        const byRoot = new Map(roots.map((r) => [r.root, r]));
        expect(byRoot.get("E:\\")?.count).toBe(2);
        expect(byRoot.get("D:\\")?.count).toBe(1);
        expect(byRoot.get("~/")?.count).toBe(1);
        const other = byRoot.get(PathFilterOtherRoot);
        expect(other?.count).toBe(2);
        expect(other?.isOther).toBe(true);
        // First root should be the most frequent: E:\
        expect(roots[0].root).toContain("E:");
    });

    it("extractPathRoots collapses overflow roots into Other + adds … button", () => {
        const sessions: S[] = [];
        const drives = ["A", "B", "C", "D", "E", "F", "G", "H"];
        drives.forEach((d) => sessions.push({ projectPath: `${d}:\\proj` }));
        const roots = extractPathRoots(sessions);
        // 6 real roots + Other (the 2 overflowed drives) + … button
        expect(roots.filter((r) => r.isMore).length).toBe(1);
        expect(roots.filter((r) => r.isOther).length).toBe(1);
        expect(roots.filter((r) => !r.isOther && !r.isMore).length).toBe(6);
        // Other bucket swallowed the 2 overflowed drives
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

    it("computeBreadcrumb computes longest common prefix under a windows root", () => {
        const sessions: S[] = [
            { projectPath: "E:\\code\\snorkeling\\frontend" },
            { projectPath: "E:\\code\\snorkeling\\backend" },
            { projectPath: "E:\\code\\snorkeling\\docs" },
            { projectPath: "D:\\unrelated" },
        ];
        const segs = computeBreadcrumb({ root: "E:\\", subPath: "" }, sessions);
        expect(segs.map((s) => s.label)).toEqual(["code", "snorkeling"]);
        expect(segs.map((s) => s.fullPrefix)).toEqual(["E:\\code", "E:\\code\\snorkeling"]);
        // All 3 E:\ sessions are under E:\code and E:\code\snorkeling
        expect(segs[0].count).toBe(3);
        expect(segs[1].count).toBe(3);
        expect(segs[segs.length - 1].isLeaf).toBe(true);
    });

    it("computeBreadcrumb shrinks when a sibling diverges earlier", () => {
        const sessions: S[] = [
            { projectPath: "E:\\code\\snorkeling\\frontend" },
            { projectPath: "E:\\code\\snorkeling\\backend" },
            { projectPath: "E:\\code\\other" },
        ];
        const segs = computeBreadcrumb({ root: "E:\\", subPath: "" }, sessions);
        expect(segs.map((s) => s.label)).toEqual(["code"]);
        expect(segs[0].count).toBe(3);
        expect(segs[0].isLeaf).toBe(true);
    });

    it("computeBreadcrumb returns empty for All and Other", () => {
        expect(computeBreadcrumb(DefaultPathFilter, [{ projectPath: "E:\\x" }])).toEqual([]);
        expect(computeBreadcrumb({ root: PathFilterOtherRoot, subPath: "" }, [{ projectPath: "" }])).toEqual([]);
    });

    it("computeBreadcrumb for *nix root produces /home-style prefixes", () => {
        const sessions: S[] = [
            { projectPath: "/home/me/proj/a" },
            { projectPath: "/home/me/proj/b" },
        ];
        const segs = computeBreadcrumb({ root: "/", subPath: "" }, sessions);
        expect(segs.map((s) => s.fullPrefix)).toEqual(["/home", "/home/me", "/home/me/proj"]);
        expect(segs[segs.length - 1].isLeaf).toBe(true);
    });

    it("otherRootMatcher keeps only empty / unrecognized projectPath", () => {
        const sessions: S[] = [
            { projectPath: "E:\\code" },
            { projectPath: "" },
            { projectPath: "relative/no-root" },
            { projectPath: "/home/me" },
        ];
        const kept = otherRootMatcher(sessions);
        expect(kept.map((s) => s.projectPath)).toEqual(["", "relative/no-root"]);
    });
});
