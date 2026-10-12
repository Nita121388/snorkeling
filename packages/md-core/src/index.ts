// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * `@snorkeling/md-core` 对外入口（md-core 物理抽包 10-12）。
 *
 * 汇总导出**宿主缝隙**（`core/`）：宿主适配器 + 纯 classnames + 纯 wiki/file-ref 语法解析。
 * 其余分层按子路径消费，避免把 React 渲染器 / block 模型全部拉进同一入口：
 *   - `@md/core/transform/*`  DOM ↔ markdown 纯文本变换
 *   - `@md/core/block-model/*` 块模型语义视图 + 编辑控制器
 *   - `@md/core/remark/*`      remark 插件管线
 *   - `@md/core/render/*`      react-markdown 渲染器注册表
 *   - `@md/core/shared/*`      纯共享 helper（markdown 语法 / task toggle / ordered list / sanitize schema）
 *
 * 不变量：本包内**零静态宿主依赖**（不得 import 宿主 `@/` 路径）。宿主能力由 `setMdHost(...)` 注入，
 * 未注入时走延迟 import 宿主模块的默认实现。
 */

export { cn } from "./core/classnames";
export {
    getMdHost,
    setMdHost,
    type MdContextMenuItem,
    type MdFileLinkOpenOptions,
    type MdHostAdapter,
    type MdImageLightboxProps,
    type MdImageResolveOpts,
} from "./core/host";
export {
    makeMarkdownWikiLinkHref,
    parseMarkdownFileLineReference,
    parseMarkdownWikiLink,
    safeDecodeURIComponent,
    type MarkdownWikiLink,
} from "./core/markdown-refs";
