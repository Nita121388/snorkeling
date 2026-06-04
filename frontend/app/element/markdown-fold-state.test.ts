// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
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
