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
let snapshot: SessionEmojiMap = readSessionEmojiMap();
const listeners = new Set<() => void>();
let storageListenerAttached = false;

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
        snapshot = readSessionEmojiMap();
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
    snapshot = next;
    emit();
}

export function setSessionEmoji(sessionId: unknown, emoji: string | null): void {
    const key = normalizeSessionEmojiKey(sessionId);
    if (key === "") {
        return;
    }
    const next: SessionEmojiMap = { ...snapshot };
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

// Test-only reset.
export function __resetSessionEmojisForTests(): void {
    listeners.clear();
    storageListenerAttached = false;
    snapshot = {};
    const store = safeStorage();
    try {
        store?.removeItem(SessionEmojiStorageKey);
    } catch {
        /* ignore */
    }
}
