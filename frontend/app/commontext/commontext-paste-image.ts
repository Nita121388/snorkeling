// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// CommonText 粘贴图片：剪贴板里的 png/jpeg/gif/webp 先落成真实文件（附件目录），
// 再在 editor 里插入 markdown 图片引用。
//
// 复用既有能力，不新增 RPC / 不改 codegen：
//   - 目录：Electron preload 的 window.api.getDataDir()（与 getConfigDir 同族，
//     cv 见 app/view/webview/webview.tsx 的 getConfigDir 用法）
//   - 写文件：RpcApi.FileMkdirCommand + RpcApi.FileWriteCommand（与
//     app/element/markdown.tsx 的 paste-image 分支同一套调用）
//
// 落盘失败不留半截引用：只有真正写成功的文件才会生成 markdown 片段，失败项
// 只进错误提示。纯文本粘贴不经过这里（见 compose modal 的 onPaste 分支）。

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { arrayToBase64 } from "@/util/util";
import { formatRemoteUri } from "@/util/waveutil";

/** 单张图片上限 (10MB)：超过直接拒绝，避免 base64 + RPC 卡住主线程。 */
export const PASTE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

/** 附件子目录名（位于 app data dir 下，跨进程重启仍是同一个目录）。 */
export const PASTE_IMAGE_SUBDIR = "commontext-images";

/** 支持粘贴的 MIME → 扩展名。顺序即文件名扩展名的优先级来源。 */
export const PASTE_IMAGE_EXT_BY_MIME: Readonly<Record<string, string>> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
};

/** markdown 渲染端无法解析这些字符，需要 <...> 包裹目标路径。 */
const MARKDOWN_DEST_UNSAFE = /[\s()<>]/;

type ClipboardImageSource = {
    kind?: string;
    type?: string;
    getAsFile?: () => Blob | null;
};

export function isSupportedPasteImageType(type: string | null | undefined): boolean {
    return typeof type === "string" && PASTE_IMAGE_EXT_BY_MIME[type.toLowerCase()] != null;
}

export function isPasteImageTooLarge(size: number): boolean {
    return Number.isFinite(size) && size > PASTE_IMAGE_MAX_BYTES;
}

export function formatByteSize(size: number): string {
    if (!Number.isFinite(size) || size <= 0) {
        return "0 B";
    }
    if (size >= 1024 * 1024) {
        return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    }
    if (size >= 1024) {
        return `${Math.round(size / 1024)} KB`;
    }
    return `${size} B`;
}

/**
 * 从剪贴板 items 里挑出可落盘的图片，保持剪贴板顺序（多图粘贴按顺序处理）。
 * 只认 kind==="file" 且 MIME 在支持列表里的项；纯文本 / 不支持的图片类型一律忽略，
 * 调用方据此判断"这次粘贴要不要接管"。
 */
export function pickPastedImages(items: ArrayLike<ClipboardImageSource> | null | undefined): Blob[] {
    if (items == null) {
        return [];
    }
    const blobs: Blob[] = [];
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item == null || item.kind !== "file" || !isSupportedPasteImageType(item.type)) {
            continue;
        }
        const blob = item.getAsFile?.();
        if (blob == null || !isSupportedPasteImageType(blob.type || item.type)) {
            continue;
        }
        blobs.push(blob);
    }
    return blobs;
}

/**
 * 稳定可读的文件名，沿用项目既有 paste 命名约定（waveterm_paste_<ms>_<rand>.<ext>，
 * 见 app/view/term/termutil.ts 的 createTempFileFromBlob）。
 */
export function buildPasteImageFileName(mimeType: string, now = Date.now(), random = Math.random): string {
    const ext = PASTE_IMAGE_EXT_BY_MIME[(mimeType ?? "").toLowerCase()] ?? "png";
    const rand = Math.floor(random() * 0x1000000)
        .toString(36)
        .padStart(5, "0")
        .slice(0, 5);
    return `waveterm_paste_${now}_${rand}.${ext}`;
}

export function joinAttachmentPath(dir: string, fileName: string): string {
    const base = (dir ?? "").replace(/[\\/]+$/, "");
    return base === "" ? fileName : `${base}/${fileName}`;
}

/** markdown 图片引用；路径含空格/括号时用 <...> 包裹，否则裸写更易读。 */
export function buildPasteImageMarkdown(filePath: string, altText = "pasted image"): string {
    const safeAlt = (altText ?? "").replace(/[[\]]/g, "");
    const dest = MARKDOWN_DEST_UNSAFE.test(filePath) ? `<${filePath}>` : filePath;
    return `![${safeAlt}](${dest})`;
}

/** 在 [start, end) 区间替换文本，返回新文本与插入内容之后的光标位置。 */
export function spliceTextAtRange(
    text: string,
    start: number,
    end: number,
    insert: string
): { text: string; caret: number } {
    const safeStart = Math.max(0, Math.min(start, text.length));
    const safeEnd = Math.max(safeStart, Math.min(end, text.length));
    return {
        text: text.slice(0, safeStart) + insert + text.slice(safeEnd),
        caret: safeStart + insert.length,
    };
}

/** 落盘失败时给用户看的一句话（带文件名/大小，便于判断是不是超大图）。 */
export function describePasteImageFailure(blob: { type?: string; size?: number }, message: string): string {
    const size = formatByteSize(blob?.size ?? 0);
    return `Image paste failed (${size}): ${message}`;
}

function getElectronDataDir(): string | null {
    const api = (window as any)?.api as ElectronApi | undefined;
    const dataDir = api?.getDataDir?.();
    if (typeof dataDir !== "string" || dataDir.trim() === "") {
        return null;
    }
    return dataDir.trim();
}

/** 附件目录绝对路径；拿不到 app data dir 时返回 null（调用方给明确错误）。 */
export function resolvePasteImageDir(dataDir: string | null = getElectronDataDir()): string | null {
    if (dataDir == null || dataDir.trim() === "") {
        return null;
    }
    return joinAttachmentPath(dataDir.trim(), PASTE_IMAGE_SUBDIR);
}

function isAlreadyExistsError(err: unknown): boolean {
    const message = err instanceof Error ? err.message : String(err ?? "");
    return message.includes("already exists");
}

/**
 * 落盘前的同步校验：类型/大小。返回错误文案，null 表示可以写。
 * 与 writer 解耦，保证即使 writer 被替换/放宽，超大图也不会被接住。
 */
export function validatePasteImage(blob: { type?: string; size?: number } | null | undefined): string | null {
    if (blob == null) {
        return "empty clipboard image";
    }
    if (!isSupportedPasteImageType(blob.type)) {
        return `unsupported image type: ${blob.type || "unknown"}`;
    }
    if (isPasteImageTooLarge(blob.size ?? 0)) {
        return `image is ${formatByteSize(blob.size ?? 0)}, limit is ${formatByteSize(PASTE_IMAGE_MAX_BYTES)}`;
    }
    return null;
}

/**
 * 把一张剪贴板图片写成附件文件，返回绝对路径。
 * 抛错时未写入任何内容（目录创建失败直接冒泡；写文件失败该文件本身不会被引用）。
 */
export async function writePasteImage(
    blob: Blob,
    opts: { dataDir?: string | null; now?: number; random?: () => number } = {}
): Promise<string> {
    const invalidReason = validatePasteImage(blob);
    if (invalidReason != null) {
        throw new Error(invalidReason);
    }
    const dir = resolvePasteImageDir(opts.dataDir === undefined ? getElectronDataDir() : opts.dataDir);
    if (dir == null) {
        throw new Error("cannot locate the attachment directory");
    }
    const filePath = joinAttachmentPath(dir, buildPasteImageFileName(blob.type, opts.now, opts.random));
    // mkdir 在目录已存在时会报 "already exists"：那是成功状态，只有其他错误才上抛。
    try {
        await RpcApi.FileMkdirCommand(TabRpcClient, {
            info: { path: formatRemoteUri(dir, "local"), mimetype: "directory" },
        });
    } catch (err) {
        if (!isAlreadyExistsError(err)) {
            throw err;
        }
    }
    const buffer = await blob.arrayBuffer();
    await RpcApi.FileWriteCommand(TabRpcClient, {
        info: { path: formatRemoteUri(filePath, "local"), mimetype: blob.type },
        data64: arrayToBase64(new Uint8Array(buffer)),
    });
    return filePath;
}

export type PasteImageInsertResult = {
    /** 实际插入 editor 的 markdown 片段（多图按粘贴顺序换行分隔）。 */
    markdown: string;
    /** 成功落盘的文件数。 */
    written: number;
    /** 失败提示（每张图一句）。 */
    failures: string[];
};

/**
 * 依次落盘 images（保序、串行，避免多张 10MB 图并发把主线程顶住），
 * 成功项拼成 markdown；失败项只产出提示。全部失败时 markdown 为空串。
 */
export async function materializePastedImages(
    images: Array<Blob>,
    write: (blob: Blob) => Promise<string> = writePasteImage
): Promise<PasteImageInsertResult> {
    const refs: string[] = [];
    const failures: string[] = [];
    for (const image of images) {
        const invalidReason = validatePasteImage(image);
        if (invalidReason != null) {
            failures.push(describePasteImageFailure(image, invalidReason));
            continue;
        }
        try {
            refs.push(buildPasteImageMarkdown(await write(image)));
        } catch (err) {
            failures.push(describePasteImageFailure(image, err instanceof Error ? err.message : String(err)));
        }
    }
    return { markdown: refs.join("\n"), written: refs.length, failures };
}