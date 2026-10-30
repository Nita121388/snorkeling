// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { normalizeSessionEmojiKey } from "@/app/agent-persona/session-persona-store";

export type TabDisplayMode = "full" | "emoji-only";

const TabDisplayModeStorageKey = "snorkeling:agent-tab-display-mode";

let snapshot: Record<string, TabDisplayMode> = {};
const listeners = new Set<() => void>();
let storageListenerAttached = false;

function safeStorage(): Storage | null {
    try {
        return typeof window !== "undefined" ? window.localStorage : null;
    } catch {
        return null;
    }
}

function readSnapshot(): Record<string, TabDisplayMode> {
    const store = safeStorage();
    if (!store) {
        return {};
    }
    try {
        const raw = store.getItem(TabDisplayModeStorageKey);
        if (!raw) {
            return {};
        }
        const parsed = JSON.parse(raw);
        if (typeof parsed !== "object" || parsed == null) {
            return {};
        }
        const out: Record<string, TabDisplayMode> = {};
        for (const [k, v] of Object.entries(parsed)) {
            const key = normalizeSessionEmojiKey(k);
            if (key && v === "emoji-only") {
                out[key] = "emoji-only";
            }
        }
        return out;
    } catch {
        return {};
    }
}

snapshot = readSnapshot();

function emit(): void {
    for (const l of [...listeners]) {
        l();
    }
}

function ensureListener(): void {
    if (storageListenerAttached || typeof window === "undefined") {
        return;
    }
    storageListenerAttached = true;
    window.addEventListener("storage", (e: StorageEvent) => {
        if (e.key !== TabDisplayModeStorageKey) {
            return;
        }
        snapshot = readSnapshot();
        emit();
    });
}

export function getTabDisplayMode(sessionId: string | null | undefined): TabDisplayMode {
    const key = normalizeSessionEmojiKey(sessionId);
    if (!key) {
        return "full";
    }
    return snapshot[key] === "emoji-only" ? "emoji-only" : "full";
}

export function setTabDisplayMode(sessionId: string | null | undefined, mode: TabDisplayMode): void {
    const key = normalizeSessionEmojiKey(sessionId);
    if (!key) {
        return;
    }
    const next = { ...snapshot };
    if (mode === "emoji-only") {
        next[key] = "emoji-only";
    } else {
        delete next[key];
    }
    const store = safeStorage();
    try {
        if (Object.keys(next).length === 0) {
            store?.removeItem(TabDisplayModeStorageKey);
        } else {
            store?.setItem(TabDisplayModeStorageKey, JSON.stringify(next));
        }
    } catch {
        // ignore
    }
    snapshot = next;
    emit();
}

export function subscribeTabDisplayMode(l: () => void): () => void {
    ensureListener();
    listeners.add(l);
    return () => {
        listeners.delete(l);
    };
}

export function getTabDisplaySnapshot(): Record<string, TabDisplayMode> {
    return snapshot;
}
