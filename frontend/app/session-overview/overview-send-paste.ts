// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Overview 发送框粘贴图片（11-24 R9，`11-24-agentsend-image-paste`）的通道适配。
//
// 复用 CommonText 的全套落盘/校验/markdown 管线（commontext-paste-image.ts），只换附件子目录：
// 决策 D3 —— 新建 `overview-send-images`，不复用 `commontext-images`（语义隔离：
// 发给 agent 的截图不是 CommonText 条目附件，清理/同步策略不同）。
//
// 落盘走 writePasteImage(blob, { subdir })，失败不留半截引用（既有语义）。

import {
    materializePastedImages,
    writePasteImage,
    type PasteImageInsertResult,
} from "@/app/commontext/commontext-paste-image";

/** 发送框附件子目录（app data dir 下；与 commontext-images 分开）。 */
export const OverviewSendImageSubdir = "overview-send-images";

/** 依次落盘剪贴板图片并生成 markdown 引用（保序、串行；失败项只进 failures）。 */
export async function materializeOverviewSendImages(blobs: readonly Blob[]): Promise<PasteImageInsertResult> {
    return materializePastedImages([...blobs], (blob) => writePasteImage(blob, { subdir: OverviewSendImageSubdir }));
}
