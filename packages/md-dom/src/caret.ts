// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * caret 桥：**DOM 位置 ↔ markdown 偏移** 的双向映射。
 *
 * 编辑引擎里最容易出错、又最难自查的一环。用户看到的是字符位置，我们要提交的是
 * markdown 字符串的位置 —— 中间隔着 `**加粗**` / 反引号 / `- ` / `> ` 这些**不占字符的
 * 源码标记**。算错一位，用户的光标就会莫名其妙跳一下，或者选区高亮错位。
 *
 * 双向两个方向：
 * - **DOM → markdown**（`caretToMarkdownOffset` / `selectionToMarkdownRange`）：
 *   用「在光标处插一个私有区哨兵字符 → 序列化 → 找哨兵下标」得到 markdown 偏移。
 *   哨兵用 Unicode 私有区的字符（U+E000…），正常文档里不可能出现，不会与内容撞号。
 * - **markdown → DOM**（`placeCaretByTextOffset`）：沿文本节点累加偏移定位光标。
 *
 * 本模块零 React、零宿主：只依赖 md-core 的块序列化器。
 */

import { serializeBlockDomToMarkdown, type WysiwygBlockKind } from "@md/core/transform/dom-to-markdown";

/** 哨兵字符：Unicode 私有区，文档内容不可能含有它们（用作 markdown 偏移的探针）。 */
export const CARET_SENTINEL = "";
export const SELECTION_START_SENTINEL = "";
export const SELECTION_END_SENTINEL = "";

/** 序列化上下文：块 kind + 标题层级 + 列表 marker（决定 markdown 的前缀形态）。 */
export type CaretSerializeCtx = {
    kind: WysiwygBlockKind;
    headingLevel?: number;
    listMarker?: string;
};

/**
 * DOM 光标位置 → markdown 偏移。无光标 / 光标不在 root 内 → null。
 *
 * **函数不修改 DOM 的语义内容**：哨兵插入后立即移除并 `normalize()` 合并被分裂的文本节点
 * （`normalize()` 不可省：分裂的相邻文本节点会被序列化器当成两块内容处理）。
 */
export function caretToMarkdownOffset(root: Element, ctx: CaretSerializeCtx): number | null {
    const sel = window.getSelection();
    if (sel == null || sel.rangeCount === 0 || !root.contains(sel.anchorNode)) {
        return null;
    }
    const range = sel.getRangeAt(0).cloneRange();
    const textNode = document.createTextNode(CARET_SENTINEL);
    range.insertNode(textNode);
    const md = serializeBlockDomToMarkdown(root, ctx);
    const idx = md.indexOf(CARET_SENTINEL);
    textNode.parentNode?.removeChild(textNode);
    // Merge any adjacent text nodes the insertion may have split.
    root.normalize();
    return idx >= 0 ? idx : null;
}

/**
 * DOM 选区 → markdown 空间的 `{start, end}`。折叠选区（非选区）返回 null。
 *
 * 两个哨兵用**不同字符**，因为序列化后必须能分辨哪端是哪端 —— 只用一个哨兵的话，
 * 选区跨越了某种会重排内容的结构（比如表格列、列表嵌套）时，两次 `indexOf` 会拿到同一个值。
 * 最后仍然按 min/max 归一：序列化器可能把选区两端顺序倒过来（例如反向选择的列表范围）。
 */
export function selectionToMarkdownRange(root: Element, ctx: CaretSerializeCtx): { start: number; end: number } | null {
    const sel = window.getSelection();
    if (sel == null || sel.rangeCount === 0 || sel.isCollapsed || !root.contains(sel.anchorNode)) {
        return null;
    }
    const range = sel.getRangeAt(0);
    const startNode = document.createTextNode(SELECTION_START_SENTINEL);
    const endNode = document.createTextNode(SELECTION_END_SENTINEL);
    const rStart = range.cloneRange();
    rStart.collapse(true);
    rStart.insertNode(startNode);
    const rEnd = range.cloneRange();
    rEnd.collapse(false);
    rEnd.insertNode(endNode);
    const md = serializeBlockDomToMarkdown(root, ctx);
    const iStart = md.indexOf(SELECTION_START_SENTINEL);
    const iEnd = md.indexOf(SELECTION_END_SENTINEL);
    startNode.parentNode?.removeChild(startNode);
    endNode.parentNode?.removeChild(endNode);
    root.normalize();
    if (iStart < 0 || iEnd < 0) {
        return null;
    }
    // 哨兵修正：序列化串里**起点哨兵自己占 1 个字符**，它在 end 哨兵之前，
    // 所以 end 的原始下标被顶高了 1（选 "hello" 的 (1,4) → 直出 end=5、长度 4）。
    // 不扣这一位，选区就长 1 个字符 —— 浮动工具栏会把格式套到多出的那个字上。
    // 反向选区也一并覆盖：min/max 归一后，较大的一定是「后插入的那个」哨兵。
    const lo = Math.min(iStart, iEnd);
    const hi = Math.max(iStart, iEnd);
    return { start: lo, end: hi - 1 };
}

/**
 * markdown/文本偏移 → DOM 光标位置（反向映射）。
 *
 * 沿文本节点累加长度定位；偏移超出末尾时折叠到根末尾（不抛错、不落在别处）。
 * `offset` 为**纯文本**偏移（不含 markdown 标记），调用方负责给出正确语义的偏移。
 */
export function placeCaretByTextOffset(root: HTMLElement, offset: number): void {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let pos = 0;
    let node: Node | null;
    while ((node = walker.nextNode()) != null) {
        const text = node.textContent ?? "";
        if (pos + text.length >= offset) {
            const range = document.createRange();
            range.setStart(node, Math.min(offset - pos, text.length));
            range.collapse(true);
            const sel = window.getSelection();
            if (sel != null) {
                sel.removeAllRanges();
                sel.addRange(range);
            }
            return;
        }
        pos += text.length;
    }
    // Offset past the end: collapse to end.
    const range = document.createRange();
    range.selectNodeContents(root);
    range.collapse(false);
    const sel = window.getSelection();
    if (sel != null) {
        sel.removeAllRanges();
        sel.addRange(range);
    }
}