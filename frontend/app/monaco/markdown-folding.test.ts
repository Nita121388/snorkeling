// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { getMarkdownFoldingRanges, getMarkdownHeadingFoldingRanges } from "./markdown-folding";

describe("markdown heading folding", () => {
    it("folds headings until the next same-or-higher heading", () => {
        const text = [
            "# Title",
            "intro",
            "## Setup",
            "step 1",
            "### Details",
            "more",
            "## Usage",
            "run it",
            "# Appendix",
            "tail",
        ].join("\n");

        expect(getMarkdownHeadingFoldingRanges(text)).toEqual([
            { start: 1, end: 8 },
            { start: 3, end: 6 },
            { start: 5, end: 6 },
            { start: 7, end: 8 },
            { start: 9, end: 10 },
        ]);
    });

    it("skips adjacent headings that have no content to fold", () => {
        const text = ["# One", "## Two", "content"].join("\n");

        expect(getMarkdownHeadingFoldingRanges(text)).toEqual([
            { start: 1, end: 3 },
            { start: 2, end: 3 },
        ]);
    });

    it("ignores headings inside fenced code blocks", () => {
        const text = [
            "# Real",
            "```md",
            "# Not a heading",
            "```",
            "text",
            "## Child",
            "child text",
            "~~~",
            "## Still not a heading",
            "~~~",
            "# Next",
            "tail",
        ].join("\n");

        expect(getMarkdownHeadingFoldingRanges(text)).toEqual([
            { start: 1, end: 10 },
            { start: 6, end: 10 },
            { start: 11, end: 12 },
        ]);
    });

    it("adds ordered list folding ranges for md files", () => {
        const text = ["# Real", "1. First", "   detail", "2. Second"].join("\n");

        expect(getMarkdownFoldingRanges(text, "/tmp/notes.md")).toEqual([
            { start: 1, end: 4 },
            { start: 2, end: 3 },
        ]);
    });

    it("does not add ordered list folding ranges for markdown-like non-md files", () => {
        const text = ["# Real", "1. First", "   detail", "2. Second"].join("\n");

        expect(getMarkdownFoldingRanges(text, "/tmp/notes.markdown")).toEqual([{ start: 1, end: 4 }]);
        expect(getMarkdownFoldingRanges(text, "/tmp/notes.mdx")).toEqual([{ start: 1, end: 4 }]);
    });
});
