// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// AgentRuntimeMetadataStore - lean reactive cache for live Agent runtime
// metadata (current model / thinking level).
//
// Performance contract (hover cards must show immediately, never block on a
// network request):
//   - First paint only reads synchronous sources (block meta requested model).
//   - This store enriches asynchronously via LiveSessionState, which NEVER
//     spawns an agent (it only looks up an already-live GUI chat session).
//   - In-flight requests are deduplicated across all hover surfaces.
//   - A failed or "no live session" response keeps whatever value exists and
//     marks the fetch complete; it does not clear data or block rendering.
import { AISessionsService } from "@/app/store/services";

export type AgentRuntimeModelSource = "requested" | "live" | "unknown";

export type AgentRuntimeMetadataEntry = {
    // live model (from a live GUI chat session), when available
    model?: string;
    provider?: string;
    thinkingLevel?: string;
    source: AgentRuntimeModelSource;
    loading: boolean;
    loadedAt?: number;
};

const entries = new Map<string, AgentRuntimeMetadataEntry>();
const pending = new Map<string, Promise<void>>();
const listenersByBlock = new Map<string, Set<() => void>>();

function emit(blockId: string) {
    for (const fn of listenersByBlock.get(blockId) ?? []) {
        fn();
    }
}

function setEntry(blockId: string, updater: (cur: AgentRuntimeMetadataEntry | undefined) => AgentRuntimeMetadataEntry) {
    const next = updater(entries.get(blockId));
    entries.set(blockId, next);
    emit(blockId);
}

export function subscribeAgentRuntimeMetadata(blockId: string, fn: () => void): () => void {
    let listeners = listenersByBlock.get(blockId);
    if (listeners == null) {
        listeners = new Set();
        listenersByBlock.set(blockId, listeners);
    }
    listeners.add(fn);
    return () => {
        listeners?.delete(fn);
        if (listeners?.size === 0) {
            listenersByBlock.delete(blockId);
        }
    };
}

export function getAgentRuntimeMetadataSnapshot(blockId: string): AgentRuntimeMetadataEntry | undefined {
    return entries.get(blockId);
}

/**
 * Kick off an async enrichment of the live model for a block if not already in
 * flight. No-op when sessionId is empty or a request for this block is pending.
 * Failures and "not live" resolutions leave the existing entry intact.
 */
export function ensureAgentRuntimeMetadata(blockId: string, sessionId: string, source: string): void {
    if (!sessionId || !blockId) {
        return;
    }
    const existing = entries.get(blockId);
    if (existing?.loading || pending.has(blockId)) {
        return;
    }
    setEntry(blockId, (cur) => ({ ...cur, loading: true }));
    const p = AISessionsService.LiveSessionState({ source: source || "pi", sessionId })
        .then((resp) => {
            if (resp.live && resp.modelId) {
                setEntry(blockId, () => ({
                    model: resp.modelName || resp.modelId,
                    provider: resp.modelProvider,
                    thinkingLevel: resp.thinkingLevel,
                    source: "live",
                    loading: false,
                    loadedAt: Date.now(),
                }));
                return;
            }
            // Live session not present (or no model reported): keep the existing
            // value (e.g. requested model from block meta), just finish loading.
            setEntry(blockId, (cur) => ({ ...cur, loading: false, loadedAt: Date.now() }));
        })
        .catch(() => {
            // Query failed: never clear/block. Keep fallback, mark done.
            setEntry(blockId, (cur) => ({ ...cur, loading: false, loadedAt: Date.now() }));
        })
        .finally(() => {
            pending.delete(blockId);
        });
    pending.set(blockId, p);
}

// test/diagnostics helper
export function __agentRuntimeMetadataDebug(): { size: number; pending: number } {
    return { size: entries.size, pending: pending.size };
}
