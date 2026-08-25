// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    cutOrderedListItem,
    getMarkdownOrderedListFoldingRanges,
    getOrderedListMoveState,
    getOrderedListSwapPreview,
    insertOrderedListItem,
    isMarkdownOrderedListPath,
    moveOrderedListItem,
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
