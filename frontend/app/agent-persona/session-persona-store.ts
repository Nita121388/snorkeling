// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * L2 (session-level) agent persona store.
 *
 * A session-level persona is a single emoji that replaces an agent's brand logo
 * for ONE session — and it shows up everywhere that session appears: the live
 * terminal block, the inline tab, the tab info card, the hover card, the Session
 * Overview row, AND the aisessions history list (including a resumed session,
 * because resume reuses the same sessionId).
 *
 * Keyed by sessionId (the `agent:sessionid` block meta / aisessions `id`), not by
 * blockId: a tabbed/resumed session is a different block each time, so a block-keyed
 * map would never survive the remount. localStorage keeps it across launches.
 *
 * Plain external store (mirror pattern shared with persona-store.ts / use-agent-personas.ts).
 * L1 (provider) lives in persona-store.ts; getAgentIcon resolves L2s → L1 → logo.
 */

export type SessionEmojiMap = Record<string, string>;

const SessionEmojiStorageKey = "snorkeling:agent-session-emojis";

function parseSessionEmojiMap(raw: string | null): SessionEmojiMap {
    if (raw == null) {
        return {};
    }
    try {
        const parsed: unknown = JSON.parse(raw);
        if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
            return {};
        }
        const result: SessionEmojiMap = {};
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
            if (typeof key === "string" && key !== "" && typeof value === "string" && value !== "") {
                result[key] = value;
            }
        }
        return result;
    } catch {
        return {};
    }
}

function safeStorage(): Storage | null {
    try {
        return typeof window !== "undefined" ? window.localStorage : null;
    } catch {
        return null;
    }
}

function readSessionEmojiMap(): SessionEmojiMap {
    const store = safeStorage();
    if (store == null) {
        return {};
    }
    try {
        return parseSessionEmojiMap(store.getItem(SessionEmojiStorageKey));
    } catch {
        return {};
    }
}

/** sessionIds are case-sensitive on disk; only trim surrounding whitespace. */
export function normalizeSessionEmojiKey(sessionId: unknown): string {
    return typeof sessionId === "string" ? sessionId.trim() : "";
}

// Stable snapshot identity between writes (useSyncExternalStore requirement).
// The reader-visible snapshot merges two layers: backend emoji props (from
// aisessions summaries' props.emoji, pushed by setBackendSessionEmojis) win over
// localStorage leftovers; P1 of the emoji-preference track makes the backend the
// source of truth while local values keep working as the fallback.
let localEmojis: SessionEmojiMap = readSessionEmojiMap();
let backendEmojis: SessionEmojiMap = {};
let snapshot: SessionEmojiMap = { ...localEmojis };
const listeners = new Set<() => void>();
let storageListenerAttached = false;

function mergeEmojiMaps(): SessionEmojiMap {
    return { ...localEmojis, ...backendEmojis };
}

function isSameEmojiMap(a: SessionEmojiMap, b: SessionEmojiMap): boolean {
    const aKeys = Object.keys(a);
    if (aKeys.length !== Object.keys(b).length) {
        return false;
    }
    for (const key of aKeys) {
        if (a[key] !== b[key]) {
            return false;
        }
    }
    return true;
}

function sanitizeEmojiMap(input: SessionEmojiMap): SessionEmojiMap {
    const result: SessionEmojiMap = {};
    if (input == null || typeof input !== "object") {
        return result;
    }
    for (const [key, value] of Object.entries(input)) {
        if (typeof key === "string" && key.trim() !== "" && typeof value === "string" && value.trim() !== "") {
            result[key] = value;
        }
    }
    return result;
}

/**
 * Push backend emoji props (session id → emoji, from ai_session_props
 * prop_key='emoji') into the store. Backend values take precedence over
 * localStorage in the merged snapshot. Passing a map without a session keeps
 * that session on its local value; an empty map clears the backend layer.
 */
export function setBackendSessionEmojis(map: SessionEmojiMap): void {
    const next = sanitizeEmojiMap(map);
    if (isSameEmojiMap(backendEmojis, next)) {
        return; // stable snapshot identity: no change, no emit
    }
    backendEmojis = next;
    snapshot = mergeEmojiMaps();
    emit();
}

/**
 * Merge a partial backend emoji map into the current one without dropping
 * entries for sessions outside the incoming set (e.g. the current list page).
 * Per-session summaries and list responses both feed this.
 */
export function mergeBackendSessionEmojis(map: SessionEmojiMap): void {
    const incoming = sanitizeEmojiMap(map);
    if (Object.keys(incoming).length === 0) {
        return;
    }
    setBackendSessionEmojis({ ...backendEmojis, ...incoming });
}

/**
 * Convenience: derive a partial backend emoji map from aisessions summaries
 * (props.emoji string cell values, keyed by session id) and merge it in.
 */
export function applyBackendSessionSummaries(
    summaries: Array<{ id?: string; props?: { emoji?: { value?: unknown } } }>
): void {
    const map: SessionEmojiMap = {};
    for (const session of summaries) {
        if (session == null || typeof session.id !== "string" || session.id.trim() === "") {
            continue;
        }
        const value = session.props?.emoji?.value;
        if (typeof value === "string" && value.trim() !== "") {
            map[session.id] = value;
        }
    }
    mergeBackendSessionEmojis(map);
}

export function getSessionEmojiSnapshot(): SessionEmojiMap {
    return snapshot;
}

function emit(): void {
    for (const listener of [...listeners]) {
        listener();
    }
}

function ensureStorageListener(): void {
    if (storageListenerAttached) {
        return;
    }
    if (typeof window === "undefined" || typeof window.addEventListener !== "function") {
        return;
    }
    storageListenerAttached = true;
    window.addEventListener("storage", (event: StorageEvent) => {
        if (event.key !== SessionEmojiStorageKey) {
            return;
        }
        if (event.storageArea != null && event.storageArea !== window.localStorage) {
            return;
        }
        localEmojis = readSessionEmojiMap();
        snapshot = mergeEmojiMaps();
        emit();
    });
}

export function subscribeSessionEmojis(listener: () => void): () => void {
    ensureStorageListener();
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function persist(next: SessionEmojiMap): void {
    const store = safeStorage();
    if (store != null) {
        try {
            if (Object.keys(next).length === 0) {
                store.removeItem(SessionEmojiStorageKey);
            } else {
                store.setItem(SessionEmojiStorageKey, JSON.stringify(next));
            }
        } catch {
            /* storage full / private mode — keep in-memory snapshot usable */
        }
    }
    localEmojis = next;
    snapshot = mergeEmojiMaps();
    emit();
}

export function setSessionEmoji(sessionId: unknown, emoji: string | null): void {
    const key = normalizeSessionEmojiKey(sessionId);
    if (key === "") {
        return;
    }
    const next: SessionEmojiMap = { ...localEmojis };
    if (emoji == null || emoji === "") {
        delete next[key];
    } else {
        next[key] = emoji;
    }
    persist(next);
}

export function clearSessionEmoji(sessionId: unknown): void {
    setSessionEmoji(sessionId, null);
}

/**
 * Pure helper: turn backend emoji prop entries into a frontend map. Each entry
 * is keyed by BOTH its session id and its session key, because block meta may
 * carry either form (`agent:sessionid` is normally the id, but resume/hero
 * paths and remote origins have been observed with the full key). Empty keys
 * and empty emoji are skipped; the first (most recently updated, since the
 * RPC orders by updated_at DESC) value for a key wins.
 */
export function emojiMapFromEntries(
    entries: Array<{ id?: string; sessionKey?: string; emoji?: string }> | null | undefined
): SessionEmojiMap {
    const result: SessionEmojiMap = {};
    if (!Array.isArray(entries)) {
        return result;
    }
    for (const entry of entries) {
        if (entry == null) {
            continue;
        }
        const emoji = typeof entry.emoji === "string" ? entry.emoji.trim() : "";
        if (emoji === "") {
            continue;
        }
        for (const rawKey of [entry.id, entry.sessionKey]) {
            const key = normalizeSessionEmojiKey(rawKey);
            if (key === "" || result[key] != null) {
                continue;
            }
            result[key] = emoji;
        }
    }
    return result;
}

/**
 * Startup bootstrap for EVERY window (design: session-emoji bootstrap, D2):
 *   1. push any legacy localStorage values to the backend (if-absent, idempotent);
 *   2. read the FULL backend emoji set and install it as the backend layer.
 * Step 1 is deliberately non-destructive — localStorage is the only cross-window
 * real-time channel, so deleting it (as the old migration did) wiped the local
 * layer of every other window and made open agent blocks fall back to brand logos.
 * Best-effort: an RPC failure keeps the current layers and retries on the next
 * window start.
 * @returns true when the backend layer was refreshed from the backend
 */
export async function bootstrapSessionEmojis(): Promise<boolean> {
    await migrateLegacySessionEmojis().catch(() => false);
    try {
        const { RpcApi } = await import("@/app/store/wshclientapi");
        const { TabRpcClient } = await import("@/app/store/wshrpcutil");
        const result = await RpcApi.SessionEmojiPropsListCommand(TabRpcClient, {});
        if (result == null) {
            return false;
        }
        // Full set for the local machine → replace the backend layer wholesale
        // (unlike list pages, nothing can be missing here).
        setBackendSessionEmojis(emojiMapFromEntries(result.entries));
        return true;
    } catch {
        return false;
    }
}

/**
 * Legacy migration (design.md §2.4, prd.md R1): replays every localStorage
 * session emoji into the backend (source=user) through the SessionEmojiMigrate
 * RPC. It is PUSH-ONLY: the localStorage key is intentionally kept (it is the
 * shared cross-window channel, and the backend layer takes precedence anyway),
 * so a later window's startup can never clear emojis that the user is looking at.
 * Idempotent — the backend write is if-absent.
 * @returns true when every entry was pushed (or there was nothing to push)
 */
export async function migrateLegacySessionEmojis(): Promise<boolean> {
    const local = readSessionEmojiMap();
    const ids = Object.keys(local);
    if (ids.length === 0) {
        return true;
    }
    const entries = ids.map((id) => ({ identifier: id, emoji: local[id] }));
    const { RpcApi } = await import("@/app/store/wshclientapi");
    const { TabRpcClient } = await import("@/app/store/wshrpcutil");
    const result = await RpcApi.SessionEmojiMigrateCommand(TabRpcClient, { entries });
    if (result == null) {
        return false;
    }
    return true;
}

// Test-only reset.
export function __resetSessionEmojisForTests(): void {
    listeners.clear();
    storageListenerAttached = false;
    localEmojis = {};
    backendEmojis = {};
    snapshot = {};
    const store = safeStorage();
    try {
        store?.removeItem(SessionEmojiStorageKey);
    } catch {
        /* ignore */
    }
}
