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
 * 双轨并存：本控制器是并行能力，未接入线上编辑路径，现有 wysiwyg-editor/dom-to-markdown
 * 零改动。
 */

import {
    transformBlockType,
    type BlockKind,
} from "../markdown-transform/block-type";
import { applyInlineStyle, type InlineStyleId } from "../markdown-transform/inline-style";
import { setCodeBlockLanguage } from "../markdown-transform/code-block";
import { toggleTaskCheckboxAtLine } from "../markdown-task-toggle";
import { renumberOrderedListBlockAtLine } from "../markdown-ordered-list";
import type { Block } from "../markdown-transform/tree";

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
    | { type: "replace-content"; block: Block; content: string };

export interface EditControllerResult {
    text: string;
    /** 编辑后期望的光标绝对偏移（可选）。 */
    caret?: number;
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
                default:
                    return null;
            }
        },
    };
}
