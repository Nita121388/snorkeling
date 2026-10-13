// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom

/**
 * 图片块渲染链路（10-12 image-block · 切片 1）
 * 验收第 1 类「渲染」+ 第 2 类「编辑」+ 第 3 类的渲染侧。
 *
 * ## 复现（先红，现在作为回归闸）
 * 历史写路径产出 `![alt](path =WxH)`。CommonMark 的**未加尖括号**的链接目的地不得含空白字符，
 * 于是 remark-parse 根本不把它当图片节点（产出 text 节点），渲染层拿不到 `<img>` ——
 * 用户调过尺寸的图片在重开笔记后**直接消失**（变成一行字面文本）。见下方 REPRO describe。
 *
 * 本文件用**真实管线**渲染（makeRemarkPlugins → rehype-sanitize → 渲染器注册表），
 * 不手写 HTML 字面量，也不 stub 渲染器。
 *
 * 关于「编辑态 ≡ 预览态 computed style」：jsdom 不加载 scss，因此分两层断言 ——
 *   ① 本文件：DOM 层不变量（`<img>` 的内联尺寸/类名/属性在编辑态与只读态逐字节相同；
 *      编辑态新增的只是**控件**，不是盒子几何）；
 *   ② `frontend/app/element/markdown-image-style.test.ts`：scss 层契约（编辑态围边用 outline，
 *      不含任何改变盒子的声明）。两层合起来才是「computed style 一致」的完整证据。
 */

import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { afterEach, describe, expect, it } from "vitest";
import { setMdHost } from "../core/host";
import { makeRemarkPlugins } from "../remark";
import { makeMarkdownSanitizeSchema } from "../shared/markdown-sanitize-schema";
import { editImageSyntaxInFullText, updateImageAltInLine, updateImageSizeInLine } from "../shared/markdown-util";
import { buildMarkdownComponents } from "./renderer-registry";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const RESOLVE_OPTS = { connName: "local", baseDir: "/ws" };

// 宿主能力打桩：图片 src 解析走 adapter（包内不得依赖宿主）。
setMdHost({
    resolveImageSrc: async (src: string | null | undefined) => (src == null || src === "" ? null : `stub:${src}`),
    resolveImageSrcSet: async () => null,
});

/** 一份最小但真实的渲染上下文（与 markdown.tsx 的 buildMarkdownComponents 入参同形）。 */
function makeCtx(md: string, editable: boolean): any {
    return {
        text: md,
        commitFullText: editable ? () => {} : undefined,
        resolveOpts: RESOLVE_OPTS,
        focusHeading: () => {},
        collapsedHeadings: new Set(),
        toggleHeadingCollapse: () => {},
        collapsedTables: new Set(),
        toggleTableCollapse: () => {},
        collapsibleOrderedLists: false,
        collapsedOrderedListItems: new Set(),
        toggleOrderedListItemCollapse: () => {},
        handleTaskCheckboxToggle: () => {},
        contentBlocksMap: new Map(),
        calloutEmojiButtonRef: { current: null },
        openCalloutEmojiPicker: () => {},
    };
}

/** 真实管线挂载 → 容器（effect 已 flush，图片解析已完成）。 */
async function renderMarkdown(md: string, editable = true): Promise<HTMLElement> {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
        root.render(
            <ReactMarkdown
                remarkPlugins={makeRemarkPlugins({ contentBlocksMap: new Map() }) as any}
                rehypePlugins={[[rehypeSanitize, makeMarkdownSanitizeSchema()]] as any}
                components={buildMarkdownComponents(makeCtx(md, editable)) as any}
            >
                {md}
            </ReactMarkdown>
        );
    });
    return host;
}

afterEach(() => {
    document.body.innerHTML = "";
});

describe("REPRO（先红 → 回归闸）：带尺寸图片写盘后不得消失", () => {
    it("写路径产出的尺寸语法必须能被 remark 重新读成图片节点", async () => {
        // 用户拖拽缩放 → 写路径产出的**写盘内容**。
        const written = updateImageSizeInLine("![a](p.png)", "p.png", 300, 200);
        expect(written).toBe("![a|300x200](p.png)");

        const host = await renderMarkdown(written, true);
        // 事故判据：图片节点在（尺寸无论落哪种形式都不能让图消失）。
        expect(host.querySelector("img")).not.toBeNull();
        expect(host.textContent ?? "").not.toContain("![");
    });
});

describe("第 1 类：三种写法都渲染出正确尺寸", () => {
    it("纯图片：无尺寸内联样式", async () => {
        const host = await renderMarkdown("![a](p.png)", false);
        const img = host.querySelector("img");
        expect(img).not.toBeNull();
        expect(img.getAttribute("style") ?? "").not.toContain("width");
        expect(img.getAttribute("alt")).toBe("a");
        expect(img.getAttribute("src")).toBe("stub:p.png");
    });

    it("Obsidian 约定 `![a|300x200](p)`", async () => {
        const host = await renderMarkdown("![a|300x200](p.png)", false);
        const img = host.querySelector("img")!;
        expect(img.style.width).toBe("300px");
        expect(img.style.height).toBe("200px");
        // 尺寸不得漏进可见文本 / 无障碍 alt
        expect(img.getAttribute("alt")).toBe("a");
        expect(host.textContent ?? "").not.toContain("300x200");
    });

    it("历史自研 `![a](p =300x200)`（读兼容：图片必须还在）", async () => {
        const host = await renderMarkdown("![a](p.png =300x200)", false);
        const img = host.querySelector("img");
        expect(img).not.toBeNull();
        expect(img!.style.width).toBe("300px");
        expect(img!.style.height).toBe("200px");
        expect(img!.getAttribute("src")).toBe("stub:p.png");
        expect(host.textContent ?? "").not.toContain("=300x200");
    });

    it("只写宽度：`![a|300](p)` → 只设宽度", async () => {
        const host = await renderMarkdown("![a|300](p.png)", false);
        const img = host.querySelector("img")!;
        expect(img.style.width).toBe("300px");
        expect(img.style.height).toBe("");
    });

    it("坏尺寸不丢图：`![a](p =abc)` 仍渲染图片（丢尺寸、保图）", async () => {
        const host = await renderMarkdown("![a](p.png =abc)", false);
        const img = host.querySelector("img");
        expect(img).not.toBeNull();
        expect(img!.getAttribute("src")).toBe("stub:p.png");
        expect(img!.getAttribute("style") ?? "").not.toContain("width");
    });

    it("行内图片与文本共存：图片渲染、文本逐字保留", async () => {
        const host = await renderMarkdown("前 ![a|10x20](p.png) 后", false);
        expect(host.querySelector("img")).not.toBeNull();
        expect(host.textContent).toBe("前  后");
    });
});

describe("第 2 类：编辑态与预览态图片盒子一致（parity）", () => {
    it("同一份源码，编辑态与只读态的 `<img>` 内联尺寸/类名/alt 逐字节相同", async () => {
        const md = "![a|300x200](p.png)";
        const preview = await renderMarkdown(md, false);
        const editing = await renderMarkdown(md, true);
        const previewImg = preview.querySelector("img")!;
        const editingImg = editing.querySelector("img")!;

        expect(editingImg.getAttribute("style")).toBe(previewImg.getAttribute("style"));
        expect(editingImg.className).toBe(previewImg.className);
        expect(editingImg.getAttribute("alt")).toBe(previewImg.getAttribute("alt"));
        expect(editingImg.getAttribute("src")).toBe(previewImg.getAttribute("src"));
    });

    it("编辑态只多出**控件**（手柄/徽标/题注），不改变图片自身盒子", async () => {
        const md = "![a|300x200](p.png)";
        const preview = await renderMarkdown(md, false);
        const editing = await renderMarkdown(md, true);

        // 控件只在编辑态存在
        expect(preview.querySelector(".markdown-img-resize-handle")).toBeNull();
        expect(preview.querySelector(".markdown-img-alt-display")).toBeNull();
        expect(editing.querySelector(".markdown-img-size-badge")?.textContent).toBe("300×200");
        expect(editing.querySelector(".markdown-img-alt-display")).not.toBeNull();

        // 图片盒子（宽高）在两种状态下一致
        const style = (host: HTMLElement) => host.querySelector("img")!.getAttribute("style");
        expect(style(editing)).toBe(style(preview));
    });

    it("题注显示真实 alt（不含尺寸后缀），编辑题注后写盘保留尺寸", async () => {
        const md = "![cat|300x200](p.png)";
        const host = await renderMarkdown(md, true);
        expect(host.querySelector(".markdown-img-alt-display")?.textContent).toBe("cat");

        // 组件里的写盘路径（与 image.tsx 的 commitAltEdit 同源：只拿真实 src + 新题注）
        const next = editImageSyntaxInFullText(md, 1, (line) => updateImageAltInLine(line, "p.png", "dog"))!;
        expect(next).toBe("![dog|300x200](p.png)");

        // 写盘 → 重渲染：题注变了、尺寸没丢，盒子与之前一致
        const after = await renderMarkdown(next, true);
        expect(after.querySelector(".markdown-img-alt-display")?.textContent).toBe("dog");
        expect(after.querySelector("img")!.getAttribute("style")).toBe(
            host.querySelector("img")!.getAttribute("style")
        );
    });

    it("改尺寸后写盘内容正确，且重渲染仍是同一尺寸（编辑 → 写盘 → 重读闭环）", async () => {
        const line = "![a](p.png)";
        const written = updateImageSizeInLine(line, "p.png", 420, 280)!;
        const host = await renderMarkdown(written, true);
        const img = host.querySelector("img")!;
        expect(img.style.width).toBe("420px");
        expect(img.style.height).toBe("280px");
        expect(host.querySelector(".markdown-img-size-badge")?.textContent).toBe("420×280");
    });
});

describe("第 3 类（渲染侧）：往返可解释 / 坏语法不丢图", () => {
    const forms: Array<[string, string, string]> = [
        ["纯图片", "![a](p.png)", ""],
        ["Obsidian 约定", "![a|300x200](p.png)", "width: 300px; height: 200px;"],
        ["历史自研", "![a](p.png =300x200)", "width: 300px; height: 200px;"],
    ];

    for (const [name, md, style] of forms) {
        it(`${name}：写盘 → 重读 → 还是同一张图`, async () => {
            const host = await renderMarkdown(md, false);
            const img = host.querySelector("img")!;
            expect(img.getAttribute("src")).toBe("stub:p.png");
            expect(img.getAttribute("alt")).toBe("a");
            if (style === "") {
                expect(img.getAttribute("style") ?? "").not.toContain("width");
            } else {
                expect(img.style.width).toBe("300px");
                expect(img.style.height).toBe("200px");
            }
        });
    }

    it("坏语法一族都不丢图（渲染层逐条验证）", async () => {
        const broken = ["![a](p.png =abc)", "![a](p.png =0x0)", "![a](p.png =)", "![a|0x0](p.png)"];
        for (const md of broken) {
            const host = await renderMarkdown(md, false);
            expect(host.querySelector("img"), md).not.toBeNull();
        }
    });

    it("改尺寸只改尺寸：多图文档里其它图片的渲染不受影响", async () => {
        const md = "![a](one.png)\n\n![b|50x60](two.png)";
        const next = editImageSyntaxInFullText(md, 1, (line) => updateImageSizeInLine(line, "one.png", 300, 200))!;
        expect(next).toBe("![a|300x200](one.png)\n\n![b|50x60](two.png)");
        const host = await renderMarkdown(next, false);
        const imgs = Array.from(host.querySelectorAll("img"));
        expect(imgs.map((i) => i.style.width)).toEqual(["300px", "50px"]);
        expect(imgs.map((i) => i.getAttribute("src"))).toEqual(["stub:one.png", "stub:two.png"]);
    });

    it("重复渲染同一份写盘内容稳定（不会第二次渲染才崩）", async () => {
        const written = updateImageSizeInLine("![a](p.png)", "p.png", 300, 200)!;
        const first = await renderMarkdown(written, true);
        const second = await renderMarkdown(written, true);
        expect(second.querySelector("img")!.getAttribute("style")).toBe(
            first.querySelector("img")!.getAttribute("style")
        );
    });
});
