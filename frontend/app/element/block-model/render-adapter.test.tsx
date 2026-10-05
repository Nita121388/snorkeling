// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildBlockTree } from "../markdown-transform/tree";
import { BlockTreeRenderer } from "./render-adapter";

function renderMarkdown(src: string): string {
    const blocks = buildBlockTree(src.split("\n"));
    return renderToStaticMarkup(<BlockTreeRenderer blocks={blocks} />);
}

describe("BlockTreeRenderer — 块模型渲染适配器（P2-A2）", () => {
    it("标题块产出 h1，且携带块坐标 data 属性", () => {
        const html = renderMarkdown("# Title");
        expect(html).toContain("data-block-kind=\"heading1\"");
        expect(html).toContain("<h1>");
        expect(html).toContain("data-block-start=\"0\"");
        expect(html).toContain("Title");
    });

    it("段落块产出 p", () => {
        const html = renderMarkdown("some text");
        expect(html).toContain("data-block-kind=\"text\"");
        expect(html).toContain("<p>some text</p>");
    });

    it("列表组：每个顶层块独立渲染，坐标正确", () => {
        const html = renderMarkdown("- a\n- b");
        // 两个块
        expect(html.match(/data-block-kind="bulleted"/g)?.length).toBe(2);
        expect(html).toContain("data-block-start=\"0\"");
        expect(html).toContain("data-block-start=\"1\"");
        expect(html).toContain("<li>a</li>");
        expect(html).toContain("<li>b</li>");
    });

    it("代码块产出 code 围栏内容", () => {
        const html = renderMarkdown("```js\nconst x = 1;\n```");
        expect(html).toContain("data-block-kind=\"code\"");
        expect(html).toContain("const x = 1;");
    });

    it("表格块产出 table", () => {
        const html = renderMarkdown("| a | b |\n| --- | --- |\n| 1 | 2 |");
        expect(html).toContain("data-block-kind=\"table\"");
        expect(html).toContain("<table>");
        expect(html).toContain("<th>a</th>");
        expect(html).toContain("<td>1</td>");
    });

    it("分隔线产出 hr", () => {
        const html = renderMarkdown("a\n***\nb");
        expect(html).toContain("data-block-kind=\"hr\"");
        expect(html).toContain("<hr");
    });

    it("块 id 稳定且随块坐标变化", () => {
        const blocks = buildBlockTree("# A\n\n# B".split("\n"));
        const a = blocks[0];
        const b = blocks[1];
        expect(a.id).toBeTypeOf("string");
        expect(a.id).not.toBe(b.id);
        expect(a.id.length).toBeGreaterThan(0);
    });

    it("嵌套列表：父块含子块，渲染可见子项", () => {
        const blocks = buildBlockTree("- parent\n  - child a\n  - child b".split("\n"));
        expect(blocks).toHaveLength(1);
        expect(blocks[0].children).toHaveLength(2);
        const html = renderToStaticMarkup(<BlockTreeRenderer blocks={blocks} />);
        expect(html).toContain("child a");
        expect(html).toContain("child b");
    });
});
