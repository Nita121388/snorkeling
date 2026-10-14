// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom

/**
 * A3 不变量门禁：**在位根不得携带任何「第二样式来源」**。
 *
 * 背景：编辑态与预览态的差异，历史上全部来自四类「第二样式来源」：
 *   ① overlay 的 CSS 镜像（`.inline-edit-overlay …` / `.wysiwyg-editor …`）
 *   ② JS 内联快照（`captureBlockTypography` → `style={...typography}`）
 *   ③ 根 class 命名空间不同（`div.wysiwyg-editor.wysiwyg-paragraph` vs `div.paragraph`）
 *   ④ 根上的 overlay 专属标记（`data-block-kind` / `data-placeholder`）
 *
 * 在位编辑的整个主张是「渲染面就是编辑面，只有一套样式」。只要根上出现 ①②③④ 任一项，
 * 主张当场失效 —— 而且失效方式是**静默的**（样式仍然能看，只是不一样）。
 * 所以这里把它们逐条锁成断言：不是靠人记着别加，是加了就红。
 *
 * 这条门禁的判据是「在位模式」而非「overlay 模式」：overlay 需要 ②③④ 才能工作
 * （它是另一个 DOM 子树），所以必须确认它们**只在 overlay 出现**。
 */

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WysiwygEditor } from "./wysiwyg-editor";

function render(extra: Record<string, unknown>) {
    return renderToStaticMarkup(
        React.createElement(WysiwygEditor as any, {
            initialHtml: "hello <strong>world</strong>",
            blockKind: "p",
            onInput: () => {},
            onBlur: () => {},
            ...extra,
        })
    );
}

/** 取根元素的属性表（首元素）。 */
function rootEl(html: string): Element {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const el = doc.body.firstElementChild;
    if (el == null) throw new Error(`no root: ${html}`);
    return el;
}

describe("A3 在位根：不得携带第二样式来源", () => {
    const inplaceHtml = render({ rootTag: "div", rootClassName: "paragraph", rootAttrs: { "data-source-line": "3" } });

    it("② 无内联 style（overlay 的 typography 快照在位路径必须为 0）", () => {
        const el = rootEl(inplaceHtml);
        expect(el.getAttribute("style")).toBeNull();
    });

    it("③ 根 class 就是预览块的 class，不含 wysiwyg-* 命名空间", () => {
        const el = rootEl(inplaceHtml);
        expect(el.className).toBe("paragraph");
        expect(el.className).not.toContain("wysiwyg-");
    });

    it("④ 无 overlay 专属标记 data-block-kind / data-placeholder", () => {
        const el = rootEl(inplaceHtml);
        expect(el.getAttribute("data-block-kind")).toBeNull();
        expect(el.getAttribute("data-placeholder")).toBeNull();
    });

    it("根仍必须 contenteditable（否则不是编辑体）", () => {
        expect(rootEl(inplaceHtml).getAttribute("contenteditable")).toBe("true");
    });
});

describe("A3 overlay 路径：②③④ 必须保留（不能为了在位而改坏旧路径）", () => {
    const overlayHtml = render({ typography: { fontWeight: "700" } });

    it("③ overlay 根仍用 wysiwyg-* 命名空间", () => {
        expect(rootEl(overlayHtml).className).toContain("wysiwyg-");
    });

    it("④ overlay 根仍带 data-block-kind=\"wysiwyg\"", () => {
        expect(rootEl(overlayHtml).getAttribute("data-block-kind")).toBe("wysiwyg");
    });

    it("② overlay 仍应用 typography 快照（textarea 承载源码时需要）", () => {
        const style = rootEl(overlayHtml).getAttribute("style") ?? "";
        expect(style).toContain("font-weight");
        expect(style).toContain("pre-wrap");
    });
});

describe("A3 在位根：class 语义三分（缺省 / 显式无 class / 显式 class）", () => {
    it("不传 rootClassName（overlay）→ 兜底 wysiwyg-* class", () => {
        expect(rootEl(render({ typography: {} })).className).toContain("wysiwyg-");
    });

    it("rootClassName=null（预览根本无 class，如 blockquote/ul）→ 不发 class 属性", () => {
        const html = render({ rootTag: "blockquote", rootClassName: null });
        expect(rootEl(html).getAttribute("class")).toBeNull();
    });

    it("rootClassName=\"\" → 同样不发 class 属性（不得退化成 wysiwyg-*）", () => {
        const html = render({ rootTag: "blockquote", rootClassName: "" });
        expect(rootEl(html).getAttribute("class")).toBeNull();
    });

    it("rootClassName 有值 → 逐字使用", () => {
        const html = render({ rootTag: "calloutalert", rootClassName: "markdown-alert markdown-alert-note" });
        expect(rootEl(html).getAttribute("class")).toBe("markdown-alert markdown-alert-note");
    });
});
