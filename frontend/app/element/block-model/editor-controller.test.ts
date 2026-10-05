// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { buildBlockTree } from "../markdown-transform/tree";
import { createEditController, lineRangeToCharOffset } from "./editor-controller";

describe("lineRangeToCharOffset — 块坐标 → 绝对字符偏移", () => {
    it("单行范围", () => {
        const text = "line one\nline two\nline three";
        // 0-based: line 1 = "line two"
        const { start, end } = lineRangeToCharOffset(text, 1, 1);
        expect(start).toBe(9); // 前一行 "line one\n" = 8+1
        expect(end).toBe(17); // start + len("line two")=8
    });

    it("多行范围含换行", () => {
        const text = "a\nb\nc\nd";
        const { start, end } = lineRangeToCharOffset(text, 0, 2);
        expect(start).toBe(0);
        // "a\nb\nc" = 1+1+1+1+1 = 5
        expect(end).toBe(5);
    });
});

describe("createEditController — 编辑控制器（P2-A1）", () => {
    const ctl = createEditController();

    it("turn-into：段落 → 标题", () => {
        const text = "hello world";
        const blocks = buildBlockTree(text.split("\n"));
        const block = blocks[0];
        expect(block.kind).toBe("text");

        const res = ctl.apply({ type: "turn-into", block, to: "heading1" }, { text });
        expect(res).not.toBeNull();
        expect(res!.text).toBe("# hello world");
    });

    it("turn-into：标题 → 段落", () => {
        const text = "# hello";
        const blocks = buildBlockTree(text.split("\n"));
        const res = ctl.apply({ type: "turn-into", block: blocks[0], to: "text" }, { text });
        expect(res?.text).toBe("hello");
    });

    it("inline-style：选中已加粗内容 → 剥离粗体（相对偏移转绝对）", () => {
        const text = "prefix **bold** suffix";
        const blocks = buildBlockTree(text.split("\n"));
        const block = blocks[0];
        // 块内相对 [start,end]，选中 "bold"（它在 \"**\" 内）→ 剥离外层 **
        const relStart = text.indexOf("bold");
        const relEnd = relStart + "bold".length;
        const res = ctl.apply(
            { type: "inline-style", block, style: "bold", start: relStart, end: relEnd },
            { text }
        );
        expect(res).not.toBeNull();
        expect(res!.text).toBe("prefix bold suffix");
    });

    it("inline-style：包裹未加粗内容（相对偏移转绝对）", () => {
        const text = "prefix word suffix";
        const blocks = buildBlockTree(text.split("\n"));
        const block = blocks[0];
        const relStart = text.indexOf("word");
        const relEnd = relStart + "word".length;
        const res = ctl.apply(
            { type: "inline-style", block, style: "bold", start: relStart, end: relEnd },
            { text }
        );
        expect(res).not.toBeNull();
        expect(res!.text).toBe("prefix **word** suffix");
    });

    it("toggle-task：翻转 checkbox", () => {
        const text = "- [ ] task";
        const blocks = buildBlockTree(text.split("\n"));
        const res = ctl.apply({ type: "toggle-task", block: blocks[0] }, { text });
        expect(res?.text).toBe("- [x] task");
    });

    it("set-code-lang：改代码块语言", () => {
        const text = "```js\nconst a = 1;\n```";
        const blocks = buildBlockTree(text.split("\n"));
        const block = blocks.find((b) => b.kind === "code");
        expect(block).toBeDefined();
        const res = ctl.apply({ type: "set-code-lang", block: block!, lang: "ts" }, { text });
        expect(res?.text).toBe("```ts\nconst a = 1;\n```");
    });

    it("renumber-list：有序列表重编号", () => {
        const text = "3. a\n5. b";
        const blocks = buildBlockTree(text.split("\n"));
        const block = blocks[0];
        const res = ctl.apply({ type: "renumber-list", block }, { text });
        // renumberOrderedListBlockAtLine 按 CommonMark 渲染重编号
        expect(res).not.toBeNull();
        expect(res!.text).not.toBe(text);
    });

    it("lineRangeToCharOffset 与 inline-style 结合：绝对偏移正确", () => {
        // 两个段落间有空行，才是两个 text 块
        const text = "first\n\nsecond third";
        const blocks = buildBlockTree(text.split("\n"));
        const block = blocks.find((b) => b.kind === "text" && b.startLine === 2)!;
        expect(block).toBeDefined();
        const rel = lineRangeToCharOffset(text, block.startLine, block.endLine);
        expect(text.slice(rel.start, rel.end)).toBe("second third");
    });
});
