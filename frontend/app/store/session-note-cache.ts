// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { AISessionsServiceType } from "@/app/store/services";
import { waveEventSubscribeSingle } from "@/app/store/wps";
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
// 已加载条目的软过期时间：全局 aisession 视图/详情块改了 note 时靠事件同步，
// 但事件可能错过（监听器尚未挂载、id 写法不同、其它窗口）。超过 TTL 后下一次
// ensure 会在后台静默刷新，避免卡片长期显示旧 note/tags。
const NoteRefreshTtlMs = 30_000;

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
// 同一会话可能以 <source>:<id>:<path> 或裸 id 两种写法出现，这里做归一化匹配。
function sessionIdMatches(candidate: string, sessionId: string): boolean {
    if (candidate === "" || sessionId === "") {
        return false;
    }
    if (candidate === sessionId) {
        return true;
    }
    // StableKey 形如 <source>:<id>:<filePath>，id 作为独立段出现；
    // 远端 key 还会多出 remote:<b64> 段，所以按段匹配而不是前缀/后缀推断。
    if (candidate.split(":").includes(sessionId)) {
        return true;
    }
    return false;
}

function handleNoteUpdatedEvent(event: Event): void {
    if (!isAISessionNoteUpdatedEvent(event)) {
        return;
    }
    const summary = event.detail.summary;
    const candidates = [summary.key, summary.id].filter(
        (id): id is string => typeof id === "string" && id !== ""
    );
    if (candidates.length === 0) {
        return;
    }
    for (const entry of noteCache.values()) {
        if (!candidates.some((candidate) => sessionIdMatches(candidate, entry.snapshot.sessionId))) {
            continue;
        }
        clearRetryTimer(entry);
        entry.retryCount = 0;
        setSnapshot(entry, { status: "loaded", summary, error: "", loadedAt: Date.now() });
    }
}

// applyTitleUpdate merges a partial title update into the cache instead of
// replacing the whole summary. The backend's auto-title worker only publishes
// {key, title, titleSource}; replacing wholesale would blank the note / tags /
// marked fields that other surfaces (hover cards, info bars) are showing.
function applyTitleUpdate(incoming: SessionSummary): void {
    const candidates = [incoming.key, incoming.id].filter(
        (id): id is string => typeof id === "string" && id !== ""
    );
    if (candidates.length === 0) {
        return;
    }
    for (const entry of noteCache.values()) {
        const existing = entry.snapshot.summary;
        if (existing == null) {
            continue;
        }
        if (!candidates.some((candidate) => sessionIdMatches(candidate, entry.snapshot.sessionId))) {
            continue;
        }
        clearRetryTimer(entry);
        entry.retryCount = 0;
        setSnapshot(entry, {
            status: "loaded",
            summary: { ...existing, title: incoming.title, titleSource: incoming.titleSource },
            error: "",
            loadedAt: Date.now(),
        });
    }
}

function ensureEventListener(): void {
    if (eventListenerAttached || typeof window === "undefined") {
        return;
    }
    window.addEventListener("aisession-note-updated", handleNoteUpdatedEvent);
    eventListenerAttached = true;
}

// ── 后端 wps 事件：aisessions:titleupdated ─────────────────────────────
// 后台 AI 标题 worker 写完标题后由 pkg/service/aisessionsservice 发布。
// 这里复用同一个 cache：把 summary 塞进 note-cache，所有已订阅的卡片 / tab
// 标签自动拿到最新 title，无需轮询。缓存条目不存在（该会话没被任何 surface
// 订阅过）时直接忽略 —— tab 下一次 ensure 会自然读到新值。
let titleListenerAttached = false;

export function ensureSessionTitleListener(): void {
    if (titleListenerAttached || typeof window === "undefined") {
        return;
    }
    titleListenerAttached = true;
    try {
        // 模块级单例，生命周期跟随 app 进程，无需保存退订句柄。
        waveEventSubscribeSingle<"aisessions:titleupdated">({
            eventType: "aisessions:titleupdated",
            handler: (event) => {
                const summary = event.data?.summary;
                if (summary == null) {
                    return;
                }
                applyTitleUpdate(summary);
            },
        });
    } catch {
        // 测试环境 / 无 wsh 客户端时订阅不可用：退化为不监听，不影响其他功能，
        // 也不影响 tab 下次 ensure 拉到新值。允许后续真正需要时重试。
        titleListenerAttached = false;
    }
}

function loadSessionNote(
    service: AISessionsServiceType,
    sessionId: string,
    connection: string,
    opts?: { background?: boolean }
): void {
    const entry = getEntry(sessionId, connection);
    if (entry.promise != null) {
        return;
    }
    // background 刷新：保留旧快照先展示，等新值到达再覆盖（不闪 loading）。
    if (!opts?.background && entry.snapshot.status === "loaded") {
        return;
    }
    clearRetryTimer(entry);
    if (!opts?.background) {
        setSnapshot(entry, { status: "loading", error: "" });
    }
    dlog("note request", { sessionId, attempt: entry.retryCount + 1, background: opts?.background === true });
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
                // background 刷新失败时保留已加载的旧快照，不要把卡片打回 loading/error。
                if (!opts?.background) {
                    setSnapshot(entry, { status: "loading", error: "" });
                }
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
    connection?: string | null,
    opts?: { force?: boolean }
): SessionNoteSnapshot {
    ensureEventListener();
    ensureSessionTitleListener();
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
    } else if (
        entry.snapshot.status === "loaded" &&
        (opts?.force === true || Date.now() - entry.snapshot.loadedAt > NoteRefreshTtlMs)
    ) {
        // 软过期 / 显式刷新：后台拉一次，旧快照继续展示。
        loadSessionNote(service, sessionId, conn, { background: true });
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
