// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * L1 (provider-level) agent persona store.
 *
 * A persona is a single emoji that replaces an agent's brand logo across every
 * surface (block header, inline tab, tab info card, hover card, session overview,
 * aisessions chips/rows, widget launcher, agent-hook modal). It is keyed by
 * provider and persisted in localStorage so it also covers historical sessions
 * that have no blockId.
 *
 * This is a plain external store (not a jotai atom) so components can subscribe
 * with `useSyncExternalStore` and non-component contexts (term-model's viewIcon
 * atom) can read a mirrored jotai atom. The mirror lives in
 * `use-agent-personas.ts`.
 *
 * L2 (block-level) personas are stored on block meta under `agent:emoji` and are
 * NOT handled here — `getAgentIcon` resolves L2 → L1 → logo.
 */

export type PersonaMap = Record<string, string>;

const AgentPersonaStorageKey = "snorkeling:agent-personas";

function parsePersonaMap(raw: string | null): PersonaMap {
    if (raw == null) {
        return {};
    }
    try {
        const parsed: unknown = JSON.parse(raw);
        if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
            return {};
        }
        const result: PersonaMap = {};
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

function readPersonaMap(): PersonaMap {
    const store = safeStorage();
    if (store == null) {
        return {};
    }
    try {
        return parsePersonaMap(store.getItem(AgentPersonaStorageKey));
    } catch {
        return {};
    }
}

/** Provider keys are normalized to lowercase so "Claude" and "claude" share one persona. */
export function normalizeAgentPersonaKey(provider: unknown): string {
    return typeof provider === "string" ? provider.trim().toLowerCase() : "";
}

// Snapshot identity is stable between writes — `useSyncExternalStore` requires that.
let snapshot: PersonaMap = readPersonaMap();
const listeners = new Set<() => void>();
let storageListenerAttached = false;

export function getAgentPersonaSnapshot(): PersonaMap {
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
        if (event.key !== AgentPersonaStorageKey) {
            return;
        }
        // Ignore writes from a different storage area (e.g. sessionStorage noise).
        if (event.storageArea != null && event.storageArea !== window.localStorage) {
            return;
        }
        snapshot = readPersonaMap();
        emit();
    });
}

export function subscribeAgentPersonas(listener: () => void): () => void {
    ensureStorageListener();
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function persist(next: PersonaMap): void {
    const store = safeStorage();
    if (store != null) {
        try {
            if (Object.keys(next).length === 0) {
                // Don't leave an empty `{}` key behind.
                store.removeItem(AgentPersonaStorageKey);
            } else {
                store.setItem(AgentPersonaStorageKey, JSON.stringify(next));
            }
        } catch {
            /* storage full / private mode — keep the in-memory snapshot usable */
        }
    }
    snapshot = next;
    emit();
}

export function setAgentPersona(provider: unknown, emoji: string | null): void {
    const key = normalizeAgentPersonaKey(provider);
    if (key === "" || key === "agent") {
        return;
    }
    const next: PersonaMap = { ...snapshot };
    if (emoji == null || emoji === "") {
        delete next[key];
    } else {
        next[key] = emoji;
    }
    persist(next);
}

export function clearAgentPersona(provider: unknown): void {
    setAgentPersona(provider, null);
}

// Test-only: drop listeners, re-read an empty map, and clear the persisted key.
export function __resetAgentPersonasForTests(): void {
    listeners.clear();
    storageListenerAttached = false;
    snapshot = {};
    const store = safeStorage();
    try {
        store?.removeItem(AgentPersonaStorageKey);
    } catch {
        /* ignore */
    }
}
