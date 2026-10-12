// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { remark } from "remark";
import remarkGfm from "remark-gfm";
import { VFile } from "vfile";
import { describe, expect, test } from "vitest";
import remarkSplitLooseLists from "./split-loose-lists";

function process(md: string) {
    const processor = remark().use(remarkGfm).use(remarkSplitLooseLists);
    const vfile = new VFile(md);
    const tree = processor.parse(vfile);
    processor.runSync(tree, vfile);
    return tree;
}

function topLevelLists(tree: any) {
    return tree.children.filter((n: any) => n.type === "list");
}

describe("remarkSplitLooseLists", () => {
    test("does nothing to tight lists", () => {
        const tree = process("1. a\n2. b\n3. c");
        const lists = topLevelLists(tree);
        expect(lists).toHaveLength(1);
        expect(lists[0].children).toHaveLength(3);
        expect(lists[0].start).toBe(1);
    });

    test("splits ordered lists at blank lines, keeping each group's source start", () => {
        const tree = process("1. a\n2. b\n\n5. c\n5. d");
        const lists = topLevelLists(tree);
        expect(lists).toHaveLength(2);
        expect(lists[0].children).toHaveLength(2);
        expect(lists[0].start).toBe(1);
        expect(lists[1].children).toHaveLength(2);
        expect(lists[1].start).toBe(5);
        expect(lists[1].spread).toBe(false);
    });

    test("every blank line starts a new group", () => {
        const tree = process("1. a\n\n2. b\n\n9. c");
        const lists = topLevelLists(tree);
        expect(lists).toHaveLength(3);
        expect(lists.map((l: any) => l.start)).toEqual([1, 2, 9]);
    });

    test("does not split unordered lists", () => {
        const tree = process("- a\n\n- b");
        const lists = topLevelLists(tree);
        expect(lists).toHaveLength(1);
        expect(lists[0].children).toHaveLength(2);
    });

    test("never splits inside code fences (parser already guards)", () => {
        const tree = process("1. real\n\n```\n1. not\n5. list\n```");
        const lists = topLevelLists(tree);
        expect(lists).toHaveLength(1);
    });

    test("single-item groups are allowed", () => {
        const tree = process("1. a\n\n3. b\n\n7. c\n8. d");
        const lists = topLevelLists(tree);
        expect(lists).toHaveLength(3);
        expect(lists[2].start).toBe(7);
    });

    test("keeps heading/paragraph context around the split intact", () => {
        const tree = process("# Title\n\n1. a\n\n2. b\n\ntail");
        expect(tree.children[0].type).toBe("heading");
        expect(tree.children[tree.children.length - 1].type).toBe("paragraph");
        expect(topLevelLists(tree)).toHaveLength(2);
    });

    test("user-authored first number as large values survive", () => {
        const tree = process("1. a\n\n99. big");
        const lists = topLevelLists(tree);
        expect(lists[1].start).toBe(99);
    });
});
