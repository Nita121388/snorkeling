// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    getMarkdownHeadingMoveState,
    getMarkdownHeadingSwapPreview,
    isMarkdownHeadingSectionPath,
    moveMarkdownHeadingSection,
} from "./markdown-heading-section";

describe("markdown heading section helpers", () => {
    it("detects markdown paths", () => {
        expect(isMarkdownHeadingSectionPath("/tmp/notes.md")).toBe(true);
        expect(isMarkdownHeadingSectionPath("/tmp/notes.markdown")).toBe(true);
        expect(isMarkdownHeadingSectionPath("/tmp/notes.mdx")).toBe(true);
        expect(isMarkdownHeadingSectionPath("/tmp/notes.txt")).toBe(false);
    });

    it("reports movement state only on heading lines", () => {
        const text = ["# Intro", "body", "# Next"].join("\n");

        expect(getMarkdownHeadingMoveState(text, 1)).toEqual({
            sectionStartLineNumber: 1,
            sectionEndLineNumber: 2,
            canMoveUp: false,
            canMoveDown: true,
        });
        expect(getMarkdownHeadingMoveState(text, 2)).toBeNull();
    });

    it("moves a heading section up with nested child headings", () => {
        const text = [
            "## One",
            "one body",
            "### One child",
            "child body",
            "## Two",
            "two body",
            "## Three",
            "three body",
        ].join("\n");

        expect(moveMarkdownHeadingSection(text, 5, "up")).toEqual({
            text: [
                "## Two",
                "two body",
                "## One",
                "one body",
                "### One child",
                "child body",
                "## Three",
                "three body",
            ].join("\n"),
            targetLineNumber: 1,
            movedRange: { startLineNumber: 1, endLineNumber: 2 },
            swappedRange: { startLineNumber: 3, endLineNumber: 6 },
        });
    });

    it("moves a heading section down with nested child headings", () => {
        const text = [
            "## One",
            "one body",
            "### One child",
            "child body",
            "## Two",
            "two body",
            "## Three",
            "three body",
        ].join("\n");

        expect(moveMarkdownHeadingSection(text, 1, "down")).toEqual({
            text: [
                "## Two",
                "two body",
                "## One",
                "one body",
                "### One child",
                "child body",
                "## Three",
                "three body",
            ].join("\n"),
            targetLineNumber: 3,
            movedRange: { startLineNumber: 3, endLineNumber: 6 },
            swappedRange: { startLineNumber: 1, endLineNumber: 2 },
        });
    });

    it("moves same-level headings across parent sections without changing heading level", () => {
        const text = ["## 2", "### 2.1", "one", "### 2.2", "two", "## 3", "### 3.1", "three"].join("\n");

        expect(moveMarkdownHeadingSection(text, 4, "down")).toEqual({
            text: ["## 2", "### 2.1", "one", "## 3", "### 2.2", "two", "### 3.1", "three"].join("\n"),
            targetLineNumber: 5,
            movedRange: { startLineNumber: 5, endLineNumber: 6 },
            swappedRange: { startLineNumber: 7, endLineNumber: 8 },
        });
    });

    it("moves same-level headings back to the previous parent section", () => {
        const text = ["## 2", "### 2.1", "one", "## 3", "### 2.2", "two", "### 3.1", "three"].join("\n");

        expect(moveMarkdownHeadingSection(text, 5, "up")).toEqual({
            text: ["## 2", "### 2.1", "one", "### 2.2", "two", "## 3", "### 3.1", "three"].join("\n"),
            targetLineNumber: 4,
            movedRange: { startLineNumber: 4, endLineNumber: 5 },
            swappedRange: { startLineNumber: 2, endLineNumber: 3 },
        });
    });

    it("previews the two same-level heading sections that will be swapped", () => {
        const text = ["# A", "## A.1", "a", "# B", "## B.1", "b"].join("\n");

        expect(getMarkdownHeadingSwapPreview(text, 2, "down")).toEqual({
            movedRange: { startLineNumber: 2, endLineNumber: 3 },
            swappedRange: { startLineNumber: 5, endLineNumber: 6 },
        });
    });

    it("ignores headings inside fenced code blocks", () => {
        const text = ["# Real", "```md", "# Not a heading", "```", "# Next"].join("\n");

        expect(getMarkdownHeadingMoveState(text, 3)).toBeNull();
        expect(getMarkdownHeadingMoveState(text, 1)).toEqual({
            sectionStartLineNumber: 1,
            sectionEndLineNumber: 4,
            canMoveUp: false,
            canMoveDown: true,
        });
    });
});
