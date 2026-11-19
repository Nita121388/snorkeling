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

export type AgentRuntimeModelSource = "requested" | "live" | "session" | "unknown";

export type AgentRuntimeMetadataEntry = {
    // canonical raw model id (modelId || modelName), kept verbatim for tooltip/copy
    model?: string;
    rawModel?: string;
    provider?: string;
    thinkingLevel?: string;
    source: AgentRuntimeModelSource;
    loading: boolean;
    /** blockId|sessionId|source this entry belongs to. */
    sessionKey?: string;
    /** Stamped only when a model was resolved; a failed/empty attempt must not block retries. */
    loadedAt?: number;
    /** Last attempt time (success or failure), diagnostics only. */
    lastAttemptAt?: number;
};

const entries = new Map<string, AgentRuntimeMetadataEntry>();
const pending = new Map<string, Promise<void>>();

const SUCCESS_TTL_MS = 5000;

function sessionCacheKey(blockId: string, sessionId: string, source: string): string {
    return `${blockId}|${sessionId}|${source || "pi"}`;
}
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
    const cacheKey = sessionCacheKey(blockId, sessionId, source);
    const existing = entries.get(blockId);
    // Only a successful resolution inside the TTL is served from cache. A
    // failed/empty attempt leaves loadedAt unset, so the next open retries.
    if (
        existing?.sessionKey === cacheKey &&
        existing.loadedAt != null &&
        Date.now() - existing.loadedAt < SUCCESS_TTL_MS
    ) {
        return;
    }
    if (existing?.loading && existing.sessionKey === cacheKey) {
        return;
    }
    if (pending.has(cacheKey)) {
        return;
    }
    // Different session/source on the same block: drop the old session's model
    // so it cannot bleed into the new card until the fresh response arrives.
    setEntry(blockId, (cur) =>
        cur?.sessionKey === cacheKey
            ? { ...cur, loading: true }
            : { model: undefined, rawModel: undefined, provider: undefined, thinkingLevel: undefined, source: "unknown", loading: true, sessionKey: cacheKey }
    );
    const p = AISessionsService.LiveSessionState({ source: source || "pi", sessionId })
        .then((resp) => {
            const attemptedAt = Date.now();
            if (resp.modelId || resp.modelName) {
                // canonical raw is the id; name is a friendly label and is not split-safe.
                const rawModel = resp.modelId || resp.modelName;
                setEntry(blockId, () => ({
                    model: rawModel,
                    rawModel,
                    provider: resp.modelProvider,
                    thinkingLevel: resp.thinkingLevel,
                    source: resp.live ? "live" : "session",
                    loading: false,
                    sessionKey: cacheKey,
                    loadedAt: attemptedAt,
                    lastAttemptAt: attemptedAt,
                }));
                return;
            }
            // Live/session not present or no model reported: keep the existing
            // value (e.g. requested model from block meta), but do NOT stamp
            // loadedAt — the next open must retry.
            setEntry(blockId, (cur) => ({
                ...(cur?.sessionKey === cacheKey
                    ? cur
                    : { source: "unknown" as AgentRuntimeModelSource, sessionKey: cacheKey }),
                loading: false,
                lastAttemptAt: attemptedAt,
            }));
        })
        .catch(() => {
            // Query failed: never clear/block the fallback, and never cache it.
            setEntry(blockId, (cur) => ({
                ...(cur?.sessionKey === cacheKey
                    ? cur
                    : { source: "unknown" as AgentRuntimeModelSource, sessionKey: cacheKey }),
                loading: false,
                lastAttemptAt: Date.now(),
            }));
        })
        .finally(() => {
            pending.delete(cacheKey);
        });
    pending.set(cacheKey, p);
}

// test/diagnostics helper
export function __agentRuntimeMetadataDebug(): { size: number; pending: number } {
    return { size: entries.size, pending: pending.size };
}
