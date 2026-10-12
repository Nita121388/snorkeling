// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom

import { describe, expect, test } from "vitest";
import { escapeTableCellText, tableCellDomToMarkdown } from "./table-cell";

function cellFromHtml(inner: string): HTMLElement {
    const td = document.createElement("td");
    td.innerHTML = inner;
    return td;
}

describe("tableCellDomToMarkdown", () => {
    test("plain text round-trips", () => {
        expect(tableCellDomToMarkdown(cellFromHtml("hello"))).toBe("hello");
    });

    test("inline marks round-trip to markdown", () => {
        expect(tableCellDomToMarkdown(cellFromHtml("<strong>bold</strong> and <em>it</em>"))).toBe(
            "**bold** and *it*"
        );
        expect(tableCellDomToMarkdown(cellFromHtml("<code>x = 1</code>"))).toBe("`x = 1`");
        expect(tableCellDomToMarkdown(cellFromHtml("<del>gone</del>"))).toBe("~~gone~~");
    });

    test("empty mark elements leave no ghost markers", () => {
        expect(tableCellDomToMarkdown(cellFromHtml("a<strong></strong>b"))).toBe("ab");
    });

    test("links serialize with their href", () => {
        expect(tableCellDomToMarkdown(cellFromHtml('<a href="https://x.dev">site</a>'))).toBe(
            "[site](https://x.dev)"
        );
    });

    test("<br> and Enter-split divs become <br>", () => {
        expect(tableCellDomToMarkdown(cellFromHtml("line1<br>line2"))).toBe("line1<br>line2");
        expect(tableCellDomToMarkdown(cellFromHtml("<div>a</div><div>b</div>"))).toBe("a<br>b");
    });

    test("trailing breaks (Enter pressed once at the end) commit nothing", () => {
        expect(tableCellDomToMarkdown(cellFromHtml("abc<br>"))).toBe("abc");
        expect(tableCellDomToMarkdown(cellFromHtml("<div>abc</div><div><br></div>"))).toBe("abc");
    });

    test("pipes and newlines in pasted text are escaped/converted", () => {
        expect(tableCellDomToMarkdown(cellFromHtml("a | b"))).toBe("a \\| b");
    });

    test("pasted html is reduced to its safe text (script/style dropped)", () => {
        expect(
            tableCellDomToMarkdown(
                cellFromHtml('<span style="color:red">hi</span><script>alert(1)</script><style>x</style>')
            )
        ).toBe("hi");
    });

    test("code with a backtick upgrades its fence", () => {
        expect(tableCellDomToMarkdown(cellFromHtml("<code>a`b</code>"))).toBe("``a`b``");
    });

    test("unknown wrappers unwrap to their content", () => {
        expect(tableCellDomToMarkdown(cellFromHtml("<mark>keep</mark><kbd>K</kbd>"))).toBe("keepK");
    });
});

describe("escapeTableCellText", () => {
    test("escapes pipes and converts newlines", () => {
        expect(escapeTableCellText("a|b")).toBe("a\\|b");
        expect(escapeTableCellText("a\nb\rc")).toBe("a<br>b<br>c");
    });
});
