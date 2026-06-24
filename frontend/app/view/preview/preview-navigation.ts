// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { isBlank } from "@/util/util";

export const PreviewExplorerRootMetaKey = "preview:explorer-root";
export const PreviewDirectoryDisplayMetaKey = "preview:directory-display";
export const PreviewDefaultDirectoryDisplaySettingKey = "preview:defaultdirectorydisplay";
export const PreviewRevealPathMetaKey = "preview:revealpath";
export const PreviewRevealSeqMetaKey = "preview:revealseq";
export const PreviewPathIsDirMetaKey = "preview:pathisdir";

export type PreviewDirectoryDisplayMode = "list" | "tree";
export type PreviewOpenTargetDirection = "off" | "left" | "right" | "up" | "down";

export function normalizePreviewDirectoryDisplayMode(
    val: any,
    fallback: PreviewDirectoryDisplayMode = "tree"
): PreviewDirectoryDisplayMode {
    if (val === "list" || val === "tree") {
        return val;
    }
    return fallback;
}

export function normalizePreviewOpenTargetDirection(
    val: any,
    fallback: PreviewOpenTargetDirection = "off"
): PreviewOpenTargetDirection {
    if (val === "left" || val === "right" || val === "up" || val === "down" || val === "off") {
        return val;
    }
    return fallback;
}

export function resolvePreviewDirectoryDisplayMode(
    blockValue: any,
    settingsValue: any,
    fallback: PreviewDirectoryDisplayMode = "tree"
): PreviewDirectoryDisplayMode {
    const defaultMode = normalizePreviewDirectoryDisplayMode(settingsValue, fallback);
    return normalizePreviewDirectoryDisplayMode(blockValue, defaultMode);
}

export function resolvePreviewOpenTargetDirection(
    blockValue: any,
    settingsValue: any,
    fallback: PreviewOpenTargetDirection = "right"
): PreviewOpenTargetDirection {
    const defaultDirection = normalizePreviewOpenTargetDirection(settingsValue, fallback);
    return normalizePreviewOpenTargetDirection(blockValue, defaultDirection);
}

export function resolvePreviewOpenTargetDirectionForBlock(
    blockValue: any,
    settingsValue: any,
    fallback: PreviewOpenTargetDirection,
    blockKind?: string | null
): PreviewOpenTargetDirection {
    if (blockValue == null && blockKind === "note") {
        return "off";
    }
    return resolvePreviewOpenTargetDirection(blockValue, settingsValue, fallback);
}

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

export function applyDirectoryNavigationMeta(
    meta: Record<string, any>,
    directoryDisplayMode: PreviewDirectoryDisplayMode,
    directoryPath?: string | null
): Record<string, any> {
    if (isBlank(directoryPath)) {
        if (Object.prototype.hasOwnProperty.call(meta, PreviewPathIsDirMetaKey)) {
            return meta;
        }
        return {
            ...meta,
            [PreviewPathIsDirMetaKey]: null,
        };
    }
    return applyExplorerRootForDirectoryNavigation(
        {
            ...meta,
            edit: false,
            "preview:searchline": null,
            [PreviewPathIsDirMetaKey]: true,
        },
        directoryDisplayMode,
        directoryPath
    );
}

export function resolveExplorerRootPathForOpenInCurrentBlock(entry: {
    path?: string | null;
    dir?: string | null;
    isdir?: boolean | null;
}): string | null {
    if (entry.isdir) {
        return isBlank(entry.path) ? null : entry.path;
    }
    return isBlank(entry.dir) ? null : entry.dir;
}
