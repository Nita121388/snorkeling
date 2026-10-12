// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom

/**
 * 种子结构同构（parity-harness 切片 1 · R2）。
 *
 * 不变量：**预览 DOM ≡ WYSIWYG 编辑种子 DOM**。编辑态不是"再写一套 DOM"，它的种子必须由
 * 同一个渲染器产出（R1 同源渲染），并且把块结构原样带过去。这条测试把「结构一致」从愿望
 * 变成断言：任何一边改动（渲染器换标签、种子多做了一次 clone/重写、sanitize 剥掉 class）
 * 都会在这里红。
 *
 * 渲染走**真实管线**（与 markdown.tsx 同源）：
 *   makeRemarkPlugins（callout 提升 / 块身份 / spacer …）→ rehype-sanitize（真 schema）
 *   → buildMarkdownComponents（@md/core/render 注册表）。
 * 不手写 HTML 字面量，否则测的是"我以为渲染器会产出什么"，而不是它真的产出什么。
 *
 * 断言四条：
 *   ① 种子里没有 `<script>` / `<button>`（callout 的 emoji 按钮必须被剔除；
 *      emoji 由 R4 从源码首行回写，留在种子里会重复进正文）；
 *   ② 种子的**块级标签序列**与预览一致（忽略 `<wbr>` 与空白文本节点）；
 *   ③ 种子不含 `[object Object]`（`node` 透传回归）；
 *   ④ callout：种子首段是普通 `<p>`，不是 `.markdown-alert-title`。
 *
 * 另加一条**非空转**伴侣断言：种子的可见文本（空白归一后）必须与预览一致 —— 否则
 * 「块级标签序列」对 p / h 这类纯行内内容的块恒为空集，② 就成了空转。
 */

import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import { describe, expect, it } from "vitest";
import { buildMarkdownComponents } from "@md/core/render";
import { makeRemarkPlugins } from "@md/core/remark";
import { makeMarkdownSanitizeSchema } from "@md/core/shared/markdown-sanitize-schema";
import { captureWysiwygInfo, type InlineEditBlockKind } from "./markdown-inline-edit";

/**
 * 挂载辅助（与 `markdown-wysiwyg-seed.test.ts` 的同名辅助形状一致；不 import 那个文件，
 * 因为 import 一个 .test.ts 会把它整棵 describe 重登记进本文件 → 用例翻倍且失败点错位）。
 */
function mount(html: string): HTMLElement {
    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.appendChild(host);
    return host.firstElementChild as HTMLElement;
}

/** 真实渲染管线 → 预览 DOM 根元素。 */
function renderPreview(md: string): HTMLElement {
    const ctx: any = {
        text: md,
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
    return mount(
        renderToStaticMarkup(
            <ReactMarkdown
                remarkPlugins={makeRemarkPlugins({ contentBlocksMap: new Map() }) as any}
                rehypePlugins={[[rehypeSanitize, makeMarkdownSanitizeSchema()]]}
                components={buildMarkdownComponents(ctx) as any}
            >
                {md}
            </ReactMarkdown>
        )
    );
}

/** 块级标签（决定"有几个块、块是什么"的标签；行内元素与文本不参与结构比较）。 */
const BLOCK_TAGS = new Set([
    "P",
    "DIV",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "UL",
    "OL",
    "LI",
    "BLOCKQUOTE",
    "CALLOUTALERT",
    "PRE",
    "TABLE",
    "THEAD",
    "TBODY",
    "TFOOT",
    "TR",
    "TD",
    "TH",
    "HR",
]);

/**
 * 块级标签（与 `markdown-inline-edit.ts` 的 `SEED_BLOCK_TAGS` 同族）：
 * 只有它们作为兄弟出现时，旁边的空白文本节点才算「非内容」。
 */
const INSIGNIFICANT_BLOCK_TAGS = new Set([
    "ADDRESS",
    "ARTICLE",
    "ASIDE",
    "BLOCKQUOTE",
    "CALLOUTALERT",
    "DD",
    "DIV",
    "DL",
    "DT",
    "FIGCAPTION",
    "FIGURE",
    "FOOTER",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "HEADER",
    "HR",
    "LI",
    "MAIN",
    "NAV",
    "OL",
    "P",
    "PRE",
    "SECTION",
    "TABLE",
    "UL",
]);

/**
 * 丢掉「块级兄弟旁的空白文本节点」—— 与 `stripInsignificantWhitespace`（种子的归一化）
 * 完全同一条规则：渲染态折叠它、编辑态 `pre-wrap` 会把它变成一整行，所以它不是内容。
 * 紧带 `<br>` 的换行同理（种子侧由 normalizeBreaksAroundNewlines 处理）。
 */
function dropInsignificantWhitespace(root: Element): void {
    const walk = (parent: Element) => {
        const kids = Array.from(parent.childNodes);
        for (const child of kids) {
            if (child.nodeType === 1) {
                walk(child as Element);
            }
        }
        if (!kids.some((n) => n.nodeType === 1 && INSIGNIFICANT_BLOCK_TAGS.has((n as Element).tagName))) {
            return;
        }
        for (const node of kids) {
            if (node.nodeType === 3 && (node.textContent ?? "").trim() === "") {
                node.remove();
            }
        }
    };
    walk(root);
}

/** 去掉编辑期标记（`<wbr>` caret 锚点）与预览侧装饰，再比较结构。 */
function withoutArtifacts(root: Element, dropSelectors: string[] = []): Element {
    const clone = root.cloneNode(true) as Element;
    for (const sel of ["wbr", ...dropSelectors]) {
        clone.querySelectorAll(sel).forEach((n) => n.remove());
    }
    dropInsignificantWhitespace(clone);
    return clone;
}

/** 块级标签序列（忽略 `<wbr>`；只遍历元素，所以空白文本节点天然不参与）。 */
function blockSkeleton(root: Element, includeRoot = false): string[] {
    const out: string[] = [];
    const walk = (el: Element) => {
        for (const child of Array.from(el.children)) {
            if (BLOCK_TAGS.has(child.tagName)) {
                out.push(child.tagName);
            }
            walk(child);
        }
    };
    walk(root);
    return includeRoot && BLOCK_TAGS.has(root.tagName) ? [root.tagName, ...out] : out;
}

function normalizeText(s: string | null): string {
    return (s ?? "").replace(/\s+/g, " ").trim();
}

/** 种子的可见文本：`[object Object]` 之类的回归也会在这里显形。 */
function seedTextOf(seedHtml: string): string {
    const root = document.createElement("div");
    root.innerHTML = seedHtml;
    return normalizeText(root.textContent);
}

type ParityCase = {
    name: string;
    /** 预览里被 inline-edit 点中的元素（= 交给 captureWysiwygInfo 的 targetEl）。 */
    target: string;
    kind: InlineEditBlockKind;
    source: string;
    /**
     * 预览侧骨架取法：`self` = 含目标元素自身（list 的种子是 outerHTML，含 `<ul>` 根）；
     * `inner` = 只取后代（其余 kind 的种子是 innerHTML）。
     */
    previewScope: "self" | "inner";
    /**
     * 种子按 R3 **重写**的前导块数（callout/quote 的标题段被降级为普通 `<p>`），
     * 比对时两侧各跳过这么多块 —— 重写本身的形状由 ④ 单独断言。
     */
    rewrittenLeadingBlocks?: number;
    /** 预览侧要丢弃的编辑期装饰（emoji 按钮：种子按 R3 剔除、由 R4 从源码回写）。 */
    dropFromPreview?: string[];
    /** 该 case 的骨架应当非空（防"两边都是空集"式的空转）。 */
    nonEmptySkeleton?: boolean;
};

const CASES: ParityCase[] = [
    { name: "p", target: "div.paragraph", kind: "p", source: "hello **world**", previewScope: "inner" },
    ...[1, 2, 3, 4, 5, 6].map((level) => ({
        name: `h${level}`,
        target: "div.heading",
        kind: "h" as InlineEditBlockKind,
        source: `${"#".repeat(level)} title`,
        previewScope: "inner" as const,
    })),
    { name: "ul", target: "ul", kind: "list", source: "- a\n- b", previewScope: "self", nonEmptySkeleton: true },
    { name: "ol", target: "ol", kind: "list", source: "1. a\n2. b", previewScope: "self", nonEmptySkeleton: true },
    {
        name: "blockquote（渲染为 .markdown-alert-quote）",
        target: "calloutalert",
        kind: "quote",
        source: "> 纯引用",
        previewScope: "inner",
        rewrittenLeadingBlocks: 1,
    },
    {
        name: "calloutalert（.markdown-alert-note）",
        target: "calloutalert",
        kind: "quote",
        source: "> [!NOTE] 标题\n>\n> 正文",
        previewScope: "inner",
        rewrittenLeadingBlocks: 1,
        nonEmptySkeleton: true,
    },
    {
        // 带 emoji 的那一支才是①的真正考点：预览里**确实**有 <button>，种子里一个都不能有
        // （否则按钮里的 emoji 会被序列化器 unwrap 成标题文本，与 R4 回写的 emoji 重复）。
        name: "calloutalert（带 emoji：按钮必须被剔除）",
        target: "calloutalert",
        kind: "quote",
        source: "> [!IMPORTANT] 🔥 标题\n>\n> 正文",
        previewScope: "inner",
        rewrittenLeadingBlocks: 1,
        dropFromPreview: [".markdown-alert-emoji-btn"],
        nonEmptySkeleton: true,
    },
];

function pickTarget(root: HTMLElement, selector: string): HTMLElement {
    const el = root.matches(selector) ? root : (root.querySelector(selector) as HTMLElement | null);
    expect(el, `预览里找不到 ${selector}`).not.toBeNull();
    return el!;
}

describe("预览 DOM ≡ WYSIWYG 编辑种子 DOM（R2 同构）", () => {
    for (const c of CASES) {
        it(`${c.name}：种子结构同构`, () => {
            const previewRoot = renderPreview(c.source);
            const target = pickTarget(previewRoot, c.target);
            const preview = withoutArtifacts(target, c.dropFromPreview);
            // 非空转：被丢弃的装饰必须真的存在于预览里
            for (const sel of c.dropFromPreview ?? []) {
                expect(target.querySelector(sel), `${c.name}: 预览里没有 ${sel}，丢弃之前先证明它真的存在`).not.toBeNull();
            }

            const info = captureWysiwygInfo(c.kind, target, c.source);
            expect(info, `${c.name}: 真实渲染的 DOM 应能产出 WYSIWYG 种子`).not.toBeNull();
            const seedHtml = info!.html;

            // ① 种子不得携带脚本 / 按钮（emoji 按钮由 R4 从源码回写）
            expect(seedHtml).not.toContain("<script");
            expect(seedHtml).not.toContain("<button");

            // ③ `node` 透传回归
            expect(seedHtml).not.toContain("[object Object]");

            const seedRoot = document.createElement("div");
            seedRoot.innerHTML = seedHtml;

            // ② 块级标签序列一致（忽略 <wbr> 与空白文本节点）
            const skip = c.rewrittenLeadingBlocks ?? 0;
            const previewSkeleton = blockSkeleton(preview, c.previewScope === "self").slice(skip);
            const seedSkeleton = blockSkeleton(seedRoot).slice(skip);
            expect(seedSkeleton, `${c.name}: 种子的块结构与预览不一致`).toEqual(previewSkeleton);
            if (c.nonEmptySkeleton) {
                expect(previewSkeleton.length, `${c.name}: 骨架比对不得空转`).toBeGreaterThan(0);
            }

            // 非空转伴侣：可见文本必须一字不差地过桥（空白归一）
            expect(seedTextOf(seedHtml), `${c.name}: 种子丢了或多带了文本`).toBe(normalizeText(preview.textContent));
        });
    }

    it("callout：种子首段是普通 <p>，不是 .markdown-alert-title（R3 标题降级）", () => {
        const source = "> [!NOTE] 标题\n>\n> 正文";
        const previewRoot = renderPreview(source);
        const target = pickTarget(previewRoot, "calloutalert");

        // 非空转：预览侧**确实**有 emoji 按钮与 .markdown-alert-title 标题段
        expect(previewRoot.outerHTML).toContain("<button");
        expect(target.querySelector(":scope > .markdown-alert-title")).not.toBeNull();

        const info = captureWysiwygInfo("quote", target, source)!;
        expect(info.html).not.toContain("<button");
        const first = document.createElement("div");
        first.innerHTML = info.html;
        const firstBlock = first.firstElementChild as HTMLElement;
        expect(firstBlock.tagName).toBe("P");
        expect(firstBlock.classList.contains("markdown-alert-title")).toBe(false);
        expect(firstBlock.className).toBe("");
        // 标题文本仍在（降级只是换标签，不是丢内容）
        expect(normalizeText(firstBlock.textContent)).toBe("标题");
    });

    it("pre.codeblock：code 不在 WYSIWYG kinds 内 → 无 DOM 种子（回落 textarea，不存在漂移面）", () => {
        const source = "```js\nconst a = 1;\n```";
        const previewRoot = renderPreview(source);
        const target = pickTarget(previewRoot, "pre.codeblock");
        // 真实渲染器产出的就是 <pre class="codeblock">（种子不该是它的克隆）
        expect(target.tagName).toBe("PRE");
        expect(target.classList.contains("codeblock")).toBe(true);
        expect(captureWysiwygInfo("code", target, source)).toBeNull();
    });
});
