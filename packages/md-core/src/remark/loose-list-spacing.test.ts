// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { remark } from "remark";
import remarkGfm from "remark-gfm";
import { describe, expect, test } from "vitest";
import remarkLooseListSpacing from "./loose-list-spacing";

function process(md: string) {
    // Run parse-only so we can inspect the mdast directly.
    const processor = remark().use(remarkGfm).use(remarkLooseListSpacing);
    const tree = processor.parse(md);
    processor.runSync(tree);
    return tree;
}

function findLists(tree: any): any[] {
    const lists: any[] = [];
    const walk = (node: any) => {
        if (node.type === "list") {
            lists.push(node);
        }
        (node.children ?? []).forEach(walk);
    };
    walk(tree);
    return lists;
}

describe("remarkLooseListSpacing", () => {
    test("marks loose lists (blank lines between items) with data-loose", () => {
        const tree = process("1. a\n\n2. b");
        const lists = findLists(tree);
        expect(lists).toHaveLength(1);
        expect(lists[0].data?.hProperties?.dataLoose).toBe("true");
    });

    test("does not mark tight lists", () => {
        const tree = process("1. a\n2. b");
        const lists = findLists(tree);
        expect(lists).toHaveLength(1);
        expect(lists[0].data?.hProperties).toBeUndefined();
    });

    test("handles unordered lists", () => {
        const tree = process("- a\n\n- b");
        const lists = findLists(tree);
        expect(lists[0].data?.hProperties?.dataLoose).toBe("true");
    });

    test("marks nested loose lists independently", () => {
        const tree = process("- outer\n  - inner one\n\n  - inner two");
        const lists = findLists(tree);
        const loose = lists.filter((l) => l.data?.hProperties?.dataLoose === "true");
        expect(loose.length).toBe(1); // only the inner list is loose
    });
});
