// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// **转发层**（兼容别名）。公共内核已搬到 scripts/verify/lib/。
// 这里保留是为了不改动既有 area（image-pager / overview-board / vcs-tree-status）
// 里 `import "../preview-edit/lib/xxx.mjs"` 的路径；新台子请直接 import "../lib/xxx.mjs"。
export * from "../../lib/oracle.mjs";
