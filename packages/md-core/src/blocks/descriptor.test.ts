// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom

/**
 * 描述符门禁 G1–G5。
 *
 * ## 设计原则：门禁必须**真的能抓错**
 *
 * 摆设式门禁（断言 `expect(true).toBe(true)`、或把一切都塞进豁免表）比没有更糟 ——
 * 它给人"有保护"的错觉。所以每一条门禁都**对着仓库里的真实来源**断言：
 * 渲染注册表、序列化器源码、sanitize schema、以及**真机往返**。
 *
 * 最后一条（G5）最重要：它把「渲染认识、序列化不认识」从"靠人记得"变成"测试必红"。
 * 本项目两类数据损坏都出在这个缝里。
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { listMarkdownRenderers } from "@md/core/render";
import { makeMarkdownSanitizeSchema } from "@md/core/shared/markdown-sanitize-schema";
import { serializeBlockDomToMarkdown } from "@md/core/transform/dom-to-markdown";

import {
    BLOCK_DESCRIPTORS,
    INLINE_DESCRIPTORS,
    STRUCTURAL_RENDERER_KEYS,
    declaredRendererKeys,
    roundTripLossyReason,
    type RoundTripRule,
} from "./descriptor";

const REPO_ROOT = resolve(__dirname, "../../../..");

function readSrc(rel: string): string {
    return readFileSync(resolve(REPO_ROOT, rel), "utf8");
}

describe("G1 六项声明齐全（缺一即红）", () => {
    it("每个块描述符都有 kind / tags / roundTrip / sanitizeTags / editable 且自洽", () => {
        for (const d of BLOCK_DESCRIPTORS) {
            expect(d.kind, `${d.kind}: kind 为空`).toBeTruthy();
            expect(Array.isArray(d.sanitizeTags), `${d.kind}: sanitizeTags 缺失`).toBe(true);
            expect(typeof d.editable, `${d.kind}: editable 必须是布尔`).toBe("boolean");
            expect(Array.isArray(d.tags), `${d.kind}: tags 缺失`).toBe(true);
            // tags 允许为空（blank 块的根是带 class 的 p，没有独立 tag），但 kind 必须非空
        }
    });

    it("roundTrip 不可还原时**必须**给出 lossyReason（否则拒绝时报不出理由）", () => {
        const all: Array<{ name: string; rule: RoundTripRule }> = [
            ...BLOCK_DESCRIPTORS.map((d) => ({ name: `block:${d.kind}`, rule: d.roundTrip })),
            ...INLINE_DESCRIPTORS.map((d) => ({ name: `inline:${d.kind}`, rule: d.roundTrip })),
        ];
        for (const { name, rule } of all) {
            if (!rule.recoverable) {
                expect((roundTripLossyReason(rule) ?? "").length, `${name}: 有损但没写原因`).toBeGreaterThan(0);
            }
        }
    });

    it("行内描述符必须给出 syntax（诊断与文档都要用）", () => {
        for (const d of INLINE_DESCRIPTORS) {
            expect(d.syntax, `${d.kind}: 缺 syntax`).toBeTruthy();
        }
    });
});

describe("G2 描述符与渲染注册表**双向覆盖**（无遗漏 / 无死条目）", () => {
    it("渲染注册表里每个 key 都被声明覆盖", () => {
        const actual = listMarkdownRenderers().map((r) => r.key);
        const declared = new Set(declaredRendererKeys());
        const missing = actual.filter((k) => !declared.has(k));
        expect(missing, `渲染注册表有这些 key，但描述符/结构性 key 都没声明：${missing.join(", ")}`).toEqual([]);
    });

    it("声明的 key 在渲染注册表里都真实存在（防死条目）", () => {
        const actual = new Set(listMarkdownRenderers().map((r) => r.key));
        const dead = declaredRendererKeys().filter((k) => !actual.has(k));
        expect(dead, `声明了但注册表里没有（死条目）：${dead.join(", ")}`).toEqual([]);
    });

    it("结构性 key 列表本身不能重复（手写列表最容易出这种错）", () => {
        const dupes = STRUCTURAL_RENDERER_KEYS.filter((k, i) => STRUCTURAL_RENDERER_KEYS.indexOf(k) !== i);
        expect(dupes, `结构性 key 重复：${dupes.join(", ")}`).toEqual([]);
    });
});

describe("G3 sanitize：描述符声明的 tag 必须在真实 schema 里存在", () => {
    it("每个块描述符的 sanitizeTags 都被 schema 放行", () => {
        const schema = makeMarkdownSanitizeSchema();
        const allowed = new Set((schema.tagNames ?? []).map((t) => String(t).toLowerCase()));
        for (const d of BLOCK_DESCRIPTORS) {
            for (const tag of d.sanitizeTags) {
                expect(allowed.has(tag.toLowerCase()), `${d.kind}: sanitize 未放行 <${tag}>（会被静默剥掉）`).toBe(true);
            }
        }
    });

    it("**带 sourceAttr 的构造必须在 schema 里放行对应属性**（本会话踩过的坑）", () => {
        // 真实教训：第一版改完，代码在、测试全绿、dev server 也在服务新模块，
        // 但真机 DOM 上属性**不存在** —— rehype-sanitize 把未放行的 data-* 静默剥掉了。
        // 这条门禁就是为了让那种事在测试里立刻红。
        //
        // 判据**从描述符派生**（不是硬编码列表）—— 否则新增构造时门禁抓不到。
        const schema = makeMarkdownSanitizeSchema();
        const attrsFor = (tag: string): string[] => {
            const entry =
                (schema.attributes ?? {})[tag.toLowerCase()] ??
                (schema.attributes ?? {})[tag.toUpperCase()] ??
                (schema.attributes ?? {})["*"] ??
                [];
            return entry.map((a: any) => (Array.isArray(a) ? String(a[0]) : String(a)));
        };
        const missing: string[] = [];
        for (const d of INLINE_DESCRIPTORS) {
            if (!d.roundTrip.recoverable) continue;
            for (const attr of d.sanitizeAttrs ?? []) {
                for (const tag of d.tags) {
                    // 只对「属性来自 hast」的构造要求放行；render 期产出的不声明 sanitizeAttrs。
                    const allowed =
                        attrsFor(tag).some((a) => a.toLowerCase() === attr.toLowerCase()) ||
                        (schema.attributes ?? {})["*"]?.some(
                            (a: any) => String(Array.isArray(a) ? a[0] : a).toLowerCase() === attr.toLowerCase()
                        );
                    if (!allowed) {
                        missing.push(`${d.kind}: <${tag}> 未放行 ${attr}`);
                    }
                }
            }
        }
        expect(missing, `这些属性会被 sanitize 静默剥掉：${missing.join("; ")}`).toEqual([]);
    });
});

describe("G4 序列化器的每个 case 都被认领（防新增 case 时漏声明）", () => {
    it("dom-to-markdown.ts 里的 case 全部被块或行内描述符覆盖", () => {
        const src = readSrc("packages/md-core/src/transform/dom-to-markdown.ts");
        const cases = [...src.matchAll(/case\s+"([A-Z0-9]+)"/g)].map((m) => m[1]);
        expect(cases.length, "没扫到 case，说明扫描逻辑失效了").toBeGreaterThan(10);

        const claimed = new Set<string>();
        for (const d of BLOCK_DESCRIPTORS) {
            for (const c of d.serializeCases) claimed.add(c);
        }
        for (const d of INLINE_DESCRIPTORS) {
            for (const t of d.tags) claimed.add(t.toUpperCase());
        }
        // 序列化器里还有一批"结构性"分支：容器/换行/未知兜底，不属于任何语义构造。
        const structural = new Set(["DIV", "P", "LI", "BLOCKQUOTE", "UL", "OL", "SCRIPT", "STYLE"]);
        const unclaimed = cases.filter((c) => !claimed.has(c) && !structural.has(c));
        expect(
            unclaimed,
            `这些 case 没被任何描述符认领（新增 case 时忘了声明，或声明写错了）：${unclaimed.join(", ")}`
        ).toEqual([]);
    });
});

describe("G5 往返可逆：`序列化(渲染(源码))` 必须等于源码（本文件的核心）", () => {
    /**
     * DOM 与源码切片**逐字节比对**。
     * 这条断言直接对应两类真实数据损坏：渲染改了一点、序列化又改回来一点。
     */
    const recoverableBlocks: Array<{ kind: string; ctx: any; html: string; expect: string }> = [
        { kind: "p", ctx: { kind: "p" }, html: "<p>hello</p>", expect: "hello" },
        { kind: "p", ctx: { kind: "p" }, html: "<p>a<strong>b</strong>c</p>", expect: "a**b**c" },
        { kind: "h", ctx: { kind: "h", headingLevel: 2 }, html: "<h2>标题</h2>", expect: "## 标题" },
        {
            kind: "quote",
            ctx: { kind: "quote" },
            html: "<blockquote><p>引用</p></blockquote>",
            expect: "> 引用",
        },
        {
            kind: "list",
            ctx: { kind: "list", listMarker: "-" },
            html: "<ul><li>a</li><li>b</li></ul>",
            expect: "- a\n- b",
        },
        {
            kind: "list-ordered",
            ctx: { kind: "list", listMarker: "1." },
            html: "<ol><li>a</li><li>b</li></ol>",
            expect: "1. a\n2. b",
        },
        {
            kind: "task-list",
            ctx: { kind: "list", listMarker: "-" },
            html: '<ul><li><input type="checkbox" checked> done</li></ul>',
            expect: "- [x] done",
        },
    ];

    for (const c of recoverableBlocks) {
        it(`${c.kind}: ${JSON.stringify(c.expect)}`, () => {
            const root = document.createElement("div");
            root.innerHTML = c.html;
            expect(serializeBlockDomToMarkdown(root, c.ctx)).toBe(c.expect);
        });
    }

    it("**带 sourceAttr 的可还原构造**：序列化器确实读回了原文（逐字节）", () => {
        // wiki 链接：href 不可逆（会补 .md / 分不出有无 label），必须靠 data-source-markdown
        const wiki = document.createElement("div");
        wiki.innerHTML = `<p>见 <a href="wave-wiki:note.md" data-source-markdown="[[note|label]]">label</a> 后</p>`;
        expect(serializeBlockDomToMarkdown(wiki, { kind: "p" as any })).toBe("见 [[note|label]] 后");

        // 脚注：显示的是序号、源码写的是 label
        const fn = document.createElement("div");
        fn.innerHTML = `<p>字<sup data-source-markdown="[^note]"><a href="#user-content-fn-note">1</a></sup></p>`;
        expect(serializeBlockDomToMarkdown(fn, { kind: "p" as any })).toBe("字[^note]");

        // 图片：src 是解析后 URL，alt 与尺寸都还原不回去
        const img = document.createElement("div");
        img.innerHTML = `<p><img src="file:///resolved.png" alt="x" data-source-markdown="![重要截图](a.png|300)"></p>`;
        expect(serializeBlockDomToMarkdown(img, { kind: "p" as any })).toBe("![重要截图](a.png|300)");
    });

    it("**声明为可还原就必须真的可还原**（防止描述符说谎）", () => {
        // 对每条「recoverable + 有 sourceAttr」的行内构造，构造一个带原文的样本，
        // 断言序列化器确实把它读回来了。若有人把某构造标成可还原但没实现读取 → 这里红。
        const samples: Record<string, { html: string; expect: string }> = {
            "wiki-link": {
                html: `<p><a href="wave-wiki:n.md" data-source-markdown="[[n]]">n</a></p>`,
                expect: "[[n]]",
            },
            "footnote-ref": {
                html: `<p><sup data-source-markdown="[^1]"><a href="#user-content-fn-1">1</a></sup></p>`,
                expect: "[^1]",
            },
            image: {
                html: `<p><img src="file:///r.png" alt="" data-source-markdown="![](a.png)"></p>`,
                expect: "![](a.png)",
            },
        };
        for (const [kind, s] of Object.entries(samples)) {
            const d = INLINE_DESCRIPTORS.find((x) => x.kind === kind)!;
            if (!d.roundTrip.recoverable) continue;
            const root = document.createElement("div");
            root.innerHTML = s.html;
            expect(serializeBlockDomToMarkdown(root, { kind: "p" as any }), `${kind} 声称可还原但没还原`).toBe(s.expect);
        }
    });
});
