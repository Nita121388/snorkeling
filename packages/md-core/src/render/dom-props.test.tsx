// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom

// D5: react-markdown's injected `node` object must never reach the DOM (`node="[object Object]"`).

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getMarkdownRenderer } from "./renderer-registry";
import { MarkdownListItem, MarkdownUnorderedList } from "./list";
import { CollapsibleTable } from "./table";
import { domProps } from "./shared";

const fakeNode = {
    type: "element",
    tagName: "p",
    position: { start: { line: 2, column: 1 }, end: { line: 2, column: 5 } },
};

describe("domProps", () => {
    it("strips the react-markdown node object and keeps the rest", () => {
        expect(domProps({ node: fakeNode, className: "x", children: "hi" })).toEqual({
            className: "x",
            children: "hi",
        });
    });
});

describe("renderers do not serialize the node attribute (D5)", () => {
    const cases: Array<[string, React.ReactNode]> = [
        [
            "ul",
            <MarkdownUnorderedList {...({ node: fakeNode, children: <li>a</li> } as any)} />,
        ],
        [
            "li",
            <MarkdownListItem
                props={{ node: fakeNode, children: "a" } as any}
                collapsed={false}
                onToggle={() => {}}
            />,
        ],
        [
            "table",
            <CollapsibleTable
                props={{ node: fakeNode, children: <tbody /> } as any}
                collapsed={false}
                onToggle={() => {}}
            />,
        ],
    ];

    for (const [name, node] of cases) {
        it(`${name}: no node="[object Object]"`, () => {
            const html = renderToStaticMarkup(node as any);
            expect(html).not.toContain("node=");
            expect(html).not.toContain("[object Object]");
        });
    }

    for (const key of ["p", "hr", "blockquote"]) {
        it(`registry ${key}: no node attribute`, () => {
            const spec = getMarkdownRenderer(key);
            expect(spec).toBeDefined();
            // `hr` is void: it must not receive children (React would reject it).
            const props: any =
                key === "hr" ? { node: fakeNode } : { node: fakeNode, className: "c", children: "x" };
            const rendered = spec!.render(props, {} as any);
            const html = renderToStaticMarkup(rendered as any);
            expect(html).not.toContain("node=");
            expect(html).not.toContain("[object Object]");
        });
    }
});
