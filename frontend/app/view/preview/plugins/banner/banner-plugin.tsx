// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Obsidian Banner 插件（.md 只读预览，frontmatter → Banner 渲染）。
//
// 思路：接管 .md/.mdx 只读预览，检测 frontmatter 中的 banner 属性，
// 如果存在则渲染 Banner 组件，否则回退到普通 Markdown 预览。
//
// 实现要点：
// - match 排除 editMode：编辑态回落到 codeedit，不拦截。
// - 有 banner 属性 → 渲染 Banner 组件 + Emoji Badge + 标题 + Markdown 预览
// - 无 banner 属性 → 原样 MarkdownPreview，零改动回退。
// - 优先级低于 md-properties 插件，确保属性卡片优先显示。

import type { MarkdownContentBlockType } from "@/app/element/markdown-util";
import { loadable } from "jotai/utils";
import { globalStore } from "@/app/store/jotaiStore";
import { useAtomValue } from "jotai";
import { useCallback, useMemo } from "react";
import { registerPreviewPlugin, type PreviewPlugin } from "@/app/view/preview/preview-plugin-registry";
import type { PreviewModel } from "@/app/view/preview/preview-model";
import { MarkdownPreview } from "@/app/view/preview/preview-markdown";
import { parseFrontmatterBlock } from "../md-properties/frontmatter-block";
import { parseBannerFromFrontmatter, type BannerBlock } from "./banner-block";
import { getFrontmatterEmoji } from "@/app/element/markdown-transform/doc-meta";
import { BannerRenderer } from "./banner-renderer";
import { EmojiBadge } from "./emoji-badge";
import { TitleArea } from "./title-area";

const pluginId = "markdown-banner";

export const bannerPlugin: PreviewPlugin = {
    id: pluginId,
    displayName: "Banner 视图",
    priority: -1, // 优先级低于 md-properties (0)
    match: (context) => {
        // 只匹配 .md/.mdx 文件
        const path = context.filePath;
        return path != null && /\.mdx?$/i.test(path);
    },
    render: ({ model, parentRef }) => <BannerView model={model} parentRef={parentRef} />,
    canEdit: () => false,
    icon: "image",
};

function BannerView({ model, parentRef }: { model: PreviewModel; parentRef: React.RefObject<HTMLDivElement> }) {
    const textLoadable = useAtomValue(loadable(model.fileContent));
    const text = textLoadable.state === "hasData" ? textLoadable.data : undefined;

    // 解析 frontmatter
    const frontmatterBlock = useMemo(() => (text ? parseFrontmatterBlock(text) : null), [text]);

    // 解析 banner 属性
    const bannerData = useMemo(() => {
        if (!frontmatterBlock?.data) return null;
        return parseBannerFromFrontmatter(frontmatterBlock.data);
    }, [frontmatterBlock]);

    // 解析 emoji 属性
    const emoji = useMemo(() => (text ? getFrontmatterEmoji(text) : null), [text]);

    // 解析标题（从 markdown 内容中提取第一个 H1）
    const title = useMemo(() => {
        if (!text) return null;
        // 匹配第一个 H1 标题
        const match = text.match(/^#\s+(.+)$/m);
        return match ? match[1].trim() : null;
    }, [text]);

    // 获取文件路径（用于构建图片基础路径）
    const statFilePathLoadable = useAtomValue(loadable(model.statFilePath));
    const filePath = statFilePathLoadable.state === "hasData" ? statFilePathLoadable.data : undefined;
    const baseUrl = useMemo(() => {
        if (!filePath) return undefined;
        // 获取文件所在目录
        const lastSlash = filePath.lastIndexOf("/");
        return lastSlash >= 0 ? filePath.substring(0, lastSlash) : undefined;
    }, [filePath]);

    // Banner 点击处理
    const handleBannerClick = useCallback(() => {
        if (!bannerData) return;
        // 可以在这里扩展点击行为，如打开图片查看器
        console.log("Banner clicked:", bannerData.banner);
    }, [bannerData]);

    // Emoji 点击处理
    const handleEmojiClick = useCallback(() => {
        console.log("Emoji clicked:", emoji);
    }, [emoji]);

    if (!bannerData) {
        // 无 banner 属性 → 原样 markdown 渲染
        return <MarkdownPreview model={model} parentRef={parentRef} />;
    }

    return (
        <div className="flex flex-col h-full">
            {/* Banner 区域 */}
            <div className="relative">
                <BannerRenderer
                    banner={bannerData.banner}
                    bannerY={bannerData.bannerY}
                    bannerLock={bannerData.bannerLock}
                    baseUrl={baseUrl}
                    onClick={handleBannerClick}
                />
                {/* Emoji Badge - 从 banner 底部突出 */}
                {emoji && (
                    <EmojiBadge
                        emoji={emoji}
                        onClick={handleEmojiClick}
                    />
                )}
            </div>

            {/* 标题区域 */}
            {title && (
                <TitleArea title={title} emoji={emoji} />
            )}

            {/* Markdown 内容区域 */}
            <div className="flex-1 overflow-auto">
                <MarkdownPreview model={model} parentRef={parentRef} />
            </div>
        </div>
    );
}

export function registerBannerPlugin(): void {
    registerPreviewPlugin(bannerPlugin);
}
