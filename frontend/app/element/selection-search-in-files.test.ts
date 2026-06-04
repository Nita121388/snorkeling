// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    isAbsolutePath,
    isMarkdownPath,
    isSamePath,
    resolvePreviewRootPathForSearch,
    resolveTextHintLine,
} from "./selection-search-in-files";

describe("selection search in files", () => {
    it("detects markdown files for edit-mode opening", () => {
        expect(isMarkdownPath("/tmp/README.md")).toBe(true);
        expect(isMarkdownPath("/tmp/notes.markdown")).toBe(true);
        expect(isMarkdownPath("/tmp/page.mdx")).toBe(true);
        expect(isMarkdownPath("/tmp/src/index.ts")).toBe(false);
    });

    it("treats home-relative paths as absolute search targets", () => {
        expect(isAbsolutePath("~/Primary/obsidians/Obsidian/模型训练仓的处理.md")).toBe(true);
        expect(isAbsolutePath("/Users/nita/Primary/README.md")).toBe(true);
        expect(isAbsolutePath("E:/code/tpot/tpot/__init__.py")).toBe(true);
        expect(isAbsolutePath("docs/README.md")).toBe(false);
    });

    it("keeps default root paths when file info is not loaded yet", () => {
        expect(resolvePreviewRootPathForSearch(null, "~")).toBe("~");
        expect(resolvePreviewRootPathForSearch(null, "/Users/nita")).toBe("/Users/nita");
    });

    it("uses directory file info as the root path", () => {
        expect(
            resolvePreviewRootPathForSearch(
                {
                    path: "/Users/nita/project",
                    isdir: true,
                } as FileInfo,
                "~"
            )
        ).toBe("/Users/nita/project");
    });

    it("uses parent dir for file info", () => {
        expect(
            resolvePreviewRootPathForSearch(
                {
                    path: "/Users/nita/project/README.md",
                    dir: "/Users/nita/project",
                    isdir: false,
                } as FileInfo,
                "~"
            )
        ).toBe("/Users/nita/project");
    });

    it("matches already-open file paths after path normalization", () => {
        expect(isSamePath("/Users/nita/project/README.md", "/Users/nita/project//README.md")).toBe(true);
        expect(isSamePath("C:\\repo\\README.md", "c:/repo/README.md")).toBe(true);
        expect(isSamePath("/Users/nita/project/README.md", "/Users/nita/project/CHANGELOG.md")).toBe(false);
    });

    it("prefers text matches near the original line number", () => {
        const fileContent = [
            "def normalize_date_series_old():",
            "    pass",
            "def unrelated():",
            "    pass",
            "def normalize_date_series():",
            "    return values",
            "def normalize_date_series():",
            "    return other_values",
        ].join("\n");

        expect(resolveTextHintLine(fileContent, "normalize_date_series()", 7)).toBe(7);
    });

    it("falls back to the nearest fuzzy text match when the nearby line no longer matches exactly", () => {
        const fileContent = [
            "def normalize_date_series_old():",
            "    pass",
            "def normalize_date_series(value):",
            "    return value",
            "def unrelated():",
            "    pass",
            "def normalize_date_series(value):",
            "    return other_value",
        ].join("\n");

        expect(resolveTextHintLine(fileContent, "normalize_date_series()", 6)).toBe(7);
    });

    it("falls back to the original line number when no text match is close enough", () => {
        const fileContent = ["def unrelated():", "    pass", "def another_function():", "    pass"].join("\n");

        expect(resolveTextHintLine(fileContent, "normalize_date_series()", 84)).toBe(84);
    });
});
