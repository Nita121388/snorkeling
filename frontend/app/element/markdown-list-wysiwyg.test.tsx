// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// WYSIWYG 列表编辑的两条数据保真契约。
//
// 背景 bug（"数字列表编辑起来样式有发生变化"）：
//   1) 编辑器种子取的是渲染树的 outerHTML —— 折叠式有序列表的 <li> 里带 summary 包装和
//      折叠按钮，且序号是 CSS counter 画的。单条 <li> 被塞进 editor 后没有 <ol> 父级，
//      浏览器用默认 disc 画成「圆点」，于是数字列表一进编辑就变圆点。
//   2) 序列化不认 <ol start>，永远从 1 重排；加上提交端还会再 wrapListMarker 一次，
//      源里的 "3." 变成 "3. 1."。
// 这里把「种子要干净」和「缩进不能丢」两个契约锁死。
//
// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { buildListWysiwygSeed, captureWysiwygInfo, preserveListIndent } from "./markdown-inline-edit";
import { serializeBlockDomToMarkdown } from "./markdown-transform/dom-to-markdown";

function el(html: string): HTMLElement {
    const host = document.createElement("div");
    host.innerHTML = html;
    return host.firstElementChild as HTMLElement;
}

/** Collapsible ordered list item, exactly as CollapsibleOrderedListItem renders it. */
const CHROME_LI = `<li class="ordered-list-collapsible" data-source-line="7" data-source-line-end="7">
    <div class="ordered-list-summary-row">
        <button type="button" class="ordered-list-collapse-button"><i></i></button>
        <div class="ordered-list-summary-content">三号条目</div>
    </div>
    <div class="ordered-list-collapse-body"><ul><li>子项</li></ul></div>
</li>`;

describe("buildListWysiwygSeed — clean editor seed", () => {
    it("wraps a bare <li> in an <ol> so the marker stays a NUMBER", () => {
        // The reported bug: without the <ol> parent the browser painted a bullet.
        const seed = buildListWysiwygSeed(el(CHROME_LI), "3.");
        expect(seed.startsWith("<ol")).toBe(true);
        expect(seed).toContain("三号条目");
    });

    it("preserves the item's own number through <ol start>", () => {
        const seed = buildListWysiwygSeed(el(CHROME_LI), "3.");
        expect(seed).toContain('start="3"');
    });

    it("omits <ol start> when the list already starts at 1", () => {
        const seed = buildListWysiwygSeed(el(CHROME_LI), "1.");
        expect(seed.startsWith("<ol")).toBe(true);
        expect(seed).not.toContain("start=");
    });

    it("uses a <ul> for bullet markers", () => {
        const seed = buildListWysiwygSeed(el(CHROME_LI), "-");
        expect(seed.startsWith("<ul")).toBe(true);
    });

    it("strips the collapse button and the summary/body chrome", () => {
        const seed = buildListWysiwygSeed(el(CHROME_LI), "3.");
        expect(seed).not.toContain("<button");
        expect(seed).not.toContain("ordered-list-summary-row");
        expect(seed).not.toContain("ordered-list-summary-content");
        expect(seed).not.toContain("ordered-list-collapse-body");
        // …while the actual content of both the item and its nested list survives.
        expect(seed).toContain("三号条目");
        expect(seed).toContain("子项");
    });

    it("drops editor-only attributes and state classes", () => {
        const seed = buildListWysiwygSeed(el(CHROME_LI), "3.");
        expect(seed).not.toContain("data-source-line");
        expect(seed).not.toContain("ordered-list-collapsible");
        expect(seed).not.toContain("inline-edit-hidden");
    });

    it("keeps an <ol> target's own structure and start", () => {
        const seed = buildListWysiwygSeed(el('<ol start="4"><li>四</li><li>五</li></ol>'), "4.");
        expect(seed.startsWith("<ol")).toBe(true);
        expect(seed).toContain('start="4"');
        expect(seed).toContain("四");
        expect(seed).toContain("五");
    });
});

describe("serializeBlockDomToMarkdown — ordered list numbering", () => {
    it("honors <ol start> instead of restarting at 1", () => {
        const seed = buildListWysiwygSeed(el(CHROME_LI), "3.");
        const root = el(`<div>${seed}</div>`);
        const md = serializeBlockDomToMarkdown(root, { kind: "list", listMarker: "3." } as never);
        // Before the fix this was "1. 三号条目\n\n子项".
        expect(md.startsWith("3. 三号条目")).toBe(true);
    });

    it("increments subsequent items from the start value", () => {
        const root = el('<div><ol start="4"><li>四</li><li>五</li></ol></div>');
        const md = serializeBlockDomToMarkdown(root, { kind: "list", listMarker: "4." } as never);
        expect(md).toBe("4. 四\n5. 五");
    });

    it("keeps bullet markers for unordered lists", () => {
        const root = el("<div><ul><li>a</li><li>b</li></ul></div>");
        const md = serializeBlockDomToMarkdown(root, { kind: "list", listMarker: "*" } as never);
        expect(md).toBe("* a\n* b");
    });
});

describe("preserveListIndent — commit keeps the block's indentation", () => {
    it("re-applies a nested item's indent to every draft line", () => {
        expect(preserveListIndent("- 改过的子项", "  - 子项")).toBe("  - 改过的子项");
    });

    it("is a no-op for a top-level list", () => {
        expect(preserveListIndent("- 改过的一", "1. 一")).toBe("- 改过的一");
    });

    it("keeps relative nested indentation on top of the base indent", () => {
        expect(preserveListIndent("1. a\n  1. b", "   1. a\n   1. a2")).toBe("   1. a\n     1. b");
    });

    it("leaves blank lines alone", () => {
        expect(preserveListIndent("- a\n\n- b", "  - a\n  - b")).toBe("  - a\n\n  - b");
    });

    it("falls back to the draft when the source has no content lines", () => {
        expect(preserveListIndent("- a", "")).toBe("- a");
    });
});

describe("captureWysiwygInfo — the marker must come from RAW source", () => {
    // Regression: the caller used to pass the *stripped* draft text (stripListMarker output),
    // so the marker lookup found nothing — worse, the leading "**" of a bold first line
    // matched the `[-*+]` alternative and the ordered item was seeded as a BULLET list.
    const PLAIN_LI = `<li data-source-line="48">总句柄 975 → 1,100</li>`;

    it("seeds an ordered list as <ol> from a bold-first source line", () => {
        const info = captureWysiwygInfo("list", el(PLAIN_LI), "1. **总句柄 975 → 1,100** 单调爬。");
        expect(info).not.toBeNull();
        expect(info!.listMarker).toBe("1.");
        expect(info!.html.startsWith("<ol")).toBe(true);
    });

    it("seeds a bullet list as <ul> and keeps the author's bullet char", () => {
        const info = captureWysiwygInfo("list", el(PLAIN_LI), "* 一条项目");
        expect(info!.listMarker).toBe("*");
        expect(info!.html.startsWith("<ul")).toBe(true);
    });

    it("keeps the item's own number when the source starts above 1", () => {
        const info = captureWysiwygInfo("list", el(PLAIN_LI), "7. **第七项**");
        expect(info!.html).toContain('start="7"');
    });

    it("ignores the `node` attribute react-markdown leaks into the rendered item", () => {
        const info = captureWysiwygInfo("list", el('<li node="[object Object]">条目</li>'), "1. 条目");
        expect(info!.html).not.toContain("node=");
    });
});
