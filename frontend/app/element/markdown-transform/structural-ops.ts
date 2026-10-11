// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * 阶段 4 M1：结构操作（块级重排 / 删除 / 复制）的**可独立求逆**数据模型。
 *
 * 为什么单独一个文件：现有 `moveBlockRange` / `deleteBlockRange`（markdown-inline-edit.tsx）
 * 是「谁需要谁调」的散装纯函数——键盘重排、拖拽重排、退格合并各自直接调用，且**没有逆操作
 * 数据**。这里把三种结构操作的结果固化成 `StructuralOp`，并给出**只依赖 op 本身**的逆操作
 * `invertStructuralOp(op)`：把 op 应用到 after 文本上应逐字节回到 before，
 * 不依赖 undo 栈里的全文本快照（那是另一条路径）。
 *
 * 硬契约（见任务 design.md）：
 *   1) 本文件**不重写**搬移/删除的行号算术——move 的逆复用 `moveBlockRange`；
 *      delete 的逆是「把 content 插回原位」（纯拼行）；duplicate 的逆复用
 *      `replaceSourceRange` 的整行删除语义。
 *   2) `StructuralOp` 里所有 range 是 **1-based inclusive** 行号。
 *      - move：`from` 是 before 坐标（块原位），`to` 是 after 坐标（块移后位）。
 *      - delete：`range` 是 before 坐标（块原位），`content` 是被删掉的**原文切片**
 *        （含被 `deleteBlockRange` 一并折叠的分隔空行，逐行原样）。
 *      - duplicate：`range` 是 before 坐标（原块），`copyRange` 是 after 坐标（副本）。
 *   3) `invert(op)(after) === before`——测试就是这条契约的护栏。
 *
 * 文档边缘空行（`edgeBlanks`）：
 *
 *   `deleteBlockRange` / `moveBlockRange` 会把**文档首/尾的空行裁掉**（它们本来就是「整理
 *   文档形状」的纯函数：删掉第一块后不该留空行开头）。这是有损的——`after` 本身不再携带
 *   「before 开头/结尾有几个空行」的信息。真实 markdown 文件常以 "\n" 结尾（split 后得到
 *   一个尾部空行元素），所以这个信息对「逐字节还原」是必需的：op 里显式记 `edgeBlanks`，
 *   `invert` 在把中间部分还原后，再把首/尾空行补回去。没有这一步，`invert(op)(after)`
 *   会丢掉文件末尾那个换行。
 *
 * 依赖方向说明：本文件 import `markdown-inline-edit.tsx` 的纯函数，而 `markdown-inline-edit`
 * 也 import 编辑控制器；于是形成 editor-controller ↔ markdown-inline-edit 的模块环。
 * 这些调用全部发生在**函数体内**（非模块初始化期），且被引用的都是 `export function`
 * 声明（提升），ESM 循环求值下安全；现有测试与产物构建均通过。
 */

import { moveBlockRange, replaceSourceRange } from "../markdown-inline-edit";

/** 1-based inclusive 行范围（源码行坐标，与 markdown-inline-edit 的行号体系一致）。 */
export interface LineRange {
    start: number;
    end: number;
}

/** 文档首/尾被结构纯函数裁掉的空行数（还原时原样补回；空行本身没有内容，记数即可）。 */
export interface EdgeBlanks {
    lead: number;
    trail: number;
}

/** 结构操作的三种可逆形态。`blockId` 是块身份（data-block-id），旧 DOM 可能没有。 */
export type StructuralOp =
    | {
          type: "move";
          blockId?: string;
          /** before 坐标：块移动前的原位行范围。 */
          from: LineRange;
          /** after 坐标：块移动后的新位行范围。 */
          to: LineRange;
          /** before 文档首/尾空行数（见文件头「文档边缘空行」）。 */
          edgeBlanks?: EdgeBlanks;
      }
    | {
          type: "delete";
          blockId?: string;
          /** before 坐标：被删块的原位行范围。 */
          range: LineRange;
          /** 被删掉的原文切片（含一并折叠的分隔空行；多行用 "\n" 连接）。 */
          content: string;
          /** before 文档首/尾空行数（见文件头「文档边缘空行」）。 */
          edgeBlanks?: EdgeBlanks;
      }
    | {
          type: "duplicate";
          blockId?: string;
          /** before 坐标：原块行范围。 */
          range: LineRange;
          /** after 坐标：副本行范围（紧随原块之后，中间隔一个空行）。 */
          copyRange: LineRange;
          /** 前向复制用 `spliceInsertBlock`，不裁边缘空行——保留字段与另两种对齐。 */
          edgeBlanks?: EdgeBlanks;
      };

/** 把一段文本按行切开（统一 LF；调用方与 markdown-inline-edit 的换行约定一致）。 */
function toLines(text: string): string[] {
    return text === "" ? [] : text.split(/\r\n|\n/);
}

function blankLines(n: number): string[] {
    return n > 0 ? new Array(n).fill("") : [];
}

/**
 * 数出文档首/尾的空行数（互不重叠：整篇都是空行时 lead 拿走全部、trail 为 0）。
 */
export function edgeBlankCounts(lines: string[]): EdgeBlanks {
    let lead = 0;
    while (lead < lines.length && lines[lead] === "") {
        lead++;
    }
    let trail = 0;
    while (trail < lines.length - lead && lines[lines.length - 1 - trail] === "") {
        trail++;
    }
    return { lead, trail };
}

/**
 * 计算 `before` → `after` 过程中被移除的**中间切片**（先剥掉文档首尾空行，再取最长公共
 * 前缀 / 后缀之间的中线）。
 *
 * 用途：delete 的 `content` 必须是被 `deleteBlockRange` 删掉的原样行（块行 + 它折叠掉的
 * 分隔空行），而 deleteBlockRange 的折叠/边缘裁剪规则由它自己拥有——这里用「先归一再取
 * 差值」反推被删切片，就**不必复制**它那套算术，也不会因它日后调整而漂移。
 *
 * 前提：after 确实由 before 连续删行得到（deleteBlockRange 保证，边缘空行已单独记入
 * `edgeBlanks`）。
 */
export function removedLineSlice(
    before: string,
    after: string
): { content: string[]; edgeBlanks: EdgeBlanks } {
    const b = toLines(before);
    const a = toLines(after);
    const edgeBlanks = edgeBlankCounts(b);
    const core = b.slice(edgeBlanks.lead, b.length - edgeBlanks.trail);
    let prefix = 0;
    while (prefix < core.length && prefix < a.length && core[prefix] === a[prefix]) {
        prefix++;
    }
    let suffix = 0;
    while (suffix < core.length - prefix && suffix < a.length - prefix && core[core.length - 1 - suffix] === a[a.length - 1 - suffix]) {
        suffix++;
    }
    return { content: core.slice(prefix, core.length - suffix), edgeBlanks };
}

/** 供 delete 分支构造 op：给定 before/after 与块范围，取被删原样切片与边缘空行数。 */
export function makeDeleteOp(before: string, after: string, range: LineRange, blockId?: string): StructuralOp {
    const { content, edgeBlanks } = removedLineSlice(before, after);
    return { type: "delete", blockId, range, content: content.join("\n"), edgeBlanks };
}

/**
 * 独立求逆：返回一个「把 after 还原成 before」的纯函数，**不依赖任何历史快照**。
 *
 * - move   ：把 `to` 处的块搬回 `from.start`（复用 `moveBlockRange`），再补回文档首尾空行。
 * - delete ：把 `content` 插回 `range.start`（拼行），再补回文档首尾空行。
 * - duplicate：删掉副本，连同复制时插入的那个分隔空行（`copyRange.start - 1`），
 *            用 `replaceSourceRange` 整行删除，避免残留空行。
 */
export function invertStructuralOp(op: StructuralOp): (text: string) => string {
    switch (op.type) {
        case "move": {
            const { from, to } = op;
            const edge = op.edgeBlanks ?? { lead: 0, trail: 0 };
            return (text: string): string => {
                // from 是 before 全文档坐标；after 已被裁掉首部空行 ⇒ 换到 core 坐标再算锚点。
                const fromCore = { start: from.start - edge.lead, end: from.end - edge.lead };
                let back = text;
                if (fromCore.start !== to.start || fromCore.end !== to.end) {
                    // 锚点必须落在「被移动块当前范围」之外，否则 moveBlockRange 会把它当成
                    // 原地丢弃（tgt ∈ [srcStart..srcEnd] 的 no-op 短路）——这正是「多块范围 +
                    // 目标在源之前」会踩的坑（from.start 会落进 to 范围里）。
                    //   · 下移（to 在 from 之后）：原块首行 from.start 在上方，安全；
                    //   · 上移（to 在 from 之前）：原块末行 from.end 在下方（h 相同 ⇒ from.end >
                    //     to.end），安全。
                    // 两者都用 "before"：把块插回「原块自己那一行」之前 ⇒ 逐字节回到原位。
                    const anchor = to.start < fromCore.start ? fromCore.end : fromCore.start;
                    back = moveBlockRange(text, to.start, to.end, anchor, "before").text;
                }
                return [...blankLines(edge.lead), ...toLines(back), ...blankLines(edge.trail)].join("\n");
            };
        }
        case "delete": {
            const { range, content } = op;
            const edge = op.edgeBlanks ?? { lead: 0, trail: 0 };
            return (text: string): string => {
                const contentLines = toLines(content);
                let leadContent = 0;
                while (leadContent < contentLines.length && contentLines[leadContent] === "") {
                    leadContent++;
                }
                // 插回点：块在 core（after 无首部空行）里的位置减去 content 自带的前导分隔空行。
                const target = toLines(text);
                const at = Math.max(0, Math.min(range.start - edge.lead - leadContent - 1, target.length));
                const core = [...target.slice(0, at), ...contentLines, ...target.slice(at)];
                return [...blankLines(edge.lead), ...core, ...blankLines(edge.trail)].join("\n");
            };
        }
        case "duplicate": {
            const { copyRange } = op;
            return (text: string): string =>
                replaceSourceRange(text, Math.max(1, copyRange.start - 1), copyRange.end, "");
        }
    }
}

/** 结构操作是否真的改动了文本（no-op 时调用方不入 undo 栈）。 */
export function structuralOpChanged(op: StructuralOp): boolean {
    switch (op.type) {
        case "move":
            return op.from.start !== op.to.start || op.from.end !== op.to.end;
        case "delete":
        case "duplicate":
            return true;
    }
}

// `deleteBlockRange` 由消费方（编辑控制器）直接委派；这里 re-export 便于本目录内引用与测试。
export { deleteBlockRange, moveBlockRange, replaceSourceRange } from "../markdown-inline-edit";
