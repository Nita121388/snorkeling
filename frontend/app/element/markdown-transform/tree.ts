// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * M1 只读块模型（P1-B）：把 markdown 源码文本解析成一棵「块树」。
 *
 * 目标（对标思源/我来的块编辑体验的地基）：`Markdown 原文 → parse → Block[]（带稳定
 * 行坐标）→ renderer` 的最小闭环。每个块携带稳定坐标（源码行范围）与嵌套结构，供
 * P2 的"编辑路径收敛到 AST"消费。
 *
 * 设计：
 * - 复用 `markdown-transform/block-type` 的识别逻辑（findBlockRangeAtLine /
 *   computeFenceSpans / detectBlockKind），保持一致的分块语义（GFM 表格分隔行、
 *   CommonMark 围栏、松散/紧凑列表等）。
 * - 纯函数，无 DOM/React 依赖，可单测。
 * - P1 只做**只读**块模型；编辑操作仍走现有文本变换，行为零变化。
 *
 * 协调规则：
 * - 顶层扫描：顺序遍历每一行，对每块起始行调 findBlockRangeAtLine 取完整范围，然后
 *   把游标直接推进到 range.end+1，跳过已覆盖行（不含空白，空白行属于间隙）。
 * - 嵌套：列表组的每个「列表项 marker 行」作为顶层块（bulleted/numbered/todo 各一项），
 *   其下缩进的续行作为 children 块；quote 整体一块（M1 不细分 quote 内层）。
 */

import {
    findBlockRangeAtLine,
    isTableSeparatorLine,
    type BlockKind,
    type BlockRange,
} from "./block-type";

/**
 * 块模型自己的块种类：在 block-type 的 BlockKind 基础上补充 "hr"（block-type 未把
 * 分隔线建模为块，它的 findBlockRangeAtLine 会把 `***` 误并入相邻段落）。tree.ts 在
 * 内部识别 hr，不改 block-type（那会波及编辑引擎 transform/detect 逻辑）。
 */
export type TreeBlockKind = BlockKind | "hr";

export interface Block {
    /** 稳定 id：hash(kind:startLine:endLine)，纯函数、确定性。 */
    id: string;
    kind: TreeBlockKind;
    /** 0-based, inclusive */
    startLine: number;
    /** 0-based, inclusive */
    endLine: number;
    /** 列表嵌套层级（顶层=0）。 */
    depth: number;
    /** 该块源码文本（不含行尾换行；续行保留缩进）。 */
    text: string;
    /** 嵌套子块（M1：列表项下缩进续行；其余类型通常为空）。 */
    children: Block[];
}

function hashCode(s: string): string {
    let h = 5381;
    for (let i = 0; i < s.length; i++) {
        h = ((h << 5) + h) ^ s.charCodeAt(i);
        h = h >>> 0;
    }
    return h.toString(36);
}

/** 稳定块 id：kind + 行范围。 */
function blockId(kind: TreeBlockKind, startLine: number, endLine: number): string {
    return hashCode(`${kind}:${startLine}:${endLine}`);
}

const ListItemLineRe = /^(\s*)([-+*]|\d{1,9}[.)])([ \t]+\[[ xX]\])?[ \t]+/;
const HrLineRe = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;

/** 该行是否是一个列表项 marker 行。 */
function isListItemLine(line: string): boolean {
    return ListItemLineRe.test(line);
}

/** 列表项缩进宽度（空格数）。 */
/** 列表项缩进宽度（空格数）。 */
function itemIndent(line: string): number {
    const m = line.match(/^\s*/);
    return m?.[0].length ?? 0;
}

/** 该行是否是一条分隔线（CommonMark hrule）。`---` 这类孤立行在这里视为 hr；真表格分隔行
 * 带竖线（`| --- |`），不匹配本正则，仍由 findBlockRangeAtLine 并入表格块。 */
function isHrLine(line: string): boolean {
    return HrLineRe.test(line);
}

/**
 * 裁剪一个 text 块范围：若 findBlockRangeAtLine 返回的范围跨过 hr 行（其 text 分支不把
 * hr 当停止边界），这里把端点收束到不含 hr 的范围，保证坐标不与 hr 块重叠。
 */
function clipAtHr(lines: string[], range: BlockRange, fromIdx: number): BlockRange {
    let start = range.start;
    let end = range.end;
    // 向左收束到不包含 hr 行
    while (start <= end && isHrLine(lines[start])) {
        start++;
    }
    while (start <= end && isHrLine(lines[end])) {
        end--;
    }
    if (start > end) {
        // 整段只有 hr（理论上已被主循环前置分支捕获，这里兜底返回单行长块）
        return { start: fromIdx, end: fromIdx };
    }
    return { start, end };
}

/** 取一块的源码文本（行拼接，不含尾换行）。 */
function blockText(lines: string[], range: BlockRange): string {
    return lines.slice(range.start, range.end + 1).join("\n");
}

/**
 * 把一个列表组（range 覆盖整组）切成顶层列表项块。每个 marker 行成为一层块，其后
 * 相同缩进的 marker 是兄弟；更缩进的续行/marker 递归为 children。返回切割后的
 * 顶层列表项块列表（块范围不重叠，合起来覆盖 range）。
 */
function splitListItems(
    lines: string[],
    range: BlockRange,
    kind: BlockKind
): { items: BlockRange[]; itemKinds: BlockKind[] } {
    const items: BlockRange[] = [];
    const itemKinds: BlockKind[] = [];
    const baseIndent = itemIndent(lines[range.start]);

    let i = range.start;
    while (i <= range.end) {
        if (isListItemLine(lines[i]) && itemIndent(lines[i]) === baseIndent) {
            const itemStart = i;
            let itemEnd = i;
            // 收集该项的后续行（同层 marker 之前、range 内）。
            let j = i + 1;
            while (j <= range.end) {
                if (isListItemLine(lines[j]) && itemIndent(lines[j]) === baseIndent) {
                    break; // 下一兄弟项
                }
                itemEnd = j;
                j++;
            }
            const m = lines[itemStart].match(ListItemLineRe)!;
            const itemKind: BlockKind = m[3] != null ? "todo" : /^\d/.test(m[2]) ? "numbered" : "bulleted";
            items.push({ start: itemStart, end: itemEnd });
            itemKinds.push(itemKind);
            i = itemEnd + 1;
        } else {
            i++;
        }
    }
    return { items, itemKinds };
}

/**
 * 解析 markdown 源码行数组为顶层块树（P1-B M1）。返回顶层块数组；空白行作为块间隙
 * 不产出块。块坐标严格基于源码行号，无重叠。
 */
export function buildBlockTree(lines: string[]): Block[] {
    const root: Block[] = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];
        // 分隔线优先：CommonMark hrule。前置识别保证 hr 行永远不会被相邻段落跨行并入
        // （block-type 的 findBlockRangeAtLine 会把 `***` 当 text 并跨进相邻段，见 design 注）。
        // 真表格分隔行 `| --- |` 带竖线不匹配 HrLineRe，仍由 findBlockRangeAtLine 并入表格块。
        if (isHrLine(line)) {
            root.push({
                id: blockId("hr", i, i),
                kind: "hr",
                startLine: i,
                endLine: i,
                depth: 0,
                text: line,
                children: [],
            });
            i++;
            continue;
        }
        if (line.trim() === "" || isTableSeparatorLine(line)) {
            i++;
            continue; // 空白与孤立表格分隔：间隙跳过（真表格分隔由 findBlockRangeAtLine 处理）
        }

        const range = findBlockRangeAtLine(lines, i + 1);
        if (range == null) {
            i++;
            continue;
        }
        const blockKind: TreeBlockKind = range.kind;
        // text 块防御：若 findBlockRangeAtLine 返回的范围跨过 hr 行（其 text 分支不把 hr
        // 当边界），裁剪端点到 hr 前，避免坐标重叠/吞并分隔线。
        const span = blockKind === "text" ? clipAtHr(lines, range, i) : { start: range.start, end: range.end };
        const { start, end } = span;
        const kind = blockKind;

        if (kind === "bulleted" || kind === "numbered" || kind === "todo") {
            // 列表组：切分成列表项块，每项一层块，缩进续行递归为 children。
            const { items, itemKinds } = splitListItems(lines, { start, end }, kind);
            for (let k = 0; k < items.length; k++) {
                const item = items[k];
                const itemKind = itemKinds[k] ?? kind;
                root.push({
                    id: blockId(itemKind, item.start, item.end),
                    kind: itemKind,
                    startLine: item.start,
                    endLine: item.end,
                    depth: 0,
                    text: blockText(lines, item),
                    children: buildNestedChildren(lines, item, itemKind, 1),
                });
            }
        } else {
            root.push({
                id: blockId(kind, start, end),
                kind,
                startLine: start,
                endLine: end,
                depth: 0,
                text: blockText(lines, range),
                children: [],
            });
        }

        i = end + 1;
    }

    return root;
}

/**
 * 递归构建列表项的嵌套子块：给定列表项范围与当前深度，收集该项内缩进的续行/子列表
 * marker 行作为子块。M1 保持简单：缩进 marker 行成为嵌套列表项块，非 marker 续行并入
 * 最近的子块文本。返回该列表项的子块数组（不再递归细分三层以上——M1 只做两层）。
 */
function buildNestedChildren(
    lines: string[],
    range: BlockRange,
    _parentKind: BlockKind,
    depth: number
): Block[] {
    const children: Block[] = [];
    if (depth > 2) {
        return children; // M1 只做两层嵌套
    }
    const baseIndent = itemIndent(lines[range.start]);

    // 收集该项内、比 baseIndent 更缩进的行。
    let i = range.start;
    while (i <= range.end) {
        const l = lines[i];
        if (isListItemLine(l) && itemIndent(l) > baseIndent) {
            // 嵌套子列表项：找其范围（直到下一个同级缩进 marker 或父项结束）。
            const childStart = i;
            const childIndent = itemIndent(l);
            let childEnd = i;
            let j = i + 1;
            while (j <= range.end) {
                if (isListItemLine(lines[j]) && itemIndent(lines[j]) <= childIndent) {
                    break;
                }
                childEnd = j;
                j++;
            }
            const m = lines[childStart].match(ListItemLineRe)!;
            const childKind: BlockKind = m[3] != null ? "todo" : /^\d/.test(m[2]) ? "numbered" : "bulleted";
            children.push({
                id: blockId(childKind, childStart, childEnd),
                kind: childKind,
                startLine: childStart,
                endLine: childEnd,
                depth,
                text: blockText(lines, { start: childStart, end: childEnd }),
                children: [],
            });
            i = childEnd + 1;
            continue;
        }
        i++;
    }
    return children;
}
