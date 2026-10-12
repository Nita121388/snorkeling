// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * 宿主侧的 markdown 图片 src 解析（md-core 物理抽包 10-12）。
 *
 * 本文件是 `markdown-util.ts` 拆分后的**宿主残留**：只有需要 RPC / 本地 HTTP endpoint 的
 * `resolveRemoteFile` / `resolveSrcSet` 留在这里（导入 `@/app/store/*`、`@/util/*`），
 * 因此它**不能**进 `packages/md-core`。
 *
 * 纯 markdown 语法部分（`transformBlocks`、`MarkdownContentBlockType`、图片语法改写 helpers）
 * 已随包搬到 `@md/core/shared/markdown-util`。
 *
 * 包内渲染层不直接依赖本文件：`MdHostAdapter.resolveImageSrc/resolveImageSrcSet` 的默认实现
 * 在调用时**动态** import 本模块（见 `packages/md-core/src/core/host.ts`），保持 md-core
 * 零静态宿主依赖。
 */

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { getWebServerEndpoint } from "@/util/endpoints";
import { formatRemoteUri } from "@/util/waveutil";
import parseSrcSet from "parse-srcset";

// Resolved image URL cache. The URL for a given (conn, baseDir, filepath) is deterministic
// (/wave/stream-file?path=... always serves the file's current content), so a memoized promise
// is safe and kills the flicker that came from re-resolving on every Markdown remount (inline
// edit commit, LivePreview buffer switch): the resolving frame that rendered `null` (image
// unmounts) is gone once the key is warm.
// ponytail: cache lives for the lifetime of the module. The stream-file endpoint streams fresh
// content per request, so staleness is never an issue. Failed resolves are NOT cached — a
// transient error would otherwise poison the key forever. If we ever need eviction (huge dirs),
// upgrade to a bounded LRU keyed the same way.
const remoteFileResolveCache = new Map<string, Promise<string | null>>();

function normalizeMarkdownFilePath(filepath: string): string {
    const trimmed = filepath.trim();
    let decoded = trimmed;
    try {
        decoded = decodeURIComponent(trimmed);
    } catch {
        // Keep the original path when it contains an incomplete escape sequence.
    }
    return decoded.replace(/\\/g, "/").replace(/^\.\//, "");
}

function joinMarkdownFilePath(baseDir: string, filepath: string): string {
    const normalizedBase = baseDir.replace(/\\/g, "/").replace(/\/+$/, "");
    const normalizedFile = filepath.replace(/^\/+/, "");
    return `${normalizedBase}/${normalizedFile}`;
}

export const resolveRemoteFile = async (filepath: string, resolveOpts: MarkdownResolveOpts): Promise<string | null> => {
    if (
        !filepath ||
        filepath.startsWith("http://") ||
        filepath.startsWith("https://") ||
        filepath.startsWith("data:")
    ) {
        return filepath;
    }
    const normalizedFilepath = normalizeMarkdownFilePath(filepath);
    const cacheKey = `${resolveOpts.connName ?? ""}|${resolveOpts.baseDir ?? ""}|${normalizedFilepath}`;
    const cached = remoteFileResolveCache.get(cacheKey);
    if (cached != null) {
        return cached;
    }
    const promise = (async (): Promise<string | null> => {
        try {
            // Local Windows paths must be joined before converting to a wsh URI.
            // Passing a nested path through FileJoinCommand makes the remote-side
            // filepath layer reinterpret drive/Unicode segments; flat paths happen
            // to work, while Obsidian's assets/<note-name>/... paths do not.
            // Keep FileJoinCommand for non-local connections, where the remote
            // filesystem owns path semantics.
            const connName = resolveOpts.connName ?? "local";
            let resolvedPath: string;
            if (connName === "local") {
                resolvedPath = joinMarkdownFilePath(resolveOpts.baseDir, normalizedFilepath);
            } else {
                const baseDirUri = formatRemoteUri(resolveOpts.baseDir, connName);
                const fileInfo = await RpcApi.FileJoinCommand(TabRpcClient, [baseDirUri, normalizedFilepath]);
                resolvedPath = fileInfo.path;
            }
            const remoteUri = formatRemoteUri(resolvedPath, connName);
            const usp = new URLSearchParams();
            usp.set("path", remoteUri);
            return getWebServerEndpoint() + "/wave/stream-file?" + usp.toString();
        } catch (err) {
            console.warn("Failed to resolve remote file:", filepath, err);
            return null;
        }
    })();
    remoteFileResolveCache.set(cacheKey, promise);
    promise.then(
        (url) => {
            if (url == null) {
                remoteFileResolveCache.delete(cacheKey);
            }
        },
        () => {
            remoteFileResolveCache.delete(cacheKey);
        }
    );
    return promise;
};

export const resolveSrcSet = async (srcSet: string, resolveOpts: MarkdownResolveOpts): Promise<string> => {
    if (!srcSet) return null;

    // Parse the srcset
    const candidates = parseSrcSet(srcSet);

    // Resolve each URL in the array of candidates
    const resolvedCandidates = await Promise.all(
        candidates.map(async (candidate) => {
            const resolvedUrl = await resolveRemoteFile(candidate.url, resolveOpts);
            return {
                ...candidate,
                url: resolvedUrl,
            };
        })
    );

    // Reconstruct the srcset string
    return resolvedCandidates
        .map((candidate) => {
            let part = candidate.url;
            if (candidate.w) part += ` ${candidate.w}w`;
            if (candidate.h) part += ` ${candidate.h}h`;
            if (candidate.d) part += ` ${candidate.d}x`;
            return part;
        })
        .join(", ");
};
