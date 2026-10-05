// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * P2-A2 块模型渲染适配器：把 P1 的 `buildBlockTree` 产出的 `Block[]` 渲染为可见内容。
 *
 * 定位（design 决策 1）：**语义视图 / 编辑出口**，不替代生产 ReactMarkdown 渲染。
 * 它把「块模型坐标 + 块源码文本」转成可验证的 DOM，供：(a) 单测断言块模型坐标正确；
 * (b) P2-B 编辑收敛时把「编辑意图后的块内容」渲染成所见。默认不接入线上渲染，flag 关闭。
 *
 * 行内渲染复用 ReactMarkdown（remark-gfm 管线），单块文本 → 单个元素。这样无需重写
 * 行内/GFM 处理，与生产渲染所见一致。
 *
 * 已知限制（P2-B 前瞻）：buildBlockTree 把扁平兄弟列表项拆成多个顶层块，每个块独立
 * ReactMarkdown → 产出**多个独立 <ul>**，而生产 ReactMarkdown 会合并成一个 <ul>。
 * 作为 flag 关闭的语义视图骨架可接受；P2-B 的「编辑预览」面应优先用生产渲染器。
 */

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Block } from "../markdown-transform/tree";

/**
 * 把单个 Block 渲染为一个元素。block.text 是其源码文本（可含多行，如代码块/表格）。
 * 外层按 kind 包一个语义标签；内部交给 ReactMarkdown 渲染行内/块内容。
 */
export function BlockModelRenderer({ block }: { block: Block }): React.ReactElement {
    return (
        <div
            data-block-kind={block.kind}
            data-block-start={block.startLine}
            data-block-end={block.endLine}
            data-block-id={block.id}
        >
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{block.text}</ReactMarkdown>
        </div>
    );
}

/**
 * 渲染整棵块树（顶层块数组）。供测试与 P2-B 编辑出口。纯组件，不触发生产渲染。
 */
export function BlockTreeRenderer({ blocks }: { blocks: Block[] }): React.ReactElement {
    return (
        <div data-block-tree>
            {blocks.map((b) => (
                <BlockModelRenderer key={b.id} block={b} />
            ))}
        </div>
    );
}
