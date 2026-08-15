// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// md-properties 插件的 match 谓词（纯函数，独立文件便于单测，避免测试拉入预览渲染依赖树）。

import type { PreviewMatchContext } from "@/app/view/preview/preview-plugin-registry";

/** .md/.mdx 只读预览接管；editMode 下回落 codeedit（不拦截）。 */
export function isMdPropertiesMatch(ctx: PreviewMatchContext): boolean {
    return (ctx.fileName.endsWith(".md") || ctx.fileName.endsWith(".mdx")) && !ctx.editMode;
}