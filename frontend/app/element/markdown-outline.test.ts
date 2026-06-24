// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { getVisibleMarkdownOutlineItems, type MarkdownOutlineItem } from "./markdown-outline";

function visibleIds(items: MarkdownOutlineItem[], collapsedIds: string[]): string[] {
    return getVisibleMarkdownOutlineItems(items, new Set(collapsedIds)).map((visibleItem) => visibleItem.item.id);
}

describe("markdown outline heading folding", () => {
    const items: MarkdownOutlineItem[] = [
        { id: "intro", label: "Intro", level: 1 },
        { id: "setup", label: "Setup", level: 2 },
        { id: "details", label: "Details", level: 3 },
        { id: "usage", label: "Usage", level: 2 },
        { id: "appendix", label: "Appendix", level: 1 },
    ];

    it("hides descendant headings when an outline heading is collapsed", () => {
        expect(visibleIds(items, ["intro"])).toEqual(["intro", "appendix"]);
    });

    it("keeps sibling headings visible when a nested outline heading is collapsed", () => {
        expect(visibleIds(items, ["setup"])).toEqual(["intro", "setup", "usage", "appendix"]);
    });
});
