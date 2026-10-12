// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 渲染链路测试：remark-frontmatter-to-waveblock + ReactMarkdown + waveblock components 委托。
// 验证：frontmatter 区域被替换为 waveblock 占位（不泄露 YAML 纯文本）、正文保留、
// 无 frontmatter 时零改动、blockkey 传给渲染委托。

import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkFrontmatterToWaveBlock from "./frontmatter-to-waveblock";

type RenderOpts = { startLine: number; endLine: number; blockKey: string };

/**
 * 模拟 markdown.tsx 的实际用法：remarkPlugins 数组用 PluggableList 的[插件, 参数]元组形式，
 * 由 ReactMarkdown 原样传给 unified（而非手动调用 transformer）。回归：曾 push 调用结果导致
 * unified 把 transformer 当插件无参调用 → tree undefined → reading 'children' 崩溃。
 */
function renderLikeApp(md: string, opts: RenderOpts, contentOverride?: string): string {
    const components = {
        waveblock: (props: any) => (
            <div className="waveblock-rendered" data-blockkey={props.blockkey}>
                [props:{props.blockkey}]
            </div>
        ),
    };
    return renderToStaticMarkup(
        <ReactMarkdown remarkPlugins={[remarkGfm, [remarkFrontmatterToWaveBlock, opts]]} components={components}>
            {md}
        </ReactMarkdown>
    );
}

function render(md: string, opts: RenderOpts): string {
    const plugin = () => (tree: any) => {
        remarkFrontmatterToWaveBlock(opts)(tree);
    };
    const components = {
        waveblock: (props: any) => (
            <div className="waveblock-rendered" data-blockkey={props.blockkey}>
                [props:{props.blockkey}]
            </div>
        ),
    };
    return renderToStaticMarkup(
        <ReactMarkdown remarkPlugins={[remarkGfm, plugin]} components={components}>
            {md}
        </ReactMarkdown>
    );
}

describe("frontmatter-to-waveblock render pipeline", () => {
    it("REGRESSION: PluggableList tuple form (as used by markdown.tsx) does not crash", () => {
        // 与 markdown.tsx 实际用法一致：push [插件, 参数] 元组。
        // 曾 push 调用结果 → unified 把 transformer 当插件无参调用 → tree undefined 崩溃。
        const md = ["---", "title: Hello", "tags: [a, b]", "---", "", "Body text here."].join("\n");
        let out: string | null = null;
        expect(() => {
            out = renderLikeApp(md, { startLine: 1, endLine: 4, blockKey: "obsidian-props[fm]" });
        }).not.toThrow();
        expect(out).toContain('data-blockkey="obsidian-props[fm]"');
        expect(out).not.toContain("title: Hello");
    });

    it("replaces the frontmatter with the delegated component and keeps the body", () => {
        const md = ["---", "title: Hello", "tags: [a, b]", "---", "", "Body text here."].join("\n");
        const html = render(md, { startLine: 1, endLine: 4, blockKey: "obsidian-props[fm]" });

        // 属性卡片占位渲染
        expect(html).toContain('class="waveblock-rendered"');
        expect(html).toContain('data-blockkey="obsidian-props[fm]"');
        expect(html).toContain("[props:obsidian-props[fm]]");
        // YAML 原文不泄露进渲染输出
        expect(html).not.toContain("title: Hello");
        expect(html).not.toContain("tags: [a, b]");
        // 正文保留
        expect(html).toContain("Body text here.");
    });

    it("keeps punctuation (hr) untouched when no frontmatter range is given", () => {
        // 行范围为空 → 插件 no-op：--- 保持 GFM 的 <hr> 语义
        const html = render("---\nnot frontmatter\n---", { startLine: 9, endLine: 99, blockKey: "x" });
        expect(html).toContain("<hr");
        expect(html).not.toContain("waveblock-rendered");
        expect(html).toContain("not frontmatter");
    });

    it("CRLF input still collapses the same range", () => {
        const md = "---\r\ntitle: X\r\n---\r\n\r\nBody.";
        const html = render(md, { startLine: 1, endLine: 3, blockKey: "k" });
        expect(html).toContain('data-blockkey="k"');
        expect(html).not.toContain("title: X");
        expect(html).toContain("Body.");
    });
});