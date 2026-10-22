// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * 终端链接的协议判定与 file:// → 原生路径解析。
 *
 * 单独成模块的原因：终端链接打开（termwrap / term-model）与 OSC 7 的 cwd 上报
 * 需要同一套 Windows 路径规则，避免两份实现各自漂移。
 *
 * 本模块保持纯函数：不引入 Electron API，路径解析可直接单测。
 */

import { isWindows } from "@/util/platformutil";

// 链接正文与末尾字符类，取值与 @xterm/addon-web-links 内置正则一致：
// 末尾标点（. , : ; ! ? 等）不并入链接。
const LinkBody = "[^\\s\"'!*(){}|\\\\^<>`]*";
const LinkTail = "[^\\s\"':,.!?{}|\\\\^~\\[\\]`()<>]";

/**
 * 终端链接识别正则。
 *
 * - http(s) 分支与 @xterm/addon-web-links 内置语义一致。
 * - file 分支覆盖 file:///E:/... 与 file://host/share/...。
 * - 前置否定回顾避免 profile:// 之类的同后缀文本被误判成链接。
 * - 不带 g flag：addon 内部会拼成 new RegExp(source, flags + "g")，带 g 会变成 gg。
 */
export const TerminalLinkRegex = new RegExp(
    `(?<![A-Za-z0-9+.-])(?:(?:https?|HTTPS?):[/]{2}|file:[/]{2,3})${LinkBody}${LinkTail}`
);

export type FileUrlPathOptions = {
    /**
     * 把 URL 的 host 当成 UNC 共享（\\server\share）。默认 false：
     * 本机 hostname 语义与 OSC 7 一致，host 会被忽略。
     */
    includeHost?: boolean;
};

/** 判断 URI 是否是 file:// 协议。 */
export function isFileUrl(uri: string): boolean {
    if (typeof uri !== "string" || uri === "") {
        return false;
    }
    try {
        return new URL(uri).protocol === "file:";
    } catch {
        return false;
    }
}

/**
 * 把 file:// URL 解析成原生路径。失败返回 null。
 *
 * - Windows 盘符：file:///E:/code/x → E:/code/x
 * - UNC 主机：file://server/share/x → \\server\share\x（需要 includeHost）
 * - POSIX：file:///home/me/a.txt → /home/me/a.txt
 */
export function fileUrlToNativePath(uri: string, options?: FileUrlPathOptions): string | null {
    if (typeof uri !== "string" || uri === "") {
        return null;
    }
    let url: URL;
    try {
        url = new URL(uri);
    } catch {
        return null;
    }
    return filePathFromFileUrl(url, options);
}

/** fileUrlToNativePath 的已解析 URL 版本，供需要区分解析失败原因的调用方使用。 */
export function filePathFromFileUrl(url: URL, options?: FileUrlPathOptions): string | null {
    if (url == null || url.protocol !== "file:") {
        return null;
    }
    let pathname: string;
    try {
        pathname = decodeURIComponent(url.pathname);
    } catch {
        // 百分号编码不合法时退回原始 pathname。
        pathname = url.pathname;
    }

    const host = url.hostname;
    if (options?.includeHost && host != "" && host !== "localhost") {
        // UNC：file://server/share/x → \\server\share\x
        return `\\\\${host}${pathname.replace(/\//g, "\\")}`;
    }

    // 双斜杠开头时收敛成一个，与 OSC 7 既有行为一致。
    if (pathname.startsWith("//")) {
        pathname = pathname.substring(1);
    }
    // Windows 盘符：/C:/... 或 /C:\... → C:/...
    if (/^\/[A-Za-z]:/.test(pathname)) {
        return pathname.substring(1).replace(/\\/g, "/");
    }
    // 已经是 UNC 反斜杠形式：/\\server\share → \\server\share
    if (pathname.startsWith("/\\\\")) {
        return pathname.substring(1);
    }
    return pathname;
}

/**
 * 终端打开文件链接时使用的路径解析。
 * Windows 上把 host 当 UNC 共享，其它平台忽略 host（避免把本机 hostname 当共享名）。
 */
export function terminalFilePath(uri: string): string | null {
    return fileUrlToNativePath(uri, { includeHost: isWindows() });
}

/** 链接 hover 提示文案。 */
export function terminalLinkHint(uri: string, modKey: string): string {
    return isFileUrl(uri) ? `${modKey}-click to open in default app` : `${modKey}-click to open link`;
}
