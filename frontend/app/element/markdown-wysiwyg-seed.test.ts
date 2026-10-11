// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom

// WYSIWYG seed normalization: the rendered tree collapses inter-element whitespace
// (`white-space: normal`) but the editor inherits `pre-wrap` from [contenteditable], so a
// whitespace-only text node between block elements becomes a full blank line. mdast-util-to-hast
// injects exactly such a "\n" between the items of a LOOSE list — the editor must not see it.

import { describe, expect, it } from "vitest";
import { captureWysiwygInfo, indentListDraft, isEmptyBlockShellDraft, isEmptyQuoteShellDraft } from "./markdown-inline-edit";

function mount(html: string): HTMLElement {
    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.appendChild(host);
    return host.firstElementChild as HTMLElement;
}

describe("captureWysiwygInfo — seed whitespace normalization", () => {
    it("drops the \\n text nodes a loose list carries between its items", () => {
        const el = mount(
            '<ul data-source-line="1" data-source-line-end="3">\n<li data-source-line="1">a</li>\n<li data-source-line="2">b</li>\n<li data-source-line="3">c</li>\n</ul>'
        );
        const info = captureWysiwygInfo("list", el, "- a\n\n- b\n\n- c");
        expect(info).not.toBeNull();
        expect(info!.html).not.toContain(">\n<");
        expect(info!.html).toBe(
            '<ul data-source-line="1" data-source-line-end="3"><li data-source-line="1">a</li><li data-source-line="2">b</li><li data-source-line="3">c</li></ul>'
        );
    });

    it("keeps meaningful inline whitespace inside a paragraph", () => {
        const el = mount('<div class="paragraph" data-source-line="1">hello <strong>world</strong></div>');
        const info = captureWysiwygInfo("p", el, "hello **world**");
        expect(info!.html).toBe("hello <strong>world</strong>");
    });

    it("keeps an intentional empty line inside a quote (bare > round-trip)", () => {
        const el = mount('<blockquote data-source-line="1"><p>before</p><p></p><p>after</p></blockquote>');
        const info = captureWysiwygInfo("quote", el, "> before\n>\n> after");
        expect(info!.html).toBe("<p>before</p><p></p><p>after</p>");
    });

    it("F4: strips the leading/trailing newlines a single-paragraph quote seed carries", () => {
        // Real render: <blockquote>\n<p>a</p>\n</blockquote>, so innerHTML is "\n<p>a</p>\n".
        // The old `/>\s+</` early-return required whitespace BETWEEN two tags and skipped
        // normalization entirely → the editor got a blank first/last line (extra bare ">").
        const el = mount('<blockquote data-source-line="1">\n<p>a</p>\n</blockquote>');
        expect(el.innerHTML).toBe("\n<p>a</p>\n");
        const info = captureWysiwygInfo("quote", el, "> a");
        expect(info!.html).toBe("<p>a</p>");
    });
});

describe("captureWysiwygInfo — list indent (F3)", () => {
    it("captures the source first line's leading indentation for an inner list", () => {
        const el = mount(
            '<ul data-source-line="2"><li data-source-line="2">b</li><li data-source-line="3">c</li></ul>'
        );
        // beginEdit passes the marker-stripped source: "  b\n  - c" (indent preserved by
        // stripListMarker), so the indent is read off the FIRST line.
        const info = captureWysiwygInfo("list", el, "  b\n  - c");
        expect(info!.listIndent).toBe("  ");
    });

    it("top-level lists capture an empty indent", () => {
        const el = mount('<ul data-source-line="1"><li data-source-line="1">a</li></ul>');
        expect(captureWysiwygInfo("list", el, "a")!.listIndent).toBe("");
    });

    it("round-trip: serializer output re-indented to the source's 2 spaces", () => {
        const serializedFromDom = "- b\n- c"; // serializeListDomToMarkdown always starts at depth 0
        expect(indentListDraft(serializedFromDom, "  ")).toBe("  - b\n  - c");
        expect(indentListDraft(serializedFromDom, "")).toBe(serializedFromDom);
        // Nested lines keep their own relative indent under the added prefix.
        expect(indentListDraft("- a\n  - b", "  ")).toBe("  - a\n    - b");
    });
});

describe("isEmptyQuoteShellDraft — data-loss guard", () => {
    it("detects the serializer output of an empty quote editor root", () => {
        expect(isEmptyQuoteShellDraft(">")).toBe(true);
        expect(isEmptyQuoteShellDraft(">\n>")).toBe(true);
        expect(isEmptyQuoteShellDraft(">\n\n>")).toBe(true);
    });

    it("does not treat real quote content as a shell", () => {
        expect(isEmptyQuoteShellDraft("> real text")).toBe(false);
        expect(isEmptyQuoteShellDraft("> [!NOTE] title\n>\n> body")).toBe(false);
    });

    it("leaves empty prose alone (clearing a paragraph is legitimate)", () => {
        expect(isEmptyQuoteShellDraft("")).toBe(false);
        expect(isEmptyQuoteShellDraft("   ")).toBe(false);
    });
});

describe("isEmptyBlockShellDraft — per-kind data-loss guard", () => {
    it("p/blank: an empty serialization is a shell", () => {
        expect(isEmptyBlockShellDraft("p", "")).toBe(true);
        expect(isEmptyBlockShellDraft("p", "   ")).toBe(true);
        expect(isEmptyBlockShellDraft("blank", "")).toBe(true);
        // Real prose is NOT a shell, and neither is a quote-formatted draft.
        expect(isEmptyBlockShellDraft("p", "> real")).toBe(false);
        expect(isEmptyBlockShellDraft("p", "text")).toBe(false);
    });

    it("code/table/hr also serialize to an empty string when the root is empty", () => {
        expect(isEmptyBlockShellDraft("code", "")).toBe(true);
        expect(isEmptyBlockShellDraft("table", "")).toBe(true);
        expect(isEmptyBlockShellDraft("hr", "")).toBe(true);
    });

    it("h: only a bare run of # is a shell", () => {
        expect(isEmptyBlockShellDraft("h", "#")).toBe(true);
        expect(isEmptyBlockShellDraft("h", "###")).toBe(true);
        expect(isEmptyBlockShellDraft("h", "### ")).toBe(true);
        expect(isEmptyBlockShellDraft("h", "### title")).toBe(false);
        expect(isEmptyBlockShellDraft("h", "")).toBe(false); // a heading never serializes to ""
    });

    it("quote: delegates to isEmptyQuoteShellDraft", () => {
        expect(isEmptyBlockShellDraft("quote", ">")).toBe(true);
        expect(isEmptyBlockShellDraft("quote", ">\n>")).toBe(true);
        expect(isEmptyBlockShellDraft("quote", "> real")).toBe(false);
        expect(isEmptyBlockShellDraft("quote", "")).toBe(false); // legitimate clear
    });

    it("list: empty or marker-only lines are shells", () => {
        expect(isEmptyBlockShellDraft("list", "")).toBe(true);
        expect(isEmptyBlockShellDraft("list", "- ")).toBe(true);
        expect(isEmptyBlockShellDraft("list", "1. ")).toBe(true);
        expect(isEmptyBlockShellDraft("list", "* ")).toBe(true);
        expect(isEmptyBlockShellDraft("list", "- [ ] ")).toBe(true);
        expect(isEmptyBlockShellDraft("list", "- \n- ")).toBe(true);
        // Indented marker-only (inner list) is still a shell.
        expect(isEmptyBlockShellDraft("list", "  - ")).toBe(true);
        // Real items are not.
        expect(isEmptyBlockShellDraft("list", "- item")).toBe(false);
        expect(isEmptyBlockShellDraft("list", "- item\n- ")).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// 空编辑器根的充要条件 = 「会话声明有内容，但种子为空」。这是 step1 事故（提交裸 ">" 覆盖
// 整段引用）的前置条件，也是 step1b（callout 原地编辑）解挂的门槛。
//
// 机制：beginEdit 的 `targetEl` 与 `blockKind` **不保证同源** ——
// focusEditedLine 用 `blockKindFromElement(prevEl)` 得到 kind，却把同一个 el 交给
// beginEdit 当种子。于是当 el 是「空元素」（引用块内的空段、已被清空的元素、
// 空白占位 p）时，quote 会话会拿到 html: ""。
// 而 `""` 仍能通过 `wysiwygHtml != null` 判断 → WysiwygEditor 以 initialHtml=""
// 挂载 → `root.innerHTML = ""` → 失焦提交时 DOM 序列化成裸 ">"（quote 的合法空壳），
// 覆盖掉原本有内容的引用块。
// ---------------------------------------------------------------------------
describe("captureWysiwygInfo — 空种子不得开 WYSIWYG（空编辑器根防线）", () => {
    it("机理：空元素 + 有内容的 quote 会话 → 修复前会返回空种子", () => {
        // 引用块内的空白占位段（`>` 空行渲染成 .blank-spacer），调到 quote 会话上
        const el = mount('<p class="blank-spacer" data-source-line="7"></p>');
        expect(el.innerHTML).toBe("");
        const info = captureWysiwygInfo("quote", el, "> 正文第一行\n> 正文第二行");
        // 修复前：{ html: "" } —— 空种子；修复后：null（回落 textarea，绝不拿空根开编辑）
        expect(info).toBeNull();
        // 并记录这条链的末端：空根序列化出的裸 ">" 正是 isEmptyQuoteShellDraft 认得的空壳
        // （注：空字符串不是空壳 —— 那是「什么都没写」，由 unchangedDraft 分支负责）。
        expect(isEmptyQuoteShellDraft(">")).toBe(true);
        expect(isEmptyQuoteShellDraft(">\n>")).toBe(true);
        expect(isEmptyQuoteShellDraft("")).toBe(false);
    });

    it("空种子 + 源码有内容 → 一律回落 textarea（各 kind）", () => {
        // 各 kind 的种子来源不同（h → .heading-title、list → outerHTML、其余 → innerHTML），
        // 所以这里用「确实是空的、且形状是渲染器真正会产出的」元素。
        const p = mount('<div class="paragraph" data-source-line="3"></div>');
        expect(captureWysiwygInfo("p", p, "有内容的段落")).toBeNull();
        const heading = mount(
            '<div class="heading is-3" data-source-line="4"><span class="heading-title"></span></div>'
        );
        expect(captureWysiwygInfo("h", heading, "### 有内容的标题")).toBeNull();
        // 列表：种子取 outerHTML，所以空 <ul> 的 html 是非空的（`<ul …></ul>`），但它**零文本**
        // —— 同样是「el 不是内容载体」的异常，同样拒绝（这正是加「看文本而不是只看 html」
        // 这一条的价值）。
        const ul = mount('<ul data-source-line="5"></ul>');
        expect(ul.outerHTML).not.toBe("");
        expect(captureWysiwygInfo("list", ul, "- 有内容的列表项")).toBeNull();
        // 有内容的列表照常开放
        const real = mount('<ul data-source-line="5"><li data-source-line="5">项</li></ul>');
        expect(captureWysiwygInfo("list", real, "- 项")!.html).toContain("项");
    });

    it("html 非空但零文本同样拒绝（callout 标题形状：只有装饰元素）", () => {
        // 真实 callout 标题渲染：<p class="markdown-alert-title"><button …></button>
        //   <span class="markdown-alert-title-text"></span></p>
        // 种子 html 不空（有 button/span 标签），但一个文本都没有 → 编辑器根看起来是空的。
        // 只看 html 是否为空拦不住，必须看**文本**。
        const title = mount(
            '<p class="markdown-alert-title" data-source-line="2">' +
                '<button class="markdown-alert-emoji-btn is-empty" type="button"></button>' +
                '<span class="markdown-alert-title-text"></span></p>'
        );
        expect(title.innerHTML).not.toBe("");
        expect(captureWysiwygInfo("p", title, "[!IMPORTANT] 标题正文")).toBeNull();
        // 有文本的标题照常开放 WYSIWYG
        const real = mount(
            '<p class="markdown-alert-title" data-source-line="2">' +
                '<button class="markdown-alert-emoji-btn" type="button">🔥</button>' +
                '<span class="markdown-alert-title-text">标题正文</span></p>'
        );
        const info = captureWysiwygInfo("quote", real, "> [!IMPORTANT] 🔥 标题正文");
        expect(info).not.toBeNull();
        expect(info!.html).toContain("标题正文");
    });

    it("源码本身就是空壳 → 空种子是合法的（新建/清空后继续输入）", () => {
        // 空标题：源码 `###` 没有文字，DOM 也是空 —— 允许开 WYSIWYG（否则会回落 textarea
        // 把 `###` 暴露给用户）。
        const heading = mount('<div class="heading is-3" data-source-line="1"><span class="heading-title"></span></div>');
        const hInfo = captureWysiwygInfo("h", heading, "###");
        expect(hInfo).not.toBeNull();
        expect(hInfo!.html).toBe("");
        // 空段落 / 空白行同理
        const blank = mount('<p class="blank-spacer" data-source-line="2"></p>');
        const bInfo = captureWysiwygInfo("blank", blank, "");
        expect(bInfo).not.toBeNull();
        expect(bInfo!.html).toBe("");
    });
});
