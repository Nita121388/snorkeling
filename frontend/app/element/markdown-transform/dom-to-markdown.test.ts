// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom

import { describe, expect, test } from "vitest";
import {
    escapeTableCellText,
    tableCellDomToMarkdown,
    serializeInlineChildren,
    serializeBlockDomToMarkdown,
    serializeListDomToMarkdown,
} from "./dom-to-markdown";

// ---------------------------------------------------------------------------
// Shared inline serializer (used by table-cell + block-level)
// ---------------------------------------------------------------------------

function makeEl(html: string, tag = "div"): HTMLElement {
    const el = document.createElement(tag);
    el.innerHTML = html;
    return el;
}

describe("serializeInlineChildren", () => {
    test("plain text", () => {
        expect(serializeInlineChildren(makeEl("hello"))).toBe("hello");
    });

    test("inline marks round-trip", () => {
        expect(serializeInlineChildren(makeEl("<strong>bold</strong> and <em>it</em>"))).toBe(
            "**bold** and *it*"
        );
        expect(serializeInlineChildren(makeEl("<code>x = 1</code>"))).toBe("`x = 1`");
        expect(serializeInlineChildren(makeEl("<del>gone</del>"))).toBe("~~gone~~");
    });

    test("empty marks leave no ghost markers", () => {
        expect(serializeInlineChildren(makeEl("a<strong></strong>b"))).toBe("ab");
    });

    test("links serialize with their href", () => {
        expect(
            serializeInlineChildren(makeEl('<a href="https://x.dev">site</a>'))
        ).toBe("[site](https://x.dev)");
    });

    test("br defaults to newline", () => {
        expect(serializeInlineChildren(makeEl("line1<br>line2"))).toBe("line1\nline2");
    });

    test("div/p/li break to newline", () => {
        expect(serializeInlineChildren(makeEl("<div>a</div><div>b</div>"))).toBe("a\nb\n");
    });

    test("script/style are dropped", () => {
        expect(serializeInlineChildren(makeEl("a<script>alert(1)</script>b"))).toBe("ab");
    });

    test("unknown wrappers unwrap", () => {
        expect(serializeInlineChildren(makeEl("<span>x</span>"))).toBe("x");
    });
});

// ---------------------------------------------------------------------------
// table-cell compatibility (delegate to shared inline with cell opts)
// ---------------------------------------------------------------------------

function cellFromHtml(inner: string): HTMLElement {
    return makeEl(inner, "td");
}

describe("tableCellDomToMarkdown (via shared serializer)", () => {
    test("plain text round-trips", () => {
        expect(tableCellDomToMarkdown(cellFromHtml("hello"))).toBe("hello");
    });

    test("inline marks round-trip to markdown", () => {
        expect(
            tableCellDomToMarkdown(cellFromHtml("<strong>bold</strong> and <em>it</em>"))
        ).toBe("**bold** and *it*");
        expect(tableCellDomToMarkdown(cellFromHtml("<code>x = 1</code>"))).toBe("`x = 1`");
        expect(tableCellDomToMarkdown(cellFromHtml("<del>gone</del>"))).toBe("~~gone~~");
    });

    test("empty mark elements leave no ghost markers", () => {
        expect(tableCellDomToMarkdown(cellFromHtml("a<strong></strong>b"))).toBe("ab");
    });

    test("links serialize with their href", () => {
        expect(
            tableCellDomToMarkdown(cellFromHtml('<a href="https://x.dev">site</a>'))
        ).toBe("[site](https://x.dev)");
    });

    test("<br> and Enter-split divs become <br>", () => {
        expect(tableCellDomToMarkdown(cellFromHtml("line1<br>line2"))).toBe("line1<br>line2");
        expect(tableCellDomToMarkdown(cellFromHtml("<div>a</div><div>b</div>"))).toBe("a<br>b");
    });

    test("trailing breaks commit nothing", () => {
        expect(tableCellDomToMarkdown(cellFromHtml("abc<br>"))).toBe("abc");
        expect(tableCellDomToMarkdown(cellFromHtml("<div>abc</div><div><br></div>"))).toBe("abc");
    });

    test("pipes and newlines are escaped/converted", () => {
        expect(tableCellDomToMarkdown(cellFromHtml("a | b"))).toBe("a \\| b");
    });

    test("pasted html reduced to safe text", () => {
        const html = "plain <b>bold</b> <script>alert(1)</script><i>italic</i>";
        const result = tableCellDomToMarkdown(cellFromHtml(html));
        expect(result).toBe("plain **bold** *italic*");
    });

    test("code with backtick upgrades fence", () => {
        expect(tableCellDomToMarkdown(cellFromHtml("<code>`</code>"))).toBe("`` ` ``");
    });
});

// ---------------------------------------------------------------------------
// Block-level serializers
// ---------------------------------------------------------------------------

describe("serializeBlockDomToMarkdown — paragraph", () => {
    test("inline content", () => {
        const el = makeEl("some <strong>bold</strong> text");
        expect(serializeBlockDomToMarkdown(el, { kind: "p" })).toBe("some **bold** text");
    });

    test("trailing breaks stripped", () => {
        const el = makeEl("text<br><br>");
        expect(serializeBlockDomToMarkdown(el, { kind: "p" })).toBe("text");
    });
});

describe("serializeBlockDomToMarkdown — heading", () => {
    test("h1", () => {
        const el = makeEl("Title");
        expect(serializeBlockDomToMarkdown(el, { kind: "h", headingLevel: 1 })).toBe("# Title");
    });

    test("h3 with inline marks", () => {
        const el = makeEl("A <strong>bold</strong> title");
        expect(serializeBlockDomToMarkdown(el, { kind: "h", headingLevel: 3 })).toBe(
            "### A **bold** title"
        );
    });

    test("h6 empty", () => {
        const el = makeEl("");
        expect(serializeBlockDomToMarkdown(el, { kind: "h", headingLevel: 6 })).toBe("######");
    });
});

describe("serializeBlockDomToMarkdown — quote", () => {
    test("single line", () => {
        const el = makeEl("quoted text");
        expect(serializeBlockDomToMarkdown(el, { kind: "quote" })).toBe("> quoted text");
    });

    test("multi-line (from br)", () => {
        const el = makeEl("line 1<br>line 2");
        expect(serializeBlockDomToMarkdown(el, { kind: "quote" })).toBe("> line 1\n> line 2");
    });

    test("empty line gets bare >", () => {
        const el = makeEl("before<br><br>after");
        expect(serializeBlockDomToMarkdown(el, { kind: "quote" })).toBe(
            "> before\n>\n> after"
        );
    });
});

describe("serializeListDomToMarkdown", () => {
    function listEl(html: string, ordered = false, tag = ordered ? "ol" : "ul"): HTMLElement {
        return makeEl(html, tag);
    }

    test("bullet list", () => {
        const el = listEl("<li>apple</li><li>banana</li>");
        expect(serializeListDomToMarkdown(el, false, "-")).toBe("- apple\n- banana");
    });

    test("ordered list", () => {
        const el = listEl("<li>first</li><li>second</li>", true);
        expect(serializeListDomToMarkdown(el, true, "1.")).toBe("1. first\n2. second");
    });

    test("preserves original bullet marker", () => {
        const el = listEl("<li>one</li><li>two</li>");
        expect(serializeListDomToMarkdown(el, false, "*")).toBe("* one\n* two");
    });

    test("task list (unchecked)", () => {
        const el = listEl('<li><input type="checkbox"> task</li>');
        expect(serializeListDomToMarkdown(el, false, "-")).toBe("- [ ] task");
    });

    test("task list (checked)", () => {
        const el = listEl('<li><input type="checkbox" checked> done</li>');
        expect(serializeListDomToMarkdown(el, false, "-")).toBe("- [x] done");
    });

    test("nested list indents", () => {
        const el = listEl("<li>a<ul><li>b</li></ul></li>");
        expect(serializeListDomToMarkdown(el, false, "-")).toBe("- a\n  - b");
    });

    test("nested ordered list restarts at 1", () => {
        const el = listEl("<li>top<ol><li>child1</li><li>child2</li></ol></li>");
        expect(serializeListDomToMarkdown(el, false, "-")).toBe(
            "- top\n  1. child1\n  2. child2"
        );
    });
});

describe("serializeBlockDomToMarkdown — blank", () => {
    test("empty div", () => {
        const el = makeEl("");
        expect(serializeBlockDomToMarkdown(el, { kind: "blank" })).toBe("");
    });
});
