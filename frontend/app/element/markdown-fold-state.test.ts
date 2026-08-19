// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { computeCollapsedHiddenFlags, findCollapsedScrollPinIndex } from "./markdown-collapse";
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

describe("findCollapsedScrollPinIndex", () => {
    const BOTTOMS_FULL_DOC = [40, 400, 800, 1400, 2000]; // blocks [heading, body, body, body, body]

    it("pins the first surviving block whose bottom is at or below the viewport top", () => {
        // blocks 1-2 inside a collapsed section (flags[1,2]=true); block 3 survives and is below viewportTop=100
        const flags = [false, true, true, false, false];
        const bottoms = [40, 400, 800, 1400, 2000];
        // block 0 survives but its bottom(40) <= viewportTop(100) → skipped
        // block 3 survives AND bottom(1400) > 100 → pin = 3
        expect(findCollapsedScrollPinIndex(flags, bottoms, 100)).toBe(3);
    });

    it("falls back to the first survivor when the viewport is entirely inside the collapsed region", () => {
        // Only block 0 (heading, bottom 40) survives; viewport top=150 is below it → no survivor
        // at or below the viewport top → fallback pins to first survivor (block 0)
        const flags = [false, true, true, true, true];
        const bottoms = [40, 400, 800, 1400, 2000];
        expect(findCollapsedScrollPinIndex(flags, bottoms, 150)).toBe(0);
    });

    it("returns null when every block is hidden", () => {
        const flags = [true, true, true];
        const bottoms = [100, 200, 300];
        expect(findCollapsedScrollPinIndex(flags, bottoms, 0)).toBeNull();
    });

    it("returns the first block when nothing is collapsed (no-op toggle)", () => {
        const flags = [false, false, false, false];
        const bottoms = [40, 400, 800, 1200];
        // viewportTop=500: block 0 bottom 40 <= 500 → skipped; block 1 bottom 400 <=500 → skipped; block 2 bottom 800 >500 → pin=2
        expect(findCollapsedScrollPinIndex(flags, bottoms, 500)).toBe(2);
    });
});
