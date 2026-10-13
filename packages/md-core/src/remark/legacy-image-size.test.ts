// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * 历史自研尺寸语法 `![alt](path =WxH)` 的**读兼容**（10-12 image-block · 切片 1）。
 *
 * 不变量的实质是「**历史文件重开仍在**」：用户过去拖过尺寸的图片，源码里躺着
 * `![alt](path =WxH)`，而 remark 读它是**文本**（CommonMark 的普通目的地不得含空白）。
 * 本插件把它还原成 image 节点，于是老笔记里的图片重新出现（而非变成一行乱码）。
 *
 * 刻意收窄的边界也在这里被固定：含空白但没有 `=` 的 `![a](p q.png)`（CommonMark 眼里的
 * 字面文本）**不还原** —— 否则会把用户刻意写的文本变成图片。
 */

import { unified } from "unified";
import remarkParse from "remark-parse";
import { describe, expect, it } from "vitest";
import remarkLegacyImageSize from "./legacy-image-size";

/** 真实 remark 解析 → 本插件还原 → 结构快照（不做渲染，只看解析树）。 */
function repair(md: string): {
    images: Array<{ url: string; alt: string; title: string | null; line?: number }>;
    text: string;
} {
    // transformer 只在 runSync 里生效（`parse()` 单独调用不会跑插件）。
    const processor = unified().use(remarkParse).use(remarkLegacyImageSize);
    const parsed: any = processor.parse(md);
    processor.runSync(parsed);
    const images: Array<{ url: string; alt: string; title: string | null; line?: number }> = [];
    const texts: string[] = [];
    const walk = (node: any) => {
        if (node.type === "image") {
            images.push({ url: node.url, alt: node.alt, title: node.title ?? null, line: node.position?.start?.line });
        }
        if (node.type === "text") {
            texts.push(node.value);
        }
        for (const child of node.children ?? []) {
            walk(child);
        }
    };
    walk(parsed);
    return { images, text: texts.join("") };
}

describe("remarkLegacyImageSize：历史尺寸语法还原成图片节点", () => {
    it("合法尺寸：还原成图片并把尺寸落到 alt（Obsidian 形式）", () => {
        expect(repair("![cat](assets/cat.png =300x200)").images).toEqual([
            { url: "assets/cat.png", alt: "cat|300x200", title: null, line: 1 },
        ]);
    });

    it("只写宽度 / 带标题", () => {
        expect(repair("![cat](a.png =300)").images[0]).toMatchObject({ url: "a.png", alt: "cat|300" });
        expect(repair('![cat](a.png =300x200 "T")').images[0]).toMatchObject({
            url: "a.png",
            alt: "cat|300x200",
            title: "T",
        });
    });

    it("坏尺寸（`=abc` / `=0x0`）：丢尺寸、保住图（离得最近的可见结果不是乱码文本）", () => {
        expect(repair("![cat](a.png =abc)").images).toEqual([
            { url: "a.png", alt: "cat", title: null, line: 1 },
        ]);
        expect(repair("![cat](a.png =0x0)").images).toEqual([
            { url: "a.png", alt: "cat", title: null, line: 1 },
        ]);
    });

    it("行内混合文本：只替换图片片段，前后文本逐字节保留", () => {
        const r = repair("见 ![cat](a.png =300x200) 与 ![dog](b.png =10x20) 结束");
        expect(r.images.map((i) => i.url)).toEqual(["a.png", "b.png"]);
        expect(r.text).toBe("见  与  结束");
    });

    it("位置信息落在源码正确行（编辑路径靠它定位）", () => {
        const r = repair("# 标题\n\n正文\n\n![cat](a.png =300x200)\n\n尾");
        expect(r.images).toHaveLength(1);
        expect(r.images[0].line).toBe(5);
    });

    it("已经被 remark 读成图片的形式保持不动（不重复还原）", () => {
        expect(repair("![cat|300x200](a.png)").images).toEqual([
            { url: "a.png", alt: "cat|300x200", title: null, line: 1 },
        ]);
        expect(repair("![cat](a.png)").images).toEqual([{ url: "a.png", alt: "cat", title: null, line: 1 }]);
    });

    it("边界：含空白但无 `=` 的普通目的地不还原（那是 CommonMark 眼里的字面文本）", () => {
        expect(repair("![a](p q.png)").images).toHaveLength(0);
    });

    it("插件重复挂载幂等：还原出的图片节点不会再被改一遍", () => {
        // 同一条管线挂两次插件：第二次看到的已是 image 节点（没有 text 可改）。
        const processor = unified().use(remarkParse).use(remarkLegacyImageSize).use(remarkLegacyImageSize);
        const tree: any = processor.parse("![cat](a.png =300x200)");
        processor.runSync(tree);
        const images: any[] = [];
        const walk = (node: any) => {
            if (node.type === "image") {
                images.push(node);
            }
            for (const child of node.children ?? []) {
                walk(child);
            }
        };
        walk(tree);
        expect(images).toHaveLength(1);
        expect(images[0]).toMatchObject({ url: "a.png", alt: "cat|300x200" });
    });
});
