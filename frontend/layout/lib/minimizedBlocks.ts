// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export const MinimizedBlocksMetaKey = "layout:minimizedblocks";

export function normalizeMinimizedBlockIds(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    const seen = new Set<string>();
    const blockIds: string[] = [];
    value.forEach((item) => {
        if (typeof item !== "string" || item === "" || seen.has(item)) {
            return;
        }
        seen.add(item);
        blockIds.push(item);
    });
    return blockIds;
}

export function getMinimizedBlockIdsFromTab(tab: Tab | null | undefined): string[] {
    const tabBlockIds = new Set(tab?.blockids ?? []);
    return normalizeMinimizedBlockIds((tab?.meta as Record<string, unknown>)?.[MinimizedBlocksMetaKey]).filter(
        (blockId) => tabBlockIds.has(blockId)
    );
}
