// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * 提交决策：**一次块编辑提交到底该写什么（或者该不该写）**。
 *
 * 这是编辑引擎里唯一决定「磁盘上会变成什么」的地方，也是本项目数据安全红线的收口点。
 * 它由四道判定按**固定顺序**串成，每一步都有过一次真实事故：
 *
 *   1. **重定位 + 陈旧检测**（`prepareInlineEditCommit`）
 *      —— 行号是坐标、会被别的提交顶走；内容被别人改过就必须拒写。
 *   2. **callout 前缀回写**（`applyCalloutPrefix`）
 *      —— 种子把 `[!TYPE]`/emoji 摘掉了，提交时要按**原文大小写**插回去。
 *   3. **空壳守卫**（`isEmptyBlockShellDraft`）
 *      —— 编辑器根从未承载内容时序列化出的「空壳」（裸 `>` / 裸 `###`）绝不能覆盖
 *         本来有内容的块。判据要同时看"草稿是不是空壳"和"原文是不是本来就空"。
 *
 *         这里的判据有一个**曾经写错过的细节**：光看「草稿是空壳 + 原文非空」是**不够**的，
 *         因为「用户主动清空一个标题」同样满足这两条（清空后的标题序列化出来就是裸
 *         `###`）。错把两者混同的后果是**用户删掉标题、失焦、文字原样回来** ——
 *         一个静默的数据/交互缺陷（实测复现过）。
 *
 *         真正要区分的是「空壳 = 用户干的」还是「空壳 = 种子从未落地（DOM 塌缩）」。
 *         overlay 路径靠**镜像草稿**区分（镜像还有内容、DOM 却塌了 → 种子没落地）；
 *         在位路径没有镜像（编辑面就是渲染面），因此改用**用户是否真的动过**：
 *         没动过而草稿塌成空壳 → 不可信（种子没落地）；动过 → 空壳是用户的意图，放行。
 *         调用方通过 `userEdited` 传入；**不传则保持保守语义（拦）**，避免隐式放宽守卫。
 *   4. **无变化跳过**
 *      —— 内容与原文一致且没被重定位就不写盘（避免无谓的 undo 记账与磁盘抖动）。
 *
 * 为什么值得单独成模块：**这四道判定此前在 overlay 路径与在位路径各写了一遍**。
 * 两份实现意味着「有人只往一边加守卫」——而这里漏一道的后果是**数据被覆盖**，
 * 不是样式错。收成一份之后，两边（以及将来的非 React 消费方）走同一条路径。
 *
 * 本模块零 React、零宿主：只依赖 md-dom 的纯层与 md-core 的块模型/切片工具。
 */

import { editorController } from "@md/core/block-model/editor-controller-instance";
import { replaceSourceRange } from "@md/core/transform/block-range";
import type { Block } from "@md/core/transform/tree";
import {
    applyCalloutPrefix,
    inlineKindToTreeKind,
    isEmptyBlockShellDraft,
    type InlineEditBlockKind,
} from "./block-syntax";
import { prepareInlineEditCommit } from "./commit-prep";

/**
 * 块级逆操作数据：随提交一起记账，供 undo / 结构操作求逆使用。
 *
 * `before` / `after` 是**完整块 markdown**（不是 diff）—— 因为块的写盘单位就是
 * 「整块源码切片替换」，整块快照是唯一能可靠求逆的粒度（按行 diff 在块边界变化时会错位）。
 */
export type BlockCommitOp = {
    blockId?: string;
    startLine: number;
    endLine: number;
    before: string;
    after: string;
};

/** 提交决策的输入。字段刻意用窄接口，宿主那边的完整会话类型可直接传入。 */
export type BlockCommitRequest = {
    kind: InlineEditBlockKind;
    /** 编辑器 DOM 序列化出来的块 markdown（**尚未**回写 callout 前缀）。 */
    committed: string;
    /** 打开编辑时从源码首行捕获的 callout 前缀（`[!NOTE] ` + emoji）；普通引用传空串。 */
    calloutPrefix?: string;
    startLine: number;
    endLine: number;
    /** 打开编辑时捕获的原文（陈旧检测 + 无变化判定的基准）。 */
    initialContent: string;
    blockId?: string;
    /** 当前全文（重定位与切片都基于它）。 */
    fullText: string;
    /** 渲染根（用于按块身份/内容重定位）。 */
    root: ParentNode | null | undefined;
    /**
     * 用户在本次会话里是否**真的编辑过**（敲键 / 删除都算）。
     *
     * 这是空壳守卫区分「用户主动清空」与「种子从未落地」的唯一依据（在位路径无镜像草稿）。
     * 缺省 `undefined` = 不确定 → 守卫保持保守（拦），不会隐式放宽数据安全判定。
     */
    userEdited?: boolean;
};

/** 提交决策：要么写，要么跳过（跳过原因必须可区分，否则没法诊断「为什么没存进去」）。 */
export type BlockCommitPlan =
    | { action: "write"; text: string; blockOp: BlockCommitOp }
    | { action: "skip"; reason: "stale" | "empty-shell" | "unchanged"; startLine: number; endLine: number };

/**
 * 计算提交决策。**纯函数**（除了读 md-core 的单例控制器求文本，不产生副作用）——
 * 调用方拿到 plan 之后再决定怎么落地（写盘 / undo 记账 / 日志）。
 */
export function planBlockCommit(req: BlockCommitRequest): BlockCommitPlan {
    const prepared = prepareInlineEditCommit(
        {
            blockKind: req.kind,
            startLine: req.startLine,
            endLine: req.endLine,
            initialContent: req.initialContent,
            blockId: req.blockId,
        },
        req.fullText,
        req.root
    );
    if (!prepared.ok) {
        return {
            action: "skip",
            reason: "stale",
            startLine: req.startLine,
            endLine: req.endLine,
        };
    }
    const current = prepared.session;

    // 2) 前缀回写：只对 callout 有意义（普通引用 prefix === "" → 原样返回）。
    const committed =
        req.calloutPrefix != null && req.calloutPrefix !== ""
            ? applyCalloutPrefix(req.committed, req.calloutPrefix)
            : req.committed;

    // 3) 空壳守卫。
    //    「草稿是空壳」本身**不足以**拒写：清空一个标题得到的就是裸 `###`。
    //    只有「用户根本没动过，草稿却塌成空壳」才是种子未落地的特征（见文件头说明）。
    //    `userEdited !== true` 同时覆盖「显式 false」与「调用方没提供」两种情况 ——
    //    都不足以放宽这条守卫。
    const shell = isEmptyBlockShellDraft(req.kind, committed);
    if (shell && req.userEdited !== true && req.committed.trim() !== "" && req.initialContent.trim() !== "") {
        return { action: "skip", reason: "empty-shell", startLine: current.startLine, endLine: current.endLine };
    }

    // 4) 无变化：内容一致且没有被重定位 → 不动文档。
    //    重定位过也要写：行的位置变了，虽然内容相同，但写下去能把 undo 记账对齐。
    if (committed === req.initialContent && current.startLine === req.startLine) {
        return { action: "skip", reason: "unchanged", startLine: current.startLine, endLine: current.endLine };
    }

    const blockOp: BlockCommitOp = {
        blockId: current.blockId,
        startLine: current.startLine,
        endLine: current.endLine,
        before: req.initialContent,
        after: committed,
    };

    // 落地：优先走编辑器控制器的 replace-content（统一意图模型的收敛点）；
    // 控制器返回 null（该坐标不在模型里）时退回纯文本切片替换 —— 两条路都产出全文。
    const block: Block = {
        id: `commit:${current.startLine}:${current.endLine}`,
        kind: inlineKindToTreeKind(req.kind, committed),
        startLine: current.startLine - 1, // 控制器用 0-based
        endLine: current.endLine - 1,
        depth: 0,
        text: req.initialContent,
        children: [],
    };
    const res = editorController.apply({ type: "replace-content", block, content: committed }, { text: req.fullText });
    const text =
        res != null ? res.text : replaceSourceRange(req.fullText, current.startLine, current.endLine, committed);

    return { action: "write", text, blockOp };
}
