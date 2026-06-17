// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { shouldHideMarkdownElementForCollapsedHeadings } from "./markdown-collapse";
import { splitOrderedListItemChildren } from "./markdown";

type MarkdownVisibilityElement = {
    headingLevel: number | null;
    headingId: string | null;
};

function getHiddenStates(elements: MarkdownVisibilityElement[], collapsedHeadingIds: string[]): boolean[] {
    const collapsedHeadingStack: number[] = [];
    const collapsedHeadingIdSet = new Set(collapsedHeadingIds);
    return elements.map((element) =>
        shouldHideMarkdownElementForCollapsedHeadings(
            element.headingLevel,
            element.headingId,
            collapsedHeadingIdSet,
            collapsedHeadingStack
        )
    );
}

describe("markdown preview heading folding", () => {
    it("hides child headings and child content when a parent heading is collapsed", () => {
        expect(
            getHiddenStates(
                [
                    { headingLevel: 1, headingId: "title" },
                    { headingLevel: null, headingId: null },
                    { headingLevel: 2, headingId: "setup" },
                    { headingLevel: null, headingId: null },
                    { headingLevel: 3, headingId: "details" },
                    { headingLevel: null, headingId: null },
                    { headingLevel: 1, headingId: "next" },
                    { headingLevel: null, headingId: null },
                ],
                ["title"]
            )
        ).toEqual([false, true, true, true, true, true, false, false]);
    });

    it("lets a child collapsed heading remain hidden inside its collapsed parent", () => {
        expect(
            getHiddenStates(
                [
                    { headingLevel: 1, headingId: "title" },
                    { headingLevel: 2, headingId: "setup" },
                    { headingLevel: null, headingId: null },
                    { headingLevel: 1, headingId: "next" },
                    { headingLevel: null, headingId: null },
                ],
                ["title", "setup"]
            )
        ).toEqual([false, true, true, false, false]);
    });

    it("resumes showing content after the collapsed heading section ends", () => {
        expect(
            getHiddenStates(
                [
                    { headingLevel: 2, headingId: "setup" },
                    { headingLevel: null, headingId: null },
                    { headingLevel: 3, headingId: "details" },
                    { headingLevel: null, headingId: null },
                    { headingLevel: 2, headingId: "usage" },
                    { headingLevel: null, headingId: null },
                    { headingLevel: 1, headingId: "appendix" },
                ],
                ["setup"]
            )
        ).toEqual([false, true, true, true, false, false, false]);
    });
});

describe("markdown preview ordered list rendering", () => {
    it("uses the first non-blank child as the ordered list summary", () => {
        const split = splitOrderedListItemChildren(["\n", "First item", "\n"]);

        expect(split.summaryChildren).toEqual(["First item"]);
        expect(split.bodyChildren).toEqual([]);
    });

    it("keeps continuation content in the collapsible ordered list body", () => {
        const split = splitOrderedListItemChildren(["\n", "Summary", "\n", "Details", "\n"]);

        expect(split.summaryChildren).toEqual(["Summary"]);
        expect(split.bodyChildren).toEqual(["Details"]);
    });
});
