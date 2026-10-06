// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { convertClosedInlineAtCaret } from "./wysiwyg-editor";
import { detectClosedInlinePair, type ClosedInlinePair } from "./markdown-transform/block-type";

function makeAnchor(text: string): { anchor: Text; parent: HTMLElement } {
    const parent = document.createElement("div");
    const anchor = document.createTextNode(text);
    parent.appendChild(anchor);
    return { anchor, parent };
}

/** 从 caret 前的文本构造 pair，并执行 DOM 手术。 */
function apply(textBeforeCaret: string, anchorText: string, caretOffset: number): { el: HTMLElement; parent: HTMLElement; html: string } | null {
    const pair = detectClosedInlinePair(textBeforeCaret);
    if (pair == null) {
        return null;
    }
    const { anchor, parent } = makeAnchor(anchorText);
    const el = convertClosedInlineAtCaret(anchor, caretOffset, pair);
    if (el == null) {
        return null;
    }
    return { el, parent, html: parent.innerHTML };
}

describe("convertClosedInlineAtCaret (P3 F5 DOM 手术核心)", () => {
    it("`**bold**` caret 在末尾 → <strong>bold</strong>，前后文保留", () => {
        const full = "**bold**";
        const r = apply(full, full, full.length);
        expect(r).not.toBeNull();
        expect(r!.html).toBe("<strong>bold</strong>");
    });

    it("前文保留：`hello **bold**` → hello <strong>bold</strong>", () => {
        const full = "hello **bold**";
        const r = apply(full, full, full.length);
        expect(r!.html).toBe("hello <strong>bold</strong>");
    });

    it("后文保留：`**bold** tail` caret 在 bold 后 → <strong>bold</strong> tail", () => {
        // caret 在 `**bold**` 之后（配对刚闭合），afterText = " tail"
        const anchor = "**bold** tail";
        const beforeCaret = "**bold**";
        const caret = "**bold**".length;
        const r = apply(beforeCaret, anchor, caret);
        expect(r!.html).toBe("<strong>bold</strong> tail");
    });

    it("``` `code` ``` → <code>code</code>", () => {
        const full = "`code`";
        const r = apply(full, full, full.length);
        expect(r!.html).toBe("<code>code</code>");
    });

    it("`*em*` → <em>em</em>；`~~del~~` → <del>del</del>", () => {
        const fullEm = "*em*";
        const rEm = apply(fullEm, fullEm, fullEm.length);
        expect(rEm!.html).toBe("<em>em</em>");
        const fullDel = "~~del~~";
        const rDel = apply(fullDel, fullDel, fullDel.length);
        expect(rDel!.html).toBe("<del>del</del>");
    });

    it("配对不完整（caret 在 `**bol` 处）→ null（不转换）", () => {
        const full = "**bol";
        const r = apply(full, full, full.length);
        expect(r).toBeNull();
    });

    it("anchor 非文本节点 → null（防御）", () => {
        const parent = document.createElement("div");
        parent.innerHTML = "<span>x</span>";
        const nonText = parent.firstChild as Node;
        const pair: ClosedInlinePair = { marker: "**", inner: "bold", innerStart: 2 };
        expect(convertClosedInlineAtCaret(nonText, 5, pair)).toBeNull();
    });

    it("文本次数不匹配（跨节点/中间改动）→ null", () => {
        const pair: ClosedInlinePair = { marker: "**", inner: "bold", innerStart: 2 };
        const { anchor, parent } = makeAnchor("**bold**");
        // 故意给错误 caret（模拟跨节点：anchor 内文本与 beforeCaret 不一致）
        const el = convertClosedInlineAtCaret(anchor, 3, pair);
        expect(el).toBeNull();
        expect(parent.childNodes.length).toBe(1); // anchor 未被破坏
    });

    it("caret 前不足配对长度 → null", () => {
        const pair: ClosedInlinePair = { marker: "**", inner: "bold", innerStart: 2 };
        const { anchor, parent } = makeAnchor("hello");
        expect(convertClosedInlineAtCaret(anchor, 2, pair)).toBeNull();
        expect(parent.childNodes.length).toBe(1);
    });
});