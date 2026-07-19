// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export function isConfirmedMissingInlineTabBlock(blockIsLoading: boolean, blockIsNull: boolean): boolean {
    return !blockIsLoading && blockIsNull;
}

export function getRemainingInlineTabBlockIds(blockIds: string[], missingBlockId: string): string[] {
    return blockIds.filter((blockId) => blockId != missingBlockId);
}

export function shouldWarmupInlineTabController({
    active,
    preview,
    blockIsLoading,
    blockExists,
    blockView,
    controller,
}: {
    active: boolean;
    preview: boolean;
    blockIsLoading: boolean;
    blockExists: boolean;
    blockView: string;
    controller: string;
}): boolean {
    return !active && !preview && !blockIsLoading && blockExists && blockView == "term" && controller.trim() != "";
}

export function getInlineTabRuntimeOpts(rows?: number, cols?: number): RuntimeOpts | undefined {
    if (rows == null || cols == null || rows <= 0 || cols <= 0) {
        return undefined;
    }
    return { termsize: { rows, cols } };
}
