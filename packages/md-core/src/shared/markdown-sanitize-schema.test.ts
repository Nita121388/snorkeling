// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// sanitize schema 的「同名属性只取第一条」陷阱回归测试。
//
// 背景（真实事故）：hast-util-sanitize 的 findDefinition 对同一 tag 的同一个属性名
// **只取第一条**定义（lib/index.js:744），后面的 ["className", …] 条目整条被忽略。
// schema 里 span 曾写三条 className，第一条是 /^hljs-./，于是
// `markdown-alert-title-text`（10-08 的 callout 竖排修复所依赖的 class）被静默剥成
// class=""，CSS 的 flex/min-width 从未落到 DOM —— 竖排 bug 实际没修掉。
// 当时的单测用「镜像 schema」，顺序与真实 schema 不同，所以漏了。
//
// 这里直接 import 真实 schema，任何「再加一条 ["className", …]」的写法都会在这里失败。

import { unified } from "unified";
import rehypeSanitize from "rehype-sanitize";
import { describe, expect, it } from "vitest";
import { makeMarkdownSanitizeSchema } from "./markdown-sanitize-schema";

function sanitize(children: any[]): any {
    const tree = { type: "root", children };
    return unified().use(rehypeSanitize, makeMarkdownSanitizeSchema()).runSync(tree as any);
}

function classesOf(node: any): string[] {
    const value = node?.properties?.className;
    if (value == null) return [];
    return Array.isArray(value) ? value : [String(value)];
}

describe("sanitize schema — 同名属性只取第一条的陷阱", () => {
    it("span.markdown-alert-title-text 必须活下来（10-08 竖排修复的命脉）", () => {
        const out: any = sanitize([
            { type: "element", tagName: "span", properties: { className: ["markdown-alert-title-text"] }, children: [] },
        ]);
        expect(classesOf(out.children[0])).toEqual(["markdown-alert-title-text"]);
    });

    it("span 的 hljs- 高亮 class 仍然保留（合并成一条后不能丢）", () => {
        const out: any = sanitize([
            { type: "element", tagName: "span", properties: { className: ["hljs-number", "hljs-title"] }, children: [] },
        ]);
        expect(classesOf(out.children[0])).toEqual(["hljs-number", "hljs-title"]);
    });

    it("span 上非白名单 class 仍被剥掉（负向对照，证明不是「全放行」）", () => {
        const out: any = sanitize([
            { type: "element", tagName: "span", properties: { className: ["markdown-alert-title-text", "evil"] }, children: [] },
        ]);
        expect(classesOf(out.children[0])).toEqual(["markdown-alert-title-text"]);
    });

    it("button 的 markdown-alert-emoji-btn 与 is-empty 都要保留", () => {
        const out: any = sanitize([
            {
                type: "element",
                tagName: "button",
                properties: { className: ["markdown-alert-emoji-btn", "is-empty"], type: "button" },
                children: [],
            },
        ]);
        expect(classesOf(out.children[0])).toEqual(["markdown-alert-emoji-btn", "is-empty"]);
    });

    it("calloutalert 自定义 tag 与其 markdown-alert* class 不被剥离", () => {
        const out: any = sanitize([
            {
                type: "element",
                tagName: "calloutalert",
                properties: { className: ["markdown-alert", "markdown-alert-note"] },
                children: [],
            },
        ]);
        expect(out.children[0].tagName).toBe("calloutalert");
        expect(classesOf(out.children[0])).toEqual(["markdown-alert", "markdown-alert-note"]);
    });
});
