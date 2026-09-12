// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Obsidian 笔记属性（frontmatter）样式化渲染插件（Phase 2：支持属性值编辑）。
//
// 思路：接管 .md/.mdx 只读预览，把文件头部 YAML frontmatter 渲染成 Obsidian 风格的属性卡片，
// 正文仍走既有 Markdown 渲染（复用 MarkdownPreview，不复制其组装逻辑）。
//
// 实现要点：
// - match 排除 editMode：编辑态回落到 codeedit，不拦截。
// - 有 frontmatter → 传 frontmatterBlock（行范围）给 Markdown 组件：新 remark 插件在 mdast 层
//   把 frontmatter 节点组替换为 waveblock（文本与行号不动 → inline-edit 草稿保存不被破坏），
//   waveBlockRenderers 按 block.type 委托 ObsidianPropertiesCard 渲染。
// - 属性编辑：卡片 onDataChange → 新对象 YAML.stringify → replaceFrontmatter 整块替换 →
//   globalStore.set(model.newFileContent, 新全文)（与正文 inline-edit 相同语义：先入草稿，
//   顶部 Save / Cmd+S 落盘，支持 Revert）。
// - 无 frontmatter / 解析失败 → 原样 MarkdownPreview，零改动回退。

import { reorderFrontmatterProperties } from "@/app/element/markdown-transform/doc-meta";
import type { MarkdownContentBlockType } from "@/app/element/markdown-util";
import { globalStore } from "@/app/store/jotaiStore";
import { MarkdownPreview } from "@/app/view/preview/preview-markdown";
import type { PreviewModel } from "@/app/view/preview/preview-model";
import { registerPreviewPlugin, type PreviewPlugin } from "@/app/view/preview/preview-plugin-registry";
import { extractFirstH1, resolveNoteTitle } from "@/app/view/preview/title-util";
import { useAtomValue } from "jotai";
import { loadable } from "jotai/utils";
import { useCallback, useMemo } from "react";
import { DocTitle } from "./doc-title";
import {
    buildPropertyEntries,
    parseFrontmatterBlock,
    replaceFrontmatter,
    stringifyFrontmatterData,
} from "./frontmatter-block";
import { deleteProperty, setProperty, type PropertyEditValue } from "./frontmatter-edit";
import { isMdPropertiesMatch } from "./md-properties-match";
import {
    ObsidianPropertiesCard,
    getObsidianPropsCollapsed,
    setObsidianPropsCollapsed,
} from "./obsidian-properties-card";

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
    // 兜底标题：正文有 H1 时靠 markdown 自身显示；没有 H1 时用文件名回退补一个干净标题。
    const statFilePathLoadable = useAtomValue(loadable(model.statFilePath));
    const filePath = statFilePathLoadable.state === "hasData" ? statFilePathLoadable.data : undefined;
    const hasH1 = useMemo(() => extractFirstH1(text) != null, [text]);
    const docTitle = useMemo(() => {
        if (hasH1 || filePath == null) return null;
        return resolveNoteTitle(text, filePath);
    }, [hasH1, text, filePath]);
    // 折叠状态持久化 key：同一预览块（同一文件）重挂后恢复折叠/展开，与标题折叠的
    // markdownCollapsedHeadings 同模式（key = blockId）。
    const collapseKey = model.blockId;

    // 解析 frontmatter 属性用于拖拽排序
    const entries = useMemo(() => {
        if (frontmatterBlock?.data == null) return [];
        return buildPropertyEntries(frontmatterBlock.data);
    }, [frontmatterBlock]);

    // 属性变更：最小 diff 写回 → 整块替换 frontmatter 行区域 → 写草稿（Save/Cmd+S 落盘）。
    //
    // 优先逐属性改写（frontmatter-edit）：只动变化的键，保留注释、引号、flow/block 序列风格
    // 与其他行的原始字节。任一步失败（如 YAML 语法错误）→ 回退旧的整块序列化，功能不退化。
    const handleDataChange = useCallback(
        (newData: Record<string, unknown>) => {
            if (text == null || frontmatterBlock == null) return;
            const oldData = frontmatterBlock.data ?? {};
            let yaml = frontmatterBlock.yamlText;
            let minimal = true;

            for (const key of Object.keys(oldData)) {
                if (!(key in newData)) {
                    const next = deleteProperty(yaml, key);
                    if (next == null) {
                        minimal = false;
                        break;
                    }
                    yaml = next;
                }
            }
            if (minimal) {
                for (const [key, value] of Object.entries(newData)) {
                    const before = oldData[key];
                    const same =
                        before === value ||
                        (typeof before === "object" &&
                            typeof value === "object" &&
                            JSON.stringify(before) === JSON.stringify(value));
                    if (same) continue;
                    const next = setProperty(yaml, key, value as PropertyEditValue);
                    if (next == null) {
                        minimal = false;
                        break;
                    }
                    yaml = next;
                }
            }

            const newYaml = minimal ? yaml : stringifyFrontmatterData(newData);
            const newText = replaceFrontmatter(text, frontmatterBlock, newYaml);
            if (newText !== text) {
                globalStore.set(model.newFileContent, newText);
            }
        },
        [text, frontmatterBlock, model]
    );

    // 属性拖拽排序：调整 frontmatter 中属性行的顺序
    const handleReorder = useCallback(
        (fromIndex: number, toIndex: number) => {
            console.log("[drag-drop] handleReorder:", { fromIndex, toIndex, entriesCount: entries.length });
            if (text == null) {
                console.log("[drag-drop] text is null, returning");
                return;
            }
            // 将 UI 索引转换为 key 名称
            const fromKey = entries[fromIndex]?.key;
            const toKey = toIndex < entries.length ? entries[toIndex]?.key : null;
            console.log("[drag-drop] fromKey:", fromKey, "toKey:", toKey);
            if (fromKey == null) return;
            const newText = reorderFrontmatterProperties(text, fromKey, toKey);
            console.log("[drag-drop] newText === text:", newText === text, "newText length:", newText?.length);
            if (newText !== text) {
                console.log("[drag-drop] setting newFileContent");
                globalStore.set(model.newFileContent, newText);
            }
        },
        [text, model, entries]
    );

    const waveBlockRenderers = useMemo(
        () => ({
            "obsidian-props": (block: MarkdownContentBlockType) => (
                <ObsidianPropertiesCard
                    block={block}
                    onDataChange={handleDataChange}
                    onReorder={handleReorder}
                    collapsedSeed={getObsidianPropsCollapsed(collapseKey)}
                    onCollapsedChange={(next) => setObsidianPropsCollapsed(collapseKey, next)}
                />
            ),
        }),
        [handleDataChange, handleReorder, collapseKey]
    );

    const preview =
        frontmatterBlock == null ? (
            // 无 frontmatter 或解析失败 → 原样 markdown 渲染
            <MarkdownPreview model={model} parentRef={parentRef} />
        ) : (
            <MarkdownPreview
                model={model}
                parentRef={parentRef}
                frontmatterBlock={{ ...frontmatterBlock, blockKey: FrontmatterBlockKey }}
                waveBlockRenderers={waveBlockRenderers}
            />
        );

    if (docTitle == null) {
        return preview;
    }
    // 无 H1 → 标题区固定在正文/属性卡上方，正文区滚动。
    return (
        <div className="flex flex-col h-full">
            <DocTitle title={docTitle} />
            <div className="flex-1 overflow-auto">{preview}</div>
        </div>
    );
}

export function registerMdPropertiesPlugin(): void {
    registerPreviewPlugin(mdPropertiesPlugin);
}
