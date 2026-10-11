// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom

// WYSIWYG seed normalization: the rendered tree collapses inter-element whitespace
// (`white-space: normal`) but the editor inherits `pre-wrap` from [contenteditable], so a
// whitespace-only text node between block elements becomes a full blank line. mdast-util-to-hast
// injects exactly such a "\n" between the items of a LOOSE list — the editor must not see it.

import { describe, expect, it } from "vitest";
import { captureWysiwygInfo, indentListDraft, isEmptyBlockShellDraft, isEmptyQuoteShellDraft } from "./markdown-inline-edit";

function mount(html: string): HTMLElement {
    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.appendChild(host);
    return host.firstElementChild as HTMLElement;
}

describe("captureWysiwygInfo — seed whitespace normalization", () => {
    it("drops the \\n text nodes a loose list carries between its items", () => {
        const el = mount(
            '<ul data-source-line="1" data-source-line-end="3">\n<li data-source-line="1">a</li>\n<li data-source-line="2">b</li>\n<li data-source-line="3">c</li>\n</ul>'
        );
        const info = captureWysiwygInfo("list", el, "- a\n\n- b\n\n- c");
        expect(info).not.toBeNull();
        expect(info!.html).not.toContain(">\n<");
        expect(info!.html).toBe(
            '<ul data-source-line="1" data-source-line-end="3"><li data-source-line="1">a</li><li data-source-line="2">b</li><li data-source-line="3">c</li></ul>'
        );
    });

    it("keeps meaningful inline whitespace inside a paragraph", () => {
        const el = mount('<div class="paragraph" data-source-line="1">hello <strong>world</strong></div>');
        const info = captureWysiwygInfo("p", el, "hello **world**");
        expect(info!.html).toBe("hello <strong>world</strong>");
    });

    it("keeps an intentional empty line inside a quote (bare > round-trip)", () => {
        const el = mount('<blockquote data-source-line="1"><p>before</p><p></p><p>after</p></blockquote>');
        const info = captureWysiwygInfo("quote", el, "> before\n>\n> after");
        expect(info!.html).toBe("<p>before</p><p></p><p>after</p>");
    });

    it("F4: strips the leading/trailing newlines a single-paragraph quote seed carries", () => {
        // Real render: <blockquote>\n<p>a</p>\n</blockquote>, so innerHTML is "\n<p>a</p>\n".
        // The old `/>\s+</` early-return required whitespace BETWEEN two tags and skipped
        // normalization entirely → the editor got a blank first/last line (extra bare ">").
        const el = mount('<blockquote data-source-line="1">\n<p>a</p>\n</blockquote>');
        expect(el.innerHTML).toBe("\n<p>a</p>\n");
        const info = captureWysiwygInfo("quote", el, "> a");
        expect(info!.html).toBe("<p>a</p>");
    });
});

describe("captureWysiwygInfo — list indent (F3)", () => {
    it("captures the source first line's leading indentation for an inner list", () => {
        const el = mount(
            '<ul data-source-line="2"><li data-source-line="2">b</li><li data-source-line="3">c</li></ul>'
        );
        // beginEdit passes the marker-stripped source: "  b\n  - c" (indent preserved by
        // stripListMarker), so the indent is read off the FIRST line.
        const info = captureWysiwygInfo("list", el, "  b\n  - c");
        expect(info!.listIndent).toBe("  ");
    });

    it("top-level lists capture an empty indent", () => {
        const el = mount('<ul data-source-line="1"><li data-source-line="1">a</li></ul>');
        expect(captureWysiwygInfo("list", el, "a")!.listIndent).toBe("");
    });

    it("round-trip: serializer output re-indented to the source's 2 spaces", () => {
        const serializedFromDom = "- b\n- c"; // serializeListDomToMarkdown always starts at depth 0
        expect(indentListDraft(serializedFromDom, "  ")).toBe("  - b\n  - c");
        expect(indentListDraft(serializedFromDom, "")).toBe(serializedFromDom);
        // Nested lines keep their own relative indent under the added prefix.
        expect(indentListDraft("- a\n  - b", "  ")).toBe("  - a\n    - b");
    });
});

describe("isEmptyQuoteShellDraft — data-loss guard", () => {
    it("detects the serializer output of an empty quote editor root", () => {
        expect(isEmptyQuoteShellDraft(">")).toBe(true);
        expect(isEmptyQuoteShellDraft(">\n>")).toBe(true);
        expect(isEmptyQuoteShellDraft(">\n\n>")).toBe(true);
    });

    it("does not treat real quote content as a shell", () => {
        expect(isEmptyQuoteShellDraft("> real text")).toBe(false);
        expect(isEmptyQuoteShellDraft("> [!NOTE] title\n>\n> body")).toBe(false);
    });

    it("leaves empty prose alone (clearing a paragraph is legitimate)", () => {
        expect(isEmptyQuoteShellDraft("")).toBe(false);
        expect(isEmptyQuoteShellDraft("   ")).toBe(false);
    });
});

describe("isEmptyBlockShellDraft — per-kind data-loss guard", () => {
    it("p/blank: an empty serialization is a shell", () => {
        expect(isEmptyBlockShellDraft("p", "")).toBe(true);
        expect(isEmptyBlockShellDraft("p", "   ")).toBe(true);
        expect(isEmptyBlockShellDraft("blank", "")).toBe(true);
        // Real prose is NOT a shell, and neither is a quote-formatted draft.
        expect(isEmptyBlockShellDraft("p", "> real")).toBe(false);
        expect(isEmptyBlockShellDraft("p", "text")).toBe(false);
    });

    it("code/table/hr also serialize to an empty string when the root is empty", () => {
        expect(isEmptyBlockShellDraft("code", "")).toBe(true);
        expect(isEmptyBlockShellDraft("table", "")).toBe(true);
        expect(isEmptyBlockShellDraft("hr", "")).toBe(true);
    });

    it("h: only a bare run of # is a shell", () => {
        expect(isEmptyBlockShellDraft("h", "#")).toBe(true);
        expect(isEmptyBlockShellDraft("h", "###")).toBe(true);
        expect(isEmptyBlockShellDraft("h", "### ")).toBe(true);
        expect(isEmptyBlockShellDraft("h", "### title")).toBe(false);
        expect(isEmptyBlockShellDraft("h", "")).toBe(false); // a heading never serializes to ""
    });

    it("quote: delegates to isEmptyQuoteShellDraft", () => {
        expect(isEmptyBlockShellDraft("quote", ">")).toBe(true);
        expect(isEmptyBlockShellDraft("quote", ">\n>")).toBe(true);
        expect(isEmptyBlockShellDraft("quote", "> real")).toBe(false);
        expect(isEmptyBlockShellDraft("quote", "")).toBe(false); // legitimate clear
    });

    it("list: empty or marker-only lines are shells", () => {
        expect(isEmptyBlockShellDraft("list", "")).toBe(true);
        expect(isEmptyBlockShellDraft("list", "- ")).toBe(true);
        expect(isEmptyBlockShellDraft("list", "1. ")).toBe(true);
        expect(isEmptyBlockShellDraft("list", "* ")).toBe(true);
        expect(isEmptyBlockShellDraft("list", "- [ ] ")).toBe(true);
        expect(isEmptyBlockShellDraft("list", "- \n- ")).toBe(true);
        // Indented marker-only (inner list) is still a shell.
        expect(isEmptyBlockShellDraft("list", "  - ")).toBe(true);
        // Real items are not.
        expect(isEmptyBlockShellDraft("list", "- item")).toBe(false);
        expect(isEmptyBlockShellDraft("list", "- item\n- ")).toBe(false);
    });
});
