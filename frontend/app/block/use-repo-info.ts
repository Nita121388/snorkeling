// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// useRepoInfo — Files 类 Block 悬浮卡的 Git 仓库信息（当前分支 + 未提交变更）。
//
// 性能红线（见 .trellis/tasks/11-02-files-card-branch-info/prd.md）：
//  1. 悬停停留阈值 150ms 才发第一次请求 —— 快速划过 Tab 栏必须 0 请求。
//     （useInfoCardHover 只有隐藏延迟，没有显示延迟，所以延迟必须做在这里。）
//  2. 缓存命中 0 请求：key = `connection\0path`，TTL 60s，正负缓存同 TTL。
//  3. single-flight：同一 key 的在途请求最多 1 个。
//  4. 失败静默：抛错 / 超时 / error 字段 → 写负缓存（info = null），永不重试风暴。
//  5. 不在 Block 挂载时预取（打开 N 个 preview block 不得产生 N 次 RPC）。
//
// 为什么不按 gitRoot 缓存：RemoteVcsStatRtnData 不返回 repopath，前端算不出仓库根。
// 按 path 缓存的代价是「不同 Block 各自一次」，换来后端零改动；将来后端补 repopath
// 只需改 repoInfoCacheKey。

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { makeConnRoute } from "@/util/util";
import * as React from "react";

export type RepoInfo = {
    /** 当前分支；detached HEAD 时后端已归一化成 `detached@<shortsha>`。 */
    branch: string;
    /** 未提交新增行数。 */
    added: number;
    /** 未提交删除行数。 */
    removed: number;
    /** 变更文件数。 */
    files: number;
};

/** 悬停停留多久才真正发请求（毫秒）。 */
export const REPO_INFO_DELAY_MS = 150;
/** 缓存有效期（正负缓存共用，毫秒）。 */
export const REPO_INFO_TTL_MS = 60_000;
/** 单次 RPC 超时（毫秒）。 */
export const REPO_INFO_TIMEOUT_MS = 8_000;

type CacheEntry = { info: RepoInfo | null; at: number };

const repoInfoCache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<RepoInfo | null>>();

function numberOrZero(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

/** 缓存 key。connection 参与 key，因为本地与远端同名路径是两个不同的仓库。 */
export function repoInfoCacheKey(path: string, connection: string): string {
    return `${connection ?? ""}\u0000${path ?? ""}`;
}

/**
 * 归一化 remotevcsstat 返回值。
 * 返回 null 表示「不需要展示 Git 分区」：不在仓库内 / 出错 / 分支为空。
 */
export function normalizeRepoInfo(rtn: RemoteVcsStatRtnData | null | undefined): RepoInfo | null {
    if (rtn == null) {
        return null;
    }
    if (typeof rtn.error === "string" && rtn.error.trim() !== "") {
        return null;
    }
    const branch = typeof rtn.branch === "string" ? rtn.branch.trim() : "";
    if (branch === "") {
        return null;
    }
    return {
        branch,
        added: numberOrZero(rtn.added),
        removed: numberOrZero(rtn.removed),
        files: numberOrZero(rtn.files),
    };
}

/**
 * 读缓存：`undefined` = 没有可用条目（未查过 / 已过期），`null` = 已知不在仓库内。
 */
export function readRepoInfoCache(path: string, connection: string, now = Date.now()): RepoInfo | null | undefined {
    const key = repoInfoCacheKey(path, connection);
    const entry = repoInfoCache.get(key);
    if (entry == null) {
        return undefined;
    }
    if (now - entry.at > REPO_INFO_TTL_MS) {
        repoInfoCache.delete(key);
        return undefined;
    }
    return entry.info;
}

export function writeRepoInfoCache(
    path: string,
    connection: string,
    info: RepoInfo | null,
    now = Date.now()
): void {
    repoInfoCache.set(repoInfoCacheKey(path, connection), { info, at: now });
}

/** 仅供测试与调试使用：清空缓存与在途表。 */
export function clearRepoInfoCache(): void {
    repoInfoCache.clear();
    inflight.clear();
}

export type RepoInfoFetcher = (path: string, connection: string) => Promise<RemoteVcsStatRtnData | null>;

const rpcRepoInfoFetcher: RepoInfoFetcher = (path, connection) =>
    RpcApi.RemoteVcsStatCommand(
        TabRpcClient,
        { path },
        { route: makeConnRoute(connection ?? ""), timeout: REPO_INFO_TIMEOUT_MS }
    );

/**
 * 取仓库信息（single-flight + 缓存写入）。
 * fetcher 可注入，单测不触碰 RPC。
 */
export function fetchRepoInfo(
    path: string,
    connection: string,
    fetcher: RepoInfoFetcher = rpcRepoInfoFetcher
): Promise<RepoInfo | null> {
    const key = repoInfoCacheKey(path, connection);
    const pending = inflight.get(key);
    if (pending != null) {
        return pending;
    }
    const task: Promise<RepoInfo | null> = (async () => {
        let info: RepoInfo | null = null;
        try {
            info = normalizeRepoInfo(await fetcher(path, connection));
        } catch {
            info = null;
        }
        writeRepoInfoCache(path, connection, info);
        return info;
    })();
    // 结果落定后释放该 key：此时才能接受下一次（例如 TTL 过期后的）请求。
    const settled = task.finally(() => {
        inflight.delete(key);
    });
    inflight.set(key, settled);
    return settled;
}

/**
 * 订阅某个路径的仓库信息。
 *
 *  - 缓存命中：同步返回（0 请求、0 异步）。
 *  - 未命中：延迟 REPO_INFO_DELAY_MS 再发请求；期间卸载则取消，不发请求。
 *  - 返回 null 表示「不渲染 Git 分区」。
 */
export function useRepoInfo(path: string, connection: string, enabled = true): RepoInfo | null {
    const [info, setInfo] = React.useState<RepoInfo | null>(() => {
        if (!enabled || !path) {
            return null;
        }
        return readRepoInfoCache(path, connection) ?? null;
    });

    React.useEffect(() => {
        if (!enabled || !path) {
            setInfo(null);
            return;
        }
        const cached = readRepoInfoCache(path, connection);
        if (cached !== undefined) {
            // 命中（含负缓存）：直接落定，不发请求。
            setInfo(cached);
            return;
        }
        setInfo(null);
        let cancelled = false;
        const timer = window.setTimeout(() => {
            void fetchRepoInfo(path, connection).then((next) => {
                // 卸载/换路径后迟到的响应只写缓存，不回填已卸载的组件。
                if (!cancelled) {
                    setInfo(next);
                }
            });
        }, REPO_INFO_DELAY_MS);
        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [path, connection, enabled]);

    return info;
}
