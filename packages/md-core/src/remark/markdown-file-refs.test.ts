// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "vitest";
import { linkifyMarkdownFileReferences, splitTextNodeWithWikiLinks } from "./markdown-file-refs";

describe("linkifyMarkdownFileReferences wiki links", () => {
    test("linkifies a wiki link embedded in longer text (the 迈瑞.md case)", () => {
        const tree: any = {
            type: "paragraph",
            children: [{ type: "text", value: "一把抓 · 官网 → [[04-官网级-智检实验室解决方案]]" }],
        };
        linkifyMarkdownFileReferences(tree);
        expect(tree.children).toHaveLength(2);
        expect(tree.children[0].type).toBe("text");
        expect(tree.children[0].value).toBe("一把抓 · 官网 → ");
        expect(tree.children[1].type).toBe("link");
        expect(tree.children[1].url).toBe("wave-wiki:" + encodeURIComponent("04-官网级-智检实验室解决方案.md"));
        expect(tree.children[1].children[0].value).toBe("04-官网级-智检实验室解决方案");
    });

    test("supports multiple wiki links plus label and heading syntax in one node", () => {
        const tree: any = {
            type: "paragraph",
            children: [{ type: "text", value: "[[a]] 和 [[b|别名]] 还有 [[c#标题]]" }],
        };
        linkifyMarkdownFileReferences(tree);
        const links = tree.children.filter((n: any) => n.type === "link");
        expect(links).toHaveLength(3);
        // text segments preserved between links (no empty segments at the edges)
        expect(tree.children.filter((n: any) => n.type === "text").map((n: any) => n.value)).toEqual([" 和 ", " 还有 "]);
        expect(links[1].children[0].value).toBe("别名");
        expect(links[2].url).toContain(encodeURIComponent("c.md#标题"));
    });

    test("leaves ![[embed]] syntax alone", () => {
        const parts = splitTextNodeWithWikiLinks({ type: "text", value: "看图 ![[img.png]] 就好" });
        expect(parts).toBeNull();
    });

    test("plain text without wiki links is untouched (file-ref path still works)", () => {
        const value = "just plain words";
        const parts = splitTextNodeWithWikiLinks({ type: "text", value });
        expect(parts).toBeNull();
        const tree: any = { type: "paragraph", children: [{ type: "text", value }] };
        linkifyMarkdownFileReferences(tree);
        expect(tree.children[0].value).toBe(value);
    });

    test("does not touch code or existing links", () => {
        const tree: any = {
            type: "paragraph",
            children: [
                { type: "inlineCode", value: "[[a]]" },
                { type: "link", url: "x", children: [{ type: "text", value: "[[b]]" }] },
            ],
        };
        linkifyMarkdownFileReferences(tree);
        expect(tree.children[0].type).toBe("inlineCode");
        expect(tree.children[1].children[0].value).toBe("[[b]]");
    });
});
