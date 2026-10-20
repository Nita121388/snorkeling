// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { AISessionsServiceType } from "@/app/store/services";
import { dispatchAISessionNoteUpdated, isAISessionNoteUpdatedEvent } from "@/app/view/aisessions/session-note-events";
import debug from "debug";

// Session Note(Summary) 模块级缓存：让 hover 卡片 / TUI TopBar / 信息条共享同一份 note 数据。
// 关键点：加载与重试在模块层进行，与组件挂载解耦 —— 组件只在悬浮期间挂载也不会打断
// "会话文件尚未落盘" 场景的后台重试，下次悬浮直接命中缓存，秒显。
// 模式对齐 outline-cache（TTL + 在途合并）。

const dlog = debug("wave:sessionnotecache");

// claude/pi 等 agent 的 session 文件在第一条消息落盘后才创建，首次 Summary 必然查不到，
// 需要延迟重试直到 agent 真正产出会话数据（或达到次数上限）。
const NoteLoadRetryDelayMs = 3000;
const NoteLoadMaxRetries = 10;

export type SessionNoteStatus = "idle" | "loading" | "loaded" | "error";

export type SessionNoteSnapshot = {
    sessionId: string;
    connection: string;
    status: SessionNoteStatus;
    summary: SessionSummary | null;
    error: string;
    loadedAt: number;
};

type NoteEntry = {
    snapshot: SessionNoteSnapshot;
    promise: Promise<SessionSummary | null> | null;
    retryTimer: number | null;
    retryCount: number;
    listeners: Set<() => void>;
};

const noteCache = new Map<string, NoteEntry>();
let eventListenerAttached = false;

function normalizeConnection(connection: string | null | undefined): string {
    return typeof connection === "string" && connection.trim() !== "" ? connection.trim() : "";
}

function cacheKey(sessionId: string, connection?: string | null): string {
    return `${normalizeConnection(connection)}|${sessionId}`;
}

function initialSnapshot(sessionId: string, connection: string): SessionNoteSnapshot {
    return { sessionId, connection, status: "idle", summary: null, error: "", loadedAt: 0 };
}

function getEntry(sessionId: string, connection: string): NoteEntry {
    const key = cacheKey(sessionId, connection);
    let entry = noteCache.get(key);
    if (entry == null) {
        entry = {
            snapshot: initialSnapshot(sessionId, connection),
            promise: null,
            retryTimer: null,
            retryCount: 0,
            listeners: new Set(),
        };
        noteCache.set(key, entry);
    }
    return entry;
}

function setSnapshot(entry: NoteEntry, patch: Partial<SessionNoteSnapshot>): void {
    entry.snapshot = { ...entry.snapshot, ...patch };
    for (const listener of entry.listeners) {
        listener();
    }
}

function clearRetryTimer(entry: NoteEntry): void {
    if (entry.retryTimer != null) {
        window.clearTimeout(entry.retryTimer);
        entry.retryTimer = null;
    }
}

// 外部 note 更新事件（其他组件保存了 note）→ 同步缓存，让所有订阅者立即看到。
function handleNoteUpdatedEvent(event: Event): void {
    if (!isAISessionNoteUpdatedEvent(event)) {
        return;
    }
    const summary = event.detail.summary;
    const candidates = new Set([summary.key, summary.id].filter((id): id is string => typeof id === "string" && id !== ""));
    for (const entry of noteCache.values()) {
        if (!candidates.has(entry.snapshot.sessionId)) {
            continue;
        }
        clearRetryTimer(entry);
        entry.retryCount = 0;
        setSnapshot(entry, { status: "loaded", summary, error: "", loadedAt: Date.now() });
    }
}

function ensureEventListener(): void {
    if (eventListenerAttached || typeof window === "undefined") {
        return;
    }
    window.addEventListener("aisession-note-updated", handleNoteUpdatedEvent);
    eventListenerAttached = true;
}

function loadSessionNote(service: AISessionsServiceType, sessionId: string, connection: string): void {
    const entry = getEntry(sessionId, connection);
    if (entry.promise != null || entry.snapshot.status === "loaded") {
        return;
    }
    clearRetryTimer(entry);
    setSnapshot(entry, { status: "loading", error: "" });
    dlog("note request", { sessionId, attempt: entry.retryCount + 1 });
    const request = service
        .Summary({ id: sessionId, connection: connection || undefined })
        .then((summary) => {
            entry.promise = null;
            entry.retryCount = 0;
            setSnapshot(entry, { status: "loaded", summary, error: "", loadedAt: Date.now() });
            return summary;
        })
        .catch((err) => {
            entry.promise = null;
            const message = err instanceof Error ? err.message : String(err);
            dlog("note request failed", { sessionId, error: message, attempt: entry.retryCount });
            if (entry.retryCount < NoteLoadMaxRetries) {
                entry.retryCount++;
                entry.retryTimer = window.setTimeout(() => {
                    entry.retryTimer = null;
                    // 重试期间若有其他请求已进入 loading/loaded 则跳过。
                    if (entry.promise == null && entry.snapshot.status !== "loaded") {
                        loadSessionNote(service, sessionId, connection);
                    }
                }, NoteLoadRetryDelayMs);
                setSnapshot(entry, { status: "loading", error: "" });
            } else {
                setSnapshot(entry, { status: "error", error: message });
            }
            return null;
        });
    entry.promise = request;
}

/**
 * 确保 note 已在后台加载（幂等）。重试在模块层进行，与组件挂载解耦。
 * 返回当前快照。
 */
export function ensureSessionNote(
    service: AISessionsServiceType,
    sessionId: string,
    connection?: string | null
): SessionNoteSnapshot {
    ensureEventListener();
    const conn = normalizeConnection(connection);
    if (sessionId === "") {
        const entry = getEntry("", conn);
        return entry.snapshot;
    }
    const entry = getEntry(sessionId, conn);
    if (entry.snapshot.status === "idle" || entry.snapshot.status === "error") {
        if (entry.snapshot.status === "error") {
            // error 是终态（重试耗尽），显式调用 ensure 视为重新触发一轮加载。
            entry.retryCount = 0;
        }
        loadSessionNote(service, sessionId, conn);
    }
    return entry.snapshot;
}

export function getSessionNoteSnapshot(sessionId: string, connection?: string | null): SessionNoteSnapshot {
    return getEntry(sessionId, normalizeConnection(connection)).snapshot;
}

export function subscribeSessionNote(
    sessionId: string,
    connection: string | null | undefined,
    listener: () => void
): () => void {
    const entry = getEntry(sessionId, normalizeConnection(connection));
    entry.listeners.add(listener);
    return () => {
        entry.listeners.delete(listener);
    };
}

export type SaveSessionNoteResult =
    | { status: "ok"; summary: SessionSummary }
    | { status: "error"; error: string };

/**
 * 保存 note + tags。
 *
 * 乐观更新：先把 note/tags 应用进缓存并派发全局事件，UI（hover 卡片 / 信息条）
 * 立刻反映用户的输入，不等 RPC 往返。RPC 成功后再用服务端返回的权威 summary 覆写；
 * 失败则用保存前的快照回滚，让用户看到的内容回到真实落盘状态。
 */
export async function saveSessionNote(
    service: AISessionsServiceType,
    sessionId: string,
    connection: string | null | undefined,
    note: string,
    tags: string[]
): Promise<SaveSessionNoteResult> {
    const conn = normalizeConnection(connection);
    const entry = getEntry(sessionId, conn);
    const before = entry.snapshot.summary;
    if (before == null) {
        // 没有基线 summary（会话还没落盘 / note 还没加载）时无法做乐观合并，
        // 也拿不到稳定的 key —— 直接报错，不去猜。
        return { status: "error", error: "session summary not loaded" };
    }
    const optimistic: SessionSummary = {
        ...before,
        note,
        tags: [...tags],
    };
    clearRetryTimer(entry);
    entry.retryCount = 0;
    setSnapshot(entry, { status: "loaded", summary: optimistic, error: "", loadedAt: Date.now() });
    dispatchAISessionNoteUpdated(optimistic);
    try {
        const updated = await service.NoteAndTags({ id: before.key, note, tags });
        clearRetryTimer(entry);
        entry.retryCount = 0;
        setSnapshot(entry, { status: "loaded", summary: updated, error: "", loadedAt: Date.now() });
        dispatchAISessionNoteUpdated(updated);
        return { status: "ok", summary: updated };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        dlog("note save failed", { sessionId, error: message });
        // 回滚到保存前的状态，避免屏幕上留着后端并不认可的编辑。
        setSnapshot(entry, { status: "loaded", summary: before, error: message, loadedAt: Date.now() });
        dispatchAISessionNoteUpdated(before);
        return { status: "error", error: message };
    }
}

// 仅供测试使用：清空模块级缓存。
export function resetSessionNoteCache(): void {
    for (const entry of noteCache.values()) {
        clearRetryTimer(entry);
        entry.listeners.clear();
    }
    noteCache.clear();
}
