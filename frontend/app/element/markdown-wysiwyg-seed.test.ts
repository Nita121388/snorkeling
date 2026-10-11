// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom

// WYSIWYG seed normalization: the rendered tree collapses inter-element whitespace
// (`white-space: normal`) but the editor inherits `pre-wrap` from [contenteditable], so a
// whitespace-only text node between block elements becomes a full blank line. mdast-util-to-hast
// injects exactly such a "\n" between the items of a LOOSE list — the editor must not see it.

import { describe, expect, it } from "vitest";
import { captureWysiwygInfo, isEmptyQuoteShellDraft } from "./markdown-inline-edit";

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
