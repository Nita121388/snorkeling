// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// callout/blockquote title flex 布局修复（P3 用户报：第一行 inline 元素成独立 flex item，
// 中文被压成竖排单字列）。断言方案 A 结构契约：title children = [button, span]。

import type { Root } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { describe, expect, it } from "vitest";
import { remarkCalloutAlert } from "./callout-alert";

function transform(md: string) {
    const processor = unified().use(remarkParse).use(remarkGfm).use(remarkCalloutAlert);
    const tree = processor.parse(md);
    const result = processor.runSync(tree) as Root;
    return result;
}

function getAlert(tree: Root): any | null {
    // 顶层 paragraph[data.hName=calloutalert.markdown-alert]（R1 块身份）
    return (
        (tree as any).children.find(
            (n: any) =>
                n?.data?.hName === "calloutalert" &&
                String(n?.data?.hProperties?.className ?? "").includes("markdown-alert")
        ) ?? null
    );
}

function getAlertTitle(tree: Root): any | null {
    const alert = getAlert(tree);
    if (alert == null) {
        return null;
    }
    return alert.children.find(
        (n: any) =>
            n?.data?.hName === "p" && String(n?.data?.hProperties?.className ?? "").includes("markdown-alert-title")
    );
}

describe("remarkCalloutAlert — R1 块身份（calloutalert + position）", () => {
    it("替换节点的 hName 为 calloutalert（沿用 waveblock 惯例）", () => {
        const tree = transform("> [!note] 标题");
        const alert = getAlert(tree);
        expect(alert).not.toBeNull();
        expect(alert.data.hName).toBe("calloutalert");
        // blockquote 自身也被替换掉，不再残留 <blockquote>
        expect((tree as any).children.some((n: any) => n?.data?.hName === "div")).toBe(false);
    });

    it("保留 blockquote 的 position（start + end 都在）", () => {
        const tree = transform("> [!note] 标题\n>\n> 正文");
        const alert = getAlert(tree);
        expect(alert.position?.start?.line).toBe(1);
        // end 覆盖整个 callout（多行正文一格编辑范围）
        expect(alert.position?.end?.line).toBe(3);
    });

    it("普通引用同样拿到 position（无标记也必须是可编辑块）", () => {
        const tree = transform("> 纯引用");
        const alert = getAlert(tree);
        expect(alert.data.hProperties.className).toContain("markdown-alert-quote");
        expect(alert.position?.start?.line).toBe(1);
        expect(alert.position?.end?.line).toBe(1);
    });
});

describe("remarkCalloutAlert — title 结构（flex 单容器契约）", () => {
    it("第一行含多个 inline 元素时：title = [button, span.markdown-alert-title-text]", () => {
        const tree = transform("> [!note] 一句话**加粗**结论");
        const title: any = getAlertTitle(tree);
        expect(title).not.toBeNull();
        // 方案 A 契约：emoji 按钮 + 文本 span（唯一非按钮 item）
        expect(title.children).toHaveLength(2);
        const [button, span] = title.children;
        expect(button?.data?.hName).toBe("button");
        expect(span?.data?.hName).toBe("span");
        expect(String(span?.data?.hProperties?.className ?? "")).toContain("markdown-alert-title-text");
        // span 内含原 inline children（文本 + strong）
        const textNodes = (span.children ?? []).filter((c: any) => c.type === "text");
        expect(textNodes.some((c: any) => (c.value ?? "").includes("一句话"))).toBe(true);
        const strongs = (span.children ?? []).filter((c: any) => c.type === "strong");
        expect(strongs.length).toBe(1);
    });

    it("空 title（只有 marker）时 span 为空、不生多余内容", () => {
        const tree = transform("> [!note]");
        const title: any = getAlertTitle(tree);
        expect(title).not.toBeNull();
        expect(title.children).toHaveLength(2);
        const [, span] = title.children;
        expect(span?.data?.hName).toBe("span");
        expect((span.children ?? []).filter((c: any) => c.type === "text" && c.value !== "")).toHaveLength(0);
    });

    it("emoji 按钮独立（无 emoji 时为空按钮但仍存在）", () => {
        const tree = transform("> 纯引用**重点**");
        const title: any = getAlertTitle(tree);
        expect(title).not.toBeNull();
        const [button, span] = title.children;
        expect(button?.data?.hName).toBe("button");
        // 无 emoji 时 button children 为空但按钮独立存在（hover 交互保留）
        expect(button?.children ?? []).toHaveLength(0);
        expect(span?.data?.hName).toBe("span");
    });

    it("正文（第二行起）不受影响：title 与后续段落分离", () => {
        const tree = transform("> [!note] 标题行**粗**\n>\n> 正文第一段");
        const alert = getAlert(tree);
        expect(alert).not.toBeNull();
        // children = [title, ...rest]
        expect(alert.children.length).toBeGreaterThan(1);
        const [title, ...rest] = alert.children;
        expect(String(title?.data?.hProperties?.className ?? "")).toContain("markdown-alert-title");
        // 后续段落不再是 title（无 markdown-alert-title class）
        for (const r of rest) {
            expect(String(r?.data?.hProperties?.className ?? "")).not.toContain("markdown-alert-title-text");
        }
    });
});
