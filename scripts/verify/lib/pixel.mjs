// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 公共内核入口（**唯二**：lib/report.mjs 与 lib/probes.mjs 是新写的，其余为转出）。
//
// 物理文件当前仍在 ../preview-edit/lib/ —— 那是历史包袱：这台最早只有 preview-edit 一个
// area，后来 overview-board / vcs-tree-status / image-pager / agent-card-seen 全部反向
// import 它。为了不动那些正在被别的任务修改的文件，这里先做**转发层**：
// 新台子一律 `import ... from "../lib/xxx.mjs"`，将来把物理文件搬到这里时，
// 只有本文件需要删除，所有 area 的 import 路径不变。
export * from "../preview-edit/lib/pixel.mjs";
