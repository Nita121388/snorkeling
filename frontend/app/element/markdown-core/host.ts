// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * md-core 宿主适配层（md-core 抽离 P0 · C2）。
 *
 * ## 为什么存在
 * 抽离目标目录（`markdown-transform/` `block-model/` `remark/` `markdown-render/`）里，
 * 少数能力本质上是**宿主的**，不可能属于纯 markdown 内核：
 *   - 图片 src 解析（需要 RPC / connection / baseDir）
 *   - 灯箱（宿主 UI 组件）
 *   - 右键菜单（宿主 Electron 菜单）
 *   - 链接打开 / 文件引用导航（宿主 block / tab / layout）
 *   - wiki link / `path:line` 语法解析（宿主可以定义自己的方言）
 * 这些能力统一走 `MdHostAdapter`，核心层只依赖本接口，不 import 宿主模块。
 *
 * ## 不变量
 * 本文件**不得静态 import** 任何宿主模块（`@/view`、`@/store`、`@/util`、`@/app/view`、
 * `@/app/store`、`jotai`、`wos`）。宿主实现一律通过**动态 import（延迟加载）**，
 * 因此本文件在 Phase B 可以原样搬进 md-core。
 *
 * ## 默认实现 = 现有行为
 * 默认实现在**调用时**动态 import 原来的 Wave 代码路径，行为与 C2 之前逐字节一致：
 *   - 纯语法解析：直接使用 `./markdown-refs`（本地纯实现，无宿主）；
 *   - 异步宿主能力（图片解析 / 链接导航）：动态 import 后转发；
 *   - 同步宿主能力（灯箱 / 右键菜单）：灯箱走 `React.lazy`（动态 import thunk），
 *     右键菜单走动态 import（`showContextMenu` 在事件处理里调用，晚一个 microtask 无感；
 *     调用方已自行 `preventDefault`/`stopPropagation`）。
 *
 * 覆盖：宿主可在启动期 `setMdHost({...})` 覆盖任意能力（未覆盖的沿用默认）。
 */

import { createElement, lazy, Suspense, type MouseEvent, type ReactNode } from "react";
import {
    makeMarkdownWikiLinkHref,
    parseMarkdownFileLineReference,
    parseMarkdownWikiLink,
    type MarkdownWikiLink,
} from "./markdown-refs";

/** 图片解析选项（与宿主 `MarkdownResolveOpts` 结构兼容；此处不 import 宿主类型）。 */
export type MdImageResolveOpts = {
    connName: string;
    baseDir: string;
    openLink?: (path: string, options: { lineNumber?: number | null; forceNewBlock?: boolean }) => Promise<void>;
};

/** 右键菜单项（与宿主全局类型 `ContextMenuItem` 结构兼容；此处不 import 宿主类型）。 */
export type MdContextMenuItem = {
    label?: string;
    type?: "separator" | "normal" | "submenu" | "checkbox" | "radio" | "header";
    role?: string;
    click?: () => void;
    submenu?: MdContextMenuItem[];
    checked?: boolean;
    visible?: boolean;
    enabled?: boolean;
    sublabel?: string;
};

/** 文件引用导航选项（与宿主 `FileLinkOpenOptions` 结构兼容）。 */
export type MdFileLinkOpenOptions = {
    connection?: string | null;
    baseDir?: string | null;
    openDirectoryIndex?: boolean;
    lineNumber?: number | null;
    heading?: string | null;
    onOpenPath?: (path: string, lineNumber: number | null) => Promise<void>;
};

export type MdImageLightboxProps = {
    src: string;
    alt?: string;
    onClose: () => void;
};

/**
 * 宿主能力集合（全部必填：默认实现保证任何能力都可用，调用点无需 `?.` 防御）。
 * 宿主可用 `setMdHost({ ... })` 覆盖其中任意一项。
 */
export interface MdHostAdapter {
    /** 解析 `path/to/file.md:12` 形式的文件行引用。 */
    parseMarkdownFileLineReference(value: string): { filePath: string; lineNumber: number } | null;
    /** 解析 `[[note]]` / `[[note|label]]` / `[[note#heading]]`（含已编码的 `wave-wiki:` 形式）。 */
    parseMarkdownWikiLink(value: string): MarkdownWikiLink | null;
    /** 生成 wiki link href（宿主导航协议前缀）。 */
    makeMarkdownWikiLinkHref(target: string, heading?: string): string;
    /** 把 markdown 里的图片 src 解析成可加载的 URL（相对路径 / 远程 / connection 相关）。 */
    resolveImageSrc(src: string | undefined | null, resolveOpts: MdImageResolveOpts): Promise<string | null>;
    /** 解析 `<source srcSet>`。 */
    resolveImageSrcSet(srcSet: string | undefined, resolveOpts: MdImageResolveOpts): Promise<string | null>;
    /** 渲染全屏灯箱（宿主 UI 组件）。 */
    renderImageLightbox(props: MdImageLightboxProps): ReactNode;
    /** 弹出宿主右键菜单（Electron 原生菜单）。 */
    showContextMenu(items: MdContextMenuItem[], event: MouseEvent<unknown>): void;
    /** 用系统默认方式打开普通链接。 */
    openLink(href: string): void;
    /** 在预览里打开文件引用 / wiki link；返回是否成功处理（false → 调用方回退 openLink）。 */
    openFileLinkInPreview(href: string, options?: MdFileLinkOpenOptions): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// 灯箱：动态 import thunk（`React.lazy` 只接受返回 Promise 的 loader），
// 因此本文件对外**零静态宿主依赖**。首次点击图片时才下载/求值该模块。
// ---------------------------------------------------------------------------
const LazyImageLightbox = lazy(async () => {
    const mod = await import("@/app/element/image-lightbox");
    return { default: mod.ImageLightbox };
});

function defaultImageLightbox(props: MdImageLightboxProps): ReactNode {
    return createElement(Suspense, { fallback: null }, createElement(LazyImageLightbox as any, props));
}

const DEFAULTS: MdHostAdapter = {
    parseMarkdownFileLineReference,
    parseMarkdownWikiLink,
    makeMarkdownWikiLinkHref,

    async resolveImageSrc(src, resolveOpts) {
        const mod = await import("@/app/element/markdown-util");
        return mod.resolveRemoteFile(src, resolveOpts as MarkdownResolveOpts);
    },
    async resolveImageSrcSet(srcSet, resolveOpts) {
        const mod = await import("@/app/element/markdown-util");
        return mod.resolveSrcSet(srcSet, resolveOpts as MarkdownResolveOpts);
    },
    renderImageLightbox: defaultImageLightbox,
    showContextMenu(items, event) {
        void import("@/app/store/contextmenu").then((mod) =>
            mod.ContextMenuModel.getInstance().showContextMenu(items as ContextMenuItem[], event)
        );
    },
    openLink(href) {
        void import("@/app/store/global").then((mod) => mod.openLink(href));
    },
    async openFileLinkInPreview(href, options) {
        const mod = await import("@/app/view/preview/file-link-navigation");
        return mod.openFileLinkInPreview(href, options);
    },
};

let currentHost: MdHostAdapter = DEFAULTS;

/** 覆盖宿主能力（未列出的沿用默认实现）。 */
export function setMdHost(host: Partial<MdHostAdapter>): void {
    currentHost = { ...DEFAULTS, ...host };
}

/** 取当前宿主能力（永远返回完整实现）。 */
export function getMdHost(): MdHostAdapter {
    return currentHost;
}
