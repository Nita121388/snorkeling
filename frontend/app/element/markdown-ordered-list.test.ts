// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    getOrderedListMoveState,
    getOrderedListSwapPreview,
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
                "2. First",
                "   first detail",
                "",
                "3. Third",
            ].join("\n"),
            targetLineNumber: 2,
            movedRange: { startLineNumber: 1, endLineNumber: 3 },
            swappedRange: { startLineNumber: 4, endLineNumber: 6 },
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

    it("returns null when the current line is not part of an ordered list", () => {
        expect(moveOrderedListItem("plain\ntext", 1, "up")).toBeNull();
        expect(getOrderedListMoveState("plain\ntext", 1)).toBeNull();
    });
});
