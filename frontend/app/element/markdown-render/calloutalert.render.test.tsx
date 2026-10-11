// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// R1 块身份渲染链路：remarkCalloutAlert → ReactMarkdown → rehype-sanitize → CalloutAlert。
// 验证：自定义 tag 未被 sanitize 剥离、`markdown-alert*` class 保留、
// renderer 注入 data-source-line / data-source-line-end（整块坐标）。

import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { makeMarkdownSanitizeSchema } from "../markdown-sanitize-schema";
import { remarkCalloutAlert } from "../remark/callout-alert";
import { CalloutAlert } from "./calloutalert";

// 真实 sanitize schema（不再维护「镜像 schema」）。本仓库吃过一次静默失效的教训：
// 镜像 schema 的条目顺序与真实 schema 不同，于是 span 上「同名 className 只取第一条」
// 导致 markdown-alert-title-text 被剥掉的事故在测试里完全测不出来。
// 任何新增/放宽属性都直接改 markdown-sanitize-schema.ts，这里 import 真货。
const schema = makeMarkdownSanitizeSchema();

function render(md: string): string {
    return renderToStaticMarkup(
        <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkCalloutAlert]}
            rehypePlugins={[[rehypeSanitize, schema]]}
            // custom element keys are not part of react-markdown's Components literal type
            components={{ calloutalert: CalloutAlert } as any}
        >
            {md}
        </ReactMarkdown>
    );
}

describe("calloutalert render pipeline (R1)", () => {
    it("keeps the custom tag + class through sanitize and injects source coordinates", () => {
        const html = render("> [!note] 标题\n>\n> 正文");
        expect(html).toContain("<calloutalert");
        expect(html).toContain("markdown-alert markdown-alert-note");
        // position 保留 → srcLineAttrs 产出整块坐标（start=1, end=3）
        expect(html).toContain('data-source-line="1"');
        expect(html).toContain('data-source-line-end="3"');
        // 标题/正文内容保留
        expect(html).toContain("标题");
        expect(html).toContain("正文");
    });

    it("plain quote also renders calloutalert (no marker invented) with coordinates", () => {
        const html = render("> 纯引用");
        expect(html).toContain("<calloutalert");
        expect(html).toContain("markdown-alert-quote");
        expect(html).toContain('data-source-line="1"');
        // 单行块没有 data-source-line-end（start === end 时省略）
        expect(html).not.toContain("data-source-line-end");
        expect(html).not.toContain("[!quote]");
    });
});
