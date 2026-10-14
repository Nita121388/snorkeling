// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * `@snorkeling/md-dom` —— 框架无关的 markdown 编辑引擎。
 *
 * 分层位置（见 Obsidian 方案 `11-我们自己的Milkdown-架构与公开API.md`）：
 *
 *   md-core   纯逻辑：markdown ⇄ 块模型，remark 管线，DOM→markdown 序列化
 *   md-dom    编辑引擎：就地编辑、caret/选区、键盘语义、块级提交   ← 本包（零 React / 零宿主）
 *   md-react  React 绑定：组件与 hooks（薄封装 md-dom + md-core），给 Snorkeling 用
 *   md-schema 对外契约：块类型、sanitize schema、序列化白名单
 *   host      适配层：图片解析 / 文件引用 / 文件 IO / 主题 token / 特性开关
 *
 * 消费者组合：
 *   - Snorkeling（React）：`md-core` + `md-dom` + `md-react` + snorkeling host adapter
 *   - journal（零框架 Chrome 扩展）：`md-core` + `md-dom` + journal host adapter
 *
 * 不变量（由 `packages/md-dom/src/boundary.test.ts` 锁死）：
 *   - 包内**零 React 运行时依赖**（不 import react / react-dom / react-markdown）
 *   - 包内**零宿主静态依赖**（不 import 宿主 `@/`；相对路径必须落在包内；只允许裸包名）
 *
 * 当前导出的是**块语法层**（纯字符串）。编辑会话层（就地编辑的 DOM 生命周期、caret/选区、
 * 键盘语义）正从 `frontend/app/element/markdown-inline-edit.tsx` 搬迁中 —— 那个文件同时含
 * React 组件，是「编辑引擎与框架绑死」的机械原因。
 */

export {
    isStaleTargetBlock,
    MarkdownRenderRootSelector,
    prepareInlineEditCommit,
    relocateByBlockId,
    relocateByContent,
    type BlockEditTarget,
} from "./commit-prep";
export {
    calloutSeedHtml,
    captureInplaceSeedHtml,
    captureWysiwygInfo,
    normalizeBreaksAroundNewlines,
    SEED_BLOCK_TAGS,
    stripInsignificantWhitespace,
    WYSIWYG_KINDS,
    type WysiwygEligibleKind,
    type WysiwygSeedInfo,
} from "./seed";
export {
    applyCalloutPrefix,
    captureCalloutPrefix,
    indentListDraft,
    indentListRange,
    initialContentFor,
    inlineKindToTreeKind,
    isEmptyBlockShellDraft,
    isEmptyQuoteShellDraft,
    wrapCodeFence,
    wrapListMarker,
    type InlineEditBlockKind,
} from "./block-syntax";
