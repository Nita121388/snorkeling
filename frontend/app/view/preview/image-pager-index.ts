// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 图片翻页索引：RPC 列目录 + 内存缓存 + 渐进填充。
//
// 设计约束（PRD）：
//   - 本层列表一次 RPC 就绪即可翻页；子目录索引后台 DFS 补齐 —— "下一步"永不因
//     索引未建好而卡住。
//   - 每个目录一次 listDir；并发 3；硬上限：图片 5000 张 / 深度 8 / 目录 500 个。
//     超限必须**截断**（不是"停止后续遍历但把已列的整批塞进去"），且 truncated 立即可见。
//   - 缓存 key = `${connKey}|${anchor}|${sort}`，TTL 60s；过期**保留旧状态重建**
//     （stale-while-revalidate），避免翻页时计数器闪回"索引中…"。
//   - 无框架依赖：useSyncExternalStore 兼容的 subscribe / getSnapshot。

import {
    PAGER_LIMITS,
    buildLayer,
    compareStationPaths,
    insertStationSorted,
    orderedSubdirs,
    type ImagePagerSort,
    type PagerEntry,
    type StationInfo,
} from "./image-pager-model";

export type ListDirFn = (path: string) => Promise<PagerEntry[]>;

export type PagerIndexState = {
    key: string;
    anchor: string;
    sort: ImagePagerSort;
    /** 锚点目录直接子文件的图片序列（按目录预览同款排序，已按上限截断）。 */
    layer: string[];
    /** 含图片目录的先序列表（含 anchor 本身，若有图）。 */
    stations: StationInfo[];
    truncated: boolean;
    /** 已列举目录数（诊断 + 上限控制）。 */
    scannedDirs: number;
    building: boolean;
    error: string | null;
    /** 每次状态替换 +1 —— 让 useSyncExternalStore 的快照比较有便宜的失效信号。 */
    version: number;
};

type CacheEntry = {
    state: PagerIndexState;
    expires: number;
    listeners: Set<() => void>;
    started: boolean;
    /** 代际令牌：entry 被替换/失效后，旧遍历必须自行停止（不可取消的 Promise 兜底）。 */
    generation: number;
};

export type EnsureParams = {
    key: string;
    anchor: string;
    sort: ImagePagerSort;
    listDir: ListDirFn;
};

const cache = new Map<string, CacheEntry>();
let generationSeq = 0;

export function pagerCacheKey(connKey: string | undefined, anchor: string, sort: ImagePagerSort): string {
    return `${connKey ?? "local"}|${anchor}|${sort}`;
}

export function getPagerIndex(key: string, params: EnsureParams): PagerIndexState {
    return ensureEntry(key, params).state;
}

export function subscribePagerIndex(key: string, params: EnsureParams, onChange: () => void): () => void {
    const entry = ensureEntry(key, params);
    entry.listeners.add(onChange);
    return () => {
        entry.listeners.delete(onChange);
    };
}

/** 手动失效（TTL / 用户刷新）。不传 key = 全清。失效后旧遍历自行终止。 */
export function invalidatePagerIndex(key?: string): void {
    if (key != null) {
        const entry = cache.get(key);
        if (entry != null) {
            entry.generation = ++generationSeq; // 让在跑的遍历失效
            entry.started = false;
            entry.expires = 0;
        }
        return;
    }
    for (const entry of cache.values()) {
        entry.generation = ++generationSeq;
        entry.started = false;
        entry.expires = 0;
    }
}

/** 仅测试用：清空缓存。 */
export function _resetPagerCacheForTest(): void {
    cache.clear();
    generationSeq = 0;
}

const MAX_CACHE_ENTRIES = 24;

function ensureEntry(key: string, params: EnsureParams): CacheEntry {
    const existing = cache.get(key);
    const now = Date.now();
    if (existing != null && existing.started && existing.expires > now) {
        return existing;
    }
    // 换代：复用 listeners；过期时**保留上一轮 state**（stale-while-revalidate），
    // 否则翻页触发的重建会让计数器闪回"索引中…"、按钮短暂全灰（审核 S1）。
    const listeners = existing?.listeners ?? new Set<() => void>();
    const prev = existing?.state;
    const entry: CacheEntry = {
        state: {
            key,
            anchor: params.anchor,
            sort: params.sort,
            layer: prev?.layer ?? [],
            stations: prev?.stations ?? [],
            truncated: prev?.truncated ?? false,
            scannedDirs: 0,
            building: true,
            error: null,
            version: (prev?.version ?? 0) + 1,
        },
        expires: now + PAGER_LIMITS.cacheTtlMs,
        listeners,
        started: true,
        generation: ++generationSeq,
    };
    cache.set(key, entry);
    pruneCache(key);
    void buildIndex(entry, params).catch((err) => {
        publish(entry, { building: false, error: `index build failed: ${String(err?.message ?? err)}` });
    });
    return entry;
}

/** 缓存条目上限：长会话浏览大量文件夹时防止无限累积（审核 S1）。 */
function pruneCache(keepKey: string): void {
    if (cache.size <= MAX_CACHE_ENTRIES) return;
    const victims = [...cache.entries()]
        .filter(([k]) => k !== keepKey)
        .sort((a, b) => a[1].expires - b[1].expires)
        .slice(0, cache.size - MAX_CACHE_ENTRIES);
    for (const [k, entry] of victims) {
        entry.generation = ++generationSeq; // 让在跑的遍历失效
        cache.delete(k);
    }
}

function publish(entry: CacheEntry, patch: Partial<PagerIndexState>): void {
    entry.state = { ...entry.state, ...patch, version: entry.state.version + 1 };
    for (const cb of entry.listeners) {
        try {
            cb();
        } catch {
            // 单个订阅者抛错不拖垮其它订阅者
        }
    }
}

/** 截断到上限并返回是否发生截断。 */
function capLayer(layer: string[]): { layer: string[]; capped: boolean } {
    if (layer.length <= PAGER_LIMITS.maxImages) {
        return { layer, capped: false };
    }
    return { layer: layer.slice(0, PAGER_LIMITS.maxImages), capped: true };
}

async function buildIndex(entry: CacheEntry, params: EnsureParams): Promise<void> {
    const { anchor, sort, listDir } = params;
    const generation = entry.generation;
    const alive = () => cache.get(params.key) === entry && entry.generation === generation;

    let stations: StationInfo[] = [];
    const queue: { path: string; depth: number }[] = [];
    let totalImages = 0;
    let scannedDirs = 0;
    let truncated = false;

    // 第一优先级：本层就绪即可翻页
    let rootEntries: PagerEntry[];
    try {
        rootEntries = await listDir(anchor);
    } catch (err) {
        if (!alive()) return;
        publish(entry, { building: false, error: `无法列目录: ${String(err?.message ?? err)}` });
        return;
    }
    if (!alive()) return;
    scannedDirs++;
    const rootBuilt = capLayer(buildLayer(rootEntries, sort));
    if (rootBuilt.capped) {
        truncated = true;
    }
    const rootLayer = rootBuilt.layer;
    totalImages = rootLayer.length;
    if (rootLayer.length > 0) {
        stations.push({
            dir: anchor,
            images: rootLayer,
            first: rootLayer[0],
            last: rootLayer[rootLayer.length - 1],
            count: rootLayer.length,
        });
    }
    publish(entry, {
        layer: rootLayer,
        stations: stations.slice(),
        truncated,
        scannedDirs,
    });

    if (truncated) {
        publish(entry, { building: false, stations: stations.slice(), truncated, scannedDirs });
        return;
    }

    for (const sub of orderedSubdirs(rootEntries)) {
        queue.push({ path: sub.path, depth: 1 });
    }

    // 后台 DFS 补站点。并发 3。截断/失效时立刻收尾（绝不让 queue 里的残余卡住 Promise）。
    await new Promise<void>((resolve) => {
        let inflight = 0;
        let finished = false;
        const finish = () => {
            if (finished) return;
            finished = true;
            queue.length = 0; // 截断时丢弃未派发任务，避免队列残留让 resolve 永不触发
            resolve();
        };
        const pump = () => {
            if (!alive() || truncated) {
                finish();
                return;
            }
            if (queue.length === 0 && inflight === 0) {
                finish();
                return;
            }
            while (queue.length > 0 && inflight < 3 && !truncated) {
                if (scannedDirs >= PAGER_LIMITS.maxDirs) {
                    truncated = true;
                    break;
                }
                const job = queue.shift();
                if (job == null) break;
                if (job.depth > PAGER_LIMITS.maxDepth) {
                    continue;
                }
                inflight++;
                scannedDirs++;
                publish(entry, { scannedDirs });
                listDir(job.path)
                    .then((entries) => {
                        if (!alive() || truncated) return;
                        const built = capLayer(buildLayer(entries, sort));
                        if (built.layer.length > 0) {
                            const layer = built.layer;
                            stations = insertStationSorted(stations, {
                                dir: job.path,
                                images: layer,
                                first: layer[0],
                                last: layer[layer.length - 1],
                                count: layer.length,
                            });
                            totalImages += layer.length;
                        }
                        if (built.capped || totalImages >= PAGER_LIMITS.maxImages) {
                            truncated = true;
                        }
                        if (truncated) {
                            // 截断标记必须立刻可见（否则 UI 永远"索引中…"）
                            publish(entry, { stations: stations.slice(), truncated, scannedDirs });
                            return;
                        }
                        for (const sub of orderedSubdirs(entries)) {
                            queue.push({ path: sub.path, depth: job.depth + 1 });
                        }
                        // 增量发布：站点列表逐步到位（UI 的"下一站"随建随可用）
                        publish(entry, { stations: stations.slice(), scannedDirs });
                    })
                    .catch(() => {
                        // 单个目录列不动（权限/网络）：跳过，不拖垮整树
                    })
                    .finally(() => {
                        inflight--;
                        pump();
                    });
            }
        };
        pump();
    });

    if (!alive()) return;
    publish(entry, {
        stations: stations.slice(),
        truncated,
        scannedDirs,
        building: false,
        // 兜底：站点顺序按路径归一（极端情况下 insert 顺序异常也能收敛）
        // 这里不做重排，insertStationSorted 已保证顺序。
    });
}

/** 站点顺序自检（测试与诊断用）。 */
export function _stationOrderForTest(stations: StationInfo[]): string[] {
    return stations.slice().sort((a, b) => compareStationPaths(a.dir, b.dir)).map((s) => s.dir);
}
