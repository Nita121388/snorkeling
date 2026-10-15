// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom

/**
 * caret 桥的独立测试面 —— **双向映射**，重点是「标记不占字符」这件事。
 *
 * 用例设计原则：每条都在证明「markdown 偏移 ≠ 可见文本偏移」，因为这正是光标跳动的根因。
 */

import { beforeEach, describe, expect, it } from "vitest";
import { caretToMarkdownOffset, placeCaretByTextOffset, selectionToMarkdownRange } from "./caret";

let root: HTMLElement;

beforeEach(() => {
    document.body.innerHTML = "";
    root = document.createElement("div");
    document.body.appendChild(root);
});

/** 构造块根 + 把光标/选区落在给定文本节点上。 */
function seed(html: string): void {
    root.innerHTML = html;
}

function caretTo(node: Node, offset: number): void {
    const range = document.createRange();
    range.setStart(node, offset);
    range.collapse(true);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
}

function selectBetween(startNode: Node, startOff: number, endNode: Node, endOff: number): void {
    const range = document.createRange();
    range.setStart(startNode, startOff);
    range.setEnd(endNode, endOff);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
}

describe("caretToMarkdownOffset：DOM 光标 → markdown 偏移", () => {
    it("纯文本块：偏移与可见文本一致", () => {
        seed("<p>hello</p>");
        const text = root.querySelector("p")!.firstChild!;
        caretTo(text, 3);
        expect(caretToMarkdownOffset(root, { kind: "p" })).toBe(3);
    });

    it("强调标记不占字符：光标在加粗中间 → 偏移落在 `**` 之后", () => {
        seed("<p>ab<strong>cd</strong></p>");
        const strongText = root.querySelector("strong")!.firstChild!;
        caretTo(strongText, 1); // 在 "cd" 的 c 之后
        const off = caretToMarkdownOffset(root, { kind: "p" })!;
        // markdown = "ab**cd**"：a0 b1 *2 *3 c4 d5 *6 *7。哨兵插在 c 之后 → 5。
        expect(off).toBe(5);
    });

    it("heading：markdown 带 `#` 前缀，光标偏移必须把前缀算进去", () => {
        seed("<h1>title</h1>");
        const text = root.querySelector("h1")!.firstChild!;
        caretTo(text, 0);
        expect(caretToMarkdownOffset(root, { kind: "h", headingLevel: 1 })).toBe(2); // "# "
    });

    it("list：偏移把 marker 算进去（用户看不到，但提交坐标里有）", () => {
        seed("<ul><li>item</li></ul>");
        const text = root.querySelector("li")!.firstChild!;
        caretTo(text, 0);
        const off = caretToMarkdownOffset(root, { kind: "list", listMarker: "-" })!;
        expect(off).toBe(2); // "- "
    });

    it("quote：偏移把 `> ` 算进去", () => {
        seed("<blockquote><p>q</p></blockquote>");
        const text = root.querySelector("p")!.firstChild!;
        caretTo(text, 1);
        expect(caretToMarkdownOffset(root, { kind: "quote" })).toBe(3);
    });

    it("查询后 DOM 复原：哨兵移除且相邻文本节点已合并", () => {
        seed("<p>ab<em>c</em>d</p>");
        const strongText = root.querySelector("em")!.firstChild!;
        caretTo(strongText, 0);
        const before = root.innerHTML;
        caretToMarkdownOffset(root, { kind: "p" });
        // normalize() 后相邻文本节点必须合并，否则序列化器会把它们当两块内容
        expect(root.innerHTML).toBe(before);
        expect(root.querySelectorAll("p")[0].childNodes.length).toBe(3);
    });

    it("无光标 / 光标不在 root 内 → null（不是 0，0 是合法偏移）", () => {
        seed("<p>hello</p>");
        expect(caretToMarkdownOffset(root, { kind: "p" })).toBeNull();
        const outside = document.createElement("p");
        outside.textContent = "outside";
        document.body.appendChild(outside);
        caretTo(outside.firstChild!, 0);
        expect(caretToMarkdownOffset(root, { kind: "p" })).toBeNull();
    });

    it("空根 → null", () => {
        seed("");
        expect(caretToMarkdownOffset(root, { kind: "p" })).toBeNull();
    });
});

describe("selectionToMarkdownRange：DOM 选区 → markdown 范围", () => {
    it("折叠选区 → null（不是选区就没有工具栏）", () => {
        seed("<p>hello</p>");
        const text = root.querySelector("p")!.firstChild!;
        caretTo(text, 2);
        expect(selectionToMarkdownRange(root, { kind: "p" })).toBeNull();
    });

    it("纯文本选区 → 起止偏移正确（end 要扣掉起点哨兵自己那 1 位）", () => {
        seed("<p>hello</p>");
        const text = root.querySelector("p")!.firstChild!;
        selectBetween(text, 1, text, 4); // 选中 "ell"
        // 序列化后是 "h<S1>ell<S2>o"：iStart=1、iEnd=5，但 S1 自己占 1 位 → end 必为 4。
        // 不扣这一位，选区就长 1 个字符（浮动工具栏会把格式套到多出的字上）。
        expect(selectionToMarkdownRange(root, { kind: "p" })).toEqual({ start: 1, end: 4 });
    });

    it("选区长度必须等于实际字数（回归钉子：曾经凭空 +1）", () => {
        seed("<p>hello</p>");
        const text = root.querySelector("p")!.firstChild!;
        selectBetween(text, 1, text, 4);
        const r = selectionToMarkdownRange(root, { kind: "p" })!;
        expect(r.end - r.start).toBe(3); // "ell"
    });

    it("跨节点选区（跨加粗）→ 起止按 markdown 位置给出", () => {
        seed("<p>ab<strong>cd</strong>ef</p>");
        const first = root.querySelector("p")!.firstChild!;
        const strongText = root.querySelector("strong")!.firstChild!;
        selectBetween(first, 1, strongText, 2); // 从 "b" 到 "cd" 之后
        const r = selectionToMarkdownRange(root, { kind: "p" })!;
        // markdown = "ab**cd**ef"：a0 b1 *2 *3 c4 d5 *6 *7 e8 f9。选中 "b**cd" → (1, 6)
        expect(r).toEqual({ start: 1, end: 6 });
    });

    it("反向选区（从右往左拖）→ start/end 被归一（不返回倒置的区间）", () => {
        seed("<p>hello</p>");
        const text = root.querySelector("p")!.firstChild!;
        // 注意：**不能用** range.setStart(4) + setEnd(1) 造反向选区 ——
        // Range 的两个边界会自动归一（start > end 时 end 被拉到 start），
        // 结果是个折叠选区、直接返回 null，测试会“假通过”。
        // 反向选区必须用 setBaseAndExtent（anchor=终点、focus=起点）。
        const sel = window.getSelection()!;
        sel.removeAllRanges();
        sel.setBaseAndExtent(text, 4, text, 1);
        const r = selectionToMarkdownRange(root, { kind: "p" })!;
        expect(r).toEqual({ start: 1, end: 4 });
        expect(r.end - r.start).toBe(3);
    });

    it("查询后 DOM 复原（两个哨兵都要移除）", () => {
        seed("<p>ab<strong>cd</strong>ef</p>");
        const first = root.querySelector("p")!.firstChild!;
        const strongText = root.querySelector("strong")!.firstChild!;
        selectBetween(first, 1, strongText, 2);
        const before = root.innerHTML;
        selectionToMarkdownRange(root, { kind: "p" });
        expect(root.innerHTML).toBe(before);
    });
});

describe("placeCaretByTextOffset：文本偏移 → DOM 光标（反向映射）", () => {
    it("落在文本节点内 → 光标落在该位置", () => {
        seed("<p>hello</p>");
        placeCaretByTextOffset(root, 3);
        const sel = window.getSelection()!;
        expect(sel.anchorNode?.textContent).toBe("hello");
        expect(sel.anchorOffset).toBe(3);
    });

    it("跨节点时累加长度（第二个节点内）", () => {
        seed("<p>ab<strong>cd</strong>ef</p>");
        placeCaretByTextOffset(root, 3); // 越过 "ab"（2）+ "cd" 的 c（1）
        const sel = window.getSelection()!;
        expect(sel.anchorNode?.textContent).toBe("cd");
        expect(sel.anchorOffset).toBe(1);
    });

    it("偏移超出末尾 → 折叠到根末尾（不抛错、不落在别处）", () => {
        seed("<p>hello</p>");
        placeCaretByTextOffset(root, 999);
        const sel = window.getSelection()!;
        expect(root.contains(sel.anchorNode!)).toBe(true);
    });

    it("空根 + 任意偏移 → 不抛错", () => {
        seed("");
        expect(() => placeCaretByTextOffset(root, 5)).not.toThrow();
    });
});