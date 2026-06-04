// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { restoreMinimizedBlockToLayout } from "@/app/block/block-minimize";
import { atoms, createBlock, getFocusedBlockId, globalStore, refocusNode, WOS } from "@/app/store/global";
import { ObjectService } from "@/app/store/services";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { getLayoutModelForStaticTab } from "@/layout/index";
import { isBlank, isLocalConnName } from "@/util/util";
import { formatRemoteUri } from "@/util/waveutil";
import {
    PreviewDefaultDirectoryDisplaySettingKey,
    PreviewDirectoryDisplayMetaKey,
    PreviewExplorerRootMetaKey,
    PreviewRevealPathMetaKey,
    PreviewRevealSeqMetaKey,
    resolvePreviewDirectoryDisplayMode,
} from "./preview-navigation";

type FileLinkOpenOptions = {
    connection?: string | null;
    lineNumber?: number | null;
    editMode?: boolean;
};

type PreviewTreeBlock = {
    blockId: string;
    block: Block;
    rootPath: string;
};

const WindowsAbsolutePathRe = /^[A-Za-z]:(?:[\\/]|$)/;
const FileUrlPrefixRe = /^file:\/\//i;
const ExternalSchemeRe = /^[A-Za-z][A-Za-z0-9+.-]*:/;

function safeDecodeURIComponent(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function stripQueryAndHash(value: string): string {
    const hashIdx = value.indexOf("#");
    const queryIdx = value.indexOf("?");
    const cutIdxs = [hashIdx, queryIdx].filter((idx) => idx >= 0);
    if (cutIdxs.length === 0) {
        return value;
    }
    return value.slice(0, Math.min(...cutIdxs));
}

export function normalizeLinkedFilePath(href: string): string | null {
    if (typeof href !== "string") {
        return null;
    }
    let value = href.trim();
    if (value === "" || value.startsWith("#")) {
        return null;
    }
    value = stripQueryAndHash(value);
    if (value === "") {
        return null;
    }
    if (FileUrlPrefixRe.test(value)) {
        try {
            const url = new URL(value);
            value = safeDecodeURIComponent(url.pathname);
            if (url.hostname && url.hostname !== "localhost") {
                value = `//${url.hostname}${value}`;
            }
            if (/^\/[A-Za-z]:/.test(value)) {
                value = value.slice(1);
            }
        } catch {
            value = value.replace(FileUrlPrefixRe, "");
            if (/^\/[A-Za-z]:/.test(value)) {
                value = value.slice(1);
            }
            value = safeDecodeURIComponent(value);
        }
    } else {
        value = safeDecodeURIComponent(value);
    }
    if (WindowsAbsolutePathRe.test(value)) {
        return value.replace(/\\/g, "/");
    }
    if (value.startsWith("/") || value.startsWith("~/")) {
        return value;
    }
    if (ExternalSchemeRe.test(value)) {
        return null;
    }
    return null;
}

function normalizePathForCompare(path: unknown): string {
    if (typeof path !== "string") {
        return "";
    }
    let value = path.trim().replace(/\\/g, "/").replace(/\/+/g, "/");
    if (/^\/[A-Za-z]:/.test(value)) {
        value = value.slice(1);
    }
    if (value.length > 1 && !/^[A-Za-z]:\/$/.test(value)) {
        value = value.replace(/\/+$/, "");
    }
    return value;
}

function normalizeConnection(connection: unknown): string {
    const normalized = typeof connection === "string" ? connection.trim() : "";
    return isLocalConnName(normalized) ? "local" : normalized;
}

export function isPathWithinRoot(targetPath: string, rootPath: string): boolean {
    const target = normalizePathForCompare(targetPath);
    const root = normalizePathForCompare(rootPath);
    if (target === "" || root === "") {
        return false;
    }
    if (target === root) {
        return true;
    }
    const rootWithSlash = root.endsWith("/") ? root : `${root}/`;
    return target.startsWith(rootWithSlash);
}

function getFallbackDir(path: string): string {
    const normalized = normalizePathForCompare(path);
    if (normalized === "" || normalized === "/" || /^[A-Za-z]:$/.test(normalized)) {
        return normalized;
    }
    const idx = normalized.lastIndexOf("/");
    if (idx <= 0) {
        return normalized;
    }
    if (idx === 2 && WindowsAbsolutePathRe.test(normalized)) {
        return normalized.slice(0, idx + 1);
    }
    return normalized.slice(0, idx);
}

function getFileInfoDir(fileInfo: FileInfo, fallbackPath: string): string {
    if (fileInfo?.isdir || fileInfo?.mimetype === "directory") {
        return fileInfo.path ?? fallbackPath;
    }
    return fileInfo?.dir || getFallbackDir(fileInfo?.path ?? fallbackPath);
}

function getCurrentSettingsDirectoryDisplayDefault(): any {
    return globalStore.get(atoms.settingsAtom)?.[PreviewDefaultDirectoryDisplaySettingKey];
}

function getTreeRootFromBlock(block: Block): string {
    const storedRoot = block.meta?.[PreviewExplorerRootMetaKey];
    if (!isBlank(storedRoot)) {
        return storedRoot;
    }
    return block.meta?.file ?? "";
}

async function statPath(path: string, connection: string | null | undefined): Promise<FileInfo> {
    return await RpcApi.FileInfoCommand(TabRpcClient, {
        info: {
            path: formatRemoteUri(path, connection ?? "local"),
        },
    });
}

async function findTreeFilesBlock(targetPath: string, connection: string): Promise<PreviewTreeBlock | null> {
    const tabId = globalStore.get(atoms.staticTabId);
    if (isBlank(tabId)) {
        return null;
    }
    const tab = globalStore.get(WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", tabId)));
    for (const blockId of tab?.blockids ?? []) {
        const block = globalStore.get(WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId)));
        if (block?.meta?.view !== "preview") {
            continue;
        }
        if (normalizeConnection(block.meta?.connection) !== normalizeConnection(connection)) {
            continue;
        }
        const displayMode = resolvePreviewDirectoryDisplayMode(
            block.meta?.[PreviewDirectoryDisplayMetaKey],
            getCurrentSettingsDirectoryDisplayDefault(),
            "tree"
        );
        if (displayMode !== "tree") {
            continue;
        }
        const blockPath = block.meta?.file ?? "";
        try {
            const blockFileInfo = await statPath(blockPath, connection);
            if (!blockFileInfo?.isdir && blockFileInfo?.mimetype !== "directory") {
                continue;
            }
        } catch {
            continue;
        }
        const rootPath = getTreeRootFromBlock(block);
        if (isPathWithinRoot(targetPath, rootPath)) {
            return { blockId, block, rootPath };
        }
    }
    return null;
}

async function focusTreeBlock(blockId: string) {
    const tabId = globalStore.get(atoms.staticTabId);
    const layoutModel = getLayoutModelForStaticTab();
    const node = layoutModel?.getNodeByBlockId(blockId);
    if (node?.id != null) {
        refocusNode(blockId);
        return;
    }
    if (!isBlank(tabId) && restoreMinimizedBlockToLayout(tabId, blockId)) {
        window.setTimeout(() => refocusNode(blockId), 50);
    }
}

async function requestTreeReveal(blockId: string, block: Block, path: string) {
    const currentSeq =
        typeof block.meta?.[PreviewRevealSeqMetaKey] === "number" ? block.meta[PreviewRevealSeqMetaKey] : 0;
    const nextSeq = Math.max(currentSeq + 1, Date.now());
    const nextMeta = {
        ...(block.meta ?? {}),
        [PreviewRevealPathMetaKey]: path,
        [PreviewRevealSeqMetaKey]: nextSeq,
    };
    await ObjectService.UpdateObjectMeta(WOS.makeORef("block", blockId), nextMeta);
}

async function createPreviewBlock(path: string, connection: string | null | undefined, meta?: Record<string, any>) {
    const blockMeta: Record<string, any> = {
        view: "preview",
        file: path,
        ...(meta ?? {}),
    };
    if (!isBlank(connection)) {
        blockMeta.connection = connection;
    }
    await createBlock({ meta: blockMeta as MetaType });
}

export function applyPreviewOpenOptions(meta: Record<string, any>, options?: FileLinkOpenOptions): Record<string, any> {
    if (options?.lineNumber != null && Number.isFinite(options.lineNumber)) {
        meta["preview:searchline"] = Math.max(1, Math.floor(options.lineNumber));
    }
    if (options?.editMode != null) {
        meta.edit = options.editMode;
    }
    return meta;
}

export function getFocusedBlockConnection(): string | null {
    const focusedBlockId = getFocusedBlockId();
    if (isBlank(focusedBlockId)) {
        return null;
    }
    const block = globalStore.get(WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", focusedBlockId)));
    return normalizeConnection(block?.meta?.connection) || null;
}

export async function openFileLinkInPreview(href: string, options?: FileLinkOpenOptions): Promise<boolean> {
    const linkedPath = normalizeLinkedFilePath(href);
    if (linkedPath == null) {
        return false;
    }
    await openPathInPreview(linkedPath, options);
    return true;
}

export async function openPathInPreview(path: string, options?: FileLinkOpenOptions): Promise<void> {
    const connection = normalizeConnection(options?.connection);
    let fileInfo: FileInfo;
    try {
        fileInfo = await statPath(path, connection);
    } catch (e) {
        await createPreviewBlock(path, connection, applyPreviewOpenOptions({}, options));
        return;
    }
    const targetPath = fileInfo?.path || path;
    const targetIsDir = !!fileInfo?.isdir || fileInfo?.mimetype === "directory";
    const treeBlock = await findTreeFilesBlock(targetPath, connection);
    if (treeBlock != null) {
        await requestTreeReveal(treeBlock.blockId, treeBlock.block, targetPath);
        await focusTreeBlock(treeBlock.blockId);
        if (!targetIsDir) {
            await createPreviewBlock(targetPath, connection, applyPreviewOpenOptions({}, options));
        }
        return;
    }
    if (targetIsDir) {
        await createPreviewBlock(
            targetPath,
            connection,
            applyPreviewOpenOptions(
                {
                    [PreviewDirectoryDisplayMetaKey]: "tree",
                    [PreviewExplorerRootMetaKey]: targetPath,
                },
                options
            )
        );
        return;
    }
    await createPreviewBlock(targetPath, connection, applyPreviewOpenOptions({}, options));
}
