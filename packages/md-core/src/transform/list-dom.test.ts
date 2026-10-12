// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { serializeBlockDomToMarkdown } from "./dom-to-markdown";
import {
    focusByAnchor,
    indentListItem,
    liFromSelection,
    normalizeListDom,
    outdentListItem,
    plantCaretAnchor,
} from "./list-dom";

function rootFromHtml(html: string): HTMLElement {
    const root = document.createElement("div");
    root.innerHTML = html;
    return root;
}

describe("normalizeListDom (F2)", () => {
    it("游离子列表（浏览器 indent 产物）并入紧邻的前一个 li", () => {
        // 实测的 execCommand("indent") 产物：嵌套 ul 直接挂在父 ul 下。
        const root = rootFromHtml("<ul><li>item A</li><li></li><li>inserteditem B</li><ul><li>item C</li></ul></ul>");
        expect(normalizeListDom(root)).toBe(true);
        const ul = root.querySelector("ul")!;
        expect(ul.children.length).toBe(3); // 只余 3 个 li
        const lastLi = ul.children[2] as HTMLElement;
        expect(lastLi.lastElementChild?.tagName).toBe("UL");
        expect(lastLi.lastElementChild?.textContent).toBe("item C");
        // 内容经序列化后仍完整（不再丢 item C）。
        expect(serializeBlockDomToMarkdown(root, { kind: "list", listMarker: "-" })).toBe(
            "- item A\n- \n- inserteditem B\n  - item C"
        );
    });

    it("游离子列表是第一个子元素时 → 并入最后一个 li（内容绝不丢弃）", () => {
        const root = rootFromHtml("<ul><ul><li>orphan</li></ul><li>item A</li></ul>");
        expect(normalizeListDom(root)).toBe(true);
        const ul = root.querySelector("ul")!;
        const host = ul.querySelector("li")!;
        expect(host.querySelector("ul")?.textContent).toBe("orphan");
        expect(serializeBlockDomToMarkdown(root, { kind: "list", listMarker: "-" })).toBe("- item A\n  - orphan");
    });

    it("列表内一个 li 都没有 → 子列表整体提升为顶层且内容保留（空列表被清除）", () => {
        const root = rootFromHtml("<ul><ul><li>x</li></ul></ul>");
        expect(normalizeListDom(root)).toBe(true);
        expect(root.querySelectorAll("ul").length).toBe(1);
        expect(root.querySelector("ul li")?.textContent).toBe("x");
        // 提升后序列化仍能拿到内容（若留下空 ul，querySelector 会命中它而丢内容）。
        expect(serializeBlockDomToMarkdown(root, { kind: "list", listMarker: "-" })).toBe("- x");
    });

    it("多个游离子列表按原顺序提升（无 li 列表）", () => {
        const root = rootFromHtml("<ul><ul><li>a</li></ul><ul><li>b</li></ul></ul>");
        expect(normalizeListDom(root)).toBe(true);
        const lists = Array.from(root.querySelectorAll("ul"));
        expect(lists.length).toBe(2);
        expect(lists[0].textContent).toBe("a");
        expect(lists[1].textContent).toBe("b");
        // 内容未丢失：仍能分别序列化出内容（block 级序列化器按契约只取第一个顶层列表，
        // 这里是两个顶层列表的退化情形，仅验证结构/顺序）。
        expect(serializeBlockDomToMarkdown(root, { kind: "list", listMarker: "-" })).toBe("- a");
        expect(lists[1].querySelector("li")?.textContent).toBe("b");
    });

    it("游离子列表紧跟已带子列表的 li → 追加进该 li（不新建顶层列表）", () => {
        const root = rootFromHtml("<ul><li>a<ul><li>b</li></ul></li><ul><li>d</li></ul><li>c</li></ul>");
        expect(normalizeListDom(root)).toBe(true);
        const firstLi = root.querySelector("li")!;
        // 两个子列表都挂在同一个 li 下（原来的 + 被搬进来的），内容都在。
        expect(Array.from(firstLi.children).filter((c) => c.tagName === "UL").length).toBe(2);
        // 没有新建顶层列表：root 下仍只有一个顶层 ul（outer）。
        expect(root.children.length).toBe(1);
        expect(root.children[0].tagName).toBe("UL");
        expect(serializeBlockDomToMarkdown(root, { kind: "list", listMarker: "-" })).toBe("- a\n  - b\n  - d\n- c");
    });

    it("嵌套在 li 内的规范结构不动，返回 false", () => {
        const root = rootFromHtml("<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>");
        const before = root.innerHTML;
        expect(normalizeListDom(root)).toBe(false);
        expect(root.innerHTML).toBe(before);
    });

    it("幂等：normalize(normalize(x)) 与 normalize(x) 结构一致且第二次返回 false", () => {
        const root = rootFromHtml(
            "<ul><li>item A</li><li></li><li>item B</li><ul><li>C</li><ul><li>D</li></ul></ul></ul>"
        );
        expect(normalizeListDom(root)).toBe(true);
        const afterFirst = root.innerHTML;
        expect(normalizeListDom(root)).toBe(false);
        expect(root.innerHTML).toBe(afterFirst);
    });

    it("list 本身就是 root（无父级）时不谎报改动", () => {
        const ul = document.createElement("ul");
        ul.innerHTML = "<ul><li>x</li></ul>";
        const before = ul.innerHTML;
        expect(normalizeListDom(ul)).toBe(false);
        expect(ul.innerHTML).toBe(before);
    });

    it("有序列表里的游离子列表同样被搬进 li（保持 ol）", () => {
        const root = rootFromHtml("<ol><li>a</li><ol><li>x</li></ol></ol>");
        expect(normalizeListDom(root)).toBe(true);
        expect(root.querySelector("ol li ol li")?.textContent).toBe("x");
        expect(serializeBlockDomToMarkdown(root, { kind: "list", listMarker: "1." })).toBe("1. a\n  1. x");
    });

    it("非列表 DOM（段落）不受影响", () => {
        const root = rootFromHtml("<p>hello</p>");
        expect(normalizeListDom(root)).toBe(false);
        expect(root.innerHTML).toBe("<p>hello</p>");
    });
});

describe("indentListItem / outdentListItem (F3 自持结构操作)", () => {
    function liAt(root: HTMLElement, index: number): HTMLLIElement {
        return root.querySelectorAll("li")[index] as HTMLLIElement;
    }

    /** 按项文本找 li（文档序索引会把嵌套项算进来，按文本更稳）。 */
    function liByText(root: HTMLElement, text: string): HTMLLIElement {
        const found = Array.from(root.querySelectorAll("li")).find((li) => (li.textContent ?? "").trim() === text);
        return found as HTMLLIElement;
    }

    it("Tab：第二项缩进到前一个兄弟 li 的嵌套子列表里（结构规范）", () => {
        const root = rootFromHtml("<ul><li>A</li><li>B</li><li>C</li></ul>");
        expect(indentListItem(liAt(root, 1))).toBe(true);
        // 嵌套 ul 必须在 li 内（规范结构），不是直接挂在 ul 下。
        expect(root.children.length).toBe(1);
        const firstLi = liAt(root, 0);
        expect(firstLi.lastElementChild?.tagName).toBe("UL");
        expect(firstLi.querySelector("ul li")?.textContent).toBe("B");
        expect(serializeBlockDomToMarkdown(root, { kind: "list", listMarker: "-" })).toBe("- A\n  - B\n- C");
    });

    it("Tab：前一个兄弟已有子列表 → 追加进它（不新建第二个子列表）", () => {
        const root = rootFromHtml("<ul><li>A<ul><li>B</li></ul></li><li>C</li></ul>");
        expect(indentListItem(liByText(root, "C"))).toBe(true);
        const firstLi = liAt(root, 0);
        expect(Array.from(firstLi.children).filter((c) => c.tagName === "UL").length).toBe(1);
        expect(serializeBlockDomToMarkdown(root, { kind: "list", listMarker: "-" })).toBe("- A\n  - B\n  - C");
    });

    it("Tab：第一项 no-op", () => {
        const root = rootFromHtml("<ul><li>A</li><li>B</li></ul>");
        const before = root.innerHTML;
        expect(indentListItem(liAt(root, 0))).toBe(false);
        expect(root.innerHTML).toBe(before);
    });

    it("Tab：同级子列表与父列表同型（ol 里套 ol）", () => {
        const root = rootFromHtml("<ol><li>A</li><li>B</li></ol>");
        expect(indentListItem(liAt(root, 1))).toBe(true);
        expect(liAt(root, 0).lastElementChild?.tagName).toBe("OL");
        expect(serializeBlockDomToMarkdown(root, { kind: "list", listMarker: "1." })).toBe("1. A\n  1. B");
    });

    it("Shift+Tab：嵌套项降级到父 li 之后，成为同级项", () => {
        const root = rootFromHtml("<ul><li>A<ul><li>B</li></ul></li><li>C</li></ul>");
        expect(outdentListItem(liAt(root, 1))).toBe(true);
        expect(serializeBlockDomToMarkdown(root, { kind: "list", listMarker: "-" })).toBe("- A\n- B\n- C");
    });

    it("Shift+Tab：降级后父列表空了 → 删除空 ul（不残留空行）", () => {
        const root = rootFromHtml("<ul><li>A<ul><li>B</li></ul></li></ul>");
        expect(outdentListItem(liAt(root, 1))).toBe(true);
        expect(root.querySelectorAll("ul").length).toBe(1);
        expect(serializeBlockDomToMarkdown(root, { kind: "list", listMarker: "-" })).toBe("- A\n- B");
    });

    it("Shift+Tab：降级后父列表还有兄弟项 → 保留父列表", () => {
        const root = rootFromHtml("<ul><li>A<ul><li>B</li><li>C</li></ul></li></ul>");
        expect(outdentListItem(liAt(root, 1))).toBe(true);
        expect(root.querySelectorAll("ul").length).toBe(2);
        expect(serializeBlockDomToMarkdown(root, { kind: "list", listMarker: "-" })).toBe("- A\n  - C\n- B");
    });

    it("Shift+Tab：顶层项 no-op", () => {
        const root = rootFromHtml("<ul><li>A</li><li>B</li></ul>");
        const before = root.innerHTML;
        expect(outdentListItem(liAt(root, 1))).toBe(false);
        expect(root.innerHTML).toBe(before);
    });

    it("Shift+Tab：带子列表的项降级时子树跟随", () => {
        const root = rootFromHtml("<ul><li>A<ul><li>B<ul><li>C</li></ul></li></ul></li></ul>");
        expect(outdentListItem(liAt(root, 1))).toBe(true); // 降级 B（C 是其子树）
        expect(serializeBlockDomToMarkdown(root, { kind: "list", listMarker: "-" })).toBe("- A\n- B\n  - C");
    });

    it("Tab → Shift+Tab 往返回到原结构", () => {
        const root = rootFromHtml("<ul><li>A</li><li>B</li></ul>");
        indentListItem(liAt(root, 1));
        outdentListItem(liAt(root, 1));
        expect(serializeBlockDomToMarkdown(root, { kind: "list", listMarker: "-" })).toBe("- A\n- B");
    });

    it("liFromSelection：无选区时返回 null", () => {
        const root = rootFromHtml("<ul><li>A</li></ul>");
        expect(liFromSelection(root)).toBeNull();
    });
});

describe("plantCaretAnchor / focusByAnchor (F4 光标锚定)", () => {
    function mountedRoot(html: string): HTMLElement {
        const root = document.createElement("div");
        root.innerHTML = html;
        root.contentEditable = "true";
        document.body.appendChild(root);
        return root;
    }

    function placeCaret(node: Node, offset: number): void {
        const sel = window.getSelection()!;
        const range = document.createRange();
        range.setStart(node, offset);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
    }

    const mounted: HTMLElement[] = [];
    function makeRoot(html: string): HTMLElement {
        const root = mountedRoot(html);
        mounted.push(root);
        return root;
    }
    afterEach(() => {
        while (mounted.length > 0) {
            mounted.pop()!.remove();
        }
        window.getSelection()?.removeAllRanges();
    });

    it("锚定后选区回到原文本边界，且 <wbr> 不残留", () => {
        const root = makeRoot("<ul><li>A</li><li>B</li></ul>");
        const text = root.querySelectorAll("li")[1].firstChild as Text;
        placeCaret(text, 1); // 末尾
        const wbr = plantCaretAnchor(root);
        expect(wbr?.tagName).toBe("WBR");
        expect(root.querySelectorAll("wbr").length).toBe(1);

        expect(focusByAnchor(root)).toBe(true);
        expect(root.querySelectorAll("wbr").length).toBe(0);
        expect(root.innerHTML).not.toContain("wbr");
        const sel = window.getSelection()!;
        expect(sel.isCollapsed).toBe(true);
        expect(sel.anchorNode?.textContent).toBe("B");
        expect(sel.anchorOffset).toBe(1);
    });

    it("文本中间锚定 → 解析回拆分后的前一段末尾", () => {
        const root = makeRoot("<ul><li>hello</li></ul>");
        const text = root.querySelector("li")!.firstChild as Text;
        placeCaret(text, 2);
        plantCaretAnchor(root);
        expect(focusByAnchor(root)).toBe(true);
        const sel = window.getSelection()!;
        expect(sel.anchorNode?.textContent).toBe("he");
        expect(sel.anchorOffset).toBe(2);
        expect(root.querySelectorAll("wbr").length).toBe(0);
    });

    it("光标在文本头部（无前一个兄弟）→ 解析到后一个文本的开头", () => {
        const root = makeRoot("<ul><li>xy</li></ul>");
        const text = root.querySelector("li")!.firstChild as Text;
        placeCaret(text, 0);
        plantCaretAnchor(root);
        expect(focusByAnchor(root)).toBe(true);
        const sel = window.getSelection()!;
        expect(sel.anchorNode?.textContent).toBe("xy");
        expect(sel.anchorOffset).toBe(0);
    });

    it("前一个兄弟是元素 → 取其最后一个文本后代的末尾", () => {
        const root = makeRoot("<ul><li><strong>bold</strong>tail</li></ul>");
        const tail = root.querySelector("li")!.lastChild as Text;
        placeCaret(tail, 0);
        plantCaretAnchor(root);
        expect(focusByAnchor(root)).toBe(true);
        const sel = window.getSelection()!;
        expect(sel.anchorNode?.textContent).toBe("bold");
        expect(sel.anchorOffset).toBe(4);
    });

    it("无锚点 → focusByAnchor 返回 false 且不动选区", () => {
        const root = makeRoot("<ul><li>A</li></ul>");
        expect(root.querySelectorAll("wbr").length).toBe(0);
        expect(focusByAnchor(root)).toBe(false);
    });

    it("无选区 → plantCaretAnchor 返回 null", () => {
        const root = makeRoot("<ul><li>A</li></ul>");
        window.getSelection()?.removeAllRanges();
        expect(plantCaretAnchor(root)).toBeNull();
    });

    it("Tab 缩进后光标仍在被操作的项内（锚定闭环）", () => {
        const root = makeRoot("<ul><li>A</li><li>B</li></ul>");
        const text = root.querySelectorAll("li")[1].firstChild as Text;
        placeCaret(text, 1);
        const li = liFromSelection(root)!;
        plantCaretAnchor(root);
        expect(indentListItem(li)).toBe(true);
        normalizeListDom(root);
        expect(focusByAnchor(root)).toBe(true);
        const sel = window.getSelection()!;
        // 光标所在项已缩进为 A 的子项，文字仍是 B。
        expect((sel.anchorNode?.parentElement as HTMLElement).closest("li")?.textContent).toBe("B");
        expect(root.querySelectorAll("wbr").length).toBe(0);
        expect(serializeBlockDomToMarkdown(root, { kind: "list", listMarker: "-" })).toBe("- A\n  - B");
    });
});
