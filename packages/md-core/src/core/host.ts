// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * md-core 宿主适配层（md-core 抽离 P0 · C2；物理抽包 10-12 扩展能力面）。
 *
 * ## 为什么存在
 * 包内（`transform/` `block-model/` `remark/` `render/`）里，少数能力本质上是**宿主的**，
 * 不可能属于纯 markdown 内核：
 *   - 图片 src 解析（需要 RPC / connection / baseDir）
 *   - 灯箱（宿主 UI 组件）
 *   - 右键菜单（宿主 Electron 菜单）
 *   - 链接打开 / 文件引用导航（宿主 block / tab / layout）
 *   - wiki link / `path:line` 语法解析（宿主可以定义自己的方言）
 *   - **UI 组件**（`TableBlock` / `CopyButton` / `IconButton`，10-12 新增）
 *   - **特性开关**（`features`）与**内容块插件工厂**（`contentBlockPlugin`）
 * 这些能力统一走 `MdHostAdapter`，包内只依赖本接口，不 import 宿主模块。
 *
 * ## 不变量
 * 本文件**不得静态 import** 任何宿主模块（`@/view`、`@/store`、`@/util`、`@/app/view`、
 * `@/app/store`、`jotai`、`wos`）。宿主实现一律通过**动态 import（延迟加载）**，
 * 因此本文件在 Phase B 可以原样搬进 md-core。
 *
 * ## 默认实现 = 现有行为
 * 默认实现在**调用时**动态 import 原来的 Wave 代码路径，行为与 C2 之前逐字节一致：
 *   - 纯语法解析：直接使用 `./markdown-refs`（本地纯实现，无宿主）；
 *   - 特性开关：直接使用 `./flags`（本地纯实现，**同步**）；
 *   - 异步宿主能力（图片解析 / 链接导航）：动态 import 后转发；
 *   - 同步宿主能力（灯箱 / 右键菜单）：灯箱走 `React.lazy`（动态 import thunk），
 *     右键菜单走动态 import（`showContextMenu` 在事件处理里调用，晚一个 microtask 无感；
 *     调用方已自行 `preventDefault`/`stopPropagation`）；
 *   - 宿主 UI 组件（`components`）：`./host-component` 的「模块求值即预热 + 同步读缓存」
 *     包装（**首次 render 前缓存已就绪**，因此 DOM 与抽包前一致；真没赶上也只是多一帧 `null`）。
 *
 * 覆盖：宿主可在启动期 `setMdHost({...})` 覆盖任意能力（未覆盖的沿用默认）。
 */

import { createElement, lazy, Suspense, type ComponentType, type MouseEvent, type ReactNode } from "react";
import { isBlockEditorFeatureEnabled, type BlockEditorFeature } from "./flags";
import { defineLazyHostComponent } from "./host-component";
import {
    makeMarkdownWikiLinkHref,
    parseMarkdownFileLineReference,
    parseMarkdownWikiLink,
    type MarkdownWikiLink,
} from "./markdown-refs";
import type { MarkdownContentBlockType } from "../shared/markdown-util";

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
 * 宿主 UI 组件集合（md-core 物理抽包 10-12 · R4）。
 *
 * 这三者是**真宿主**（依赖 block-editor 运行时 / Wave UI 原语），无法随包搬走，所以渲染层
 * 只经 adapter 取用。默认实现在模块求值期用 `import()` 预热宿主模块（见 `./host-component`），
 * 因此宿主**零接线**也能拿到真实组件。
 *
 * prop 形状用结构类型声明（不 import 宿主类型），与宿主实现保持兼容。
 */
export interface MdHostComponents {
    /** WYSIWYG 表格块（`@/app/element/block-editor/components/table-block`）。 */
    TableBlock: ComponentType<{ props: any; collapsed: boolean; onToggle: () => void }>;
    /** 复制按钮 UI 原语（`@/app/element/copybutton`）。 */
    CopyButton: ComponentType<{
        title: string;
        className?: string;
        onClick: (e: MouseEvent<HTMLButtonElement>) => void;
    }>;
    /** 图标按钮 UI 原语（`@/app/element/iconbutton`）。 */
    IconButton: ComponentType<{ decl: any; className?: string }>;
}

/** 宿主特性开关（默认实现 = 包内纯实现 `./flags`，宿主可换成 settings / 远端配置）。 */
export interface MdHostFeatures {
    isBlockEditorFeatureEnabled(feature: BlockEditorFeature): boolean;
}

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
    /** 宿主特性开关（渲染层的 `tablecell` / `codelang` 等 gate 全走这里）。 */
    features: MdHostFeatures;
    /** 宿主 UI 组件（表格块 / 复制按钮 / 图标按钮）。 */
    components: MdHostComponents;
    /**
     * `!!!type[key]!!!` 内容块占位符的 remark 插件工厂。
     *
     * 可选：**未注入时** remark 管线（`../remark/index.ts`）自己用包内纯实现兜底 —— 这里不设默认
     * 值，是为了避免 `core` 层在值层面反向依赖 `remark` 层。宿主可用它换一套占位符语法。
     */
    contentBlockPlugin?: (opts: { blocks: Map<string, MarkdownContentBlockType> }) => unknown;
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

    // ---- 特性开关 / UI 组件 / 内容块插件（md-core 物理抽包 10-12 · R4）-------------------
    // 纯能力（flags / contentblock）直接用包内纯实现：渲染层需要一个**同步**的调用点，
    // 同步能力无法用动态 import 兜底。宿主 UI 组件则用延迟 import 预热（见 host-component.ts）。
    features: { isBlockEditorFeatureEnabled },
    components: {
        TableBlock: defineLazyHostComponent("TableBlock", async () => {
            const mod = await import("@/app/element/block-editor/components/table-block");
            return { default: mod.TableBlock };
        }),
        CopyButton: defineLazyHostComponent("CopyButton", async () => {
            const mod = await import("@/app/element/copybutton");
            return { default: mod.CopyButton };
        }),
        IconButton: defineLazyHostComponent("IconButton", async () => {
            const mod = await import("@/app/element/iconbutton");
            return { default: mod.IconButton };
        }),
    },
};

let currentHost: MdHostAdapter = DEFAULTS;

/**
 * 覆盖宿主能力（未列出的沿用默认实现）。
 *
 * 注意：`features` / `components` / `contentBlockPlugin` 是**整个对象替换**（浅合并），
 * 只想覆盖其中一项时请把其余项显式写全，或改用 `getMdHost()` 展开后覆盖。
 */
export function setMdHost(host: Partial<MdHostAdapter>): void {
    currentHost = { ...DEFAULTS, ...host };
}

/** 取当前宿主能力（永远返回完整实现）。 */
export function getMdHost(): MdHostAdapter {
    return currentHost;
}
