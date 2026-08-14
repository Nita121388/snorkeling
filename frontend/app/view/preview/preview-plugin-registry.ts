// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 第一阶段内部插件机制：预览插件注册表。
// 设计来源：需求文档「插件机制需求」§95-180（PreviewPlugin 接口 + 注册表）。
// 内部插件 = 代码随主应用编译，但通过本注册表接入，不散落进 getSpecializedView 的 if/else。
// 接口形状与未来第二阶段外部插件一致，届时可原样抽出。

import type { ComponentType, RefObject } from "react";
// FileInfo 为全局类型（frontend/types/gotypes.d.ts，declare global），无需 import。
import type { PreviewModel } from "./preview-model";

// 插件渲染属性：model 提供文件内容/元数据，parentRef 为宿主容器，readonly 表示只读态。
// ponytail: 与现有 SpecializedViewProps 形状兼容（model+parentRef），readonly 可选，避免渲染层强耦合。
export type PreviewPluginProps = {
    model: PreviewModel;
    parentRef: RefObject<HTMLDivElement>;
    readonly?: boolean;
};

// 匹配上下文：打开文件时由宿主构造，供插件 match 判断是否接管。
export type PreviewMatchContext = {
    fileInfo: FileInfo | null;
    mimeType: string;
    fileName: string;
    filePath: string;
    editMode: boolean;
};

export type PreviewPlugin = {
    id: string;
    displayName: string;
    priority?: number;
    match: (context: PreviewMatchContext) => boolean;
    render: ComponentType<PreviewPluginProps>;
    canEdit?: (context: PreviewMatchContext) => boolean;
    icon?: string;
};

const previewPlugins: PreviewPlugin[] = [];

export function registerPreviewPlugin(plugin: PreviewPlugin): void {
    // 同 id 去重：HMR 热重载 / 重复注册时替换旧实例，避免注册表膨胀与 match 歧义。
    const existingIdx = previewPlugins.findIndex((p) => p.id === plugin.id);
    if (existingIdx >= 0) {
        previewPlugins.splice(existingIdx, 1);
    }
    previewPlugins.push(plugin);
    previewPlugins.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
}

export function unregisterPreviewPlugin(id: string): void {
    const idx = previewPlugins.findIndex((p) => p.id === id);
    if (idx >= 0) {
        previewPlugins.splice(idx, 1);
    }
}

export function getAllPreviewPlugins(): PreviewPlugin[] {
    return [...previewPlugins];
}

export function resolvePreviewPlugin(context: PreviewMatchContext): PreviewPlugin | null {
    return previewPlugins.find((plugin) => plugin.match(context)) ?? null;
}

export function getPreviewPluginById(id: string): PreviewPlugin | null {
    return previewPlugins.find((plugin) => plugin.id === id) ?? null;
}
