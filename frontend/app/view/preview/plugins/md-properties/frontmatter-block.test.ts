// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    parseFrontmatterBlock,
    inferPropertyType,
    buildPropertyEntries,
} from "./frontmatter-block";

describe("parseFrontmatterBlock", () => {
    it("parses basic frontmatter between --- fences", () => {
        const md = [
            "---",
            "title: Hello",
            "tags: [a, b]",
            "---",
            "",
            "Body here.",
        ].join("\n");
        const fb = parseFrontmatterBlock(md);
        expect(fb).not.toBeNull();
        expect(fb!.startLine).toBe(1);
        expect(fb!.endLine).toBe(4);
        expect(fb!.data).toEqual({ title: "Hello", tags: ["a", "b"] });
    });

    it("returns null for files without frontmatter", () => {
        expect(parseFrontmatterBlock("Hello world")).toBeNull();
        expect(parseFrontmatterBlock("# heading\n\ntext")).toBeNull();
    });

    it("handles CRLF line endings", () => {
        const md = "---\r\ntitle: X\r\n---\r\n\r\nBody.";
        const fb = parseFrontmatterBlock(md);
        expect(fb).not.toBeNull();
        expect(fb!.startLine).toBe(1);
        expect(fb!.endLine).toBe(3);
    });

    it("supports --- and ... as end markers", () => {
        const fb1 = parseFrontmatterBlock("---\ntitle: A\n---\nBody");
        const fb2 = parseFrontmatterBlock("---\ntitle: B\n...\nBody");
        expect(fb1).not.toBeNull();
        expect(fb2).not.toBeNull();
        expect(fb1!.endLine).toBe(3);
        expect(fb2!.endLine).toBe(3);
    });

    it("skips false-ending inside multi-line YAML values", () => {
        const md = [
            "---",
            "code: |",
            "  ---",
            "  x",
            "---",
            "Body.",
        ].join("\n");
        const fb = parseFrontmatterBlock(md);
        expect(fb).not.toBeNull();
        expect(fb!.startLine).toBe(1);
        expect(fb!.endLine).toBe(5);
    });

    it("returns data {} for empty frontmatter (---\\n---)", () => {
        const fb = parseFrontmatterBlock("---\n---\nBody.");
        expect(fb).not.toBeNull();
        expect(fb!.data).toEqual({});
        expect(fb!.startLine).toBe(1);
        expect(fb!.endLine).toBe(2);
    });

    it("returns data {} for frontmatter with only comments", () => {
        const fb = parseFrontmatterBlock("---\n# just a comment\n---\nBody.");
        expect(fb).not.toBeNull();
        expect(fb!.data).toEqual({});
    });

    it("allows leading blank lines before frontmatter", () => {
        const md = "\n\n---\ntitle: X\n---\nBody.";
        const fb = parseFrontmatterBlock(md);
        expect(fb).not.toBeNull();
        expect(fb!.startLine).toBe(3);
        expect(fb!.endLine).toBe(5);
    });

    it("returns null for unclosed frontmatter", () => {
        const fb = parseFrontmatterBlock("---\ntitle: X\nBody.");
        expect(fb).toBeNull();
    });
});

describe("inferPropertyType", () => {
    it("infers boolean, number, string types", () => {
        expect(inferPropertyType("draft", true)).toBe("boolean");
        expect(inferPropertyType("score", 42)).toBe("number");
        expect(inferPropertyType("title", "hello")).toBe("text");
    });

    it("infers tag for #tag strings", () => {
        expect(inferPropertyType("myTag", "#coding")).toBe("tag");
    });

    it("infers link for [[wikilink]]", () => {
        expect(inferPropertyType("see", "[[Other Note]]")).toBe("link");
    });

    it("infers date/datetime from ISO strings", () => {
        expect(inferPropertyType("date", "2024-01-15")).toBe("date");
        expect(inferPropertyType("date", "2024-01-15T10:30:00")).toBe("datetime");
        expect(inferPropertyType("date", "2024-01-15 10:30:00+09:00")).toBe("datetime");
    });

    it("infers tags when all array elements are #tag strings", () => {
        expect(inferPropertyType("tags", ["#a", "#b"])).toBe("tags");
    });

    it("infers list for non-tag arrays", () => {
        expect(inferPropertyType("aliases", ["foo", "bar"])).toBe("list");
    });

    it("infers json for objects", () => {
        expect(inferPropertyType("meta", { nested: true })).toBe("json");
    });

    it("overrides with known key tables", () => {
        // publish key → boolean even when value is string (edge case, but key hint first)
        expect(inferPropertyType("publish", true)).toBe("boolean");
        expect(inferPropertyType("created", "2024-01-15")).toBe("date");
        expect(inferPropertyType("tags", ["#x"])).toBe("tags");
    });
});

describe("buildPropertyEntries", () => {
    it("skips null/undefined values", () => {
        const data = { a: "ok", b: null, c: undefined };
        const entries = buildPropertyEntries(data as any);
        expect(entries.map((e) => e.key)).toEqual(["a"]);
    });

    it("normalizes list values to string arrays", () => {
        const entries = buildPropertyEntries({ tags: ["#a", "#b"] });
        expect(entries[0].type).toBe("tags");
        expect(entries[0].value).toEqual(["#a", "#b"]);
    });

    it("wraps non-array list values", () => {
        const entries = buildPropertyEntries({ single: ["only-one"] });
        expect(entries[0].value).toEqual(["only-one"]);
    });
});