// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom

// WYSIWYG seed normalization: the rendered tree collapses inter-element whitespace
// (`white-space: normal`) but the editor inherits `pre-wrap` from [contenteditable], so a
// whitespace-only text node between block elements becomes a full blank line. mdast-util-to-hast
// injects exactly such a "\n" between the items of a LOOSE list — the editor must not see it.

import { describe, expect, it } from "vitest";
import {
    applyCalloutPrefix,
    calloutSeedHtml,
    captureCalloutPrefix,
    captureWysiwygInfo,
    indentListDraft,
    isEmptyBlockShellDraft,
    isEmptyQuoteShellDraft,
} from "./markdown-inline-edit";
import { serializeBlockDomToMarkdown } from "@md/core/transform/dom-to-markdown";

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

// ---------------------------------------------------------------------------
// R3 干净种子：emoji <button> 必须移除，标题降为普通 <p>（只取标题文本 span 的内容）。
// ---------------------------------------------------------------------------
function mountCallout(innerHtml: string): HTMLElement {
    return mount(
        `<calloutalert class="markdown-alert markdown-alert-note" data-source-line="1" data-source-line-end="3">${innerHtml}</calloutalert>`
    );
}

describe("calloutSeedHtml (R3)", () => {
    it("removes the emoji button and flattens the title paragraph to a plain <p>", () => {
        const el = mountCallout(
            '<p class="markdown-alert-title" data-source-line="1">' +
                '<button class="markdown-alert-emoji-btn" type="button">🔥</button>' +
                '<span class="markdown-alert-title-text">标题<b>粗</b></span></p>' +
                '<p data-source-line="3">正文</p>'
        );
        const html = calloutSeedHtml(el);
        // 种子不得含 emoji 按钮（否则 emoji 文本会 unwrap 泄漏进正文）
        expect(html).not.toContain("<button");
        expect(html).not.toContain("🔥");
        // 标题降为普通 <p>，行内格式保留
        expect(html).toContain("<p>标题<b>粗</b></p>");
        // 正文保留
        expect(html).toContain("<p data-source-line=\"3\">正文</p>");
    });

    it("real app DOM shape: title is a <div class=markdown-alert-title> (registry p renderer)", () => {
        // The title mdast `p` goes through the registry `p` renderer, which renders
        // <div className="paragraph" {…props}> — props.className (markdown-alert-title) wins,
        // so the DOM title is a DIV and a tag-qualified `p.` selector would miss it.
        const el = mountCallout(
            '<div class="markdown-alert-title" data-source-line="1">' +
                '<button class="markdown-alert-emoji-btn" type="button">🔥</button>' +
                '<span class="markdown-alert-title-text">标题</span></div>' +
                '<div class="paragraph" data-source-line="3">正文</div>'
        );
        const html = calloutSeedHtml(el);
        expect(html).not.toContain("<button");
        // title flattened to a plain <p> (class stripped), body inner text kept
        expect(html).toContain("<p>标题</p>");
        expect(html).toContain("<div class=\"paragraph\" data-source-line=\"3\">正文</div>");
        // and the serializer round-trips it back to quote lines
        const root = document.createElement("div");
        root.innerHTML = html;
        expect(serializeBlockDomToMarkdown(root, { kind: "quote" })).toBe("> 标题\n>\n> 正文");
    });

    it("empty title → <p></p> (serializes to a bare label, keeps first-line position)", () => {
        const el = mountCallout(
            '<p class="markdown-alert-title" data-source-line="1">' +
                '<button class="markdown-alert-emoji-btn is-empty" type="button"></button>' +
                '<span class="markdown-alert-title-text"></span></p>' +
                '<p data-source-line="3">正文</p>'
        );
        const html = calloutSeedHtml(el);
        expect(html).toContain("<p></p>");
        expect(html).not.toContain("<button");
    });
});

describe("captureWysiwygInfo — callout seed (R3)", () => {
    it("seed drops the button, keeps title + body text, and passes the empty-root guard", () => {
        const el = mountCallout(
            '<p class="markdown-alert-title" data-source-line="1">' +
                '<button class="markdown-alert-emoji-btn" type="button">🔥</button>' +
                '<span class="markdown-alert-title-text">标题</span></p>' +
                '<p data-source-line="3">正文</p>'
        );
        const info = captureWysiwygInfo("quote", el, "> [!NOTE] 🔥 标题\n>\n> 正文");
        expect(info).not.toBeNull();
        expect(info!.html).not.toContain("<button");
        expect(info!.html).toContain("标题");
        expect(info!.html).toContain("正文");
    });
});

// ---------------------------------------------------------------------------
// R4 标记保真：从源码首行捕获 `[!TYPE]` + emoji（保大小写），提交时回写首行。
// ---------------------------------------------------------------------------
describe("captureCalloutPrefix (R4)", () => {
    it("preserves the marker's original case and the emoji", () => {
        expect(captureCalloutPrefix("> [!Note] 标题")).toBe("[!Note] ");
        expect(captureCalloutPrefix("> [!IMPORTANT] 🔥 标题")).toBe("[!IMPORTANT] 🔥 ");
    });

    it("returns \"\" for a plain quote (no marker invented)", () => {
        expect(captureCalloutPrefix("> 普通引用")).toBe("");
        expect(captureCalloutPrefix("")).toBe("");
    });

    it("marker-only first line captures just the marker", () => {
        expect(captureCalloutPrefix("> [!NOTE]")).toBe("[!NOTE]");
        expect(captureCalloutPrefix("  > [!TIP]")).toBe("[!TIP]");
    });
});

describe("callout R3 → R4 serializer round-trip (no editor)", () => {
    function seedRoot(el: HTMLElement): HTMLElement {
        const root = document.createElement("div");
        root.innerHTML = calloutSeedHtml(el);
        return root;
    }

    it("single-line callout: marker + emoji restored, marker case preserved", () => {
        const el = mountCallout(
            '<p class="markdown-alert-title" data-source-line="1">' +
                '<button class="markdown-alert-emoji-btn" type="button">🔥</button>' +
                '<span class="markdown-alert-title-text">标题</span></p>'
        );
        const serialized = serializeBlockDomToMarkdown(seedRoot(el), { kind: "quote" });
        expect(serialized).toBe("> 标题");
        const prefix = captureCalloutPrefix("> [!Note] 🔥 标题");
        expect(applyCalloutPrefix(serialized, prefix)).toBe("> [!Note] 🔥 标题");
    });

    it("multi-paragraph callout: bare > separator preserved", () => {
        const el = mountCallout(
            '<p class="markdown-alert-title" data-source-line="1">' +
                '<button class="markdown-alert-emoji-btn is-empty" type="button"></button>' +
                '<span class="markdown-alert-title-text">标题</span></p>' +
                '<p data-source-line="3">正文</p>'
        );
        const serialized = serializeBlockDomToMarkdown(seedRoot(el), { kind: "quote" });
        expect(serialized).toBe("> 标题\n>\n> 正文");
        expect(applyCalloutPrefix(serialized, captureCalloutPrefix("> [!NOTE] 标题\n>\n> 正文"))).toBe(
            "> [!NOTE] 标题\n>\n> 正文"
        );
    });

    it("plain quote: empty prefix leaves the draft untouched (no [!quote])", () => {
        const el = mountCallout('<p data-source-line="1">普通引用</p>');
        const serialized = serializeBlockDomToMarkdown(seedRoot(el), { kind: "quote" });
        expect(serialized).toBe("> 普通引用");
        expect(applyCalloutPrefix(serialized, captureCalloutPrefix("> 普通引用"))).toBe("> 普通引用");
    });
});

describe("applyCalloutPrefix (R4)", () => {
    it("bare > → `> [!NOTE]` with no trailing space", () => {
        expect(applyCalloutPrefix(">", "[!NOTE] ")).toBe("> [!NOTE]");
    });

    it("inserts the prefix before the existing title text", () => {
        expect(applyCalloutPrefix("> 标题", "[!NOTE] ")).toBe("> [!NOTE] 标题");
        expect(applyCalloutPrefix("> 标题", "[!NOTE] 🔥 ")).toBe("> [!NOTE] 🔥 标题");
    });

    it("plain quote (empty prefix) is untouched — no [!quote] invented", () => {
        expect(applyCalloutPrefix("> 标题", "")).toBe("> 标题");
    });

    it("does not touch a non-quote first line", () => {
        expect(applyCalloutPrefix("plain text", "[!NOTE] ")).toBe("plain text");
    });

    it("multi-line: only the first line gains the marker", () => {
        expect(applyCalloutPrefix(">\n> 正文", "[!NOTE] ")).toBe("> [!NOTE]\n> 正文");
    });
});

// ---------------------------------------------------------------------------
// R1–R4 实测发现的保真 bug：紧邻 <br> 的格式化换行。
// 渲染器在软换行前后插 `\n`（`<p>a<br>\nb</p>`）。渲染态 normal 下不可见，但编辑器是
// pre-wrap → 它变成第二个真实换行 → 引用块提交后凭空多出裸 ">" 空行
// （普通引用 `> a` / `> b` 被拆成两个段落）。实测于普通引用与无标题 callout。
// ---------------------------------------------------------------------------
describe("stripInsignificantWhitespace — 紧邻 <br> 的格式化换行", () => {
    // 注意：必须用 DOM API 构造，不能写 innerHTML 字符串。HTML 解析器会把相邻文本节点
    // **合并**（`"<br>\nb"` → 一个 `"\nb"` 文本节点），而 React 是逐 children 建节点的
    // （`<br>` 之后那个 `"\n"` 是**独立**文本节点）—— 只有后者才等于应用里的真实结构，
    // 而 bug 正是这个独立节点造成的。
    const br = () => document.createElement("br");
    const makeQuote = (children: (string | Node)[]): HTMLElement => {
        const host = document.createElement("div");
        const bq = document.createElement("blockquote");
        bq.setAttribute("data-source-line", "1");
        const para = document.createElement("p");
        for (const child of children) {
            para.append(typeof child === "string" ? document.createTextNode(child) : child);
        }
        bq.append(para);
        host.append(bq);
        document.body.appendChild(host);
        return bq;
    };

    it("删掉 <br> 之后紧随的独立换行节点，引用块不再凭空多出裸 >", () => {
        const el = makeQuote(["a", br(), "\n", "b"]);
        expect(el.querySelector("p")!.childNodes.length).toBe(4); // a | br | "\n" | b
        expect(captureWysiwygInfo("quote", el, "> a\n> b")!.html).toBe("<p>a<br>b</p>");
    });

    it("<br> 之前的独立换行节点同样删掉", () => {
        const el = makeQuote(["a", "\n", br(), "b"]);
        expect(captureWysiwygInfo("quote", el, "> a\n> b")!.html).toBe("<p>a<br>b</p>");
    });

    it("不含换行的空白原样保留（可能是用户有意输入）", () => {
        const el = makeQuote(["a ", br(), "b"]);
        expect(captureWysiwygInfo("quote", el, "> a\n> b")!.html).toBe("<p>a <br>b</p>");
    });

    it("nbsp 不被当作格式化空白（保留，且序列化成 \\u00a0 实体）", () => {
        const el = makeQuote(["a\u00a0", br(), "b"]);
        const html = captureWysiwygInfo("quote", el, "> a\n> b")!.html;
        // 内容保留即可：template 的 innerHTML 会把 nbsp 序列化成 `&nbsp;` 实体
        expect(html.replace(/&nbsp;/g, "\u00a0")).toBe("<p>a\u00a0<br>b</p>");
        expect(html).toContain("&nbsp;");
    });
});
