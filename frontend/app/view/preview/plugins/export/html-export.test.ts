// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { PreviewMatchContext } from "@/app/view/preview/preview-plugin-registry";
import { describe, expect, it } from "vitest";
import { defaultExportOptions } from "./export-provider";
import {
    buildTocHtml,
    findFrontmatterRange,
    markdownToHtml,
    serializeHtml,
    stripFrontmatter,
    wrapDocument,
} from "./html-export";

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
        // 预览管线会把 `>` 引用转成 callout 块（不是裸 blockquote），导出沿用同一套渲染。
        expect(html).toContain("markdown-alert markdown-alert-quote");
        // 但静态导出**不能**带预览专用的交互控件：那个"加 emoji"按钮在导出的 HTML 里不可点。
        expect(html).not.toContain("markdown-alert-emoji-btn");
        expect(html).not.toContain("<button");
    });

    it("gives headings ids that exactly match the TOC anchors (incl. duplicate headings)", async () => {
        const source = "# 标题\n\n正文\n\n## Sub Title\n\n更多正文\n\n# 标题\n";
        const html = await markdownToHtml(source, { ...defaultExportOptions, includeToc: true }, ctx);
        const tocIds = [...html.matchAll(/<a href="#([^"]+)"/g)].map((m) => m[1]);
        const headingIds = [...html.matchAll(/<h[1-6] id="([^"]+)"/g)].map((m) => m[1]);
        // 目录锚点与标题 id 必须一一对应，否则导出文件里的目录是死链
        expect(tocIds.length).toBe(3);
        expect(headingIds).toEqual(tocIds);
        expect(tocIds[2]).toBe("标题-1"); // 重名标题走 github-slugger 的 -1 后缀
    });

    it("ignores headings inside fenced code blocks when building the TOC", () => {
        const toc = buildTocHtml("# 真标题\n\n```bash\n# 这不是标题\n```\n");
        expect(toc).toContain("真标题");
        expect(toc).not.toContain("这不是标题");
    });

    it("uses the export filename as the document title", async () => {
        const html = await markdownToHtml("# Hi", { ...defaultExportOptions, fileName: "notes/daily.md" }, ctx);
        expect(html).toContain("<title>daily</title>");
    });

    it("honors bodyOnly by returning just the article body (no doctype / styles)", async () => {
        const html = await markdownToHtml("# Hi", { ...defaultExportOptions, bodyOnly: true }, ctx);
        expect(html).not.toContain("<!doctype");
        expect(html).not.toContain("<style>");
        expect(html).toContain("<h1");
    });

    it("strips frontmatter by default (includeFrontmatter false)", async () => {
        const html = await markdownToHtml(
            "---\ntitle: X\n---\n\n# Body",
            { ...defaultExportOptions, includeFrontmatter: false },
            ctx
        );
        expect(html).not.toContain("title: X");
    });

    it("keeps frontmatter text when includeFrontmatter true", async () => {
        const html = await markdownToHtml(
            "---\ntitle: KeepMe\n---\n\n# Body",
            { ...defaultExportOptions, includeFrontmatter: true },
            ctx
        );
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
