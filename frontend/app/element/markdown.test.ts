// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import React from "react";
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

    it("keeps all inline content as summary when there is no <br/> to split on", () => {
        // No <br/> means no soft break to fold on; the entire inline run stays as the summary.
        // (Earlier "split at first non-blank node" behavior was abandoned — see markdown.tsx comment.)
        const split = splitOrderedListItemChildren(["\n", "Summary", "\n", "Details", "\n"]);

        // trimBlankTextNodes only trims leading/trailing whitespace-only children, not interior ones.
        expect(split.summaryChildren).toEqual(["Summary", "\n", "Details"]);
        expect(split.bodyChildren).toEqual([]);
    });

    it("does not duplicate a leading <ul> after a <br/> in a tight list", () => {
        // Tight list: react-markdown does NOT wrap li content in <p>, so
        // children are the flat inline sequence [...text, <br/>, <ul>, text...].
        // bodyChildren must contain the <ul> exactly once, not twice.
        const ulNode = React.createElement(
            "ul",
            null,
            React.createElement("li", null, "Sub")
        );
        const split = splitOrderedListItemChildren([
            "Summary text",
            "\n",
            React.createElement("br", null),
            ulNode,
            "\n",
            "More body",
            "\n",
        ]);

        expect(split.summaryChildren).toEqual(["Summary text"]);
        const ulInBody = split.bodyChildren.filter(
            (c) => React.isValidElement(c) && c.type === "ul"
        );
        expect(ulInBody).toHaveLength(1);
    });

    it("moves a leading <ul> after a <br/> into the body, not the summary", () => {
        // The <ul> must end up in bodyChildren (not summaryChildren) and survive trimBlankTextNodes.
        const ulNode = React.createElement(
            "ul",
            null,
            React.createElement("li", null, "Item")
        );
        const split = splitOrderedListItemChildren([
            "\n",
            "Summary text",
            "\n",
            React.createElement("br", null),
            ulNode,
            "\n",
            "More body",
            "\n",
        ]);

        expect(split.summaryChildren).toEqual(["Summary text"]);
        // No <ul> leaked into the summary:
        expect(
            split.summaryChildren.some(
                (c) => React.isValidElement(c) && c.type === "ul"
            )
        ).toBe(false);
        // The body contains exactly one <ul> and the trailing text:
        expect(
            split.bodyChildren.filter(
                (c) => React.isValidElement(c) && c.type === "ul"
            )
        ).toHaveLength(1);
        expect(split.bodyChildren).toContain("More body");
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
