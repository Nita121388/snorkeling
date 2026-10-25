// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { computeCollapsedHiddenFlags, findCollapsedScrollAnchorIndex } from "./markdown-collapse";
import { captureMarkdownFoldSnapshot, resolveMarkdownFoldLines } from "./markdown-fold-state";
import { moveMarkdownHeadingSection } from "./markdown-heading-section";

describe("markdown fold state helpers", () => {
    it("resolves folded heading lines after same-level sections move", () => {
        const text = [
            "## One",
            "one body",
            "## Two",
            "two body",
            "### Two child",
            "child body",
            "## Three",
            "three body",
        ].join("\n");
        const snapshot = captureMarkdownFoldSnapshot(text, [
            { startLineNumber: 3, endLineNumber: 6, isCollapsed: true },
        ]);
        const moved = moveMarkdownHeadingSection(text, 3, "down");

        expect(moved?.text).toBeTruthy();
        expect(resolveMarkdownFoldLines(moved!.text, snapshot)).toEqual([5]);
    });

    it("resolves folded heading lines after moving across parent sections", () => {
        const text = ["## 2", "### 2.1", "one", "### 2.2", "two", "## 3", "### 3.1", "three"].join("\n");
        const snapshot = captureMarkdownFoldSnapshot(text, [
            { startLineNumber: 4, endLineNumber: 5, isCollapsed: true },
        ]);
        const moved = moveMarkdownHeadingSection(text, 4, "down");

        expect(resolveMarkdownFoldLines(moved!.text, snapshot)).toEqual([5]);
    });

    it("uses heading path and duplicate order to avoid folding the wrong duplicate", () => {
        const text = ["## Parent A", "### Repeat", "a", "## Parent B", "### Repeat", "b", "### Repeat", "c"].join("\n");
        const snapshot = captureMarkdownFoldSnapshot(text, [
            { startLineNumber: 7, endLineNumber: 8, isCollapsed: true },
        ]);
        const moved = moveMarkdownHeadingSection(text, 7, "up");

        expect(resolveMarkdownFoldLines(moved!.text, snapshot)).toEqual([5]);
    });

    it("ignores non-collapsed regions and headings inside fenced code blocks", () => {
        const text = ["# Real", "body", "```md", "# Fake", "```", "# Next", "tail"].join("\n");
        const snapshot = captureMarkdownFoldSnapshot(text, [
            { startLineNumber: 1, endLineNumber: 2, isCollapsed: false },
            { startLineNumber: 4, endLineNumber: 4, isCollapsed: true },
            { startLineNumber: 6, endLineNumber: 7, isCollapsed: true },
        ]);

        expect(resolveMarkdownFoldLines(text, snapshot)).toEqual([6]);
    });
});

describe("computeCollapsedHiddenFlags (heading collapse visibility)", () => {
    // Mirrors the preview's top-level block walk: each element is { level, id }.
    // Blocks under a collapsed heading must be hidden until a heading of <= level re-opens.
    it("hides body blocks under a collapsed heading, reveals below a sibling/parent", () => {
        const blocks = [
            { level: 2, id: "a" }, // collapsed
            { level: null, id: null }, // a's body → hide
            { level: null, id: null }, // a's body → hide
            { level: 2, id: "b" }, // sibling → re-open
            { level: null, id: null },
            { level: 3, id: "c" }, // nested child of b, NOT collapsed
            { level: null, id: null }, // c's body → visible
        ];
        const flags = computeCollapsedHiddenFlags(blocks, new Set(["a"]));
        expect(flags).toEqual([false, true, true, false, false, false, false]);
    });

    it("reveals children of a heading collapsed at a higher level only up to the next <= heading", () => {
        const blocks = [
            { level: 1, id: "h1" }, // collapsed
            { level: 1, id: "h2" }, // sibling, closes h1's section
            { level: null, id: null }, // h2's body, visible
        ];
        const flags = computeCollapsedHiddenFlags(blocks, new Set(["h1"]));
        expect(flags).toEqual([false, false, false]);
    });

    it("hides everything under a collapsed h1 until an uncollapsed sibling", () => {
        const blocks = [
            { level: 1, id: "h1" },
            { level: 2, id: "h2" }, // child → hide
            { level: 3, id: "h3" }, // grandchild → hide
            { level: 1, id: "h4" }, // opens a new top-level section
            { level: null, id: null },
        ];
        const flags = computeCollapsedHiddenFlags(blocks, new Set(["h1"]));
        expect(flags).toEqual([false, true, true, false, false]);
    });
});

describe("findCollapsedScrollAnchorIndex", () => {
    // Heading at 0, its section body at 100..1500, next section from 1500 on.
    const TOPS = [0, 100, 500, 1500, 2000];

    it("finds no anchor when the collapsed content sits below the fold", () => {
        // Reader is at [700, 1500) and collapses the section under the heading they are on:
        // blocks 1-2 disappear, the first survivor starts at 1500 — past the viewport bottom.
        // Nothing the reader sees moves → no scrollTop change.
        // (The old rule pinned block 3 here and scrolled the page by the collapsed height.)
        const flags = [false, true, true, false, false];
        expect(findCollapsedScrollAnchorIndex(flags, TOPS, 700, 1500)).toBeNull();
    });

    it("pins the first surviving block inside the viewport when content above it shrank", () => {
        // Reader is scrolled to [1000, 1800) and collapsed a section above the fold: block 3
        // starts inside the viewport and slides up by the removed height → it is the anchor.
        const flags = [false, true, true, false, false];
        expect(findCollapsedScrollAnchorIndex(flags, TOPS, 1000, 1800)).toBe(3);
    });

    it("pins the same block when that section is expanded again", () => {
        // Expanding restores height above the fold: block 3 slides down by the same amount.
        const flags = [false, false, false, false, false];
        expect(findCollapsedScrollAnchorIndex(flags, TOPS, 1000, 1800)).toBe(3);
    });

    it("skips survivors that start above the viewport top", () => {
        // Only the heading (top 0) and a straddling-free block at 500 survive, both above the
        // viewport top 1000 → skipped; block 3 at 1500 is the anchor.
        const flags = [false, true, false, false, false];
        expect(findCollapsedScrollAnchorIndex(flags, TOPS, 1000, 1800)).toBe(3);
    });

    it("returns null when the first survivor already starts below the viewport", () => {
        // Blocks 0-2 hidden, first survivor starts at 1500 — past the viewport bottom 1800? no:
        // 1500 < 1800, so use a tighter viewport to prove the below-viewport guard.
        const flags = [true, true, true, false, false];
        expect(findCollapsedScrollAnchorIndex(flags, TOPS, 0, 1200)).toBeNull();
    });

    it("returns null when every block is hidden", () => {
        const flags = [true, true, true, true, true];
        expect(findCollapsedScrollAnchorIndex(flags, TOPS, 1000, 1800)).toBeNull();
    });

    it("returns null when every surviving block starts above the viewport top", () => {
        // The reader's viewport is entirely inside the collapsed region: there is nothing
        // visible to pin to, so the browser clamp stays in charge.
        const flags = [false, true, true, true, true];
        expect(findCollapsedScrollAnchorIndex(flags, TOPS, 1000, 1800)).toBeNull();
    });
});
