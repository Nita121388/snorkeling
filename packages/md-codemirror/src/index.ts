// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * `@snorkeling/md-codemirror` —— CodeMirror 6 Markdown 编辑内核。
 *
 * 分层位置（见 design/plans/ 与任务 `10-17-codemirror6-markdown-editor`）：
 *
 *   md-core      Markdown 解析、块模型、源码坐标、往返与提交契约
 *   md-codemirror CodeMirror 6 编辑内核：文本状态、Selection、滚动、IME、History、Live Preview ← 本包
 *   md-react     React 生命周期薄绑定（第二阶段，Snorkeling 消费）
 *   host adapter 每个消费者的图片、链接、保存、主题能力；全部有默认实现
 *
 * 不变量（由 `boundary.test.ts` 锁死）：
 *   - 零 React（不 import react / react-dom / react-markdown）；
 *   - 零 Monaco（CodeMirror 只服务 Markdown / 卡片文本，不碰代码编辑器）；
 *   - 零宿主静态依赖（不 import 宿主 `@/`；相对路径必须落在包内；只允许裸包名
 *     与 `@snorkeling/md-core` 的**纯子路径**（`core/markdown-refs` 这类零 React 模块））。
 *
 * journal（零框架 Chrome 扩展）直接用本包 API；Snorkeling 在 React 薄绑定就绪后接入。
 */

export { createMarkdownEditor } from "./editor";
export type { ModeExtensions } from "./editor";
export { runMarkdownEditorCommand, createMarkdownCommands } from "./commands";
export { getDefaultHost, mergeHost, emitHostEvent } from "./host";
export {
    buildDecorations,
    livePreviewExtension,
    livePreviewBaseTheme,
} from "./live-preview";
export type {
    MarkdownChange,
    MarkdownCommand,
    MarkdownEditor,
    MarkdownEditorHost,
    MarkdownEditorMode,
    MarkdownEditorOptions,
    MarkdownHostEvent,
    MarkdownSelection,
} from "./types";