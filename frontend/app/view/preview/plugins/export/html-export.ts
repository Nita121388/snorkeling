// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import rehypeHighlight from "rehype-highlight";
import { makeRemarkPlugins } from "@/app/element/remark";
import { transformBlocks } from "@/app/element/markdown-util";
import { findFrontmatterSpan, parseFrontmatterProperties } from "@/app/element/markdown-transform/doc-meta";
import type { PreviewMatchContext } from "@/app/view/preview/preview-plugin-registry";
import type { ExportOptions, SerializedExport } from "./export-provider";

/**
 * Extract the YAML frontmatter region (between the leading `---` fences) from the source, keeping
 * the fence markers so callers can decide to strip or wrap them. Returns `null` when the document
 * doesn't start with a well-formed frontmatter block.
 */
export function findFrontmatterRange(text: string): { startLine: number; endLine: number } | null {
    const span = findFrontmatterSpan(text);
    if (span == null) return null;
    return { startLine: span.start, endLine: span.end };
}

/**
 * Strip the leading YAML frontmatter from the source (fences included). When `includeFrontmatter`
 * is true the text is returned unchanged; otherwise the frontmatter region is removed.
 */
export function stripFrontmatter(text: string, includeFrontmatter: boolean): string {
    if (includeFrontmatter) return text;
    const span = findFrontmatterSpan(text);
    if (span == null) return text;
    const lines = text.split(/\r?\n/);
    // Remove lines [start, end] inclusive (the two `---` fences plus everything between).
    return lines.filter((_, i) => i < span.start || i > span.end).join("\n");
}

/**
 * Converts a markdown file path reference to an absolute URL usable in a standalone HTML file.
 * Guards the well-known `data:`/`http(s):`/`wave:` schemes; local/relative paths are kept as-is
 * (the browser will resolve them relative to the saved file). Returns the original value when it
 * can't be resolved confidently.
 */
export function resolveMarkdownUrl(value: string): string {
    if (!value || value.startsWith("#")) return value;
    const lower = value.toLowerCase();
    if (/^(data:|https?:|mailto:|tel:|wave:|file:|ftp:)/.test(lower)) return value;
    return value;
}

/**
 * The built-in exporter for static, self-contained HTML. Renders the markdown through the same
 * remark plugin chain the preview uses (mermaid→tag, GFM, blank spacers, loose-list spacing,
 * content blocks) via a unified pipeline, then wraps the result in a standalone HTML document.
 * Reuses only the *parse* chain — no React runtime, no DOM rendering — so it is trivially
 * testable and safe to run in a worker / headless context.
 */
export async function markdownToHtml(source: string, options: ExportOptions, _context: PreviewMatchContext): Promise<string> {
    const cleanSource = stripFrontmatter(source, options.includeFrontmatter);
    const { content } = transformBlocks(cleanSource);
    const rendered = await unified()
        .use(remarkParse)
        .use(makeRemarkPlugins({ contentBlocksMap: new Map() }))
        .use(remarkRehype, { allowDangerousHtml: true })
        .use(rehypeHighlight)
        .use(rehypeStringify, { allowDangerousHtml: true })
        .process(content);
    return wrapDocument(String(rendered), options, source);
}

/**
 * Wrap rendered markdown body in a standalone HTML document with embedded styling. Keeps the
 * output self-contained (a single file openable in any browser). `options.darkTheme` toggles the
 * embedded color palette; `options.includeToc` prepends a lightweight table of contents.
 */
export function wrapDocument(body: string, options: ExportOptions, source: string): string {
    const tocHtml = options.includeToc ? buildTocHtml(source) : "";
    const theme = options.darkTheme ? DARK_CSS : LIGHT_CSS;
    const lang = "zh-CN";
    return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title></title>
<style>
${MARKDOWN_CSS}
${theme}
</style>
</head>
<body>
<article class="markdown-export">${tocHtml}${body}</article>
</body>
</html>
`;
}

/**
 * Build a simple table-of-contents from heading lines. Anchors are derived the same way
 * rehype-slug would (kebab-cased text); enough for navigation in the exported file.
 */
export function buildTocHtml(source: string): string {
    const lines = source.split(/\r?\n/);
    const entries: { level: number; text: string; id: string }[] = [];
    for (const line of lines) {
        const m = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
        if (m == null) continue;
        const level = m[1].length;
        const text = m[2].trim();
        entries.push({ level, text, id: slugify(text) });
    }
    if (entries.length === 0) return "";
    const items = entries
        .map((e) => `<li class="toc-l${e.level}"><a href="#${e.id}">${escapeHtml(e.text)}</a></li>`)
        .join("\n");
    return `<nav class="markdown-toc"><h1>目录</h1><ul>${items}</ul></nav>`;
}

/** Derive a stable kebab-case slug from heading text (mirrors rehype-slug defaults). */
function slugify(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^\w\u4e00-\u9fa5\- ]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
}

function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Serialize exported HTML as a byte buffer for file save / print-to-pdf. */
export function serializeHtml(html: string): SerializedExport {
    return {
        data: new TextEncoder().encode(html),
        extension: "html",
        mimeType: "text/html; charset=utf-8",
    };
}

const MARKDOWN_CSS = `
* { box-sizing: border-box; }
.markdown-export { max-width: 880px; margin: 0 auto; padding: 32px 24px; line-height: 1.65; font-size: 16px; }
.markdown-export h1, .markdown-export h2, .markdown-export h3, .markdown-export h4 { line-height: 1.3; margin: 1.4em 0 0.6em; }
.markdown-export p { margin: 0.6em 0; }
.markdown-export code { padding: 0.15em 0.35em; border-radius: 4px; font-size: 0.9em; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
.markdown-export pre { padding: 14px 16px; border-radius: 8px; overflow: auto; }
.markdown-export pre code { background: transparent; padding: 0; }
.markdown-export blockquote { margin: 0.8em 0; padding: 0.2em 1em; border-left: 4px solid #8884; }
.markdown-export table { border-collapse: collapse; width: 100%; margin: 1em 0; }
.markdown-export th, .markdown-export td { border: 1px solid; padding: 6px 10px; text-align: left; }
.markdown-export img { max-width: 100%; }
.markdown-export a { text-decoration: underline; }
.markdown-export ul, .markdown-export ol { padding-left: 1.6em; }
.markdown-toc { border-bottom: 1px solid; margin-bottom: 1.2em; padding-bottom: 0.6em; }
.markdown-toc ul { list-style: none; padding-left: 0; }
.markdown-toc li { margin: 0.15em 0; }
.markdown-toc .toc-l2 { padding-left: 1em; } .markdown-toc .toc-l3 { padding-left: 2em; }
.markdown-toc .toc-l4 { padding-left: 3em; } .markdown-toc .toc-l5 { padding-left: 4em; } .markdown-toc .toc-l6 { padding-left: 5em; }
`;

const LIGHT_CSS = `
body { background: #ffffff; color: #1a1a1a; }
.markdown-export code { background: #f4f4f5; }
.markdown-export pre { background: #f6f8fa; }
.markdown-export table th { background: #f4f4f5; }
.markdown-export blockquote { border-color: #d0d0d5; color: #444; }
`;

const DARK_CSS = `
body { background: #1e1e1e; color: #d4d4d4; }
.markdown-export code { background: #2d2d2d; }
.markdown-export pre { background: #252526; }
.markdown-export table th { background: #2d2d2d; }
.markdown-export blockquote { border-color: #3f3f46; color: #b0b0b0; }
`;