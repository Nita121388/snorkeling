// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * 提交前置层：块身份重定位 + 陈旧检测（写盘前的唯一决策点）。
 *
 * 这层决定「这次提交能不能安全落到那个块上」，是本项目数据安全红线的执行点。它的三条判据：
 *
 *   1. **id 是身份，行号是坐标**。别的提交让行号整体位移后，仍要能按 `data-block-id` 找回同一块；
 *   2. **id 落空时按内容唯一匹配退化**（拿不到 id 不该等于没有防护）；
 *   3. **陈旧就拒写**。本块在编辑期间被外部改过 → 宁可丢一次编辑，也不覆盖别人的内容。
 *
 * 与其余 md-dom 代码一样：**零 React、零宿主依赖**，只吃 `ParentNode` 与字符串。
 * 会话类型刻意做成**结构化最小类型** `BlockEditTarget`（不含 React 类型），
 * 于是宿主那边的 `InlineEditSession`（含 React.CSSProperties 等）可以原样传入，
 * 调用点一个字节都不用改；而本包不需要为了一个类型去依赖 React。
 */

import { initialContentFor, type InlineEditBlockKind } from "./block-syntax";

/** 渲染根选择器（与宿主 measureOverlay 的 `.markdown-render-root` 一致）。 */
export const MarkdownRenderRootSelector = ".markdown-render-root";

/**
 * 提交前置所需的最小会话视图（结构化类型）。
 *
 * 刻意不写 `targetEl` / `typography` / 回调等字段：那些是编辑会话的**宿主关注点**，
 * 不是重定位/陈旧检测的输入。窄接口让这层能脱离 React 与会话对象单独测试。
 */
export type BlockEditTarget = {
    blockKind: InlineEditBlockKind;
    /** 1-based, inclusive。 */
    startLine: number;
    /** 1-based, inclusive。 */
    endLine: number;
    /** 打开编辑器时捕获的原文（陈旧检测的比对基准）。 */
    initialContent: string;
    /** 块身份（内容寻址、确定性）；旧 DOM 可能缺失，缺失则退化为「不做重定位」。 */
    blockId?: string;
    /** 块边缘插入模式：写的是新增内容，没有「原文」可比。 */
    insertMode?: "before" | "after";
};

/**
 * 用块身份在当前 DOM 里重定位：返回**当前**的源码行范围，未命中返回 null。
 *
 * 选择器同时要求 `data-source-line`：表格的 wrapper 与内层 <table> 会带**同一个** id
 * （wrapper 不带坐标），只按 id 查会拿到没有坐标的那个元素；复合选择器天然跳过它。
 *
 * 未命中（形状变了、块被别的提交替换、旧 DOM 没有 id）→ 返回 null，调用方退回捕获范围，
 * 继续用内容守卫把关 —— 这正是「id 是身份不是坐标」的退化路径。
 */
export function relocateByBlockId(
    root: ParentNode | null | undefined,
    blockId: string | undefined
): { startLine: number; endLine: number } | null {
    if (root == null || blockId == null || blockId === "") {
        return null;
    }
    // 括号形式足以处理 id 值里的特殊字符；blockId 本身形如 blk-<hex>-<n>，无 CSS 元字符。
    const el = root.querySelector<HTMLElement>(`[data-block-id="${blockId}"][data-source-line]`);
    if (el == null) {
        return null;
    }
    const start = Number(el.dataset.sourceLine);
    if (!Number.isFinite(start) || start < 1) {
        return null;
    }
    const endRaw = el.dataset.sourceLineEnd != null ? Number(el.dataset.sourceLineEnd) : start;
    const end = Number.isFinite(endRaw) && endRaw >= start ? Math.trunc(endRaw) : Math.trunc(start);
    return { startLine: Math.trunc(start), endLine: end };
}

/**
 * 陈旧检测：当前源码切片与打开编辑器时捕获的 `initialContent` 是否一致？
 *
 * 不一致 → 该块在编辑期间被外部（磁盘改动、别的提交、实时预览重渲染）改过，写下去就会
 * 覆盖别人的内容。**宁可丢一次编辑，不可写错块**。
 *
 * 跳过两类会话（它们本来就没有「原文」可比）：
 * - `insertMode`（块边缘插入）：写的是新增内容；
 * - `initialContent === ""`（placeholder / 空块）：空字符串不是可比的基准。
 *
 * 两侧归一化共用 `initialContentFor`（打开编辑也是它）——这是不会漂移的关键。
 */
export function isStaleTargetBlock(session: BlockEditTarget, fullText: string): boolean {
    if (session.insertMode != null || session.initialContent === "") {
        return false;
    }
    const lines = fullText.split(/\r\n|\n/);
    const sourceSlice = lines.slice(session.startLine - 1, session.endLine).join("\n");
    return initialContentFor(session.blockKind, sourceSlice) !== session.initialContent;
}

/** 提交前置的结果。用泛型保住调用方的会话类型（宿主那边还有 targetEl / 回调等字段）。 */
export type CommitPreparation<T extends BlockEditTarget> =
    | { ok: true; session: T; relocated: boolean; relocatedBy?: "id" | "content" }
    | { ok: false; session: T; reason: "stale" };

/**
 * 退化重定位：精确 id 落空时，按「**内容唯一匹配**」找回同一个块。
 *
 * 为什么需要（沙箱实测发现）：id 是「内容摘要 + 同摘要出现序号」派生的。编辑一个与本块
 * 内容相同的兄弟块后，那个兄弟的摘要变了、本块的**序号**因此前移（实测：改完上面那个
 * 「一样的内容」后，下面那个的 id 从 `blk-xxxx-1` 变成 `blk-xxxx-0`），于是按 id 精确定位
 * 落空 —— 尽管本块一个字都没被改。
 *
 * 安全约束：**只在恰好一个候选时采用**。多个候选 = 真歧义（例如两个仍然完全相同、
 * 都等于 initialContent 的块），此时不猜，退回捕获范围、交给内容守卫把关 ——
 * 宁可失去重定位能力，绝不让改动落到另一个块上。
 */
export function relocateByContent(
    root: ParentNode | null | undefined,
    session: BlockEditTarget,
    fullText: string
): { startLine: number; endLine: number } | null {
    if (root == null || session.insertMode != null || session.initialContent === "") {
        return null;
    }
    // 调用方可能传一个只实现了 querySelector 的桩（测试里就有），这里保持纯函数「总返回」。
    if (typeof (root as any).querySelectorAll !== "function") {
        return null;
    }
    const lines = fullText.split(/\r\n|\n/);
    const candidates: { startLine: number; endLine: number }[] = [];
    for (const el of Array.from(root.querySelectorAll<HTMLElement>("[data-source-line]"))) {
        const start = Number(el.dataset.sourceLine);
        if (!Number.isFinite(start) || start < 1) {
            continue;
        }
        const endRaw = el.dataset.sourceLineEnd != null ? Number(el.dataset.sourceLineEnd) : start;
        const end = Number.isFinite(endRaw) && endRaw >= start ? Math.trunc(endRaw) : Math.trunc(start);
        const slice = lines.slice(Math.trunc(start) - 1, end).join("\n");
        if (initialContentFor(session.blockKind, slice) === session.initialContent) {
            candidates.push({ startLine: Math.trunc(start), endLine: end });
            if (candidates.length > 1) {
                return null; // 真歧义：不猜
            }
        }
    }
    return candidates[0] ?? null;
}

/**
 * commit() 写盘前的唯一决策点（纯函数，可直测）：
 *   1) 按块身份重定位到**当前**行号（命中则覆盖 startLine/endLine）；
 *   2) 陈旧检测（不符则 ok=false，调用方必须中止写入）。
 *
 * 未命中时退回捕获范围，仍过内容守卫——所以「拿不到 id」不会导致漏防护，只会失去重定位能力。
 * 顺序不可颠倒：必须先重定位再比对，否则行号位移后拿旧行号切片必然“不符”，把所有合法提交都拦下。
 */
export function prepareInlineEditCommit<T extends BlockEditTarget>(
    session: T,
    fullText: string,
    root: ParentNode | null | undefined
): CommitPreparation<T> {
    const byId = relocateByBlockId(root, session.blockId);
    // 精确 id 先试；落空时退到「内容唯一匹配」（见 relocateByContent 的说明）。
    const relocatedRange = byId ?? relocateByContent(root, session, fullText);
    const resolved =
        relocatedRange == null
            ? session
            : { ...session, startLine: relocatedRange.startLine, endLine: relocatedRange.endLine };
    if (isStaleTargetBlock(resolved, fullText)) {
        return { ok: false, session: resolved, reason: "stale" };
    }
    return {
        ok: true,
        session: resolved,
        relocated: relocatedRange != null,
        relocatedBy: relocatedRange == null ? undefined : byId != null ? "id" : "content",
    };
}
