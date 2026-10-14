// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom

/**
 * `md-dom` 种子采集层的独立测试面。
 *
 * 这层的每条规则都对应过一次**真实事故**，所以用例按「当时的症状」命名，
 * 而不是按函数名。改名/重构时请保留症状描述 —— 它是「为什么不能删这条」的唯一记录。
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
    calloutSeedHtml,
    captureInplaceSeedHtml,
    captureWysiwygInfo,
    normalizeBreaksAroundNewlines,
    stripInsignificantWhitespace,
} from "./seed";

let root: HTMLElement;

beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
});

function mount(html: string): HTMLElement {
    root.innerHTML = html;
    return root.firstElementChild as HTMLElement;
}

describe("normalizeBreaksAroundNewlines：<br> 后那个换行不是第二个换行", () => {
    it("<br>\\n → <br>（渲染态 normal 下被折叠，编辑器 pre-wrap 下会显形）", () => {
        expect(normalizeBreaksAroundNewlines("a<br>\nb")).toBe("a<br>b");
        expect(normalizeBreaksAroundNewlines("a<br>\n<br>b")).toBe("a<br><br>b");
    });

    // ⚠ 已知边界（本测试是**现状钉子**，不是“正确行为”声明）：
    // 正则只剥 `\n` **前**的 `[ \t]*`，不剥 `\n` **后**的缩进。
    // HTML 在 `white-space: normal` 下会把行首空白去掉，所以预览是 `b`、
    // overlay 编辑面（`pre-wrap`）是 `  b` —— 理论上是一处可见差异。
    // 但真实 remark 输出没有这种缩进（是 `<br>\n标题`），所以实际未观察到症状。
    // 不在此层“顺手改”：改正则容易连带影响正常的行内空白，而影响面（overlay 路径）
    // 还有 52 条镜像要整体退役。先钉住现状，防静默漂移。
    it("已知边界：`\n` 之后的缩进不被剔除（现状钉子）", () => {
        expect(normalizeBreaksAroundNewlines("a<br>\n  b")).toBe("a<br>  b");
    });

    it("\\n<br> → <br>（同理，换行在 <br> 之前）", () => {
        expect(normalizeBreaksAroundNewlines("a\n<br>b")).toBe("a<br>b");
    });

    it("不贴 <br> 的换行是用户正文，一律不动", () => {
        expect(normalizeBreaksAroundNewlines("a\nb")).toBe("a\nb");
    });
});

describe("stripInsignificantWhitespace：元素间空白在 pre-wrap 下会占一整行", () => {
    it("有块级兄弟时删掉纯空白文本节点（松散列表点进去变双倍行距的根因）", () => {
        const out = stripInsignificantWhitespace("<ul>\n  <li>a</li>\n  <li>b</li>\n</ul>");
        expect(out).not.toMatch(/>\s+</);
        expect(out).toContain("<li>a</li>");
        expect(out).toContain("<li>b</li>");
    });

    it("**没有**块级兄弟时，空白是真实行内内容，必须保留", () => {
        // `<p>` 里只有文本节点：开头那个空格是内容（`a b` 的间隔）
        expect(stripInsignificantWhitespace("<p>a b</p>")).toContain("a b");
    });

    it("空种子原样返回（不做无意义的 template 解析）", () => {
        expect(stripInsignificantWhitespace("")).toBe("");
    });
});

describe("calloutSeedHtml（overlay 路径）：emoji 按钮与标题容器都要处理", () => {
    it("移除 emoji 按钮（否则按钮里的 emoji 会被 unwrap 进正文、与回写前缀叠加成重复）", () => {
        const el = mount(
            '<calloutalert class="markdown-alert"><div class="markdown-alert-title">' +
                '<button class="markdown-alert-emoji-btn">🔔</button>' +
                '<span class="markdown-alert-title-text">标题</span></div></calloutalert>'
        );
        const seed = calloutSeedHtml(el);
        expect(seed).not.toContain("markdown-alert-emoji-btn");
        expect(seed).not.toContain("🔔");
        expect(seed).toContain("标题");
    });

    it("标题容器降为裸 <p>（overlay 自己带盒子样式，不降会叠加两次）", () => {
        const el = mount(
            '<calloutalert class="markdown-alert"><div class="markdown-alert-title">' +
                '<span class="markdown-alert-title-text">标题</span></div></calloutalert>'
        );
        const seed = calloutSeedHtml(el);
        expect(seed).not.toContain("markdown-alert-title");
        expect(seed).toContain("<p>标题</p>");
    });
});

describe("captureInplaceSeedHtml（A3 在位路径）：保留结构、只删供能控件", () => {
    it("保留 .markdown-alert-title 容器（在位面就是渲染面，拆了结构就会掉样式）", () => {
        const el = mount(
            '<calloutalert class="markdown-alert"><div class="markdown-alert-title">' +
                '<button class="markdown-alert-emoji-btn"></button>' +
                '<span class="markdown-alert-title-text">标题</span></div></calloutalert>'
        );
        const seed = captureInplaceSeedHtml(el);
        expect(seed).toContain('class="markdown-alert-title"');
        expect(seed).toContain('class="markdown-alert-title-text"');
        expect(seed).not.toContain("markdown-alert-emoji-btn");
    });

    it("移除 heading 的折叠按钮（编辑期不该有的交互），但保留 title span", () => {
        const el = mount(
            '<div class="heading is-1"><button class="heading-collapse-button"></button>' +
                '<span class="heading-title">标题</span></div>'
        );
        const seed = captureInplaceSeedHtml(el);
        expect(seed).not.toContain("heading-collapse-button");
        expect(seed).toContain('class="heading-title"');
    });
});

describe("captureWysiwygInfo：拒绝的三种情形都是「宁可暴露标记，也不丢内容」", () => {
    it("种子为空但源码并非空壳 → 拒绝（否则会以合法空壳覆盖有内容的块，不可恢复）", () => {
        const el = mount('<div class="paragraph"></div>');
        expect(captureWysiwygInfo("p", el, "本来有内容的一段")).toBeNull();
    });

    it("种子无文本（全是装饰元素）→ 同样拒绝（只看 html 是否为空拦不住这种）", () => {
        const el = mount(
            '<calloutalert class="markdown-alert"><div class="markdown-alert-title">' +
                '<span class="markdown-alert-title-text"></span></div></calloutalert>'
        );
        expect(captureWysiwygInfo("quote", el, "> [!NOTE] 有内容")).toBeNull();
    });

    it("种子含 img / a → 拒绝（往返有损，回落 textarea）", () => {
        expect(captureWysiwygInfo("p", mount("<div class=\"paragraph\"><img src=\"x.png\"></div>"), "![x](x.png)")).toBeNull();
        expect(captureWysiwygInfo("p", mount('<div class="paragraph"><a href="/x">x</a></div>'), "[x](/x)")).toBeNull();
    });

    it("**feature 开关由宿主注入**：显式 false → 直接拒绝（包不猜宿主 flag 在哪）", () => {
        const el = mount('<div class="paragraph">内容</div>');
        expect(captureWysiwygInfo("p", el, "内容", { isWysiwygEnabled: () => false })).toBeNull();
        expect(captureWysiwygInfo("p", el, "内容", { isWysiwygEnabled: () => true })).not.toBeNull();
    });

    it("p：返回归一化后的 html（含 <br> 归一化）", () => {
        const el = mount('<div class="paragraph">a<br>\nb</div>');
        const info = captureWysiwygInfo("p", el, "a\nb");
        expect(info?.html).toBe("a<br>b");
    });

    it("h：从渲染 class is-N 取标题级别", () => {
        const el = mount('<div class="heading is-3"><span class="heading-title">标题</span></div>');
        const info = captureWysiwygInfo("h", el, "### 标题");
        expect(info?.headingLevel).toBe(3);
        // 只取 title span 的内容，不含折叠按钮
        expect(info?.html).toBe("标题");
    });

    it("list：marker 与缩进从**源码**捕获（保留作者选择 `*` 还是 `-`、以及嵌套缩进）", () => {
        const el = mount("<ul><li>a</li></ul>");
        const info = captureWysiwygInfo("list", el, "  * a");
        expect(info?.listMarker).toBe("*");
        expect(info?.listIndent).toBe("  ");
        expect(info?.html).toContain("<ul>"); // 列表种子要带外层 tag（序列化器认它）
    });

    it("table / code 等非散文类 → 拒绝（它们有各自的专用编辑器）", () => {
        const el = mount("<pre><code>x</code></pre>");
        expect(captureWysiwygInfo("code", el, "```\nx\n```")).toBeNull();
        expect(captureWysiwygInfo("table", el, "| a |")).toBeNull();
    });
});
