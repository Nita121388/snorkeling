// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * 块区间纯函数（md-core 抽离 P0 · C1）。
 *
 * 本文件是**纯函数模块**：只做「源码文本 ↔ 源码文本」的行区间运算。
 * 硬约束：
 *   - 禁止 import React / DOM / jotai / store / view / util 等任何宿主依赖；
 *   - 禁止读模块级可变状态（无闭包、无单例、无会话对象）；
 *   - 只允许相对 import 本目录内的其它纯模块（当前为零依赖）。
 *
 * 为什么单独一个文件：这 4 个函数原先住在编辑壳（2461 行）里。
 * `markdown-transform/structural-ops.ts` 与 `block-model/editor-controller.ts` 需要它们，
 * 于是核心层反向依赖编辑壳，抽离 md-core 时形成阻塞。下沉到本模块后依赖方向变为单向：
 *   编辑壳 / 结构操作 / 编辑控制器 → block-range（纯）
 * 编辑壳仍 re-export 同名符号，对外 API 逐字不变（21 个外部引用点无需改动）。
 *
 * 所有行号均为 **1-based inclusive**（与编辑壳的行号体系一致）。
 */

/**
 * Replace an inclusive [startLine..endLine] range (1-based, original-coordinate) inside `text`
 * with `newSegment`. Lines outside the range are preserved verbatim, including EOL style:
 * we split on /\r\n|\n/ but always join with "\n". CRLF inputs will lose CR.
 * For markdown source the existing files are saved by Wave with "\n" so this is fine in practice.
 *
 * If newSegment is the empty string, the range is deleted (no empty line left behind unless
 * newSegment itself contains empty lines — caller's responsibility).
 */
export function replaceSourceRange(text: string, startLine: number, endLine: number, newSegment: string): string {
    const lines = text.split(/\r\n|\n/);
    const safeStart = Math.min(Math.max(1, Math.trunc(startLine)), lines.length || 1);
    const safeEnd = Math.max(safeStart, Math.min(Math.trunc(endLine), lines.length));
    const before = lines.slice(0, safeStart - 1);
    const after = lines.slice(safeEnd); // endLine is inclusive → slice from endLine (index endLine-1+1)
    const replacement = newSegment.length > 0 ? newSegment.split(/\r\n|\n/) : [];
    // Preserve the source file's dominant EOL. split swallowed every \r\n / \n, so re-join with
    // whichever style wins a simple count — without this, saving an Obsidian note that is entirely
    // CRLF would silently flatten every line to LF and flood the diff for a one-paragraph edit.
    // Mixed-EOL files resolve to the majority style; same heuristic most editors pick, and plenty
    // for the "edit one paragraph" path this function serves.
    const crlfCount = (text.match(/\r\n/g) || []).length;
    const lfCount = (text.match(/\n/g) || []).length;
    const eol = crlfCount > lfCount / 2 ? "\r\n" : "\n";
    return [...before, ...replacement, ...after].join(eol);
}

/**
 * Pure insert helper used by the insert-mode commit: splice `draftLines` into `lines` as a
 * new block before/after the anchor line (1-based), bracketed by a blank line so it renders
 * as its own block. Exported for tests.
 */
export function spliceInsertBlock(
    lines: string[],
    startLine: number,
    endLine: number,
    mode: "before" | "after",
    draftLines: string[]
): string[] {
    // Bracket the WHOLE anchor block, not just its first line: lists / tables / code blocks /
    // multi-line paragraphs span [startLine..endLine] (data-source-line-end), and "after" must
    // splice below endLine or the new block lands mid-block (e.g. tearing a list open between
    // its items). before → above startLine, after → below endLine.
    const startIdx = Math.max(0, Math.min(startLine - 1, lines.length));
    const endIdx = Math.max(0, Math.min(endLine - 1, lines.length));
    const block = mode === "before" ? [...draftLines, ""] : ["", ...draftLines];
    const next = lines.slice();
    next.splice(mode === "before" ? startIdx : endIdx + 1, 0, ...block);
    return next;
}

/** Result of moving a block: the rewritten text plus the moved block's new 1-based start line. */
export type MoveBlockResult = { text: string; newStartLine: number };

/**
 * Pure helper for deleting a whole block [startLine..endLine] from the source text. Keeps the
 * document tidy: also removes one leading/trailing blank line around the block (the separator
 * lines) and collapses any accidental blank run at the junction to a single blank, so deleting
 * a paragraph doesn't leave three consecutive blank lines. Returns the new full text.
 */
export function deleteBlockRange(fullText: string, startLine: number, endLine: number): string {
    const lines = fullText.split(/\r\n|\n/);
    const safeStart = Math.max(1, Math.min(Math.trunc(startLine), lines.length));
    const safeEnd = Math.max(safeStart, Math.min(Math.trunc(endLine), lines.length));
    const before = lines.slice(0, safeStart - 1);
    const after = lines.slice(safeEnd);
    // The block is normally wrapped in blank separator lines: drop ONE of the two (keep the
    // other) so the surrounding blocks still have a single blank between them. If only one
    // side has a blank, keep it (it's the paragraph separator).
    if (before.length > 0 && before[before.length - 1] === "" && after.length > 0 && after[0] === "") {
        before.pop();
    }
    const merged = before.concat(after);
    // never leave a leading/trailing blank (e.g. deleting the very first block)
    while (merged.length > 0 && merged[0] === "") {
        merged.shift();
    }
    while (merged.length > 0 && merged[merged.length - 1] === "") {
        merged.pop();
    }
    return merged.join("\n");
}

/**
 * Pure helper for block drag-and-drop reorder: move the source block range [srcStart..srcEnd]
 * (1-based, original coords) to before/after the target block anchored at `tgtLine`.
 *
 * Algorithm (order matters — remove first to avoid line-number drift):
 *   1) Remove the source block via `deleteBlockRange`, which handles the blank separator
 *      cleanup at the original junction so no orphaned blanks remain.
 *   2) Re-index the target against the post-deletion array — a source ABOVE the target shifts
 *      the target up by the source's height, so the insertion index is compensated.
 *   3) Splice the block back in, adding a separator blank ONLY where both neighbors are content.
 *      The block's internal lines (incl. blanks) are pushed verbatim, so code fences survive.
 *
 * Dropping a block onto itself (tgtLine inside [srcStart..srcEnd]) is a no-op.
 */
export function moveBlockRange(
    fullText: string,
    srcStart: number,
    srcEnd: number,
    tgtLine: number,
    mode: "before" | "after" | "inside",
    /** 缩进目标层级（inside 模式）：被拖块每行缩进到该空格数（嵌套为子项）。 */
    insideIndent?: number
): MoveBlockResult {
    const lines = fullText.split(/\r\n|\n/);
    const n = lines.length || 1;
    const s = Math.max(1, Math.min(Math.trunc(srcStart), n));
    const e = Math.max(s, Math.min(Math.trunc(srcEnd), n));
    const block = lines.slice(s - 1, e);
    const tgt = Math.max(1, Math.min(Math.trunc(tgtLine), n));

    // Dropping a block onto itself (anchor equals either edge of its own range) → no-op.
    if (tgt >= s && tgt <= e) {
        return { text: fullText, newStartLine: s };
    }

    // 1) Remove the source block (deleteBlockRange collapses one separator at the junction).
    const afterDelete = deleteBlockRange(fullText, s, e);
    const afterLines = afterDelete.split(/\r\n|\n/);

    // 2) Re-index the target against the post-deletion array.
    const height = e - s + 1;
    const tgtIdx = tgt < s ? tgt - 1 : tgt - 1 - height; // 0-based line index in afterLines

    // inside 模式（P3 F7 拖拽嵌套）：把被拖块插入到目标块之后，并整块缩进到
    // insideIndent（嵌套为目标块的子项）。不添加分隔空行（子项紧跟父项）。
    // 缩进对齐：块内各行保留相对缩进（子列表层级不变），块整体对齐到 indent。
    if (mode === "inside") {
        const insertIdx = Math.max(0, Math.min(afterLines.length, tgtIdx + 1));
        const indent = Math.max(0, insideIndent ?? 2);
        const markerIndent = Math.min(
            ...block.filter((l) => l.trim() !== "").map((l) => l.match(/^ */)?.[0].length ?? 0)
        );
        const blockIndented = block.map((line) => {
            if (line.trim() === "") return line;
            const cur = line.match(/^ */)?.[0].length ?? 0;
            return " ".repeat(indent + (cur - markerIndent)) + line.slice(cur);
        });
        const out: string[] = [];
        out.push(...afterLines.slice(0, insertIdx));
        out.push(...blockIndented);
        out.push(...afterLines.slice(insertIdx));
        while (out.length > 0 && out[0] === "") out.shift();
        while (out.length > 0 && out[out.length - 1] === "") out.pop();
        const newStartLine = insertIdx + 1;
        return { text: out.join("\n"), newStartLine };
    }

    const insertIdx = mode === "before" ? Math.max(0, tgtIdx) : Math.min(afterLines.length, tgtIdx + 1);

    // 3) Splice back in, adding a separator blank only where both neighbors are content.
    const before = afterLines.slice(0, insertIdx);
    const after = afterLines.slice(insertIdx);
    const top = block[0];
    const bottom = block[block.length - 1];
    const above = before.length > 0 ? before[before.length - 1] : null;
    const below = after.length > 0 ? after[0] : null;
    const needAboveSep = above != null && above !== "" && top !== "";
    const needBelowSep = below != null && below !== "" && bottom !== "";

    const out: string[] = [];
    out.push(...before);
    if (needAboveSep) out.push("");
    out.push(...block);
    if (needBelowSep) out.push("");
    out.push(...after);

    // Trim any leading/trailing blank the move may have left at the document edges.
    while (out.length > 0 && out[0] === "") out.shift();
    while (out.length > 0 && out[out.length - 1] === "") out.pop();

    const newStartLine = before.length + (needAboveSep ? 1 : 0) + 1;
    return { text: out.join("\n"), newStartLine };
}
