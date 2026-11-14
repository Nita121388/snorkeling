// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { normalizeSessionEmojiKey } from "@/app/agent-persona/session-persona-store";
import * as jotai from "jotai";

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

/**
 * jotai 镜像：外部快照（localStorage）本身不是 jotai 状态，atom getter 里 `get()` 它
 * 拿不到重算通知。这个 revision atom 在 onMount 时订阅外部快照，快照一变就自增 ——
 * 消费方（term-model 头部）只要在 getter 里 `get(tabDisplayModeRevisionAtom)` 就能
 * 在「仅显示 Emoji」切换的同一帧重算，而不必改成 React 组件。
 *
 * 注意：这是**会话级**开关（key 是 sessionId），不要当成全局设置来读。
 */
export const tabDisplayModeRevisionAtom = jotai.atom(0);
tabDisplayModeRevisionAtom.onMount = (setValue) => {
    return subscribeTabDisplayMode(() => {
        setValue((v) => v + 1);
    });
};
