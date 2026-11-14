// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// .base 查看器内部插件（Phase 1，只读）。
// match：文件扩展名 .base。渲染：BaseViewTable。
// 与 Obsidian 解耦：只读 .base 纯文本 + 扫描 markdown frontmatter，不依赖 Obsidian 应用。

import { registerPreviewPlugin, PreviewPlugin } from "@/app/view/preview/preview-plugin-registry";
import { i18n } from "@/i18n/config";
import { BaseViewTable } from "./base-view-table";

const pluginId = "base-view";

export const baseViewPlugin: PreviewPlugin = {
    id: pluginId,
    // 惰性求值：避免 import 期把标题锁死到启动时的 locale。
    get displayName() {
        return i18n.t("preview:plugin.baseView");
    },
    priority: 0,
    match: (ctx) => ctx.fileName.endsWith(".base"),
    render: ({ model }) => <BaseViewTable model={model} />,
    canEdit: () => false,
    icon: "table",
};

export function registerBaseViewPlugin(): void {
    registerPreviewPlugin(baseViewPlugin);
}
