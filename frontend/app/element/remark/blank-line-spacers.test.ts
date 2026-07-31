// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import remarkBlankLineSpacers from "./blank-line-spacers";
import { makeRemarkPlugins } from "./index";
import type { Root } from "mdast";

function transform(md: string): Root {
    const processor = unified().use(remarkParse).use(remarkBlankLineSpacers).use(remarkStringify);
    const parsed = processor.parse(md) as Root;
    return processor.runSync(parsed) as Root;
}

function spacerLineCounts(tree: Root): number[] {
    return tree.children
        .filter((c: any) => c?.type === "paragraph" && c?.data?.hProperties?.["data-spacer-lines"])
        .map((c: any) => Number(c.data.hProperties["data-spacer-lines"]));
}

describe("remarkBlankLineSpacers", () => {
    it("inserts one spacer between paragraphs separated by a single blank line", () => {
        const tree = transform("a\n\nb\n");
        // Source layout: line 1 "a", line 2 blank, line 3 "b" → gap = 1.
        expect(spacerLineCounts(tree)).toEqual([1]);
    });

    it("inserts one spacer per blank line when the author leaves several", () => {
        const tree = transform("a\n\n\n\nb\n");
        // Source layout: line 1 "a", lines 2/3/4 blank, line 5 "b" → gap = 3.
        expect(spacerLineCounts(tree)).toEqual([3, 3, 3]);
    });

    it("respects minSpacerLines by suppressing sub-threshold gaps", () => {
        const processor = unified()
            .use(remarkParse)
            .use(remarkBlankLineSpacers, { minSpacerLines: 2 })
            .use(remarkStringify);
        const tree = processor.runSync(processor.parse("a\n\nb\n") as Root) as Root;
        expect(spacerLineCounts(tree)).toEqual([]);
    });

    it("respects linesPerSpacer > 1 by emitting fewer but still tagged spacers", () => {
        const processor = unified()
            .use(remarkParse)
            .use(remarkBlankLineSpacers, { linesPerSpacer: 2 })
            .use(remarkStringify);
        // gap = 3, linesPerSpacer = 2 => floor(3/2) = 1 spacer, tagged with the gap (3).
        const tree = processor.runSync(processor.parse("a\n\n\n\nb\n") as Root) as Root;
        expect(spacerLineCounts(tree)).toEqual([3]);
    });

    it("preserves non-spacer children at their original positions", () => {
        const tree = transform("# h1\n\npara\n");
        const kinds = tree.children.map((c) => c.type);
        expect(kinds).toEqual(["heading", "paragraph", "paragraph"]);
    });

    it("omits the spacer plugin when makeRemarkPlugins is called with blankSpacer: null", () => {
        const plugins = makeRemarkPlugins({
            contentBlocksMap: new Map() as any,
            blankSpacer: null,
        });
        const hasSpacer = plugins.some((p: any) =>
            Array.isArray(p) ? p[0] === remarkBlankLineSpacers : p === remarkBlankLineSpacers
        );
        expect(hasSpacer).toBe(false);
    });

    it("includes the spacer plugin by default", () => {
        const plugins = makeRemarkPlugins({ contentBlocksMap: new Map() as any });
        const hasSpacer = plugins.some((p: any) =>
            Array.isArray(p) ? p[0] === remarkBlankLineSpacers : p === remarkBlankLineSpacers
        );
        expect(hasSpacer).toBe(true);
    });
});
