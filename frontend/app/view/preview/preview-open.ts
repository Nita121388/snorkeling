// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getApi } from "@/app/store/global";
import { isBlank, isLocalConnName } from "@/util/util";
import type { PreviewModel } from "./preview-model";

const MaxFileSize = 1024 * 1024 * 10; // 10MB
const MaxCSVSize = 1024 * 1024 * 1; // 1MB

const TextApplicationMimetypes = [
    "application/sql",
    "application/x-php",
    "application/x-pem-file",
    "application/x-httpd-php",
    "application/liquid",
    "application/graphql",
    "application/javascript",
    "application/typescript",
    "application/x-javascript",
    "application/x-typescript",
    "application/dart",
    "application/vnd.dart",
    "application/x-ruby",
    "application/wasm",
    "application/x-latex",
    "application/x-sh",
    "application/x-python",
    "application/x-awk",
];

function isTextFile(mimeType: string): boolean {
    if (mimeType == null) {
        return false;
    }
    return (
        mimeType.startsWith("text/") ||
        TextApplicationMimetypes.includes(mimeType) ||
        (mimeType.startsWith("application/") &&
            (mimeType.includes("json") || mimeType.includes("yaml") || mimeType.includes("toml"))) ||
        mimeType.includes("xml")
    );
}

function isStreamingType(mimeType: string): boolean {
    if (mimeType == null) {
        return false;
    }
    return (
        mimeType.startsWith("application/pdf") ||
        mimeType.startsWith("video/") ||
        mimeType.startsWith("audio/") ||
        mimeType.startsWith("image/")
    );
}

function isMarkdownLike(mimeType: string): boolean {
    if (mimeType == null) {
        return false;
    }
    return mimeType.startsWith("text/markdown") || mimeType.startsWith("text/mdx");
}

export function canPreviewFileInfo(fileInfo: FileInfo): boolean {
    if (fileInfo == null) {
        return false;
    }
    if (fileInfo.notfound) {
        return true;
    }
    const mimeType = fileInfo.mimetype;
    if (mimeType == null) {
        return false;
    }
    if (isStreamingType(mimeType)) {
        return true;
    }
    const hasKnownSize = typeof fileInfo.size === "number" && Number.isFinite(fileInfo.size);
    const size = hasKnownSize ? fileInfo.size : 0;
    if (hasKnownSize && size > MaxFileSize) {
        return false;
    }
    if (mimeType === "text/csv" && hasKnownSize && size > MaxCSVSize) {
        return false;
    }
    return (
        mimeType === "directory" ||
        mimeType === "text/csv" ||
        isMarkdownLike(mimeType) ||
        isTextFile(mimeType) ||
        (hasKnownSize && size === 0)
    );
}

export function shouldOpenWithDefaultApp(fileInfo: FileInfo, conn: string): boolean {
    if (fileInfo == null || fileInfo.isdir || isBlank(fileInfo.path) || !isLocalConnName(conn)) {
        return false;
    }
    return !canPreviewFileInfo(fileInfo);
}

export async function openPreviewEntry(model: PreviewModel, fileInfo: FileInfo, conn: string): Promise<void> {
    if (shouldOpenWithDefaultApp(fileInfo, conn)) {
        getApi().openNativePath(fileInfo.path);
        return;
    }
    await model.openPathWithTarget(fileInfo.path);
}
