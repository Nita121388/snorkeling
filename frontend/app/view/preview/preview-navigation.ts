// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { isBlank } from "@/util/util";

export const PreviewExplorerRootMetaKey = "preview:explorer-root";

export type PreviewDirectoryDisplayMode = "list" | "tree";

export function applyExplorerRootForDirectoryNavigation(
    meta: Record<string, any>,
    directoryDisplayMode: PreviewDirectoryDisplayMode,
    directoryPath?: string | null
): Record<string, any> {
    if (directoryDisplayMode !== "tree" || isBlank(directoryPath)) {
        return meta;
    }
    return {
        ...meta,
        [PreviewExplorerRootMetaKey]: directoryPath,
    };
}
