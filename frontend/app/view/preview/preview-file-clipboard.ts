// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { isLocalConnName } from "@/util/util";
import { formatRemoteUri } from "@/util/waveutil";
import { atom, type PrimitiveAtom } from "jotai";
import { type PreviewModel } from "./preview-model";

const overwriteError = "set overwrite flag to delete the existing file";
const mergeError = "set overwrite flag to delete the existing contents or set merge flag to merge the contents";

export type PreviewFileClipboardItem = {
    path: string;
    name: string;
    isdir: boolean;
    conn: string;
};

export type PreviewFileClipboardMode = "copy" | "move";

export type PreviewFileClipboard = {
    mode: PreviewFileClipboardMode;
    items: PreviewFileClipboardItem[];
    createdAt: number;
};

export const previewFileClipboardAtom = atom<PreviewFileClipboard | null>(
    null
) as PrimitiveAtom<PreviewFileClipboard | null>;

export function getPreviewFileClipboard(): PreviewFileClipboard | null {
    return globalStore.get(previewFileClipboardAtom);
}

export function makePreviewFileClipboardItems(fileInfos: FileInfo[], conn: string): PreviewFileClipboardItem[] {
    const seenPaths = new Set<string>();
    const items: PreviewFileClipboardItem[] = [];
    fileInfos.forEach((fileInfo) => {
        if (fileInfo == null || fileInfo.path == null || fileInfo.path === "" || seenPaths.has(fileInfo.path)) {
            return;
        }
        seenPaths.add(fileInfo.path);
        items.push({
            path: fileInfo.path,
            name: fileInfo.name || fileInfo.path.split(/[\\/]/).pop() || fileInfo.path,
            isdir: Boolean(fileInfo.isdir),
            conn,
        });
    });
    return items;
}

function makeSystemClipboardText(items: PreviewFileClipboardItem[]): string {
    return items
        .map((item) => (isLocalConnName(item.conn) ? item.path : formatRemoteUri(item.path, item.conn)))
        .join("\n");
}

async function writePreviewFileItemsToSystemClipboard(items: PreviewFileClipboardItem[]): Promise<void> {
    if (items.length === 0 || typeof window === "undefined") {
        return;
    }
    const fallbackText = makeSystemClipboardText(items);
    const localPaths = items.filter((item) => isLocalConnName(item.conn)).map((item) => item.path);
    const api = (window as any)?.api as ElectronApi | undefined;
    try {
        if (api?.writeClipboardFiles != null && localPaths.length > 0) {
            const wroteFiles = await api.writeClipboardFiles(localPaths, fallbackText);
            if (wroteFiles) {
                return;
            }
        }
        if (api?.writeClipboardText != null) {
            await api.writeClipboardText(fallbackText);
            return;
        }
        await navigator.clipboard.writeText(fallbackText);
    } catch (e) {
        console.warn("failed to write copied file paths to system clipboard", e);
    }
}

export function copyPreviewFileItems(
    fileInfos: FileInfo[],
    conn: string,
    mode: PreviewFileClipboardMode = "copy"
): PreviewFileClipboard | null {
    const items = makePreviewFileClipboardItems(fileInfos, conn);
    if (items.length === 0) {
        return null;
    }
    const clipboard: PreviewFileClipboard = {
        mode,
        items,
        createdAt: Date.now(),
    };
    globalStore.set(previewFileClipboardAtom, clipboard);
    void writePreviewFileItemsToSystemClipboard(items);
    return clipboard;
}

// Move (cut) stages the same clipboard in "move" mode so Paste moves instead of copies.
export function cutPreviewFileItems(fileInfos: FileInfo[], conn: string): PreviewFileClipboard | null {
    return copyPreviewFileItems(fileInfos, conn, "move");
}

export function getUnsupportedPasteItems(clipboard: PreviewFileClipboard | null): PreviewFileClipboardItem[] {
    return clipboard?.items.filter((item) => item.isdir) ?? [];
}

export function getPasteableItems(clipboard: PreviewFileClipboard | null): PreviewFileClipboardItem[] {
    return clipboard?.items.filter((item) => !item.isdir) ?? [];
}

export function makePasteLabel(clipboard: PreviewFileClipboard | null): string {
    const itemCount = getPasteableItems(clipboard).length;
    const action = clipboard?.mode === "move" ? "Move" : "Paste";
    if (itemCount <= 1) {
        return action;
    }
    return `${action} ${itemCount} Items`;
}

export function makeCopyLabel(fileInfos: FileInfo[]): string {
    if (fileInfos.length <= 1) {
        return "Copy";
    }
    return `Copy ${fileInfos.length} Items`;
}

export function makeCutLabel(fileInfos: FileInfo[]): string {
    if (fileInfos.length <= 1) {
        return "Cut";
    }
    return `Cut ${fileInfos.length} Items`;
}

function makeCopyOptions(overrides?: Partial<FileCopyOpts>): FileCopyOpts {
    const timeoutYear = 31536000000;
    return {
        timeout: timeoutYear,
        ...overrides,
    };
}

async function runPastePreviewFileItems(
    mode: PreviewFileClipboardMode,
    model: PreviewModel,
    clipboard: PreviewFileClipboard | null,
    destDirPath: string,
    destConn: string,
    setErrorMsg: (msg: ErrorMsg) => void,
    opts?: Partial<FileCopyOpts>
): Promise<void> {
    const pasteableItems = getPasteableItems(clipboard);
    if (pasteableItems.length === 0) {
        const unsupportedItems = getUnsupportedPasteItems(clipboard);
        if (unsupportedItems.length > 0) {
            setErrorMsg({
                status: mode === "move" ? "Move Failed" : "Paste Failed",
                text: "Folder paste is not supported yet.",
                level: "error",
            });
        }
        return;
    }
    // ponytail: director move-paste stays file-only like copy-paste. Upgrade path: allow
    // directory moves by setting opts.recursive for cross-host moves (see wshfs.Move).
    const desturi = formatRemoteUri(destDirPath, destConn);
    try {
        for (const item of pasteableItems) {
            const data: CommandFileCopyData = {
                srcuri: formatRemoteUri(item.path, item.conn),
                desturi,
                opts: makeCopyOptions(opts),
            };
            if (mode === "move") {
                await model.env.rpc.FileMoveCommand(TabRpcClient, data, { timeout: data.opts.timeout });
            } else {
                await model.env.rpc.FileCopyCommand(TabRpcClient, data, { timeout: data.opts.timeout });
            }
        }
    } catch (e) {
        const pasteError = `${e}`;
        if (mode === "move") {
            // Backend move rejects an existing destination outright (no overwrite/merge path),
            // so unlike copy there is no retry dialog to offer here.
            setErrorMsg({
                status: "Move Failed",
                text: pasteError,
                level: "error",
            });
            return;
        }
        const allowRetry = pasteError.includes(overwriteError) || pasteError.includes(mergeError);
        if (allowRetry) {
            setErrorMsg({
                status: "Confirm Overwrite File(s)",
                text: "This copy operation will overwrite an existing file. Would you like to continue?",
                level: "warning",
                buttons: [
                    {
                        text: "Delete Then Copy",
                        onClick: async () => {
                            await pastePreviewFileItems(model, clipboard, destDirPath, destConn, setErrorMsg, {
                                overwrite: true,
                            });
                        },
                    },
                    {
                        text: "Sync",
                        onClick: async () => {
                            await pastePreviewFileItems(model, clipboard, destDirPath, destConn, setErrorMsg, {
                                merge: true,
                            });
                        },
                    },
                ],
            });
        } else {
            setErrorMsg({
                status: "Copy Failed",
                text: pasteError,
                level: "error",
            });
        }
        return;
    } finally {
        model.refresh();
    }
    // Cut is one-shot: clear the staged clipboard after a successful move so a stale
    // "Move Here" cannot try to re-move already-moved files.
    if (mode === "move") {
        globalStore.set(previewFileClipboardAtom, null);
    }
}

export async function pastePreviewFileItems(
    model: PreviewModel,
    clipboard: PreviewFileClipboard | null,
    destDirPath: string,
    destConn: string,
    setErrorMsg: (msg: ErrorMsg) => void,
    opts?: Partial<FileCopyOpts>
): Promise<void> {
    return runPastePreviewFileItems("copy", model, clipboard, destDirPath, destConn, setErrorMsg, opts);
}

export async function movePreviewFileItems(
    model: PreviewModel,
    clipboard: PreviewFileClipboard | null,
    destDirPath: string,
    destConn: string,
    setErrorMsg: (msg: ErrorMsg) => void,
    opts?: Partial<FileCopyOpts>
): Promise<void> {
    return runPastePreviewFileItems("move", model, clipboard, destDirPath, destConn, setErrorMsg, opts);
}
