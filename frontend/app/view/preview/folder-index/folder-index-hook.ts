// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 文件夹索引徽标（实验插件）— 目录级 hook：读两个数据源 + 合并 + 缓存。
// 定位对齐 vcs-tree-status-hook.ts（同为「目录级装饰」：一次读取 + 渲染期 O(1) 查表）。
// 开关与刷新版本都来自 block meta：关 = 不发任何 RPC；preview:idxrefresh 变化 = 重算。

import { globalStore } from "@/app/store/jotaiStore";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { base64ToString, fireAndForget, isBlank } from "@/util/util";
import { useEffect, useRef, useState } from "react";
import type { BadgeDeco, FolderIndexEntry } from "./folder-index-model";
import { mergeDecorations, parseIndexDoc, toRelPath } from "./folder-index-model";
import { isIdxBadgesEnabled, refreshRevisionFromMeta } from "./folder-index-meta";
import { runScriptDecorations } from "./folder-index-worker";
import { WindowsDrivesPath } from "../preview-windows-drives";
import type { PreviewModel } from "../preview-model";
import type { PreviewEnv } from "../previewenv";

const IdxBadgesDebounceMs = 250;
const IdxBadgesCacheTtlMs = 10_000;
const IdxBadgesEntryLimit = 2_000;

export interface FolderIndexBadgesState {
    /** 合并后的徽标表：key = 相对根目录路径（也兼容文件名兜底，查表用 lookupDecoration） */
    decorations: Record<string, BadgeDeco>;
    /** 每次重算 +1：explorer 拼进 treeRefreshKey，驱动树刷新 */
    revision: number;
    /** 一行状态（排障用；不渲染到树里） */
    status: "idle" | "loading" | "ok" | "degraded" | "off";
}

interface CacheEntry {
    decorations: Record<string, BadgeDeco>;
    at: number;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(conn: string | null, rootPath: string, idxRevision: number): string {
    return `${conn ?? ""}|${rootPath}|${idxRevision}`;
}

async function readRemoteText(model: PreviewModel, rpc: PreviewEnv["rpc"], path: string): Promise<string | null> {
    try {
        const remotePath = await model.formatRemoteUri(path, globalStore.get);
        const fileData = await rpc.FileReadCommand(TabRpcClient, { info: { path: remotePath } as FileInfo }, null);
        return base64ToString(fileData?.data64 ?? "");
    } catch {
        return null;
    }
}

async function listEntries(
    model: PreviewModel,
    rpc: PreviewEnv["rpc"],
    rootPath: string
): Promise<FolderIndexEntry[]> {
    const remotePath = await model.formatRemoteUri(rootPath, globalStore.get);
    const entries: FolderIndexEntry[] = [];
    const stream = rpc.FileListStreamCommand(
        TabRpcClient,
        { path: remotePath, opts: { limit: IdxBadgesEntryLimit } },
        null
    );
    for await (const chunk of stream) {
        if (chunk?.fileinfo == null) {
            continue;
        }
        for (const info of chunk.fileinfo) {
            entries.push({
                name: info.name,
                path: info.path,
                relPath: toRelPath(rootPath, info.path),
                isDir: !!info.isdir,
                modtime: info.modtime || undefined,
            });
        }
    }
    return entries;
}

/**
 * 目录索引徽标：meta 开关开时才读 index.md + .index/badges.js；
 * 两个源都失败 = 空 map（树零徽标），绝不抛到渲染层。
 */
export function useFolderIndexBadges(opts: {
    model: PreviewModel;
    rpc: PreviewEnv["rpc"];
    rootPath: string;
    conn: string | null;
    blockMeta: Record<string, unknown> | null | undefined;
}): FolderIndexBadgesState {
    const { model, rpc, rootPath, conn, blockMeta } = opts;
    const enabled = isIdxBadgesEnabled(blockMeta);
    const idxRevision = refreshRevisionFromMeta(blockMeta);
    const [state, setState] = useState<FolderIndexBadgesState>({ decorations: {}, revision: 0, status: "idle" });
    const lastRootRef = useRef<string | null>(null);

    useEffect(() => {
        if (!enabled || isBlank(rootPath ?? "")) {
            setState((prev) => ({ ...prev, decorations: {}, status: "off" }));
            return;
        }
        // 「This PC」伪路径：读不到 index.md，直接关
        if (rootPath === WindowsDrivesPath) {
            setState((prev) => ({ ...prev, decorations: {}, status: "off" }));
            return;
        }
        const cached = cache.get(cacheKey(conn, rootPath, idxRevision));
        if (cached != null && Date.now() - cached.at < IdxBadgesCacheTtlMs) {
            setState((prev) => ({ decorations: cached.decorations, revision: prev.revision, status: "ok" }));
            return;
        }
        // 换目录清空旧徽标（旧目录的徽标挂到新目录上就是错的）；同目录刷新保留旧表避免闪烁
        if (lastRootRef.current !== rootPath) {
            setState((prev) => ({ ...prev, decorations: {}, status: "loading" }));
        }
        lastRootRef.current = rootPath;
        let cancelled = false;
        const timer = setTimeout(() => {
            setState((prev) => ({ ...prev, status: "loading" }));
            fireAndForget(async () => {
                const indexText = await readRemoteText(model, rpc, `${rootPath}/index.md`);
                const scriptText = await readRemoteText(model, rpc, `${rootPath}/.index/badges.js`);
                let merged: Record<string, BadgeDeco> = {};
                let status: FolderIndexBadgesState["status"] = "ok";
                if (indexText == null && scriptText == null) {
                    status = "degraded";
                } else {
                    const indexMap = parseIndexDoc(indexText ?? "").map;
                    let scriptMap: Record<string, BadgeDeco> = {};
                    if (scriptText != null && scriptText.trim() !== "") {
                        const entries = await listEntries(model, rpc, rootPath).catch(() => [] as FolderIndexEntry[]);
                        const run = await runScriptDecorations(scriptText, entries);
                        scriptMap = run.map;
                        if (run.errors > 0) {
                            status = "degraded";
                        }
                    }
                    merged = mergeDecorations(indexMap, scriptMap);
                }
                if (cancelled) {
                    return;
                }
                cache.set(cacheKey(conn, rootPath, idxRevision), { decorations: merged, at: Date.now() });
                setState((prev) => ({ decorations: merged, revision: prev.revision + 1, status }));
            });
        }, IdxBadgesDebounceMs);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [enabled, rootPath, conn, idxRevision, model, rpc]);

    return state;
}

/** 测试/排障：清缓存（供 verify harness 复跑用） */
export function clearFolderIndexBadgesCache(): void {
    cache.clear();
}
