// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * 模块级编辑控制器单例（P2-B2）。
 *
 * createEditController() 是无状态纯函数工厂，其返回实例不依赖 React/DOM，可安全地作为
 * 模块级单例共享。prose 提交收敛点在 markdown-inline-edit.tsx（useInlineEdit 的 commit），
 * code 语言收敛点在 markdown.tsx —— 两处 import 同一实例，保证编辑路径共用一份控制器。
 *
 * 不要把单例经 block-model/index.ts 转发导出（避免形成多方依赖环）；由消费方显式 import 本模块。
 */
import { createEditController } from "./editor-controller";

export const editorController = createEditController();
