// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * 宿主侧 re-export shim（md-core 物理抽包 10-12）。
 *
 * flag 的实现是**纯逻辑**（零 import），已随包搬到 `@md/core/core/flags` —— 渲染层需要一个
 * 同步的 flag 读取点，同步能力无法用「延迟 import() 兜底」实现，只能让纯实现随包走。
 *
 * 本文件保留原路径 + 原导出名，是为了让宿主的 ~10 个调用点
 * （`markdown.tsx` / `markdown-inline-edit.tsx` / `block-editor/components/table-block.tsx` /
 * `block-editor/flags.test.ts`）**一个字节都不用改**。
 *
 * 宿主若要换 flag 的存储后端，覆盖 `MdHostAdapter.features`（见 `@md/core/core/host`）；
 * 宿主自身的 `isBlockEditorFeatureEnabled` 调用点仍走本模块。
 */

export * from "@md/core/core/flags";
