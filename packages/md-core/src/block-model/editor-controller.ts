// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * P2-A1 编辑控制器（编辑路径收敛到 AST 块模型的第一步）。
 *
 * 把「对某一块模型的编辑意图」翻译成现有 markdown-transform 纯函数变换，产出新全文。
 * 纯函数薄壳，无 DOM/React 依赖，可单测。产出文本后由调用方走 handleInlineEditCommit
 * （从而进入 P1 统一 undo 栈）——本控制器不直接提交，保持「意图 → 变换 → 文本」纯净。
 *
 * 复用（不改签名/行为）：
 *   - transformBlockType          —— turn-into（源码文本级块类型重写）
 *   - applyInlineStyle            —— inline-style（需从块坐标换算绝对字符偏移）
 *   - toggleTaskCheckboxAtLine    —— toggle-task
 *   - setCodeBlockLanguage        —— set-code-lang
 *   - renumberOrderedListBlockAtLine —— renumber-list
 *
 * 双轨并存：控制器本身是「意图 → 变换 → 文本」的纯函数层，不碰 DOM/React；消费者把返回文本
 * 交给 markdown.tsx 的 handleInlineEditCommit（进统一 undo 栈）。阶段 4 起结构操作
 * （move/delete/duplicate-block）也走这里，并额外返回可独立求逆的 `StructuralOp`。
 */

import {
    transformBlockType,
    type BlockKind,
} from "../transform/block-type";
import { applyInlineStyle, type InlineStyleId } from "../transform/inline-style";
import { setCodeBlockLanguage } from "../transform/code-block";
import {
    edgeBlankCounts,
    makeDeleteOp,
    type LineRange,
    type StructuralOp,
} from "../transform/structural-ops";
import { deleteBlockRange, moveBlockRange, spliceInsertBlock } from "../transform/block-range";
import { toggleTaskCheckboxAtLine } from "../shared/markdown-task-toggle";
import { renumberOrderedListBlockAtLine } from "../shared/markdown-ordered-list";
import type { Block, TreeBlockKind } from "../transform/tree";

/** 一个「对某块模型的编辑意图」。所有坐标取自 Block（0-based startLine/endLine）。
 *
 * inline-style 的 start/end 是**相对 block.text 源码**的 0-based 偏移（含列表标记/标题 `#`
 * 等源码前缀），不是「渲染后可见内容」的偏移。调用方须按 block.text 计算。
 */
export type BlockEditIntent =
    | { type: "turn-into"; block: Block; to: BlockKind }
    | { type: "inline-style"; block: Block; style: InlineStyleId; start: number; end: number }
    | { type: "toggle-task"; block: Block }
    | { type: "set-code-lang"; block: Block; lang: string | null }
    | { type: "renumber-list"; block: Block }
    | { type: "replace-content"; block: Block; content: string }
    /**
     * 结构操作（阶段 4）：整块重排 / 删除 / 复制。与内容类意图同一入口、同一返回契约
     * `{ text, caret? }`，额外带回可独立求逆的 `op`。
     *
     * move-block：把 `block` 移到 `targetLine`（1-based）之前/之后。控制器**委派**既有
     * `moveBlockRange`（不重写搬移算术）；`targetLine` 语义与拖拽重排一致。
     */
    | { type: "move-block"; block: Block; targetLine: number; mode: "before" | "after" }
    /** 删除整块（含其分隔空行）。委派既有 `deleteBlockRange`。 */
    | { type: "delete-block"; block: Block }
    /** 复制整块，副本紧随其后（中间隔一个空行）。委派既有 `spliceInsertBlock`。 */
    | { type: "duplicate-block"; block: Block };

export interface EditControllerResult {
    text: string;
    /** 编辑后期望的光标绝对偏移（可选）。 */
    caret?: number;
    /**
     * 结构操作的可逆数据（只有 move-block / delete-block / duplicate-block 会带）。
     * 内容类意图不带——它们的可逆性由 undo 快照负责，这里只对结构操作提供
     * `invertStructuralOp(op)(after) === before` 的闭环数据。
     */
    op?: StructuralOp;
}

export interface EditControllerContext {
    text: string;
}

export interface EditController {
    apply(intent: BlockEditIntent, ctx: EditControllerContext): EditControllerResult | null;
}

/**
 * 计算给定（0-based, inclusive）行范围的**绝对字符偏移**。
 * 返回该行起始偏移（start）与该行结束偏移（end，不含换行符，含该行内容）。
 */
export function lineRangeToCharOffset(text: string, startLine: number, endLine: number): {
    start: number;
    end: number;
} {
    const lines = text.split("\n");
    let s = 0;
    for (let i = 0; i < Math.min(startLine, lines.length); i++) {
        s += lines[i].length + 1;
    }
    let e = s;
    for (let i = startLine; i <= Math.min(endLine, lines.length - 1); i++) {
        e += lines[i].length;
        if (i < endLine) {
            e += 1; // 行间换行
        }
    }
    return { start: s, end: e };
}

/**
 * 从「1-based 行范围 + 块身份」构造一个最小 Block。
 *
 * 结构意图只消费 `block.startLine` / `block.endLine` / `block.id`（0-based 坐标 + 身份），
 * 不使用 kind / text / children。markdown.tsx 只有编辑会话或悬停 DOM 的 1-based 行号，
 * 这里统一换算，避免每个调用点手搬 Block 对象时把 0-based/1-based 弄混。
 */
export function makeBlockRef(
    blockId: string | undefined,
    startLine1: number,
    endLine1: number,
    kind: TreeBlockKind = "text"
): Block {
    return {
        id: blockId ?? "",
        kind,
        startLine: startLine1 - 1,
        endLine: endLine1 - 1,
        depth: 0,
        text: "",
        children: [],
    };
}

/**
 * 默认实现：把 BlockEditIntent 映射到 markdown-transform 纯函数。
 * 全部是「源码文本 → 源码文本」变换，单次产出一步。
 */
export function createEditController(): EditController {
    return {
        apply(intent: BlockEditIntent, ctx: EditControllerContext): EditControllerResult | null {
            const { text } = ctx;
            const block = intent.block;
            // 1-based 行号（纯函数接口大多用 1-based）
            const line1 = block.startLine + 1;

            switch (intent.type) {
                case "turn-into": {
                    // block.kind 是 TreeBlockKind（可能含 "hr"），transformBlockType 的
                    // sourceKind 需要 BlockKind；非 BlockKind 时省略，让变换自检测。
                    const sourceKind =
                        block.kind === "hr" ? undefined : (block.kind as BlockKind);
                    const result = transformBlockType(text, line1, intent.to, sourceKind != null ? { sourceKind } : undefined);
                    if (result == null) {
                        return null;
                    }
                    return { text: result.text, caret: result.caret };
                }
                case "inline-style": {
                    const { start, end } = lineRangeToCharOffset(text, block.startLine, block.endLine);
                    // intent.start/end 是块内相对偏移（0-based，块内字符）；转绝对偏移。
                    const absStart = start + intent.start;
                    const absEnd = start + intent.end;
                    const edit = applyInlineStyle(text, absStart, absEnd, intent.style);
                    if (edit == null) {
                        return null;
                    }
                    return { text: edit.text, caret: edit.start };
                }
                case "toggle-task": {
                    const result = toggleTaskCheckboxAtLine(text, line1);
                    if (result == null) {
                        return null;
                    }
                    return { text: result };
                }
                case "set-code-lang": {
                    const result = setCodeBlockLanguage(text, line1, intent.lang);
                    if (result == null) {
                        return null;
                    }
                    return { text: result };
                }
                case "renumber-list": {
                    const result = renumberOrderedListBlockAtLine(text, line1);
                    if (result == null) {
                        return null;
                    }
                    return { text: result.text };
                }
                case "replace-content": {
                    // 整体替换块内容（prose WYSIWYG 提交）：用块坐标定位绝对字符偏移，
                    // 把 [start..end] 范围替换为 intent.content。
                    //
                    // 坐标体系：lineRangeToCharOffset 按 \n 切（与 inline-style 共享的同一坐标
                    // 体系），故本分支对 LF 文件与 replaceSourceRange 严格等价（wave 保存一律 \n）。
                    // CRLF 文件会有已知的边界 EOL 差异（\r 归属块行、\n 是分隔符），非生产场景，
                    // 见 editor-controller.test.ts 的 CRLF 用例注明。
                    const { start, end } = lineRangeToCharOffset(text, block.startLine, block.endLine);
                    const next = text.slice(0, start) + intent.content + text.slice(end);
                    return { text: next, caret: start + intent.content.length };
                }
                // ---- 结构操作（阶段 4）：只做范围推导 + op 构造 + 委派既有纯函数 --------
                // 不得在控制器里写第二份搬移/删除算术（design 硬契约）。
                case "move-block": {
                    const s = block.startLine + 1;
                    const e = block.endLine + 1;
                    const res = moveBlockRange(text, s, e, intent.targetLine, intent.mode);
                    if (res.text === text) {
                        return null; // no-op（如原地放下）：调用方不入 undo 栈
                    }
                    const height = e - s + 1;
                    const from: LineRange = { start: s, end: e };
                    const to: LineRange = { start: res.newStartLine, end: res.newStartLine + height - 1 };
                    return {
                        text: res.text,
                        caret: lineRangeToCharOffset(res.text, res.newStartLine - 1, res.newStartLine - 1).start,
                        op: {
                            type: "move",
                            blockId: block.id,
                            from,
                            to,
                            edgeBlanks: edgeBlankCounts(text.split(/\r\n|\n/)),
                        },
                    };
                }
                case "delete-block": {
                    const s = block.startLine + 1;
                    const e = block.endLine + 1;
                    const next = deleteBlockRange(text, s, e);
                    if (next === text) {
                        return null;
                    }
                    const beforeLineCount = text === "" ? 0 : text.split(/\r\n|\n/).length;
                    const afterLines = next === "" ? [] : next.split("\n");
                    // 光标：落到下一块起始；删掉的是末块则落到文档末尾（对标删除后的自然落点）。
                    const caret =
                        e >= beforeLineCount || afterLines.length === 0
                            ? next.length
                            : lineRangeToCharOffset(next, Math.min(s - 1, afterLines.length - 1), Math.min(s - 1, afterLines.length - 1)).start;
                    return { text: next, caret, op: makeDeleteOp(text, next, { start: s, end: e }, block.id) };
                }
                case "duplicate-block": {
                    const s = block.startLine + 1;
                    const e = block.endLine + 1;
                    const lines = text.split(/\r\n|\n/);
                    const blockLines = lines.slice(s - 1, e);
                    const next = spliceInsertBlock(lines, s, e, "after", blockLines).join("\n");
                    if (next === text) {
                        return null;
                    }
                    // spliceInsertBlock("after") 在 endIdx+1 处插入 ["", ...draft] ⇒ 空行在
                    // e+1 行、副本从 e+2 行开始（1-based）。
                    const copyRange: LineRange = { start: e + 2, end: e + 1 + blockLines.length };
                    return {
                        text: next,
                        caret: lineRangeToCharOffset(next, copyRange.start - 1, copyRange.start - 1).start,
                        op: { type: "duplicate", blockId: block.id, range: { start: s, end: e }, copyRange },
                    };
                }
                default:
                    return null;
            }
        },
    };
}
