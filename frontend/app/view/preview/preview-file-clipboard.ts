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

export type PreviewFileClipboard = {
    mode: "copy";
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

export function copyPreviewFileItems(fileInfos: FileInfo[], conn: string): PreviewFileClipboard | null {
    const items = makePreviewFileClipboardItems(fileInfos, conn);
    if (items.length === 0) {
        return null;
    }
    const clipboard: PreviewFileClipboard = {
        mode: "copy",
        items,
        createdAt: Date.now(),
    };
    globalStore.set(previewFileClipboardAtom, clipboard);
    void writePreviewFileItemsToSystemClipboard(items);
    return clipboard;
}

export function getUnsupportedPasteItems(clipboard: PreviewFileClipboard | null): PreviewFileClipboardItem[] {
    return clipboard?.items.filter((item) => item.isdir) ?? [];
}

export function getPasteableItems(clipboard: PreviewFileClipboard | null): PreviewFileClipboardItem[] {
    return clipboard?.items.filter((item) => !item.isdir) ?? [];
}

export function makePasteLabel(clipboard: PreviewFileClipboard | null): string {
    const itemCount = getPasteableItems(clipboard).length;
    if (itemCount <= 1) {
        return "Paste";
    }
    return `Paste ${itemCount} Items`;
}

export function makeCopyLabel(fileInfos: FileInfo[]): string {
    if (fileInfos.length <= 1) {
        return "Copy";
    }
    return `Copy ${fileInfos.length} Items`;
}

function makeCopyOptions(overrides?: Partial<FileCopyOpts>): FileCopyOpts {
    const timeoutYear = 31536000000;
    return {
        timeout: timeoutYear,
        ...overrides,
    };
}

export async function pastePreviewFileItems(
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
                status: "Paste Failed",
                text: "Folder paste is not supported yet.",
                level: "error",
            });
        }
        return;
    }
    const desturi = formatRemoteUri(destDirPath, destConn);
    try {
        for (const item of pasteableItems) {
            const data: CommandFileCopyData = {
                srcuri: formatRemoteUri(item.path, item.conn),
                desturi,
                opts: makeCopyOptions(opts),
            };
            await model.env.rpc.FileCopyCommand(TabRpcClient, data, { timeout: data.opts.timeout });
        }
    } catch (e) {
        const copyError = `${e}`;
        const allowRetry = copyError.includes(overwriteError) || copyError.includes(mergeError);
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
                text: copyError,
                level: "error",
            });
        }
        return;
    } finally {
        model.refresh();
    }
}
