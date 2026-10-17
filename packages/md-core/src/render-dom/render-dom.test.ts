// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom

/**
 * 框架无关渲染真源的测试面。
 *
 * 三组断言，按重要性排：
 * 1. **契约可用性**：产出物满足 md-dom 读取的字段（行号 / 块身份 / 有损构造原文）
 *    —— 不满足的话这份 DOM 根本不能被编辑引擎驱动，渲染得再漂亮也没用。
 * 2. **零框架**：本目录不引 React（静态扫描源码，因为"能跑"证明不了"没依赖"）。
 * 3. **往返保真**：`序列化(渲染(源码)) === 源码`（可还原构造），
 *    这是本项目两类数据损坏的通用判据。
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { renderMarkdownToDom, renderMarkdownToHtml } from "./index";
import { serializeBlockDomToMarkdown } from "../transform/dom-to-markdown";

const SRC_DIR = resolve(__dirname);

describe("零框架（静态扫描源码，不靠「能不能跑」证明）", () => {
    function walk(dir: string): string[] {
        const out: string[] = [];
        for (const entry of readdirSync(dir)) {
            const full = resolve(dir, entry);
            if (statSync(full).isDirectory()) {
                out.push(...walk(full));
            } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry)) {
                out.push(full);
            }
        }
        return out;
    }

    it("render-dom 目录内不出现任何框架/宿主依赖", () => {
        const forbidden = [/from\s+"react"/, /from\s+"react-dom/, /from\s+"react-markdown/, /from\s+"@\//];
        const offenders: string[] = [];
        for (const file of walk(SRC_DIR)) {
            const src = readFileSync(file, "utf8");
            for (const re of forbidden) {
                if (re.test(src)) {
                    offenders.push(`${file.replace(SRC_DIR, "")} 命中 ${re}`);
                }
            }
        }
        expect(offenders, `渲染真源必须是框架无关的：\n${offenders.join("\n")}`).toEqual([]);
    });
});

describe("契约可用性：md-dom 需要什么，产出物就必须有什么", () => {
    const DOC = ["# 标题", "", "第一段。", "", "- a", "- b", "", "> 引用", ""].join("\n");

    it("块根带 `data-source-line`（写盘坐标）", () => {
        const root = renderMarkdownToDom(DOC);
        const el = root.querySelector('[data-source-line="3"]');
        expect(el, "第 3 行的段落块必须带行号属性").not.toBeNull();
    });

    it("块根带 `data-block-id`（行号位移后的重定位依据）", () => {
        const root = renderMarkdownToDom(DOC);
        const el = root.querySelector('[data-source-line="3"]')!;
        expect(el.getAttribute("data-block-id")).toBeTruthy();
    });

    it("行号覆盖多个块型（标题 / 段落 / 列表 / 引用）", () => {
        const root = renderMarkdownToDom(DOC);
        for (const line of [1, 3, 5, 8]) {
            expect(root.querySelector(`[data-source-line="${line}"]`), `line=${line} 没有块`).not.toBeNull();
        }
    });

    it("**有损构造带上原始源码**（wiki 链接 / 脚注 / 图片）—— 这是编辑安全的前提", () => {
        const root = renderMarkdownToDom("见 [[目标|别名]] 与 [^1] 与 ![alt](a.png|100)\n\n[^1]: 定义\n");
        const wiki = root.querySelector("a[data-source-markdown]");
        expect(wiki?.getAttribute("data-source-markdown")).toBe("[[目标|别名]]");
        const fn = root.querySelector("sup[data-source-markdown]");
        expect(fn?.getAttribute("data-source-markdown")).toBe("[^1]");
        const img = root.querySelector("img[data-source-markdown]");
        expect(img?.getAttribute("data-source-markdown")).toBe("![alt](a.png|100)");
    });

    it("sanitize 默认开：脚本与事件处理器被剥掉", () => {
        const html = renderMarkdownToHtml('<img src=x onerror="alert(1)">\n\n<script>alert(2)</script>\n');
        expect(html).not.toContain("onerror");
        expect(html.toLowerCase()).not.toContain("<script");
    });

    it("consumer 追加 rehype 插件（在 sanitize 之前）", () => {
        // 一个最小 rehype 插件：给所有 p 打标
        const plugin = () => (tree: any) => {
            const visit = (n: any) => {
                if (n.type === "element" && n.tagName === "p") {
                    n.properties = { ...(n.properties ?? {}), "data-probe": "1" };
                }
                (n.children ?? []).forEach(visit);
            };
            visit(tree);
        };
        const html = renderMarkdownToHtml("正文", { rehypePlugins: [plugin] });
        expect(html).toContain("data-probe");
    });
});

describe("往返保真：`序列化(渲染(源码)) === 源码`", () => {
    /**
     * 这是本项目两类数据损坏的通用判据。
     * 只测**当前已声明可还原**的构造 —— 不可还原的一律由 md-dom 的 gate 拒绝编辑。
     */
    const cases: Array<{ name: string; md: string; line: number; kind: any; ctx?: any; expect: string }> = [
        { name: "段落", md: "第一段。", line: 1, kind: "p", expect: "第一段。" },
        { name: "段落含强调", md: "前**粗**后", line: 1, kind: "p", expect: "前**粗**后" },
        { name: "标题", md: "## 标题", line: 1, kind: "h", ctx: { headingLevel: 2 }, expect: "## 标题" },
        { name: "引用", md: "> 引用", line: 1, kind: "quote", expect: "> 引用" },
        { name: "无序列表", md: "- a\n- b", line: 1, kind: "list", ctx: { listMarker: "-" }, expect: "- a\n- b" },
        {
            name: "有序列表",
            md: "1. a\n2. b",
            line: 1,
            kind: "list",
            ctx: { listMarker: "1." },
            expect: "1. a\n2. b",
        },
    ];

    for (const c of cases) {
        it(`${c.name}：${JSON.stringify(c.expect)}`, () => {
            const root = renderMarkdownToDom(c.md);
            const block = root.querySelector(`[data-source-line="${c.line}"]`) as HTMLElement | null;
            expect(block, "渲染产物里找不到目标块").not.toBeNull();
            const ctx = { kind: c.kind, ...(c.ctx ?? {}) };
            expect(serializeBlockDomToMarkdown(block!, ctx as any)).toBe(c.expect);
        });
    }

    it("wiki 链接：渲染产物直接可往返（无需任何补充信息）", () => {
        const root = renderMarkdownToDom("见 [[目标|别名]] 后");
        const block = root.querySelector('[data-source-line="1"]') as HTMLElement;
        expect(serializeBlockDomToMarkdown(block, { kind: "p" as any })).toBe("见 [[目标|别名]] 后");
    });

    it("图片：alt 与尺寸后缀都保住（本项目曾整段丢失）", () => {
        const root = renderMarkdownToDom("![重要截图](a.png|300)");
        const block = root.querySelector('[data-source-line="1"]') as HTMLElement;
        expect(serializeBlockDomToMarkdown(block, { kind: "p" as any })).toBe("![重要截图](a.png|300)");
    });
});
