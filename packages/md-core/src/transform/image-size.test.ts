// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * 图片尺寸语法：解析 / 序列化 / 往返（10-12 image-block · 切片 1 · 验收第 3 类「往返」）。
 *
 * 覆盖三种写法：
 *   A. `![alt|WxH](path)`      ← Obsidian 约定（**只写这一种**）
 *   B. `![alt](path =WxH)`     ← 历史自研（只读兼容）
 *   C. `![alt](path)`          ← 纯图片
 *
 * 三条不变量：
 *   ① **序列化可被自己重新解析**（`parse ∘ serialize = id`，逐形态断言）；
 *   ② 序列化产出必须能被 **remark** 读成 `image` 节点（尺寸只落在 alt，绝不进目的地）；
 *   ③ **降级铁律**：尺寸坏 → 丢掉尺寸，绝不丢图（目的地保持可解析）。
 */

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { describe, expect, it } from "vitest";
import {
    formatImageSize,
    makeImageFragmentRe,
    parseImageFragment,
    parseImageSize,
    serializeImageFragment,
} from "./image-size";
import {
    editImageSyntaxInFullText,
    removeImageSizeInLine,
    replaceImageSrcInLine,
    updateImageAltInLine,
    updateImageSizeInLine,
} from "../shared/markdown-util";

/** 真实 remark 解析出的图片节点（我们不假装知道解析器怎么读，直接问它）。 */
function remarkImages(md: string): Array<{ url: string; alt: string; title: string | null }> {
    const tree: any = unified().use(remarkParse).use(remarkGfm).parse(md);
    const out: Array<{ url: string; alt: string; title: string | null }> = [];
    const walk = (node: any) => {
        if (node.type === "image") {
            out.push({ url: node.url, alt: node.alt, title: node.title ?? null });
        }
        for (const child of node.children ?? []) {
            walk(child);
        }
    };
    walk(tree);
    return out;
}

/** 组件里的写盘路径：改某一行的尺寸（与 image.tsx 的 commitImageSize 同源）。 */
function writeSize(full: string, line: number, src: string, w: number, h: number): string | null {
    return editImageSyntaxInFullText(full, line, (lineText) => updateImageSizeInLine(lineText, src, w, h));
}

describe("parseImageSize：三种写法都认（读）", () => {
    it("纯图片 → 无尺寸，src 原样", () => {
        expect(parseImageSize("assets/cat.png", "cat")).toEqual({
            src: "assets/cat.png",
            alt: "cat",
            width: null,
            height: null,
            sizeSyntax: null,
        });
    });

    it("Obsidian 约定（alt 携带尺寸，首选）", () => {
        expect(parseImageSize("assets/cat.png", "cat|300x200")).toEqual({
            src: "assets/cat.png",
            alt: "cat",
            width: 300,
            height: 200,
            sizeSyntax: "alt",
        });
    });

    it("历史自研（src 后缀，只读兼容）", () => {
        expect(parseImageSize("assets/cat.png =300x200", "cat")).toEqual({
            src: "assets/cat.png",
            alt: "cat",
            width: 300,
            height: 200,
            sizeSyntax: "legacy-src",
        });
    });

    it("只写宽度：`alt|300` / `src =300`", () => {
        expect(parseImageSize("p.png", "a|300")).toMatchObject({ width: 300, height: null, sizeSyntax: "alt" });
        expect(parseImageSize("p.png =300", "a")).toMatchObject({ width: 300, height: null, sizeSyntax: "legacy-src" });
    });

    it("alt 自带 `|` 时取最后一个（Obsidian 约定：尺寸在最后一段）", () => {
        expect(parseImageSize("p.png", "before|after|120x80")).toMatchObject({
            alt: "before|after",
            width: 120,
            height: 80,
        });
    });

    it("尺寸数值无效（0 / 非数字）→ 尺寸视为无，路径保持干净", () => {
        expect(parseImageSize("p.png", "a|0x0")).toMatchObject({ alt: "a", width: null, height: null, sizeSyntax: "alt" });
        // `=abc` 不是尺寸形状 → 不当作尺寸（地址原样保留，交给宿主解析失败提示）
        expect(parseImageSize("p.png =abc", "a")).toMatchObject({ src: "p.png =abc", width: null, height: null });
        // `alt|abc` 是合法 alt（含竖线），不得被当成尺寸语法吃掉
        expect(parseImageSize("p.png", "a|abc")).toMatchObject({ alt: "a|abc", width: null, height: null });
    });

    it("null/undefined 输入不抛", () => {
        expect(parseImageSize(null, null)).toMatchObject({ src: "", alt: "", width: null, height: null });
    });
});

describe("parseImageFragment：单个片段的完整解析", () => {
    it("三种写法 + 标题", () => {
        expect(parseImageFragment("![cat](assets/cat.png)")).toMatchObject({
            src: "assets/cat.png",
            alt: "cat",
            title: null,
            width: null,
            height: null,
        });
        expect(parseImageFragment("![cat|300x200](assets/cat.png)")).toMatchObject({
            alt: "cat",
            width: 300,
            height: 200,
            sizeSyntax: "alt",
        });
        expect(parseImageFragment("![cat](assets/cat.png =300x200)")).toMatchObject({
            alt: "cat",
            width: 300,
            height: 200,
            sizeSyntax: "legacy-src",
        });
        expect(parseImageFragment('![cat](assets/cat.png =300x200 "A cat")')).toMatchObject({
            alt: "cat",
            title: "A cat",
            width: 300,
            height: 200,
            sizeSyntax: "legacy-src",
        });
    });

    it("尖括号目的地（含空白）", () => {
        expect(parseImageFragment("![cat](<my cat.png>)")).toMatchObject({ src: "my cat.png", alt: "cat" });
    });

    it("alt 里的 `]` 转义可逆", () => {
        expect(parseImageFragment("![a\\]b](p.png)")).toMatchObject({ alt: "a]b", src: "p.png" });
    });

    it("不是图片片段 → null", () => {
        expect(parseImageFragment("see ![cat](p.png) here")).toBeNull();
        expect(parseImageFragment("[cat](p.png)")).toBeNull();
        expect(parseImageFragment("![unclosed(p.png)")).toBeNull();
    });
});

describe("formatImageSize：Obsidian 约定后缀", () => {
    it("宽高 / 只宽 / 无", () => {
        expect(formatImageSize(300, 200)).toBe("300x200");
        expect(formatImageSize(300, null)).toBe("300");
        expect(formatImageSize(null, null)).toBeNull();
        expect(formatImageSize(0, 0)).toBeNull();
        // 只有高度无法用 Obsidian 约定表达 → 丢尺寸（宁丢尺寸，绝不写坏语法）
        expect(formatImageSize(null, 200)).toBeNull();
    });

    it("浮点取整", () => {
        expect(formatImageSize(300.4, 199.6)).toBe("300x200");
    });
});

describe("序列化不变量 ①：parse ∘ serialize = id（三种写法逐形态）", () => {
    const cases: Array<[string, Record<string, unknown>]> = [
        ["纯图片", { alt: "cat", src: "assets/cat.png", width: null, height: null }],
        ["宽高", { alt: "cat", src: "assets/cat.png", width: 300, height: 200 }],
        ["只宽", { alt: "cat", src: "assets/cat.png", width: 300, height: null }],
        ["标题", { alt: "cat", src: "assets/cat.png", title: "A cat", width: 300, height: 200 }],
        ["空 alt", { alt: "", src: "assets/cat.png", width: 10, height: 20 }],
        ["alt 含 `]`", { alt: "a]b", src: "assets/cat.png", width: 10, height: 20 }],
        ["alt 含 `|`", { alt: "a|b", src: "assets/cat.png", width: 10, height: 20 }],
        ["路径含空格", { alt: "cat", src: "my cat.png", width: 10, height: 20 }],
        ["路径括号不平衡", { alt: "cat", src: "img(1.png", width: 10, height: 20 }],
    ];

    for (const [name, parts] of cases) {
        it(`${name}：序列化 → 重新解析回同值`, () => {
            const text = serializeImageFragment(parts as any);
            const back = parseImageFragment(text);
            expect(back).not.toBeNull();
            expect({
                alt: back!.alt,
                src: back!.src,
                title: back!.title,
                width: back!.width,
                height: back!.height,
            }).toEqual({
                alt: parts.alt ?? "",
                src: parts.src,
                title: (parts.title as string) ?? null,
                width: parts.width,
                height: parts.height,
            });
        });
    }
});

describe("序列化不变量 ②：产出必须能被 remark 读成图片节点", () => {
    const cases: Array<[string, Record<string, unknown>]> = [
        ["纯", { alt: "cat", src: "assets/cat.png" }],
        ["宽高（Obsidian）", { alt: "cat", src: "assets/cat.png", width: 300, height: 200 }],
        ["标题", { alt: "cat", src: "assets/cat.png", title: "A cat", width: 300, height: 200 }],
        ["路径含空格", { alt: "cat", src: "my cat.png", width: 300, height: 200 }],
        ["路径括号不平衡", { alt: "cat", src: "img(1.png", width: 300, height: 200 }],
        ["alt 含 `]`", { alt: "a]b", src: "p.png" }],
    ];

    for (const [name, parts] of cases) {
        it(`${name}：remark 读到 1 个 image 节点，且尺寸不在目的地里`, () => {
            const text = serializeImageFragment(parts as any);
            const images = remarkImages(text);
            expect(images).toHaveLength(1);
            expect(images[0].url).toBe(parts.src);
            // 尺寸绝不进目的地（进了就说明又写回了「图消失」的形态）。
            expect(images[0].url).not.toContain("=");
            const reparsed = parseImageFragment(text);
            expect(reparsed!.width).toBe((parts.width as number) ?? null);
        });
    }

    it("历史写法 `![a](p =300x200)` 是 remark 读不到的（事故根因，作为对照）", () => {
        expect(remarkImages("![a](p.png =300x200)")).toHaveLength(0);
        expect(remarkImages("![a|300x200](p.png)")).toHaveLength(1);
    });
});

describe("写路径：只写 Obsidian 约定（不再产生 `=WxH`）", () => {
    it("三种读入形态，尺寸写回都是 `![alt|WxH](path)`", () => {
        const expected = "![cat|300x200](assets/cat.png)";
        expect(updateImageSizeInLine("![cat](assets/cat.png)", "assets/cat.png", 300, 200)).toBe(expected);
        expect(updateImageSizeInLine("![cat|10x20](assets/cat.png)", "assets/cat.png", 300, 200)).toBe(expected);
        expect(updateImageSizeInLine("![cat](assets/cat.png =10x20)", "assets/cat.png", 300, 200)).toBe(expected);
    });

    it("写回结果能被 remark 读成图片（写盘 → 重开不丢图）", () => {
        const written = updateImageSizeInLine("![cat](assets/cat.png)", "assets/cat.png", 300, 200)!;
        expect(remarkImages(written)).toEqual([{ url: "assets/cat.png", alt: "cat|300x200", title: null }]);
    });

    it("保留标题", () => {
        expect(updateImageSizeInLine('![cat](a.png "T")', "a.png", 300, 200)).toBe('![cat|300x200](a.png "T")');
        // 历史形态（尺寸写在目的地）也收敛到 Obsidian 约定，标题不丢
        expect(updateImageSizeInLine('![cat](a.png =10x20 "T")', "a.png", 300, 200)).toBe(
            '![cat|300x200](a.png "T")'
        );
    });

    it("未命中的 src → null（调用方跳过提交）", () => {
        expect(updateImageSizeInLine("![cat](a.png)", "b.png", 300, 200)).toBeNull();
    });

    it("去掉尺寸：两种写法都能清", () => {
        expect(removeImageSizeInLine("![cat|300x200](a.png)", "a.png")).toBe("![cat](a.png)");
        expect(removeImageSizeInLine("![cat](a.png =300x200)", "a.png")).toBe("![cat](a.png)");
        expect(removeImageSizeInLine("![cat](a.png)", "a.png")).toBeNull();
    });

    it("改题注保留尺寸（改说明文字不该丢尺寸）", () => {
        expect(updateImageAltInLine("![old|300x200](a.png)", "a.png", "new")).toBe("![new|300x200](a.png)");
        expect(updateImageAltInLine("![old](a.png =300x200)", "a.png", "new")).toBe("![new|300x200](a.png)");
    });

    it("改路径保留尺寸", () => {
        expect(replaceImageSrcInLine("![cat|300x200](a.png)", "a.png", "b.png")).toBe("![cat|300x200](b.png)");
        expect(replaceImageSrcInLine("![cat](a.png =300x200)", "a.png", "b.png")).toBe("![cat|300x200](b.png)");
    });
});

describe("往返：改尺寸只改尺寸，不重排全文", () => {
    const source = ["# title", "", "see ![cat](assets/cat.png) here", "", "![dog](dog.png)", "tail"].join("\n");

    it("只有目标行变化，其余逐字节相同", () => {
        const before = source.split("\n");
        const after = writeSize(source, 3, "assets/cat.png", 300, 200);
        expect(after).not.toBeNull();
        const lines = after!.split("\n");
        expect(lines).toHaveLength(before.length);
        for (let i = 0; i < before.length; i++) {
            if (i === 2) {
                continue;
            }
            expect(lines[i]).toBe(before[i]);
        }
        // 第 3 行：只有图片片段被规范化，行内其余文本逐字节保留。
        expect(lines[2]).toBe("see ![cat|300x200](assets/cat.png) here");
    });

    it("同一行多张图只改命中的那张", () => {
        const line = "![a](one.png) ![b](two.png)";
        expect(updateImageSizeInLine(line, "two.png", 50, 60)).toBe("![a](one.png) ![b|50x60](two.png)");
    });

    it("重复写同一尺寸是稳定的（幂等）", () => {
        const once = writeSize(source, 3, "assets/cat.png", 300, 200)!;
        const twice = writeSize(once, 3, "assets/cat.png", 300, 200)!;
        expect(twice).toBe(once);
    });

    it("历史形态的坏尺寸尾缀：吃掉尾缀、保住路径，写盘后是干净可解析的图片（数据级修复）", () => {
        // 读入坏语法 → 写尺寸：尾缀被吃掉（"=abc" 不是路径的一部分）→ 产出干净图片
        const written = updateImageSizeInLine("![cat](a.png =abc)", "a.png", 300, 200);
        expect(written).toBe("![cat|300x200](a.png)");
        expect(remarkImages(written!)).toHaveLength(1);
    });
});

describe("片段扫描器：一个正则覆盖尖括号 / 普通目的地", () => {
    it("一行里的多个片段都能扫到", () => {
        const line = '![a](one.png) ![b|10x20](<two file.png>) text ![c](three.png "t")';
        const re = makeImageFragmentRe();
        const found: string[] = [];
        let m: RegExpExecArray | null;
        while ((m = re.exec(line)) != null) {
            found.push(m[0]);
        }
        expect(found).toEqual(["![a](one.png)", "![b|10x20](<two file.png>)", '![c](three.png "t")']);
    });
});
