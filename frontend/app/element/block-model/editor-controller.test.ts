// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { buildBlockTree, type Block } from "../markdown-transform/tree";
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

    it("set-code-lang：代码块不在首行（模拟 markdown.tsx 的 1-based 会话行号 → 0-based Block）", () => {
        // 代码块前有 2 行文字；代码块起始 0-based 行 2（1-based 会话行号 3）。
        const text = "intro line\nsecond line\n```js\nconst x = 2;\n```";
        const blocks = buildBlockTree(text.split("\n"));
        const block = blocks.find((b) => b.kind === "code")!;
        expect(block.startLine).toBe(2); // 0-based

        // markdown.tsx onApplyLanguage 把 1-based 会话行号（3）转 0-based（startLine-1=2）
        const line1 = 3; // 1-based 会话行号（editSession.startLine）
        const line0 = line1 - 1; // → 0-based Block.startLine
        const converted: Block = { ...block, startLine: line0, endLine: line0 };
        const res = ctl.apply({ type: "set-code-lang", block: converted, lang: "ts" }, { text });
        expect(res?.text).toBe("intro line\nsecond line\n```ts\nconst x = 2;\n```");
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

describe("createEditController — replace-content（prose WYSIWYG 提交收敛，P2-B2）", () => {
    const ctl = createEditController();

    // 与 markdown-inline-edit commit 的 replaceSourceRange 对同一 [start, end]+content 输出保持等价。
    const refReplace = (
        text: string,
        startLine: number, // 1-based inclusive
        endLine: number,
        newSegment: string
    ): string => {
        const lines = text.split(/\r\n|\n/);
        const safeStart = Math.min(Math.max(1, Math.trunc(startLine)), lines.length || 1);
        const safeEnd = Math.max(safeStart, Math.min(Math.trunc(endLine), lines.length));
        const before = lines.slice(0, safeStart - 1);
        const after = lines.slice(safeEnd);
        const replacement = newSegment.length > 0 ? newSegment.split(/\r\n|\n/) : [];
        const crlfCount = (text.match(/\r\n/g) || []).length;
        const lfCount = (text.match(/\n/g) || []).length;
        const eol = crlfCount > lfCount / 2 ? "\r\n" : "\n";
        return [...before, ...replacement, ...after].join(eol);
    };

    const applyReplace = (text: string, startLine0: number, endLine0: number, content: string) => {
        const block: Block = {
            id: `t:${startLine0}:${endLine0}`,
            kind: "text",
            startLine: startLine0,
            endLine: endLine0,
            depth: 0,
            text: "",
            children: [],
        };
        return ctl.apply({ type: "replace-content", block, content }, { text });
    };

    it("单行段落替换", () => {
        const text = "hello world";
        const res = applyReplace(text, 0, 0, "new text");
        expect(res?.text).toBe("new text");
        expect(res?.text).toBe(refReplace(text, 1, 1, "new text"));
    });

    it("中段块：块前有内容、块后紧跟下一块时不吞换行/后续块", () => {
        const text = "first line\nsecond line\nthird line";
        const res = applyReplace(text, 1, 1, "REPLACED");
        expect(res?.text).toBe("first line\nREPLACED\nthird line");
        expect(res?.text).toBe(refReplace(text, 2, 2, "REPLACED"));
    });

    it("多行 soft-break 段落：endLine > startLine 整块替换", () => {
        const text = "LINE A\nLINE B\nLINE C";
        // 0-based 行 1-2 是多行块
        const res = applyReplace(text, 1, 2, "Multi\nline");
        expect(res?.text).toBe("LINE A\nMulti\nline");
        expect(res?.text).toBe(refReplace(text, 2, 3, "Multi\nline"));
    });

    it("space 前缀内容与后续内容拼接", () => {
        const text = "aa\nbb\ncc";
        const res = applyReplace(text, 0, 0, "xx");
        expect(res?.text).toBe("xx\nbb\ncc");
        expect(res?.text).toBe(refReplace(text, 1, 1, "xx"));
    });

    it("block 坐标校验 start/end 在行范围内", () => {
        const text = "aa\nbb\ncc";
        // endLine 越界时受 lineRangeToCharOffset 的 min 保护
        const res = applyReplace(text, 1, 5, "yy");
        expect(res).not.toBeNull();
    });

    it("替代 caret 定位（可选输出）", () => {
        const text = "prefix\nbody";
        const res = applyReplace(text, 1, 1, "XY");
        // caret 落在替换内容末尾
        expect(res?.caret).toBe(text.indexOf("body") + 2);
    });

    it("CRLF 文件：已知 EOL 差异（非生产场景，wave 保存一律 \\n）", () => {
        // lineRangeToCharOffset 按 \n 切，\r 归属块行内容（"b\r"），end 指向分隔符 \n 前。
        // 替换段内不重写 EOL，块边缘的 \n 分隔符保留 → 与 replaceSourceRange 的 dominant-EOL
        // 重 join 语义有已知差异。wave 保存一律 \n（dom-to-markdown 注释），CRLF 非生产场景，
        // 收敛不改变该行为；若未来需严格对齐，在控制器内做 dominant-EOL 归并即可。
        const text = "a\r\nb\r\nc";
        const res = applyReplace(text, 1, 1, "B2");
        // 实际：块行内容含 \r，替换后边缘换行保持 \n（不重写为 \r\n）
        expect(res?.text).toBe("a\r\nB2\nc");
    });

    it("空内容：控制器留空行（差异契约；调用方 guard 保证不进入本分支）", () => {
        // 控制器 replace-content 是字符范围替换：空 content 替换 [start..end] 内容段，
        // 块尾的 \n 分隔符由 text.slice(end) 保留 → 清空段落会产生一个多余空行：
        //   replace-content(block 1..1, "") → "line1\n\nline3"
        //   replaceSourceRange(2,2,"")        → "line1\nline3"（空 segment = 删整行，不留空行）
        // 调用方（markdown-inline-edit commit 的 wysiwyg-prose 分支）以
        // `committedDraft.length > 0` 保证空内容永不进入本 intent、回落原 replaceSourceRange，
        // 使「清空段落 = 删除该行」与现状完全一致。此处断言控制器契约本身，防未来改动
        // 把差异悄悄带进调用路径。
        const text = "line1\npara-to-clear\nline3";
        const res = applyReplace(text, 1, 1, "");
        expect(res?.text).toBe("line1\n\nline3");
        // 明确不等价于 replaceSourceRange 的行删除语义（由调用方 guard 隔开）
        expect(res?.text).not.toBe(refReplace(text, 2, 2, ""));
    });
});
