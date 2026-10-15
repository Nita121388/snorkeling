// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * 编辑会话的**锚点解析**：从一个渲染块元素算出「这次编辑到底是哪一段源码」。
 *
 * 这是编辑器真正开始工作前的第一步，也是 overlay 路径与在位路径**逐字重复**的那段：
 * 算行号 → 读多行范围 → 切源码 → 归一化初始内容 → 取块身份 → 摘 callout 前缀。
 * 两份实现的危险不在于样式，而在于**两边算出不同的初始内容**：
 * 陈旧检测拿 `initialContent` 当基准，基准一旦漂移，合法提交会被判成陈旧而静默丢弃，
 * 或更糟 —— 拿错的基准去覆盖别人的改动。
 *
 * 抽成一份之后，两条路径（以及将来的非 React 消费方）从同一个函数拿会话描述。
 *
 * 本模块零 React、零宿主。
 */

import { captureCalloutPrefix, initialContentFor, type InlineEditBlockKind } from "./block-syntax";

/** 锚点解析的结果：一次会话的**定位信息 + 内容基准**。 */
export type EditAnchor = {
    /** 1-based，且至少为 1（行号会被别的提交顶走，所以永远以"当下有效坐标"为准）。 */
    safeLine: number;
    /** 1-based 闭区间。多行视觉块（软换行段落/标题/列表）带 data-source-line-end。 */
    endLine: number;
    /** 源码原样切片（**未**归一化）：写盘时的「before」基准要用它。 */
    sourceContent: string;
    /** 归一化后的编辑器初始内容：剥掉 marker / callout 前缀等只属于源码头的东西。 */
    initialContent: string;
    /** 块身份（remarkBlockIds 打的 data-block-id）。缺失 → 提交时跳过重定位。 */
    blockId?: string;
    isCallout: boolean;
    /**
     * callout 前缀（`[!Note] ` + emoji），仅当 `stripsCalloutMarker` 为真且是 callout 时给出。
     * undefined = 提交时**不要**回写前缀（编辑器正文里已经带着 marker，回写会重复）。
     */
    calloutPrefix?: string;
};

export type EditAnchorRequest = {
    blockKind: InlineEditBlockKind;
    /** 调用方拿到的行号（可能过期/非法，这里统一收敛）。 */
    line: number;
    /** 渲染块根元素 —— 行号范围、块身份、是否 callout 全部从它身上读。 */
    targetEl: HTMLElement;
    /** 当前全文（切片基准）。 */
    fullText: string;
    /**
     * 编辑器正文**是否已经剥掉了 callout marker**（种子阶段把 `[!NOTE]` 摘掉了）。
     *
     * 这是 captureCalloutPrefix 唯一的前置条件：只有正文里没有 marker 时，提交才需要回写。
     * textarea 回落路径逐字提交源码（含 marker）→ 必须传 false，否则提交会写两遍 marker。
     */
    stripsCalloutMarker?: boolean;
};

export type EditAnchorResult = { ok: true; anchor: EditAnchor } | { ok: false; reason: "line-out-of-range" };

/**
 * 解析锚点。纯函数（只读传入的 DOM 元素与文本，不做任何修改）。
 *
 * 行号范围的收敛规则（两条路径曾各写一遍，行为必须一致）：
 * - `data-source-line-end` 存在且 ≥ start → 用它（多行视觉块）；
 * - 缺失 / 非法 / < start → 退回单行（保持未重渲染的旧块也能编辑）；
 * - 任何情况下都不超过全文行数。
 */
export function resolveEditAnchor(req: EditAnchorRequest): EditAnchorResult {
    const safeLine = Math.max(1, Math.trunc(req.line));
    const lines = req.fullText.split(/\r\n|\n/);
    if (safeLine > lines.length) {
        return { ok: false, reason: "line-out-of-range" };
    }
    const endAttr = req.targetEl.dataset.sourceLineEnd;
    const endLineRaw = endAttr != null ? Number(endAttr) : safeLine;
    const endLine =
        Number.isFinite(endLineRaw) && endLineRaw >= safeLine
            ? Math.min(Math.trunc(endLineRaw), lines.length)
            : safeLine;
    const sourceContent = lines.slice(safeLine - 1, endLine).join("\n");
    // 归一化入口收敛到 initialContentFor（与提交时的陈旧检测同一个函数，防漂移）。
    const initialContent = initialContentFor(req.blockKind, sourceContent);
    // callout：种子把 marker 摘掉了 → 提交时要按原文大小写插回去。
    // 非 callout / 正文仍带 marker → 不回写（否则提交会出现两遍 marker）。
    const isCallout = req.targetEl.matches("calloutalert, .markdown-alert");
    const calloutPrefix =
        isCallout && req.stripsCalloutMarker === true ? captureCalloutPrefix(lines[safeLine - 1] ?? "") : undefined;
    return {
        ok: true,
        anchor: {
            safeLine,
            endLine,
            sourceContent,
            initialContent,
            blockId: req.targetEl.dataset.blockId ?? undefined,
            isCallout,
            calloutPrefix: calloutPrefix != null && calloutPrefix !== "" ? calloutPrefix : undefined,
        },
    };
}