// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { isPreviewWindow } from "@/app/store/windowtype";
import {
    recordPathUsageEntry,
    removePathUsageEntry,
    type PathUsageKind,
} from "@/app/view/preview/path-usage";
import { atoms, getSettingsKeyAtom, globalStore } from "@/store/global";
import { atom } from "jotai";

export const PathUsagePersistDebounceMs = 600;

// Single source of truth is the persisted config. The panel reads this atom; writes
// go through SetConfigCommand and the config echo drives the UI back.
export const pathUsageAtom = atom<PathUsageEntryType[]>((get) => {
    const value = get(getSettingsKeyAtom("preview:path-usage"));
    return Array.isArray(value) ? value : [];
});

// Desired final state while a debounced write is pending. Kept until the config echo
// confirms it, so a navigation racing the RPC round-trip cannot drop entries.
let pendingEntries: PathUsageEntryType[] | null = null;
let lastSentEntries: PathUsageEntryType[] | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let echoUnsub: (() => void) | null = null;
let unloadFlushBound = false;

function entriesEqual(a: PathUsageEntryType[] | null, b: PathUsageEntryType[] | null): boolean {
    if (a === b) return true;
    if (a == null || b == null || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        const x = a[i];
        const y = b[i];
        if (
            x.path !== y.path ||
            (x.connection ?? "") !== (y.connection ?? "") ||
            x.kind !== y.kind ||
            x.count !== y.count ||
            x.lastAt !== y.lastAt
        ) {
            return false;
        }
    }
    return true;
}

function ensureEchoSubscription(): void {
    if (echoUnsub != null || isPreviewWindow()) return;
    echoUnsub = globalStore.sub(pathUsageAtom, () => {
        if (pendingEntries != null && entriesEqual(globalStore.get(pathUsageAtom), pendingEntries)) {
            pendingEntries = null;
            lastSentEntries = null;
        }
    });
}

// Before the config is loaded the settings atom is empty; recording then would
// clobber the persisted entries with a single fresh one. Skip until it is ready.
function isUsageConfigReady(): boolean {
    return globalStore.get(atoms.fullConfigAtom) != null;
}

function currentEntries(): PathUsageEntryType[] {
    if (pendingEntries != null) {
        return pendingEntries;
    }
    return globalStore.get(pathUsageAtom) ?? [];
}

// Best-effort: a navigation in the last <debounce> before the window goes away would
// otherwise be dropped. Registered lazily so importing this module has no side effect.
function ensureUnloadFlush(): void {
    if (unloadFlushBound || typeof window === "undefined") return;
    unloadFlushBound = true;
    window.addEventListener("pagehide", () => flushPathUsageWrites());
}

function scheduleFlush(): void {
    ensureUnloadFlush();
    if (persistTimer != null) return;
    persistTimer = setTimeout(() => {
        persistTimer = null;
        flushPathUsageWrites();
    }, PathUsagePersistDebounceMs);
}

/** Immediately persist any buffered usage entries (used by tests and teardown). */
export function flushPathUsageWrites(): void {
    if (persistTimer != null) {
        clearTimeout(persistTimer);
        persistTimer = null;
    }
    if (isPreviewWindow()) {
        pendingEntries = null;
        return;
    }
    const entries = pendingEntries;
    if (entries == null) {
        return;
    }
    if (entriesEqual(entries, lastSentEntries)) {
        return;
    }
    lastSentEntries = entries;
    RpcApi.SetConfigCommand(TabRpcClient, { "preview:path-usage": entries }).catch((e) => {
        console.warn("failed to persist preview:path-usage", e);
    });
}

export function recordPathUsage(path: string, kind: PathUsageKind, connection?: string): void {
    if (isPreviewWindow() || !isUsageConfigReady()) return;
    ensureEchoSubscription();
    const current = currentEntries();
    const next = recordPathUsageEntry(current, { path, kind, connection, now: Date.now() });
    if (next === current) {
        return;
    }
    pendingEntries = next;
    scheduleFlush();
}

export function removePathUsage(selection: { path: string; connection?: string }): void {
    if (isPreviewWindow() || !isUsageConfigReady()) return;
    ensureEchoSubscription();
    const current = currentEntries();
    const next = removePathUsageEntry(current, selection.path, selection.connection);
    if (next === current) {
        return;
    }
    pendingEntries = next;
    scheduleFlush();
}
