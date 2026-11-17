// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 批注时间线窗口 store（v2 设计 §3.1 游标窗口 / §3.6 失效矩阵 / §3.7 窗口驱逐）。
//
// 结构（自下而上）：
//   annotationCache(cacheKey → entry)   模块级缓存，切 tab 不丢
//   entry.annotations                   **窗口内**条目，恒按 (seq, id) 升序
//   entry.meta                          serverExhausted / evictedOlderCount（游标两个布尔的事实来源）
//   getAnnotationWindow()               派生时间桶（不落库，纯计算 + 引用缓存）
//
// 失效口径（§3.6，全文件唯一判据）：
//   **「条目集合的排序键空间变了」= 失效；「只是尾部新增/删除元素」= 不失效。**
//   - 失效（整窗 invalidate → 回到最新页）：AI 重生成替换 drafts / 锚点重锚定改写 seq /
//     会话文件重写 / 切筛选 / 切会话或 connection。
//   - 不失效（就地增量）：新批注落在最新桶（追加）/ 落在窗口内历史 seq（按序插入）/
//     删除窗口内唯一条目（该桶消失）。
//
// 并发：单飞（inflight / loadingOlder）+ **请求代数**（generation）。任何响应回来时
// 若代数已变，一律丢弃（失效后迟到的那一页不能写进新窗口）。
//
// store 只做数据；React 组件订阅 getAnnotationSnapshot / getAnnotationWindow。

import { AISessionsServiceType } from "@/app/store/services";
import * as React from "react";
import {
    UnknownBucketKey,
    buildRailItems,
    buildTimeBuckets,
    type AnnotationAnchorRequest,
    type AnnotationLike,
    type TimeBucket,
    type TimeBucketLabelFor,
} from "./annotation-model";

export type AnnotationStatus = "idle" | "loading" | "loaded" | "error";

/** seq → 锚点消息时间戳（ms）。返回 undefined = 无法判定时间（条目落 unknown 桶）。 */
export type SeqTimestampOf = (seq: number) => number | undefined;

/** 页大小（首屏与「加载更早」共用）；后端再夹取一次 [20,500]。 */
export const AnnotationPageLimit = 100;
export const AnnotationPageMinLimit = 20;
export const AnnotationPageMaxLimit = 500;

/** 窗口上限（§3.7）：MaxBuckets / MaxEntries 任一先到即触发驱逐。 */
export const AnnotationWindowMaxBuckets = 5;
export const AnnotationWindowMaxEntries = 2000;

/**
 * 窗口快照（§3.1）。
 *
 * `atEarliest` 与 `hasMoreOlder` 是**两个独立事实**（§3.7），不要合并：
 * - `atEarliest`：窗口旧端已抵达「服务端确认过的最早点」，且没有更早的条目被驱逐出去；
 * - `hasMoreOlder`：旧端还有可加载内容（服务器还有，或曾经加载过但被驱逐出内存）。
 * 驱逐一个更早的桶后会出现 `hasMoreOlder=true` + `atEarliest=false`（即便服务器已耗尽）。
 */
export type AnnotationWindow = {
    buckets: TimeBucket[];
    /** 旧端游标（= 窗口内最小 (seq,id)）；undefined 表示没有更早可加载。 */
    oldestCursor?: AnnotationCursor;
    /** 新端游标（= 窗口内最大 (seq,id)），「回到最新」/hasMoreNewer 的判据。 */
    newestCursor?: AnnotationCursor;
    hasMoreOlder: boolean;
    atEarliest: boolean;
    loadingOlder: boolean;
    olderError: string | null;
};

export type EvictedBucketInfo = {
    dateKey: string;
    /** 该桶被驱逐的**批注条数**（不是节点数）。 */
    count: number;
};

export type LoadOlderAnnotationsResult = {
    /** 本次真正新增的条目数（全部是已存在的重复 = 0，合并幂等）。 */
    added: number;
    hasMoreOlder: boolean;
    atEarliest: boolean;
    evicted: EvictedBucketInfo[];
    error: string | null;
};

export type AnnotationStoreOptions = {
    /** 测试注入点：默认每次新建 AISessionsServiceType（真实走 WOS）。 */
    service?: AISessionsServiceType;
    /** 单页条数覆盖（夹取到 [20,500]）。 */
    limit?: number;
};

type AnnotationEntry = {
    annotations: AnnotationView[];
    status: AnnotationStatus;
    error: string;
    listeners: Set<() => void>;
    inflight: boolean;
    /** 请求代数：invalidate 时 ++；迟到响应的代数对不上即丢弃。 */
    generation: number;
    /** 失效发生在请求飞行中：等这次响应结束后立刻重载一次（回到最新页）。 */
    reloadQueued: boolean;
    reloadService?: AISessionsServiceType;
    lastAnchors: AnnotationAnchorRequest[];
    meta: {
        /** 服务端已确认「没有更早的条目」了。 */
        serverExhausted: boolean;
        /** 被驱逐到窗口之外的、比窗口旧端更早的条目数（hasMoreOlder 的第二个来源）。 */
        evictedOlderCount: number;
    };
    loadingOlder: boolean;
    olderError: string | null;
    windowMemo: WindowMemo | null;
};

type WindowMemo = {
    annotationsRef: AnnotationView[];
    tsOfRef: SeqTimestampOf;
    nowMinute: number;
    labelForRef?: TimeBucketLabelFor;
    window: AnnotationWindow;
};

const EMPTY_ANNOTATIONS: AnnotationView[] = [];
const EMPTY_WINDOW: AnnotationWindow = {
    buckets: [],
    hasMoreOlder: false,
    atEarliest: false,
    loadingOlder: false,
    olderError: null,
};
const UNKNOWN_TS_OF: SeqTimestampOf = () => undefined;

const annotationCache = new Map<string, AnnotationEntry>();
let sharedService: AISessionsServiceType | undefined;

function defaultService(): AISessionsServiceType {
    if (sharedService == null) sharedService = new AISessionsServiceType();
    return sharedService;
}

function normalizeConnection(connection: string | null | undefined): string {
    return typeof connection === "string" ? connection.trim() : "";
}

function cacheKey(sessionKey: string, connection: string | null | undefined): string {
    return `${normalizeConnection(connection)}|${sessionKey}`;
}

function freshMeta(): AnnotationEntry["meta"] {
    return { serverExhausted: false, evictedOlderCount: 0 };
}

function entryFor(sessionKey: string, connection: string | null | undefined): AnnotationEntry {
    const key = cacheKey(sessionKey, connection);
    let entry = annotationCache.get(key);
    if (entry == null) {
        entry = {
            annotations: EMPTY_ANNOTATIONS,
            status: "idle",
            error: "",
            listeners: new Set(),
            inflight: false,
            generation: 0,
            reloadQueued: false,
            lastAnchors: [],
            meta: freshMeta(),
            loadingOlder: false,
            olderError: null,
            windowMemo: null,
        };
        annotationCache.set(key, entry);
    }
    return entry;
}

function notify(entry: AnnotationEntry): void {
    for (const listener of entry.listeners) listener();
}

/** 任何可见状态变化都要走这里：重置窗口派生缓存 + 广播。 */
function touch(entry: AnnotationEntry): void {
    entry.windowMemo = null;
    notify(entry);
}

function subscribe(sessionKey: string, connection: string | null | undefined, listener: () => void): () => void {
    const entry = entryFor(sessionKey, connection);
    entry.listeners.add(listener);
    return () => {
        entry.listeners.delete(listener);
    };
}

// ---------------------------------------------------------------------------
// 纯逻辑：排序键 / 合并去重 / 页大小 / 驱逐计划
// ---------------------------------------------------------------------------

/** 排序键 (seq, id) 升序 —— 全窗口唯一排序口径（§3.1 不变量 1）。 */
function compareSortKey(left: { seq: number; id: number }, right: { seq: number; id: number }): number {
    if (left.seq !== right.seq) return left.seq - right.seq;
    return left.id - right.id;
}

function sortViews(views: AnnotationView[]): AnnotationView[] {
    return [...views].sort(compareSortKey);
}

/**
 * 条目身份键 = id（>0 时）。
 *
 * 去重口径比「(seq,id)」更紧一点：重锚定会把同一条的 seq 改写，
 * 只用 (seq,id) 会让同一条在窗口里出现两次；用 id 作身份键天然覆盖 (seq,id) 去重。
 */
function viewIdentity(view: { id: number; seq: number; anchorKey?: string; kind?: string; title?: string }): string {
    if (view.id > 0) return `id:${view.id}`;
    return `local:${view.anchorKey ?? ""}|${view.seq}|${view.kind ?? ""}|${view.title ?? ""}`;
}

/**
 * 合并两批条目（幂等）：按身份键去重，后到的覆盖前有的，输出按 (seq,id) 升序。
 * 同一页重复合并 == 只合一次（「加载更早」重试 / 驱逐后回补都不会重复出行）。
 */
function mergeViews(current: AnnotationView[], incoming: AnnotationView[]): AnnotationView[] {
    const byIdentity = new Map<string, AnnotationView>();
    for (const view of current) byIdentity.set(viewIdentity(view), view);
    for (const view of incoming) byIdentity.set(viewIdentity(view), view);
    return sortViews([...byIdentity.values()]);
}

/** 页大小夹取：缺省 / 非法 → 默认页；其余夹到 [20,500]（与后端同口径）。 */
export function clampAnnotationPageLimit(limit?: number): number {
    if (limit == null || !Number.isFinite(limit) || limit <= 0) return AnnotationPageLimit;
    return Math.min(AnnotationPageMaxLimit, Math.max(AnnotationPageMinLimit, Math.floor(limit)));
}

function cursorOf(view: { seq: number; id: number }): AnnotationCursor | undefined {
    // 零值游标在后端等价于「最新页」，绝不能当成旧端游标下发。
    if (view.seq === 0 && view.id === 0) return undefined;
    return { beforeSeq: view.seq, beforeId: view.id };
}

function bucketMidSeq(bucket: TimeBucket): number {
    if (bucket.items.length === 0) return 0;
    return (bucket.items[0].seq + bucket.items[bucket.items.length - 1].seq) / 2;
}

/** 桶内**批注条数**（不是节点数）：MaxEntries 的计量单位。 */
export function bucketAnnotationCount(bucket: TimeBucket): number {
    let count = 0;
    for (const item of bucket.items) count += item.annotations.length;
    return count;
}

export type BucketEvictionStep = {
    /** 在传入 buckets 数组里的下标。 */
    dropIndex: number;
    dateKey: string;
    /** 该桶的批注条数。 */
    count: number;
};

/**
 * 驱逐计划（纯函数，§3.7）：**驱逐距 refSeq 最远的桶，且永不驱逐最新桶**。
 *
 * - 「最新桶」= 最后一个**有日期**的桶。unknown 桶（缺锚点时间）排在其后，可被驱逐
 *   （它不代表新端位置）；若窗口里只有 unknown 桶，则没有可辨识的最新桶，不驱逐。
 * - MaxBuckets 与 MaxEntries 任一超限就继续驱逐，直到两者都回到上限内；
 *   只剩最新桶时停止（**永不驱逐最新桶** 优先于 MaxEntries）。
 * - refSeq 缺省 = 最新桶的中点（视口未知时按「视口在最底部」处理，即从最旧的桶开始赶）。
 */
export function planWindowEviction(
    buckets: TimeBucket[],
    totalAnnotations: number,
    opts: { refSeq?: number; maxBuckets?: number; maxEntries?: number } = {}
): BucketEvictionStep[] {
    const plan: BucketEvictionStep[] = [];
    if (buckets.length === 0) return plan;
    const maxBuckets = opts.maxBuckets ?? AnnotationWindowMaxBuckets;
    const maxEntries = opts.maxEntries ?? AnnotationWindowMaxEntries;
    let newestDatedIndex = -1;
    for (let index = 0; index < buckets.length; index++) {
        if (buckets[index].dateKey !== UnknownBucketKey) newestDatedIndex = index;
    }
    if (newestDatedIndex < 0) return plan;
    const refSeq = opts.refSeq ?? bucketMidSeq(buckets[newestDatedIndex]);
    const dropped = new Set<number>();
    let remaining = totalAnnotations;
    for (;;) {
        const bucketCount = buckets.length - dropped.size;
        if (bucketCount <= maxBuckets && remaining <= maxEntries) break;
        let victim = -1;
        let victimDistance = -1;
        for (let index = 0; index < buckets.length; index++) {
            if (dropped.has(index)) continue;
            if (index === newestDatedIndex) continue; // 永不驱逐最新桶
            const distance = Math.abs(bucketMidSeq(buckets[index]) - refSeq);
            if (distance > victimDistance) {
                victim = index;
                victimDistance = distance;
            }
        }
        if (victim < 0) break; // 只剩最新桶：停（内存上界让位于「最新桶常驻」）
        dropped.add(victim);
        remaining -= bucketAnnotationCount(buckets[victim]);
        plan.push({
            dropIndex: victim,
            dateKey: buckets[victim].dateKey,
            count: bucketAnnotationCount(buckets[victim]),
        });
    }
    return plan;
}

// ---------------------------------------------------------------------------
// 窗口事实（§3.7：两个布尔分开记）
// ---------------------------------------------------------------------------

function windowAtEarliest(entry: AnnotationEntry): boolean {
    return entry.meta.serverExhausted && entry.meta.evictedOlderCount === 0;
}

function windowHasMoreOlder(entry: AnnotationEntry): boolean {
    // 窗口是空的（还没加载过 / 刚被失效）：没有任何旧端事实，不让端帽误判「还有更早」。
    if (entry.annotations.length === 0) return false;
    if (!entry.meta.serverExhausted) return true;
    return entry.meta.evictedOlderCount > 0;
}

/**
 * 按驱逐计划真正砍掉条目（§3.7）。需要 tsOf 才能算桶；没有 tsOf 时不做驱逐
 * （桶边界不可知时不冒「误驱逐最新桶」的风险，调用方应在 Step 7 接上 seqToTimestamp）。
 */
function evictWindow(
    entry: AnnotationEntry,
    tsOf: SeqTimestampOf | undefined,
    refSeq: number | undefined
): EvictedBucketInfo[] {
    if (tsOf == null || entry.annotations.length === 0) return [];
    const buckets = buildTimeBuckets(buildRailItems(entry.annotations), tsOf);
    if (buckets.length === 0) return [];
    const plan = planWindowEviction(buckets, entry.annotations.length, { refSeq });
    if (plan.length === 0) return [];
    const droppedIdentities = new Set<string>();
    const evicted: EvictedBucketInfo[] = [];
    for (const step of plan) {
        const bucket = buckets[step.dropIndex];
        if (bucket == null) continue;
        for (const item of bucket.items) {
            for (const annotation of item.annotations) droppedIdentities.add(viewIdentity(annotation));
        }
        evicted.push({ dateKey: step.dateKey, count: step.count });
    }
    if (droppedIdentities.size === 0) return [];
    const kept = entry.annotations.filter((annotation) => !droppedIdentities.has(viewIdentity(annotation)));
    const keptOldest = kept.length > 0 ? kept[0] : null;
    let olderEvicted = 0;
    for (const annotation of entry.annotations) {
        if (!droppedIdentities.has(viewIdentity(annotation))) continue;
        if (keptOldest == null || compareSortKey(annotation, keptOldest) < 0) olderEvicted += 1;
    }
    entry.meta.evictedOlderCount += olderEvicted;
    entry.annotations = kept;
    entry.windowMemo = null;
    return evicted;
}

// ---------------------------------------------------------------------------
// 锚点差分（§3.6 第 5 行 vs 「尾部新增不失效」）
// ---------------------------------------------------------------------------

function anchorSignature(anchor: AnnotationAnchorRequest): string {
    return `${anchor.seq}|${anchor.role}|${anchor.hash}`;
}

/**
 * 新锚点是否需要整窗重载。
 *
 * - 首次空 → 空：只有还没加载过（idle）才拉一次。
 * - 空 → 非空：需要服务端补拉 + 把历史 seq=0 的条目重锚定（v1 行为保留）。
 * - 窗口里仍有 seq<=0 的未解析条目：需要重锚定。
 * - 已有 anchorKey 的 (seq,role,hash) 变了 / 有 anchorKey 消失：**排序键空间变了 → 失效**。
 * - 纯尾部新增（只多出新 anchorKey）：**不失效**（不因为流式增长重载整窗）。
 */
export function assessAnnotationAnchors(
    lastAnchors: AnnotationAnchorRequest[],
    nextAnchors: AnnotationAnchorRequest[],
    opts: { windowSeqs?: number[]; loaded?: boolean } = {}
): "reload" | "keep" {
    const previous = lastAnchors ?? [];
    const next = nextAnchors ?? [];
    if (previous.length === 0 && next.length === 0) {
        return opts.loaded === true ? "keep" : "reload";
    }
    if (next.length === 0) return "keep";
    if (previous.length === 0) return "reload";
    if ((opts.windowSeqs ?? []).some((seq) => seq <= 0)) return "reload";
    const previousByKey = new Map<string, string>();
    for (const anchor of previous) previousByKey.set(anchor.anchorKey, anchorSignature(anchor));
    for (const anchor of next) {
        const signature = previousByKey.get(anchor.anchorKey);
        if (signature == null) continue; // 新锚点 = 尾部增长
        if (signature !== anchorSignature(anchor)) return "reload";
    }
    const nextKeys = new Set(next.map((anchor) => anchor.anchorKey));
    for (const key of previousByKey.keys()) {
        if (!nextKeys.has(key)) return "reload"; // 锚点被移除 → 排序键空间变了
    }
    return "keep";
}

// ---------------------------------------------------------------------------
// 加载：最新页 / 更早页 / 失效
// ---------------------------------------------------------------------------

/**
 * 拉最新页（无 cursor）并**替换**窗口：首屏、以及所有「整窗失效 → 回到最新页」的落地路径。
 *
 * - 单飞：已有请求在飞时直接返回（锚点变化会由收尾的补发逻辑覆盖）。
 * - 迟到响应：代数变了就丢弃，不写进新窗口（§3.6 并发）。
 */
export async function loadAnnotationsLatest(
    sessionKey: string,
    connection: string | null | undefined,
    anchors: AnnotationAnchorRequest[],
    opts: AnnotationStoreOptions = {}
): Promise<void> {
    if (sessionKey === "") return;
    const entry = entryFor(sessionKey, connection);
    entry.lastAnchors = anchors ?? [];
    if (entry.inflight) return;
    const service = opts.service ?? defaultService();
    const limit = clampAnnotationPageLimit(opts.limit);
    entry.inflight = true;
    if (entry.annotations.length === 0 && entry.status !== "error") entry.status = "loading";
    entry.error = "";
    touch(entry);
    const generation = entry.generation;
    let stale = false;
    try {
        const response = await service.Annotations({
            sessionKey,
            connection: normalizeConnection(connection) || undefined,
            anchors: entry.lastAnchors.length > 0 ? entry.lastAnchors : undefined,
            limit,
        });
        if (generation !== entry.generation) {
            stale = true; // 失效后的迟到页：丢弃
            return;
        }
        entry.annotations = sortViews(response.annotations ?? []);
        entry.meta = {
            serverExhausted: response.hasMore !== true,
            evictedOlderCount: 0,
        };
        entry.loadingOlder = false;
        entry.olderError = null;
        entry.status = "loaded";
        entry.error = "";
    } catch (err) {
        if (generation !== entry.generation) {
            stale = true;
            return;
        }
        entry.status = "error";
        entry.error = err instanceof Error ? err.message : String(err);
    } finally {
        entry.inflight = false;
        touch(entry);
        if (entry.reloadQueued) {
            const queuedService = entry.reloadService;
            entry.reloadQueued = false;
            entry.reloadService = undefined;
            void loadAnnotationsLatest(sessionKey, connection, entry.lastAnchors, {
                service: queuedService ?? opts.service,
                limit: opts.limit,
            });
        } else if (!stale && entry.lastAnchors !== anchors) {
            // 请求进行中又来了新的 anchors（典型：打开会话时先以空锚点加载，消息到齐后
            // 才带上 anchorKey）：用最新锚点补一次，否则服务端永远拿不到锚点、
            // 历史批注的 seq 一直是 0。
            void loadAnnotationsLatest(sessionKey, connection, entry.lastAnchors, opts);
        }
    }
}

/**
 * 用调用方提供的锚点对齐一次窗口。
 *
 * v1 语义是「强制重载」，v2 改成**差分**（§3.6）：只有排序键空间变化（重锚定改 seq /
 * 锚点移除 / 有 seq=0 待解析 / 首次非空锚点）才整窗失效回最新页；纯尾部新增不重载。
 */
async function applyAnchors(
    sessionKey: string,
    connection: string | null | undefined,
    anchors: AnnotationAnchorRequest[],
    opts: AnnotationStoreOptions = {}
): Promise<void> {
    if (sessionKey === "") return;
    const entry = entryFor(sessionKey, connection);
    const verdict = assessAnnotationAnchors(entry.lastAnchors, anchors, {
        windowSeqs: entry.annotations.map((annotation) => annotation.seq),
        loaded: entry.status === "loaded" || entry.annotations.length > 0,
    });
    if (verdict === "keep") {
        // 纯尾部增长：只更新锚点，窗口与滚动位置都不动。
        entry.lastAnchors = anchors;
        return;
    }
    await invalidateAnnotations(sessionKey, connection, { reload: true, anchors, service: opts.service, limit: opts.limit });
}

/**
 * 用调用方提供的锚点对齐窗口（保留 v1 导出）。
 * 典型用途：会话详情的 renderItems 就绪后，用「工具锚点 → anchorSeq」的真实 seq
 * 覆盖掉先前基于空 ItemKey 的空锚点列表，顺带让服务端把历史 seq=0 的批注补正。
 * 纯尾部增长时不会重复发请求。
 */
export function reloadAnnotationsWithAnchors(
    sessionKey: string,
    connection: string | null | undefined,
    anchors: AnnotationAnchorRequest[],
    opts: AnnotationStoreOptions = {}
): Promise<void> {
    if (sessionKey === "" || anchors.length === 0) return Promise.resolve();
    return applyAnchors(sessionKey, connection, anchors, opts);
}

/**
 * 整窗失效（§3.6 的「是」行）：++generation 丢弃在飞响应、清窗口、可选立即回最新页。
 *
 * 调用场景：AI 重生成替换 drafts / 锚点重锚定改 seq / 会话文件被重写 /
 * 切筛选（过滤 kind）/ 任何「排序键空间变了」的外部信号。
 */
export async function invalidateAnnotations(
    sessionKey: string,
    connection: string | null | undefined,
    opts: AnnotationStoreOptions & { reload?: boolean; anchors?: AnnotationAnchorRequest[] } = {}
): Promise<void> {
    if (sessionKey === "") return;
    const entry = entryFor(sessionKey, connection);
    entry.generation += 1;
    entry.reloadQueued = false;
    entry.reloadService = undefined;
    if (opts.anchors != null) entry.lastAnchors = opts.anchors;
    entry.annotations = EMPTY_ANNOTATIONS;
    entry.status = "idle";
    entry.error = "";
    entry.meta = freshMeta();
    entry.loadingOlder = false;
    entry.olderError = null;
    entry.windowMemo = null;
    if (opts.reload === true) {
        if (entry.inflight) {
            // 在飞请求的响应会被代数检查丢弃，收尾时再补一次真正的加载。
            entry.reloadQueued = true;
            entry.reloadService = opts.service;
        } else {
            await loadAnnotationsLatest(sessionKey, connection, entry.lastAnchors, {
                service: opts.service,
                limit: opts.limit,
            });
            return;
        }
    }
    notify(entry);
}

/** 强制回最新页（外部变更后的兜底：等价「整窗失效 + 重载」）。 */
export function refreshAnnotations(
    sessionKey: string,
    connection: string | null | undefined,
    opts: AnnotationStoreOptions = {}
): Promise<void> {
    return invalidateAnnotations(sessionKey, connection, { reload: true, service: opts.service, limit: opts.limit });
}

/**
 * 「加载更早一页」（§3.3 游标 + §3.8 前插）。
 *
 * 用窗口旧端游标取下一页，按 (seq,id) 合并去重（重试幂等），再按 §3.7 驱逐。
 * 返回被驱逐的桶信息供调用方决定「视口锚定 / 提示」。
 *
 * 不做滚动锚定：scrollTop 补偿在视图层（同一帧 useLayoutEffect），store 只保证
 * 数据在 await 之后一次性就位。
 */
export async function loadOlderAnnotations(
    sessionKey: string,
    connection: string | null | undefined,
    opts: AnnotationStoreOptions & { tsOf?: SeqTimestampOf; refSeq?: number } = {}
): Promise<LoadOlderAnnotationsResult | null> {
    if (sessionKey === "") return null;
    const entry = entryFor(sessionKey, connection);
    if (entry.annotations.length === 0) return null;
    if (entry.inflight || entry.loadingOlder) return null; // 单飞
    const oldest = entry.annotations[0];
    const cursor = cursorOf(oldest);
    if (cursor == null) {
        // 旧端游标是零值（未解析条目）：不可再往前翻，如实报告当前窗口事实。
        return {
            added: 0,
            hasMoreOlder: windowHasMoreOlder(entry),
            atEarliest: windowAtEarliest(entry),
            evicted: [],
            error: null,
        };
    }
    const service = opts.service ?? defaultService();
    entry.loadingOlder = true;
    entry.olderError = null;
    touch(entry);
    const generation = entry.generation;
    try {
        const response = await service.Annotations({
            sessionKey,
            connection: normalizeConnection(connection) || undefined,
            anchors: entry.lastAnchors.length > 0 ? entry.lastAnchors : undefined,
            cursor,
            limit: clampAnnotationPageLimit(opts.limit),
        });
        if (generation !== entry.generation) return null; // 迟到响应丢弃
        const page = response.annotations ?? [];
        const before = entry.annotations.length;
        entry.annotations = mergeViews(entry.annotations, page);
        const added = entry.annotations.length - before;
        // hasMore 只描述「更早还有没有」；最新端由失效矩阵负责（§3.3）。
        entry.meta.serverExhausted = response.hasMore !== true;
        const evicted = evictWindow(entry, opts.tsOf, opts.refSeq);
        entry.loadingOlder = false;
        entry.olderError = null;
        touch(entry);
        return {
            added,
            hasMoreOlder: windowHasMoreOlder(entry),
            atEarliest: windowAtEarliest(entry),
            evicted,
            error: null,
        };
    } catch (err) {
        if (generation !== entry.generation) return null;
        const message = err instanceof Error ? err.message : String(err);
        entry.loadingOlder = false;
        entry.olderError = message;
        touch(entry);
        return {
            added: 0,
            hasMoreOlder: windowHasMoreOlder(entry),
            atEarliest: windowAtEarliest(entry),
            evicted: [],
            error: message,
        };
    }
}

// ---------------------------------------------------------------------------
// 就地增量（§3.6 前 3 行：尾部增删**不**失效）
// ---------------------------------------------------------------------------

function upsertAnnotationInEntry(entry: AnnotationEntry, view: AnnotationView): void {
    entry.annotations = mergeViews(
        entry.annotations.filter((annotation) => viewIdentity(annotation) !== viewIdentity(view)),
        [view]
    );
    entry.windowMemo = null;
    notify(entry);
}

function removeAnnotationFromEntry(entry: AnnotationEntry, id: number): void {
    const next = entry.annotations.filter((annotation) => annotation.id !== id);
    if (next.length === entry.annotations.length) return;
    entry.annotations = next;
    entry.windowMemo = null;
    notify(entry);
}

export async function saveAnnotation(
    request: AISessionsAnnotationSaveRequest,
    opts: AnnotationStoreOptions = {}
): Promise<AnnotationView> {
    const service = opts.service ?? defaultService();
    const saved = await service.AnnotationSave(request);
    const entry = annotationCache.get(cacheKey(request.sessionKey, request.connection));
    // 单条落库 = 尾部/窗口内增量（§3.6 前两行），整窗失效会把用户的滚动位置一起冲掉。
    if (entry != null && saved != null) upsertAnnotationInEntry(entry, saved);
    return saved;
}

/**
 * 只改一条批注的「节点原文」副本（NODE 区就地编辑）。
 * 其余字段原样回传，避免把 title/body/tags 冲掉；nodeText 为空串 = 清除覆盖。
 */
export async function saveAnnotationNodeText(
    annotation: AnnotationLike,
    nodeText: string,
    sessionKey: string,
    connection: string | null | undefined,
    opts: AnnotationStoreOptions = {}
): Promise<void> {
    const next = nodeText.trim();
    if ((annotation.nodeText ?? "") === next) return;
    await saveAnnotation(
        {
            id: annotation.id,
            sessionKey,
            anchorKey: annotation.anchorKey,
            seq: annotation.seq,
            kind: annotation.kind,
            title: annotation.title,
            body: annotation.body,
            tags: annotation.tags ?? [],
            status: annotation.status,
            source: annotation.source,
            nodeText: next,
            connection: normalizeConnection(connection) || undefined,
        },
        opts
    );
}

/**
 * Accept or discard drafts (empty ids = all drafts of the session).
 *
 * 只改状态 / 删条目（§3.6 第 1、3 行），不整窗失效：草稿条的采纳/丢弃发生在
 * 用户正在看的位置上，重载会把滚动打回最新。
 */
export async function bulkDraftAnnotations(
    sessionKey: string,
    connection: string | null | undefined,
    ids: number[],
    action: "accept" | "discard",
    opts: AnnotationStoreOptions = {}
): Promise<number> {
    const service = opts.service ?? defaultService();
    const response = await service.AnnotationBulkDrafts({
        sessionKey,
        connection: normalizeConnection(connection) || undefined,
        ids,
        action,
    });
    const entry = annotationCache.get(cacheKey(sessionKey, connection));
    if (entry != null) {
        const affected = (annotation: AnnotationView) =>
            annotation.status === "draft" && (ids.length === 0 || ids.includes(annotation.id));
        entry.annotations =
            action === "discard"
                ? entry.annotations.filter((annotation) => !affected(annotation))
                : entry.annotations.map((annotation) =>
                      affected(annotation) ? { ...annotation, status: "accepted" } : annotation
                  );
        entry.windowMemo = null;
        notify(entry);
    }
    return response.affected;
}

export async function deleteAnnotation(
    id: number,
    sessionKey: string,
    connection?: string,
    opts: AnnotationStoreOptions = {}
): Promise<void> {
    const service = opts.service ?? defaultService();
    await service.AnnotationDelete(id);
    const entry = annotationCache.get(cacheKey(sessionKey, connection));
    // 删除 = 窗口内的局部删除（桶空了由派生层自然消失），不做整窗重载。
    if (entry != null) removeAnnotationFromEntry(entry, id);
}

// ---------------------------------------------------------------------------
// 读：v1 全量快照（= 窗口内条目）/ 窗口派生 / hooks
// ---------------------------------------------------------------------------

export function getAnnotationSnapshot(sessionKey: string, connection: string | null | undefined): AnnotationView[] {
    const entry = sessionKey === "" ? undefined : annotationCache.get(cacheKey(sessionKey, connection));
    return entry?.annotations ?? EMPTY_ANNOTATIONS;
}

/**
 * 窗口派生（§3.1）：把窗口内条目按锚点消息时间聚成桶，并附上游标与两个旧端布尔。
 *
 * `tsOf` 取**锚点消息**时间（seq → ts），缺省视为全部未知时间（单 unknown 桶）。
 * 同一份窗口 + 同一个 tsOf + 同一分钟内的 now 复用同一个对象引用（useSyncExternalStore
 * 的快照同一性要求）。
 */
export function getAnnotationWindow(
    sessionKey: string,
    connection: string | null | undefined,
    tsOf?: SeqTimestampOf,
    opts: { now?: number; labelFor?: TimeBucketLabelFor } = {}
): AnnotationWindow {
    const entry = sessionKey === "" ? undefined : annotationCache.get(cacheKey(sessionKey, connection));
    if (entry == null) return EMPTY_WINDOW;
    const resolver = tsOf ?? UNKNOWN_TS_OF;
    const now = opts.now ?? Date.now();
    const nowMinute = Math.floor(now / 60_000);
    const memo = entry.windowMemo;
    if (
        memo != null &&
        memo.annotationsRef === entry.annotations &&
        memo.tsOfRef === resolver &&
        memo.nowMinute === nowMinute &&
        memo.labelForRef === opts.labelFor
    ) {
        return memo.window;
    }
    const buckets =
        entry.annotations.length === 0
            ? []
            : buildTimeBuckets(buildRailItems(entry.annotations), resolver, { now, labelFor: opts.labelFor });
    const first = entry.annotations[0];
    const last = entry.annotations[entry.annotations.length - 1];
    const window: AnnotationWindow = {
        buckets,
        oldestCursor: first == null ? undefined : cursorOf(first),
        newestCursor: last == null ? undefined : cursorOf(last),
        hasMoreOlder: windowHasMoreOlder(entry),
        atEarliest: windowAtEarliest(entry),
        loadingOlder: entry.loadingOlder,
        olderError: entry.olderError,
    };
    entry.windowMemo = {
        annotationsRef: entry.annotations,
        tsOfRef: resolver,
        nowMinute,
        labelForRef: opts.labelFor,
        window,
    };
    return window;
}

export function useSessionAnnotations(
    sessionKey: string,
    connection: string | null | undefined,
    anchors: AnnotationAnchorRequest[]
): {
    annotations: AnnotationView[];
    status: AnnotationStatus;
    error: string;
    reload: () => Promise<void>;
} {
    const conn = normalizeConnection(connection);
    const anchorsSignature = React.useMemo(() => JSON.stringify(anchors), [anchors]);
    React.useEffect(() => {
        if (sessionKey === "") return;
        // 差分对齐：纯尾部增长不重载，排序键空间变化才整窗失效回最新页。
        void applyAnchors(sessionKey, conn, anchors);
        // anchorsSignature 覆盖数组内容；不依赖数组引用。
    }, [sessionKey, conn, anchorsSignature]);

    const sub = React.useCallback(
        (listener: () => void) => (sessionKey === "" ? () => {} : subscribe(sessionKey, conn, listener)),
        [sessionKey, conn]
    );
    const get = React.useCallback(
        () => (sessionKey === "" ? EMPTY_ANNOTATIONS : getAnnotationSnapshot(sessionKey, conn)),
        [sessionKey, conn]
    );
    const annotations = React.useSyncExternalStore(sub, get, get);
    const entry = annotationCache.get(cacheKey(sessionKey, conn));
    return {
        annotations,
        status: entry?.status ?? "idle",
        error: entry?.error ?? "",
        reload: () => invalidateAnnotations(sessionKey, conn, { reload: true }),
    };
}

/**
 * 订阅窗口（含 buckets / 游标 / 旧端两个布尔 / 加载更早的状态）。
 * `tsOf` 必须是引用稳定的回调（useCallback / 模块级 Map 查询），否则每帧都会重算桶。
 */
export function useAnnotationWindow(
    sessionKey: string,
    connection: string | null | undefined,
    tsOf?: SeqTimestampOf,
    opts: { now?: number; labelFor?: TimeBucketLabelFor } = {}
): AnnotationWindow {
    const conn = normalizeConnection(connection);
    const now = opts.now;
    const labelFor = opts.labelFor;
    const sub = React.useCallback(
        (listener: () => void) => (sessionKey === "" ? () => {} : subscribe(sessionKey, conn, listener)),
        [sessionKey, conn]
    );
    const get = React.useCallback(
        () => getAnnotationWindow(sessionKey, conn, tsOf, { now, labelFor }),
        [sessionKey, conn, tsOf, now, labelFor]
    );
    return React.useSyncExternalStore(sub, get, get);
}

/** 测试用：清空模块级缓存（否则用例之间会互相污染）。 */
export function __resetAnnotationStoreForTest(): void {
    annotationCache.clear();
    sharedService = undefined;
}
