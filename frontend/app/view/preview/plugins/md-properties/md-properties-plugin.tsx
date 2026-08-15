// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Obsidian 笔记属性（frontmatter）样式化渲染插件（Phase 1，只读）。
//
// 思路：接管 .md/.mdx 只读预览，把文件头部 YAML frontmatter 渲染成 Obsidian 风格的属性卡片，
// 正文仍走既有 Markdown 渲染（复用 MarkdownPreview，不复制其组装逻辑）。
//
// 实现要点：
// - match 排除 editMode：编辑态回落到 codeedit，不拦截。
// - 有 frontmatter → 传 frontmatterBlock（行范围）给 Markdown 组件：新 remark 插件在 mdast 层
//   把 frontmatter 节点组替换为 waveblock（文本与行号不动 → inline-edit 草稿保存不被破坏），
//   waveBlockRenderers 按 block.type 委托 ObsidianPropertiesCard 渲染。
// - 无 frontmatter / 解析失败 → 原样 MarkdownPreview，零改动回退。

import type { MarkdownContentBlockType } from "@/app/element/markdown-util";
import { loadable } from "jotai/utils";
import { useAtomValue } from "jotai";
import { useMemo } from "react";
import { registerPreviewPlugin, type PreviewPlugin } from "@/app/view/preview/preview-plugin-registry";
import type { PreviewModel } from "@/app/view/preview/preview-model";
import { MarkdownPreview } from "@/app/view/preview/preview-markdown";
import { parseFrontmatterBlock } from "./frontmatter-block";
import { isMdPropertiesMatch } from "./md-properties-match";
import { ObsidianPropertiesCard } from "./obsidian-properties-card";

const pluginId = "md-properties";

// waveblock blockkey：同一 Markdown 实例只渲染一个文件的一个 frontmatter，固定 key 安全。
const FrontmatterBlockKey = "obsidian-props[fm]";

export const mdPropertiesPlugin: PreviewPlugin = {
    id: pluginId,
    displayName: "属性视图",
    priority: 0,
    match: isMdPropertiesMatch,
    render: ({ model, parentRef }) => <MdPropertiesView model={model} parentRef={parentRef} />,
    canEdit: () => false,
    icon: "file-lines",
};

function MdPropertiesView({ model, parentRef }: { model: PreviewModel; parentRef: React.RefObject<HTMLDivElement> }) {
    const textLoadable = useAtomValue(loadable(model.fileContent));
    const text = textLoadable.state === "hasData" ? textLoadable.data : undefined;
    const frontmatterBlock = useMemo(() => (text ? parseFrontmatterBlock(text) : null), [text]);

    const waveBlockRenderers = useMemo(
        () => ({ "obsidian-props": (block: MarkdownContentBlockType) => <ObsidianPropertiesCard block={block} /> }),
        []
    );

    if (frontmatterBlock == null) {
        // 无 frontmatter 或解析失败 → 原样 markdown 渲染
        return <MarkdownPreview model={model} parentRef={parentRef} />;
    }

    return (
        <MarkdownPreview
            model={model}
            parentRef={parentRef}
            frontmatterBlock={{ ...frontmatterBlock, blockKey: FrontmatterBlockKey }}
            waveBlockRenderers={waveBlockRenderers}
        />
    );
}

export function registerMdPropertiesPlugin(): void {
    registerPreviewPlugin(mdPropertiesPlugin);
}