// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { isMarkdownPath, isSamePath, resolvePreviewRootPathForSearch } from "./selection-search-in-files";

describe("selection search in files", () => {
    it("detects markdown files for edit-mode opening", () => {
        expect(isMarkdownPath("/tmp/README.md")).toBe(true);
        expect(isMarkdownPath("/tmp/notes.markdown")).toBe(true);
        expect(isMarkdownPath("/tmp/page.mdx")).toBe(true);
        expect(isMarkdownPath("/tmp/src/index.ts")).toBe(false);
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
});
