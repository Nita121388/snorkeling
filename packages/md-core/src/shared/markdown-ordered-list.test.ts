// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    cutOrderedListItem,
    getPreviousOrderedListContinuation,
    setOrderedListMarkerNumberAtLine,
    getMarkdownOrderedListFoldingRanges,
    getOrderedListMoveState,
    getOrderedListSwapPreview,
    insertOrderedListItem,
    isMarkdownOrderedListPath,
    moveOrderedListItem,
    normalizeOrderedListNumbering,
    renumberOrderedListsInSelection,
} from "./markdown-ordered-list";

describe("markdown ordered list helpers", () => {
    it("detects markdown paths", () => {
        expect(isMarkdownOrderedListPath("/tmp/notes.md")).toBe(true);
        expect(isMarkdownOrderedListPath("/tmp/notes.markdown")).toBe(true);
        expect(isMarkdownOrderedListPath("/tmp/notes.mdx")).toBe(true);
        expect(isMarkdownOrderedListPath("/tmp/notes.txt")).toBe(false);
    });

    it("detects a list item from its child content lines", () => {
        const text = ["1. First", "   child detail", "   - child bullet", "2. Second"].join("\n");

        expect(getOrderedListMoveState(text, 2)).toEqual({
            itemStartLineNumber: 1,
            itemEndLineNumber: 3,
            canMoveUp: false,
            canMoveDown: true,
        });
    });

    it("folds child content into the previous ordered list item", () => {
        const text = [
            "1. First",
            "   child detail",
            "   - child bullet",
            "   1. child ordered",
            "2. Second",
            "3. Third",
            "   third detail",
        ].join("\n");

        expect(getMarkdownOrderedListFoldingRanges(text)).toEqual([
            { startLineNumber: 1, endLineNumber: 4 },
            { startLineNumber: 6, endLineNumber: 7 },
        ]);
    });

    it("does not fold single-line ordered list items", () => {
        const text = ["1. First", "2. Second"].join("\n");

        expect(getMarkdownOrderedListFoldingRanges(text)).toEqual([]);
    });

    it("ignores ordered list markers inside fenced code blocks", () => {
        const text = [
            "1. First",
            "   first detail",
            "```md",
            "1. Not a real item",
            "```",
            "2. Second",
            "~~~",
            "3. Still not a real item",
            "~~~",
        ].join("\n");

        expect(getMarkdownOrderedListFoldingRanges(text)).toEqual([
            { startLineNumber: 1, endLineNumber: 5 },
            { startLineNumber: 6, endLineNumber: 9 },
        ]);
    });

    it("previews the two list items that will be swapped", () => {
        const text = ["1. First", "   first detail", "2. Second", "   second detail", "3. Third"].join("\n");

        expect(getOrderedListSwapPreview(text, 4, "up")).toEqual({
            movedRange: { startLineNumber: 3, endLineNumber: 4 },
            swappedRange: { startLineNumber: 1, endLineNumber: 2 },
        });
        expect(getOrderedListSwapPreview(text, 3, "down")).toEqual({
            movedRange: { startLineNumber: 3, endLineNumber: 4 },
            swappedRange: { startLineNumber: 5, endLineNumber: 5 },
        });
    });

    it("does not preview impossible list item swaps", () => {
        const text = ["1. First", "2. Second"].join("\n");

        expect(getOrderedListSwapPreview(text, 1, "up")).toBeNull();
        expect(getOrderedListSwapPreview(text, 2, "down")).toBeNull();
    });

    it("moves an item up with its child content and renumbers siblings", () => {
        const text = ["1. First", "   first detail", "2. Second", "   second detail", "3. Third"].join("\n");

        expect(moveOrderedListItem(text, 3, "up")).toEqual({
            text: ["1. Second", "   second detail", "2. First", "   first detail", "3. Third"].join("\n"),
            targetLineNumber: 1,
            movedRange: { startLineNumber: 1, endLineNumber: 2 },
            swappedRange: { startLineNumber: 3, endLineNumber: 4 },
        });
    });

    it("keeps the replaced sibling when moving up from child content", () => {
        const text = [
            "1. First",
            "   first detail",
            "",
            "2. Second",
            "   second detail",
            "   second detail two",
            "3. Third",
        ].join("\n");

        expect(moveOrderedListItem(text, 5, "up")).toEqual({
            text: [
                "1. Second",
                "   second detail",
                "   second detail two",
                "",
                "2. First",
                "   first detail",
                "3. Third",
            ].join("\n"),
            targetLineNumber: 2,
            movedRange: { startLineNumber: 1, endLineNumber: 3 },
            // Blank separators now belong to neither item: the moved-down sibling starts after
            // the blank run, so its range begins one line later than the pre-fix behavior.
            swappedRange: { startLineNumber: 5, endLineNumber: 6 },
        });
    });

    it("moves an item down with its child content and renumbers siblings", () => {
        const text = ["1. First", "   first detail", "2. Second", "   second detail", "3. Third"].join("\n");

        expect(moveOrderedListItem(text, 1, "down")).toEqual({
            text: ["1. Second", "   second detail", "2. First", "   first detail", "3. Third"].join("\n"),
            targetLineNumber: 3,
            movedRange: { startLineNumber: 3, endLineNumber: 4 },
            swappedRange: { startLineNumber: 1, endLineNumber: 2 },
        });
    });

    it("treats following plain lines as part of the previous ordered list item", () => {
        const text = ["1. First", "plain paragraph belongs to first", "2. Second", "3. Third"].join("\n");

        expect(moveOrderedListItem(text, 2, "down")).toEqual({
            text: ["1. Second", "2. First", "plain paragraph belongs to first", "3. Third"].join("\n"),
            targetLineNumber: 3,
            movedRange: { startLineNumber: 2, endLineNumber: 3 },
            swappedRange: { startLineNumber: 1, endLineNumber: 1 },
        });
    });

    it("renumbers ordered lists inside a selection without moving content", () => {
        const text = ["Intro", "4. First", "8. Second", "   9. Child", "   2. Child two", "10. Third", "Outro"].join(
            "\n"
        );

        expect(renumberOrderedListsInSelection(text, 2, 6)).toEqual({
            text: ["Intro", "1. First", "2. Second", "   1. Child", "   2. Child two", "3. Third", "Outro"].join("\n"),
        });
    });

    it("inserts an empty ordered list item above and renumbers siblings", () => {
        const text = ["1. First", "2. Second", "3. Third"].join("\n");

        expect(insertOrderedListItem(text, 2, "above")).toEqual({
            text: ["1. First", "2. ", "3. Second", "4. Third"].join("\n"),
            targetLineNumber: 2,
            targetColumn: 4,
        });
    });

    it("inserts an empty ordered list item below the current item content", () => {
        const text = ["1. First", "   detail", "2. Second"].join("\n");

        expect(insertOrderedListItem(text, 1, "below")).toEqual({
            text: ["1. First", "   detail", "2. ", "3. Second"].join("\n"),
            targetLineNumber: 3,
            targetColumn: 4,
        });
    });

    it("cuts an ordered list item and renumbers the remaining siblings", () => {
        const text = ["1. First", "   detail", "2. Second", "3. Third"].join("\n");

        expect(cutOrderedListItem(text, 1)).toEqual({
            text: ["1. Second", "2. Third"].join("\n"),
            targetLineNumber: 1,
            targetColumn: 1,
            cutText: ["1. First", "   detail"].join("\n"),
        });
    });

    it("cuts the only ordered list item without renumbering unrelated lines", () => {
        const text = ["Intro", "1. First", "   detail", "# Outro"].join("\n");

        expect(cutOrderedListItem(text, 2)).toEqual({
            text: ["Intro", "# Outro"].join("\n"),
            targetLineNumber: 2,
            targetColumn: 1,
            cutText: ["1. First", "   detail"].join("\n"),
        });
    });

    it("returns null when the current line is not part of an ordered list", () => {
        expect(moveOrderedListItem("plain\ntext", 1, "up")).toBeNull();
        expect(getOrderedListMoveState("plain\ntext", 1)).toBeNull();
    });

    // --- regressions: insert-below landing at EOF / cross-list renumber / fence pollution ---

    it("inserts below the last item before a trailing paragraph, not after it", () => {
        const text = ["1. One", "2. Two", "3. Three", "4. Four", "5. Five", "", "Some paragraph"].join("\n");

        const result = insertOrderedListItem(text, 5, "below");
        expect(result?.text).toEqual(
            ["1. One", "2. Two", "3. Three", "4. Four", "5. Five", "6. ", "", "Some paragraph"].join("\n")
        );
        expect(result?.targetLineNumber).toBe(6);
    });

    it("does not renumber a second list that follows the edited one across a blank line", () => {
        const text = ["1. One", "2. Two", "3. Three", "4. Four", "5. Five", "", "1. Alpha", "2. Beta"].join("\n");

        const result = insertOrderedListItem(text, 5, "below");
        expect(result?.text).toEqual(
            [
                "1. One",
                "2. Two",
                "3. Three",
                "4. Four",
                "5. Five",
                "6. ",
                "",
                "1. Alpha",
                "2. Beta",
            ].join("\n")
        );
    });

    it("never renumbers ordered-list markers inside fenced code blocks", () => {
        const text = ["1. One", "2. Two", "3. Three", "4. Four", "5. Five", "", "```", "1. x", "```"].join("\n");

        const result = insertOrderedListItem(text, 5, "below");
        expect(result?.text).toEqual(
            ["1. One", "2. Two", "3. Three", "4. Four", "5. Five", "6. ", "", "```", "1. x", "```"].join("\n")
        );
    });

    it("stops item extent at blank line followed by shallow content (no EOF swallow)", () => {
        const text = ["1. First", "2. Second", "", "tail paragraph"].join("\n");

        // Cursor on the tail paragraph must NOT resolve into item 2's insert flow.
        expect(getOrderedListMoveState(text, 4)).toBeNull();
    });
});

describe("normalizeOrderedListNumbering (whole-document)", () => {

    it("renumbers duplicate markers inside a tight list (no blank lines)", () => {
        const text = "1. a\n1. b\n1. c";
        expect(normalizeOrderedListNumbering(text)?.text).toBe("1. a\n2. b\n3. c");
    });

    it("preserves user-written starts of blank-separated groups", () => {
        // Blank lines = group boundaries; each group's first number stays as authored.
        const text = "1. a\n\n5. b\n\n5. c";
        expect(normalizeOrderedListNumbering(text)).toBeNull();
    });

    it("keeps text untouched when already sequential", () => {
        const text = "1. a\n2. b\n3. c";
        expect(normalizeOrderedListNumbering(text)).toBeNull();
    });

    it("does not touch code fences containing digits-dot lines", () => {
        const text = "1. a\n\n```\n1. not a list\n5. not either\n```";
        expect(normalizeOrderedListNumbering(text)).toBeNull();
    });

    it("handles multiple independent lists", () => {
        const text = "3. a\n3. b\n\n# heading\n\n7. x\n7. y";
        const out = normalizeOrderedListNumbering(text)?.text;
        expect(out).toContain("1. a\n2. b");
        // Blank + heading separated group = new visual group: start preserved, run continues.
        expect(out).toContain("7. x\n8. y");
    });
});

describe("group-start chip helpers", () => {
    it("setOrderedListMarkerNumberAtLine rewrites only the marker digit", () => {
        expect(setOrderedListMarkerNumberAtLine("1. a\n\n5. b", 3, 8)?.text).toBe("1. a\n\n8. b");
    });
    it("setOrderedListMarkerNumberAtLine returns null on non-marker lines", () => {
        expect(setOrderedListMarkerNumberAtLine("plain", 1, 2)).toBeNull();
    });
    it("continuation = previous sibling marker + 1 above the blank run", () => {
        const text = "1. a\n2. b\n\n5. c";
        expect(getPreviousOrderedListContinuation(text, 4)).toBe(3);
    });
    it("continuation returns null when the block above is a heading", () => {
        const text = "# t\n\n2. item";
        expect(getPreviousOrderedListContinuation(text, 3)).toBeNull();
    });
    it("continuation returns null inside code fences area", () => {
        const text = "```\n1. fake\n```\n\n2. real";
        expect(getPreviousOrderedListContinuation(text, 5)).toBeNull();
    });
    it("continuation handles first line", () => {
        expect(getPreviousOrderedListContinuation("1. a", 1)).toBeNull();
    });
});
