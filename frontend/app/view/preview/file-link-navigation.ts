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
    PreviewPathIsDirMetaKey,
    PreviewRevealPathMetaKey,
    PreviewRevealSeqMetaKey,
    resolvePreviewDirectoryDisplayMode,
} from "./preview-navigation";

type FileLinkOpenOptions = {
    connection?: string | null;
    baseDir?: string | null;
    openDirectoryIndex?: boolean;
    lineNumber?: number | null;
    editMode?: boolean;
    revealInTree?: boolean;
    revealInTreeBlockId?: string | null;
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

function cleanPathSegments(path: string): string {
    let value = path.replace(/\\/g, "/");
    let prefix = "";

    const drivePrefix = value.match(/^([A-Za-z]:)(?:\/|$)/);
    if (drivePrefix != null) {
        prefix = `${drivePrefix[1]}/`;
        value = value.slice(drivePrefix[0].length);
    } else if (value === "~") {
        return "~";
    } else if (value.startsWith("~/")) {
        prefix = "~/";
        value = value.slice(2);
    } else if (value.startsWith("//")) {
        prefix = "//";
        value = value.slice(2);
    } else if (value.startsWith("/")) {
        prefix = "/";
        value = value.replace(/^\/+/, "");
    }

    const parts: string[] = [];
    for (const part of value.split("/")) {
        if (part === "" || part === ".") {
            continue;
        }
        if (part === "..") {
            if (parts.length > 0 && parts[parts.length - 1] !== "..") {
                parts.pop();
            } else if (prefix === "") {
                parts.push(part);
            }
            continue;
        }
        parts.push(part);
    }

    const joined = parts.join("/");
    if (prefix === "") {
        return joined;
    }
    if (prefix === "~/" && joined === "") {
        return "~";
    }
    return `${prefix}${joined}`;
}

function resolveRelativeLinkedFilePath(relativePath: string, baseDir?: string | null): string | null {
    if (typeof baseDir !== "string" || baseDir.trim() === "") {
        return null;
    }
    const normalizedBaseDir = cleanPathSegments(baseDir.trim());
    if (normalizedBaseDir === "") {
        return null;
    }
    const normalizedRelativePath = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
    if (normalizedRelativePath === "") {
        return normalizedBaseDir;
    }
    const separator = normalizedBaseDir === "/" || normalizedBaseDir.endsWith("/") ? "" : "/";
    return cleanPathSegments(`${normalizedBaseDir}${separator}${normalizedRelativePath}`);
}

function joinLinkedPath(basePath: string, relativePath: string): string {
    const normalizedBasePath = cleanPathSegments(basePath.trim());
    const normalizedRelativePath = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
    const separator = normalizedBasePath === "/" || normalizedBasePath.endsWith("/") ? "" : "/";
    return cleanPathSegments(`${normalizedBasePath}${separator}${normalizedRelativePath}`);
}

export function normalizeLinkedFilePath(href: string, options?: Pick<FileLinkOpenOptions, "baseDir">): string | null {
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
    return resolveRelativeLinkedFilePath(value, options?.baseDir);
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

async function findDirectoryIndexPath(path: string, connection: string | null | undefined): Promise<string | null> {
    for (const fileName of ["README.md", "index.md"]) {
        const candidatePath = joinLinkedPath(path, fileName);
        try {
            const fileInfo = await statPath(candidatePath, connection);
            if (!fileInfo?.isdir && fileInfo?.mimetype !== "directory" && !fileInfo?.notfound) {
                return fileInfo?.path || candidatePath;
            }
        } catch {
            continue;
        }
    }
    return null;
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

async function findExistingNonEditPreviewBlock(targetPath: string, connection: string): Promise<string | null> {
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
        if (block.meta?.edit === true) {
            continue;
        }
        if (block.meta?.file !== targetPath) {
            continue;
        }
        return blockId;
    }
    return null;
}

async function applySearchLineToBlock(blockId: string, options?: FileLinkOpenOptions): Promise<void> {
    if (options?.lineNumber == null || !Number.isFinite(options.lineNumber)) {
        return;
    }
    const block = globalStore.get(WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId)));
    const nextMeta = applyPreviewOpenOptions({ ...(block?.meta ?? {}) }, options);
    await ObjectService.UpdateObjectMeta(WOS.makeORef("block", blockId), nextMeta);
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
    console.log("[CTREVEAL] requestTreeReveal WRITE", { blockId, path, currentSeq, nextSeq });
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
    const linkedPath = normalizeLinkedFilePath(href, { baseDir: options?.baseDir });
    if (linkedPath == null) {
        return false;
    }
    await openPathInPreview(linkedPath, options);
    return true;
}

export async function openPathInPreview(path: string, options?: FileLinkOpenOptions): Promise<void> {
    const connection = normalizeConnection(options?.connection);
    console.log("[CTREVEAL] openPathInPreview ENTER", { path, revealInTree: options?.revealInTree, lineNumber: options?.lineNumber, connection });
    let fileInfo: FileInfo;
    try {
        fileInfo = await statPath(path, connection);
    } catch (e) {
        console.log("[CTREVEAL] openPathInPreview: stat failed, creating fallback block");
        await createPreviewBlock(path, connection, applyPreviewOpenOptions({}, options));
        return;
    }
    const targetPath = fileInfo?.path || path;
    const targetIsDir = !!fileInfo?.isdir || fileInfo?.mimetype === "directory";
    if (targetIsDir && options?.openDirectoryIndex) {
        const indexPath = await findDirectoryIndexPath(targetPath, connection);
        if (indexPath != null) {
            await openPathInPreview(indexPath, { ...options, openDirectoryIndex: false });
            return;
        }
    }
    const treeBlock = options?.revealInTree === false ? null : await findTreeFilesBlock(targetPath, connection);
    console.log("[CTREVEAL] openPathInPreview treeBlock", { revealInTree: options?.revealInTree, targetPath, treeBlockId: treeBlock?.blockId ?? null, treeBlockRoot: treeBlock?.rootPath ?? null, revealInTreeBlockId: options?.revealInTreeBlockId ?? null });
    if (treeBlock != null) {
        await requestTreeReveal(treeBlock.blockId, treeBlock.block, targetPath);
        await focusTreeBlock(treeBlock.blockId);
        if (!targetIsDir) {
            const existingId = await findExistingNonEditPreviewBlock(targetPath, connection);
            console.log("[CTREVEAL] openPathInPreview (treeBlock branch) existingId", { targetPath, existingId });
            if (existingId != null) {
                await focusTreeBlock(existingId);
                await applySearchLineToBlock(existingId, options);
                return;
            }
            await createPreviewBlock(
                targetPath,
                connection,
                applyPreviewOpenOptions({ [PreviewPathIsDirMetaKey]: false }, options)
            );
        }
        return;
    }
    if (options?.revealInTree === true && options?.revealInTreeBlockId != null) {
        const fallbackBlock = globalStore.get(WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", options.revealInTreeBlockId)));
        if (fallbackBlock != null) {
            console.log("[CTREVEAL] openPathInPreview fallback reveal in current explorer block", { blockId: options.revealInTreeBlockId, targetPath });
            await requestTreeReveal(options.revealInTreeBlockId, fallbackBlock, targetPath);
            await focusTreeBlock(options.revealInTreeBlockId);
            if (!targetIsDir) {
                const existingId = await findExistingNonEditPreviewBlock(targetPath, connection);
                if (existingId != null) {
                    await focusTreeBlock(existingId);
                    await applySearchLineToBlock(existingId, options);
                    return;
                }
                await createPreviewBlock(
                    targetPath,
                    connection,
                    applyPreviewOpenOptions({ [PreviewPathIsDirMetaKey]: false }, options)
                );
            }
            return;
        }
    }
    if (targetIsDir) {
        console.log("[CTREVEAL] openPathInPreview: createPreviewBlock (dir/tree, no treeBlock found)");
        await createPreviewBlock(
            targetPath,
            connection,
            applyPreviewOpenOptions(
                {
                    [PreviewDirectoryDisplayMetaKey]: "tree",
                    [PreviewExplorerRootMetaKey]: targetPath,
                    [PreviewPathIsDirMetaKey]: true,
                },
                options
            )
        );
        return;
    }
    const existingId = await findExistingNonEditPreviewBlock(targetPath, connection);
    console.log("[CTREVEAL] openPathInPreview (no treeBlock) existingId", { targetPath, existingId });
    if (existingId != null) {
        await focusTreeBlock(existingId);
        await applySearchLineToBlock(existingId, options);
        return;
    }
    console.log("[CTREVEAL] openPathInPreview: createPreviewBlock (new file block)");
    await createPreviewBlock(
        targetPath,
        connection,
        applyPreviewOpenOptions({ [PreviewPathIsDirMetaKey]: false }, options)
    );
}
