// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    linkifyMarkdownFileReferences,
    shouldOpenMarkdownLinkInNewBlock,
    splitOrderedListItemChildren,
} from "./markdown";
import { shouldHideMarkdownElementForCollapsedHeadings } from "./markdown-collapse";

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

describe("markdown preview file references", () => {
    it("opens ctrl and command clicks in a new block", () => {
        expect(shouldOpenMarkdownLinkInNewBlock({ ctrlKey: false, metaKey: false } as React.MouseEvent)).toBe(false);
        expect(shouldOpenMarkdownLinkInNewBlock({ ctrlKey: true, metaKey: false } as React.MouseEvent)).toBe(true);
        expect(shouldOpenMarkdownLinkInNewBlock({ ctrlKey: false, metaKey: true } as React.MouseEvent)).toBe(true);
    });
    it("turns an absolute markdown path with a line number into a link", () => {
        const textNode = {
            type: "text",
            value: "E:/primary/Obsidian/Primary Mission/notes/学习笔记.md:43",
        };
        const tree = { type: "root", children: [{ type: "paragraph", children: [textNode] }] };

        linkifyMarkdownFileReferences(tree);

        expect(tree.children[0].children[0]).toEqual({
            type: "link",
            url: textNode.value,
            children: [{ type: "text", value: textNode.value }],
            position: undefined,
        });
    });

    it("does not linkify file references inside code blocks", () => {
        const code = {
            type: "code",
            value: "E:/primary/Obsidian/Primary Mission/notes/学习笔记.md:43",
            children: [],
        };
        const tree = { type: "root", children: [code] };

        linkifyMarkdownFileReferences(tree);

        expect(tree.children[0]).toBe(code);
    });

    it("linkifies wiki links with their display label", () => {
        const tree: any = {
            type: "root",
            children: [{ type: "paragraph", children: [{ type: "text", value: "[[终端笔记|打开笔记]]" }] }],
        };

        linkifyMarkdownFileReferences(tree);

        expect(tree.children[0].children[0].children[0].value).toBe("打开笔记");
        expect(tree.children[0].children[0].url).toContain("wave-wiki:");
    });
});
