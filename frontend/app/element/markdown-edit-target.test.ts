// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom

// D1: block-identity resolution for click/dblclick-to-edit.
//   - list items promote to the OWNING <ul>/<ol> (whole-list editing, valid HTML seed)

import { describe, expect, it } from "vitest";
import { resolveEditTargetFromElement } from "./markdown";

function mount(html: string): HTMLElement {
    const root = document.createElement("div");
    root.className = "markdown-render-root";
    root.innerHTML = html;
    document.body.appendChild(root);
    return root;
}

describe("resolveEditTargetFromElement — list promotion (D1)", () => {
    it("promotes a plain <li> click to its owning <ul> with the list's start line", () => {
        const root = mount(
            [
                '<ul data-source-line="1" data-source-line-end="3">',
                '  <li data-source-line="1">a</li>',
                '  <li data-source-line="2">b</li>',
                '  <li data-source-line="3">c</li>',
                "</ul>",
            ].join("")
        );
        const second = root.querySelectorAll("li")[1];
        const resolved = resolveEditTargetFromElement(second);
        expect(resolved).not.toBeNull();
        expect(resolved!.target.tagName).toBe("UL");
        expect(resolved!.line).toBe(1);
        expect(resolved!.blockKind).toBe("list");
    });

    it("promotes to <ol> too (ordered list)", () => {
        const root = mount(
            [
                '<ol data-source-line="10" data-source-line-end="11">',
                '  <li data-source-line="10">x</li>',
                '  <li data-source-line="11">y</li>',
                "</ol>",
            ].join("")
        );
        const resolved = resolveEditTargetFromElement(root.querySelectorAll("li")[0]);
        expect(resolved!.target.tagName).toBe("OL");
        expect(resolved!.line).toBe(10);
        expect(resolved!.blockKind).toBe("list");
    });

    it("promotes to the NEAREST owning list even when a sublist is present", () => {
        const root = mount(
            [
                '<ul data-source-line="1" data-source-line-end="4">',
                '  <li data-source-line="1">a',
                '    <ul data-source-line="2" data-source-line-end="3">',
                '      <li data-source-line="2">n1</li>',
                '      <li data-source-line="3">n2</li>',
                "    </ul>",
                "  </li>",
                "</ul>",
            ].join("")
        );
        const nested = root.querySelectorAll("li")[1];
        const resolved = resolveEditTargetFromElement(nested);
        expect(resolved!.target.tagName).toBe("UL");
        expect(resolved!.line).toBe(2);
    });
});

describe("resolveEditTargetFromElement — read-only image", () => {
    it("still returns null for an <img> click (read-only image)", () => {
        const root = mount('<p data-source-line="1"><img src="a.png" /></p>');
        expect(resolveEditTargetFromElement(root.querySelector("img") as HTMLElement)).toBeNull();
    });
});
