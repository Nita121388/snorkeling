// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// aisession-gen-store — 后台 AI 生成（标题 / note+tags）的共享状态缓存。
//
// 与 session-note-cache 同一套模块级模式：状态与组件挂载解耦，后端
// aisessions:generationstatus 事件驱动更新，组件用 useSyncExternalStore 订阅。
// 生成结果本身仍走既有 titleupdated / note-updated 广播，本 store 只负责
// 「进行中 / 失败 / 完成」这类过程态，避免各入口自己维护 loading。

import { AISessionsServiceType } from "@/app/store/services";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import * as React from "react";

export type GenStateName = "queued" | "running" | "done" | "failed";

export type GenSnapshot = {
    sessionKey: string;
    connection: string;
    kind: string;
    state: GenStateName;
    attempt: number;
    maxAttempts: number;
    error: string;
    updatedAt: number;
};

type GenEntry = {
    snapshot: GenSnapshot;
    listeners: Set<() => void>;
    clearTimer: number | null;
};

const genCache = new Map<string, GenEntry>();
let listenerAttached = false;

/** done 状态在 UI 上保留这么久后自动回落到 idle（不提示长期"成功"）。 */
const DoneAutoClearMs = 3000;

function normalizeConnection(connection: string | null | undefined): string {
    return typeof connection === "string" ? connection.trim() : "";
}

export function genCacheKey(connection: string | null | undefined, sessionKey: string, kind: string): string {
    return `${normalizeConnection(connection)}|${sessionKey}|${kind}`;
}

function getEntry(connection: string, sessionKey: string, kind: string): GenEntry {
    const key = genCacheKey(connection, sessionKey, kind);
    let entry = genCache.get(key);
    if (entry == null) {
        entry = {
            snapshot: {
                sessionKey,
                connection,
                kind,
                state: "queued",
                attempt: 0,
                maxAttempts: 1,
                error: "",
                updatedAt: 0,
            },
            listeners: new Set(),
            clearTimer: null,
        };
        genCache.set(key, entry);
    }
    return entry;
}

function notify(entry: GenEntry, patch: Partial<GenSnapshot>): void {
    entry.snapshot = { ...entry.snapshot, ...patch };
    if (entry.clearTimer != null) {
        window.clearTimeout(entry.clearTimer);
        entry.clearTimer = null;
    }
    if (entry.snapshot.state === "done") {
        entry.clearTimer = window.setTimeout(() => {
            entry.clearTimer = null;
            // 回落到 idle：用 updatedAt=0 表达"没有进行中的任务"，
            // 组件把它当 idle 渲染。
            entry.snapshot = { ...entry.snapshot, state: "queued", updatedAt: 0 };
            for (const listener of entry.listeners) listener();
        }, DoneAutoClearMs);
    }
    for (const listener of entry.listeners) listener();
}

export function ensureGenListener(): void {
    if (listenerAttached || typeof window === "undefined") {
        return;
    }
    listenerAttached = true;
    try {
        waveEventSubscribeSingle<"aisessions:generationstatus">({
            eventType: "aisessions:generationstatus",
            handler: (event) => {
                const data = event.data;
                if (data == null || typeof data.key !== "string" || data.key === "") {
                    return;
                }
                const entry = getEntry(data.connection ?? "", data.key, data.kind ?? "");
                notify(entry, {
                    state: (data.state as GenStateName) ?? "queued",
                    attempt: data.attempt ?? 0,
                    maxAttempts: data.maxAttempts ?? 1,
                    error: data.error ?? "",
                    updatedAt: data.updatedAt ?? Date.now(),
                });
            },
        });
    } catch {
        // 测试环境 / 无 wsh 客户端：退化为不监听，不影响按钮本身。
        listenerAttached = false;
    }
}

function subscribe(connection: string, sessionKey: string, kind: string, listener: () => void): () => void {
    const entry = getEntry(connection, sessionKey, kind);
    entry.listeners.add(listener);
    return () => {
        entry.listeners.delete(listener);
    };
}

/** 读取单个（会话, kind）的状态；updatedAt==0 表示无进行中的任务。 */
export function getGenSnapshot(
    connection: string | null | undefined,
    sessionKey: string,
    kind: string
): GenSnapshot | null {
    const entry = genCache.get(genCacheKey(connection, sessionKey, kind));
    if (entry == null || entry.snapshot.updatedAt === 0) {
        return null;
    }
    return entry.snapshot;
}

export function useSessionGenerationStatus(
    sessionKey: string,
    connection: string | null | undefined,
    kind: string
): GenSnapshot | null {
    const conn = normalizeConnection(connection);
    React.useEffect(() => {
        ensureGenListener();
    }, []);
    const sub = React.useCallback(
        (listener: () => void) => (sessionKey === "" ? () => {} : subscribe(conn, sessionKey, kind, listener)),
        [conn, kind, sessionKey]
    );
    const get = React.useCallback(
        () => (sessionKey === "" ? null : getGenSnapshot(conn, sessionKey, kind)),
        [conn, kind, sessionKey]
    );
    return React.useSyncExternalStore(sub, get, get);
}

export type AutoGenerateResult = {
    ok: boolean;
    skipped: { id: string; reason: string }[];
    error: string;
};

/** 乐观入队 + 调用 RPC。调用方负责在失败时展示错误。 */
export async function autoGenerate(
    service: AISessionsServiceType,
    opts: {
        ids: string[];
        connection?: string;
        /** 选中会话所属 origin（"" = 本机）。 */
        origin?: string;
        kind: string;
        force?: boolean;
        aiMode?: string;
        /** UI 入口标识，进入审计记录。 */
        source?: string;
    }
): Promise<AutoGenerateResult> {
    ensureGenListener();
    const connection = normalizeConnection(opts.connection);
    const ids = opts.ids.filter((id) => typeof id === "string" && id !== "");
    if (ids.length === 0) {
        return { ok: true, skipped: [], error: "" };
    }
    for (const id of ids) {
        notify(getEntry(connection, id, opts.kind), {
            state: "queued",
            attempt: 1,
            maxAttempts: 3,
            error: "",
            updatedAt: Date.now(),
        });
    }
    try {
        const response = await service.AutoGenerate({
            ids,
            connection: connection || undefined,
            origin: opts.origin || undefined,
            kind: opts.kind,
            force: opts.force === true,
            aiMode: opts.aiMode,
            source: opts.source,
        });
        for (const skip of response.skipped ?? []) {
            notify(getEntry(connection, skip.id, opts.kind), {
                state: "failed",
                error: skip.reason,
                updatedAt: Date.now(),
            });
        }
        return { ok: true, skipped: response.skipped ?? [], error: "" };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        for (const id of ids) {
            notify(getEntry(connection, id, opts.kind), {
                state: "failed",
                error: message,
                updatedAt: Date.now(),
            });
        }
        return { ok: false, skipped: [], error: message };
    }
}

/** 批量聚合：返回选中会话里 queued/running/done/failed 的数量。 */
export function getBatchGenCounts(connection: string | null | undefined, sessionKeys: string[], kind: string) {
    const conn = normalizeConnection(connection);
    const counts = { queued: 0, running: 0, done: 0, failed: 0, total: 0 };
    for (const key of sessionKeys) {
        const snapshot = getGenSnapshot(conn, key, kind);
        if (snapshot == null) continue;
        counts.total++;
        if (snapshot.state === "queued") counts.queued++;
        else if (snapshot.state === "running") counts.running++;
        else if (snapshot.state === "done") counts.done++;
        else if (snapshot.state === "failed") counts.failed++;
    }
    return counts;
}

export type BatchGenCounts = {
    queued: number;
    running: number;
    done: number;
    failed: number;
    total: number;
};

function sameBatchGenCounts(left: BatchGenCounts, right: BatchGenCounts): boolean {
    return (
        left.queued === right.queued &&
        left.running === right.running &&
        left.done === right.done &&
        left.failed === right.failed &&
        left.total === right.total
    );
}

/**
 * 批量计数用 useState + 订阅更新，而不是 useSyncExternalStore。
 *
 * 原因：getBatchGenCounts 每次都会构造一个新对象；把它直接当 getSnapshot
 * 返回会让 React 认为快照永远在变，触发 "Maximum update depth exceeded"
 * (#185)。这里在更新时做值比较，只在计数真的变化时换引用。
 */
export function useBatchGenCounts(
    connection: string | null | undefined,
    sessionKeys: string[],
    kind: string
): BatchGenCounts {
    const sessionKeysKey = JSON.stringify(sessionKeys);
    const [counts, setCounts] = React.useState<BatchGenCounts>(() => getBatchGenCounts(connection, sessionKeys, kind));

    React.useEffect(() => {
        ensureGenListener();
        const conn = normalizeConnection(connection);
        const update = () => {
            const next = getBatchGenCounts(conn, sessionKeys, kind);
            setCounts((prev) => (sameBatchGenCounts(prev, next) ? prev : next));
        };
        update();
        const unsubs = sessionKeys.map((key) => subscribe(conn, key, kind, update));
        const timer = window.setInterval(update, DoneAutoClearMs);
        return () => {
            window.clearInterval(timer);
            for (const unsub of unsubs) unsub();
        };
        // sessionKeysKey 覆盖数组内容变化；不直接依赖 sessionKeys 数组引用。
    }, [connection, kind, sessionKeysKey]);

    return counts;
}
