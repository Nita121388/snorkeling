// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export const PreviewLiveSourceBlockMetaKey = "preview:live-source-blockid";
export const PreviewLiveScrollSyncMetaKey = "preview:livescrollsync";

function isBlank(value: string | null | undefined): boolean {
    return value == null || value === "";
}

export function resolveLivePreviewBlockIdForSource(
    sourceBlockId: string,
    candidateBlockIds: string[],
    getBlockById: (blockId: string) => Block | null | undefined,
    cachedBlockId?: string | null
): string | null {
    const isLivePreviewForSource = (blockId: string) => {
        if (isBlank(blockId) || blockId === sourceBlockId) {
            return false;
        }
        const blockData = getBlockById(blockId);
        return blockData?.meta?.view === "preview" && blockData.meta?.[PreviewLiveSourceBlockMetaKey] === sourceBlockId;
    };
    if (!isBlank(cachedBlockId) && candidateBlockIds.includes(cachedBlockId) && isLivePreviewForSource(cachedBlockId)) {
        return cachedBlockId;
    }
    for (const blockId of candidateBlockIds) {
        if (blockId === cachedBlockId) {
            continue;
        }
        if (isLivePreviewForSource(blockId)) {
            return blockId;
        }
    }
    return null;
}
