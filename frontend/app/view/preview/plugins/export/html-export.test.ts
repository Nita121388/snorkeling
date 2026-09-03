// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { markdownToHtml, stripFrontmatter, findFrontmatterRange, buildTocHtml, wrapDocument, serializeHtml } from "./html-export";
import { defaultExportOptions } from "./export-provider";
import type { PreviewMatchContext } from "@/app/view/preview/preview-plugin-registry";

const ctx: PreviewMatchContext = {
    fileInfo: null,
    mimeType: "text/markdown",
    fileName: "note.md",
    filePath: "/vault/note.md",
    editMode: false,
};

describe("findFrontmatterRange / stripFrontmatter", () => {
    it("detects a leading frontmatter block", () => {
        const text = "---\ntitle: X\ntags: [a]\n---\n\n# Body";
        expect(findFrontmatterRange(text)).toEqual({ startLine: 0, endLine: 3 });
    });

    it("returns null for text without frontmatter", () => {
        expect(findFrontmatterRange("# Hello")).toBeNull();
    });

    it("strips frontmatter when includeFrontmatter is false", () => {
        const text = "---\ntitle: X\n---\n\n# Body";
        expect(stripFrontmatter(text, false)).toBe("\n# Body");
    });

    it("keeps frontmatter when includeFrontmatter is true", () => {
        const text = "---\ntitle: X\n---\n\n# Body";
        expect(stripFrontmatter(text, true)).toBe(text);
    });
});

describe("buildTocHtml", () => {
    it("builds a TOC from headings", () => {
        const html = buildTocHtml("# One\n## Two\nSome text\n### Three");
        expect(html).toContain("目录");
        expect(html).toContain('href="#one"');
        expect(html).toContain('href="#two"');
        expect(html).toContain("toc-l1");
        expect(html).toContain("toc-l2");
    });

    it("returns empty for heading-less docs", () => {
        expect(buildTocHtml("just text")).toBe("");
    });
});

describe("markdownToHtml", () => {
    it("renders gfm table, code highlighting and headings into standalone html", async () => {
        const html = await markdownToHtml(
            "# 标题\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```js\nconst x = 1;\n```\n\n> 引用",
            defaultExportOptions,
            ctx
        );
        expect(html).toContain("<!doctype html>");
        expect(html).toContain("<article");
        expect(html).toContain("<h1");
        expect(html).toContain("<table");
        expect(html).toContain("<code");
        expect(html).toContain("hljs");
        expect(html).toContain("<blockquote");
    });

    it("strips frontmatter by default (includeFrontmatter false)", async () => {
        const html = await markdownToHtml("---\ntitle: X\n---\n\n# Body", { ...defaultExportOptions, includeFrontmatter: false }, ctx);
        expect(html).not.toContain("title: X");
    });

    it("keeps frontmatter text when includeFrontmatter true", async () => {
        const html = await markdownToHtml("---\ntitle: KeepMe\n---\n\n# Body", { ...defaultExportOptions, includeFrontmatter: true }, ctx);
        expect(html).toContain("KeepMe");
    });
});

describe("wrapDocument / serializeHtml", () => {
    it("wraps body in document with dark theme css when requested", () => {
        const html = wrapDocument("<p>hi</p>", { ...defaultExportOptions, darkTheme: true }, "# hi");
        expect(html).toContain("<article");
        expect(html).toContain("#1e1e1e");
    });

    it("serializes to a Uint8Array buffer with html extension", () => {
        const out = serializeHtml("<p>hi</p>");
        expect(out.extension).toBe("html");
        expect(out.mimeType).toContain("text/html");
        expect(out.data).toBeInstanceOf(Uint8Array);
        expect(new TextDecoder().decode(out.data)).toBe("<p>hi</p>");
    });
});
