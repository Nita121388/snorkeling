// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { buildBlockTree, type Block } from "../markdown-transform/tree";
import { createEditController, lineRangeToCharOffset, makeBlockRef } from "./editor-controller";
import { invertStructuralOp } from "../markdown-transform/structural-ops";
import { moveBlockRange } from "../markdown-transform/block-range";

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

describe("createEditController — 结构意图（阶段 4 M1）", () => {
    const ctl = createEditController();

    it("move-block：委派 moveBlockRange，返回文本 + 可求逆的 op", () => {
        const text = "A\n\nB\n\nC";
        // B 是 0-based 块 2..2（1-based 3..3）
        const block = makeBlockRef("blk-b", 3, 3);
        const res = ctl.apply({ type: "move-block", block, targetLine: 5, mode: "after" }, { text });
        expect(res).not.toBeNull();
        expect(res!.text).toBe("A\n\nC\n\nB");
        expect(res!.op?.type).toBe("move");
        expect(invertStructuralOp(res!.op!)(res!.text)).toBe(text);
    });

    it("move-block：多块范围上移也可逆", () => {
        const text = "A\n\nB\n\nC\n\nD";
        const block = makeBlockRef("blk-cd", 5, 7);
        const res = ctl.apply({ type: "move-block", block, targetLine: 1, mode: "before" }, { text });
        expect(res!.text).toBe("C\n\nD\n\nA\n\nB");
        expect(invertStructuralOp(res!.op!)(res!.text)).toBe(text);
    });

    it("move-block：原地放下（no-op）返回 null，调用方不入 undo 栈", () => {
        const text = "A\n\nB\n\nC";
        const block = makeBlockRef("blk-a", 1, 1);
        const res = ctl.apply({ type: "move-block", block, targetLine: 1, mode: "before" }, { text });
        expect(res).toBeNull();
    });

    it("delete-block：删除整块且不留双空行，op 可求逆", () => {
        const text = "A\n\nB\n\nC";
        const block = makeBlockRef("blk-b", 3, 3);
        const res = ctl.apply({ type: "delete-block", block }, { text });
        expect(res!.text).toBe("A\n\nC");
        expect(res!.op?.type).toBe("delete");
        expect(invertStructuralOp(res!.op!)(res!.text)).toBe(text);
    });

    it("delete-block：首块边界（不留开头空行）", () => {
        const text = "A\n\nB\n\nC";
        const block = makeBlockRef("blk-a", 1, 1);
        const res = ctl.apply({ type: "delete-block", block }, { text });
        expect(res!.text).toBe("B\n\nC");
        // 删掉首块后光标落到（新的）首块起始 = 偏移 0
        expect(res!.caret).toBe(0);
        expect(invertStructuralOp(res!.op!)(res!.text)).toBe(text);
    });

    it("delete-block：末块边界（光标落到文档末尾）", () => {
        const text = "A\n\nB\n\nC";
        const block = makeBlockRef("blk-c", 5, 5);
        const res = ctl.apply({ type: "delete-block", block }, { text });
        expect(res!.text).toBe("A\n\nB");
        expect(res!.caret).toBe("A\n\nB".length);
        expect(invertStructuralOp(res!.op!)(res!.text)).toBe(text);
    });

    it("delete-block：多块范围（含分隔空行一并折叠）", () => {
        const text = "A\n\nB\n\nC\n\nD";
        const block = makeBlockRef("blk-bc", 3, 5);
        const res = ctl.apply({ type: "delete-block", block }, { text });
        expect(res!.text).toBe("A\n\nD");
        expect(invertStructuralOp(res!.op!)(res!.text)).toBe(text);
    });

    it("duplicate-block：副本紧随其后且内容一致，op 可求逆", () => {
        const text = "A\n\nB\n\nC";
        const block = makeBlockRef("blk-b", 3, 3);
        const res = ctl.apply({ type: "duplicate-block", block }, { text });
        expect(res!.text).toBe("A\n\nB\n\nB\n\nC");
        expect(res!.op?.type).toBe("duplicate");
        expect(invertStructuralOp(res!.op!)(res!.text)).toBe(text);
    });

    it("duplicate-block：光标落在副本起始（连续复制得到 A A A）", () => {
        const text = "A";
        const block = makeBlockRef("blk-a", 1, 1);
        const first = ctl.apply({ type: "duplicate-block", block }, { text });
        expect(first!.text).toBe("A\n\nA");
        // 副本在 1-based 行 3 ⇒ 光标偏移 = 3（"A\n\n" 之后）
        expect(first!.caret).toBe(3);
        // 对副本再复制一次：副本紧随其后
        const block2 = makeBlockRef("blk-a2", 3, 3);
        const second = ctl.apply({ type: "duplicate-block", block: block2 }, { text: first!.text });
        expect(second!.text).toBe("A\n\nA\n\nA");
    });

    it("内容类意图不携带 op（返回契约区分）", () => {
        const text = "hello world";
        const block = buildBlockTree(text.split("\n"))[0];
        const res = ctl.apply({ type: "turn-into", block, to: "heading1" }, { text });
        expect(res!.op).toBeUndefined();
    });

    it("结构意图对 CRLF 文本保持与既有纯函数一致", () => {
        // 既有纯函数按 /\r\n|\n/ 切行、join("\n") 输出（CRLF 会被归一为 LF），
        // 控制器委派它们 ⇒ 同一行为（非生产场景，wave 一律 \n）。
        const crlf = "A\r\n\r\nB\r\n\r\nC";
        const block = makeBlockRef("blk-b", 3, 3);
        const res = ctl.apply({ type: "delete-block", block }, { text: crlf });
        expect(res!.text).toBe("A\n\nC");
    });

    it("M2 回归：统一意图与旧直调 moveBlockRange 逐字节一致（P3 键盘/拖拽重排用例输入）", () => {
        // markdown.tsx 的 moveFocusedBlock / 拖拽 drop 现经 move-block 意图；这条用例锁定
        // 「与旧实现逐字节相同」，防止未来在控制器里引入额外归一化。
        const cases: { doc: string; s: number; e: number; tgt: number; mode: "before" | "after" }[] = [
            { doc: "# title\n\nB\n\nC\n\nD", s: 3, e: 5, tgt: 7, mode: "after" },
            { doc: "A\n\nB\n\nC\n\nD", s: 5, e: 7, tgt: 1, mode: "before" },
            { doc: "hello\n\nworld", s: 3, e: 3, tgt: 1, mode: "before" },
            { doc: "A\n\nB\n\nC", s: 3, e: 3, tgt: 1, mode: "before" },
            { doc: "A\n\nB\n\nC", s: 1, e: 1, tgt: 5, mode: "after" },
        ];
        for (const c of cases) {
            const direct = moveBlockRange(c.doc, c.s, c.e, c.tgt, c.mode);
            const res = ctl.apply(
                { type: "move-block", block: makeBlockRef(undefined, c.s, c.e), targetLine: c.tgt, mode: c.mode },
                { text: c.doc }
            );
            expect(res!.text).toBe(direct.text);
        }
    });
});
