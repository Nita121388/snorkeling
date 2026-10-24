// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Copy Context DOM contract — shared between the element layer (which resolves
// a selection against the DOM) and feature views (which own the data needed to
// format a full context block).
//
// The existing file-oriented contract (`data-copy-context-path` +
// `data-source-line`, used by markdown preview / code editor / tables) stays
// untouched. This contract adds a second, richer flavour for surfaces that
// cannot be described by "file + line" — AI session messages and the agent
// terminal.
//
// Layering: this module must not import from `app/view/*`. Feature views
// register a resolver; the element layer only parses + dispatches.

/** DOM attribute naming the provenance kind. */
export const CopyContextKindAttr = "data-copy-context-kind";
/** DOM attribute carrying the JSON-encoded provenance payload. */
export const CopyContextMetaAttr = "data-copy-context-meta";

/** AI session detail message or tool call. */
export const CopyContextKindSession = "aisession";
/** Agent terminal (canvas — never resolved through DOM, kept for completeness). */
export const CopyContextKindTerm = "agentterm";

/**
 * Provenance attached to a single rendered message (or tool call). Session-level
 * fields travel here too: the message node is the only element a selection can
 * walk up to, so it must carry everything needed to describe itself.
 */
export type SessionCopyMeta = {
    sessionId: string;
    source?: string;
    title?: string;
    projectPath?: string;
    model?: string;
    seq?: number;
    role?: string;
    /** Milliseconds (or seconds — the formatter normalizes). */
    timestamp?: number;
    /** Backend record id inside the session file — exact locator for an agent. */
    entryId?: string;
    /** Stable per-item key (entry/tool pairing) — secondary locator. */
    itemKey?: string;
    toolName?: string;
    exitCode?: number;
};

/**
 * Turns provenance into the final pasteable text.
 * `selectedText` is the live DOM selection, so single-message partial
 * selections stay partial.
 */
export type SessionContextResolver = (meta: SessionCopyMeta, selectedText: string) => string | null;

const resolversBySessionId = new Map<string, SessionContextResolver>();

function asFiniteNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asString(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}

/** Defensive parse of `data-copy-context-meta`; returns null on any defect. */
export function parseSessionCopyMeta(raw: string | null | undefined): SessionCopyMeta | null {
    if (raw == null || raw.length === 0) {
        return null;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return null;
    }
    if (parsed == null || typeof parsed !== "object") {
        return null;
    }
    const record = parsed as Record<string, unknown>;
    const sessionId = asString(record.sessionId);
    if (sessionId == null || sessionId.trim().length === 0) {
        return null;
    }
    return {
        sessionId,
        source: asString(record.source),
        title: asString(record.title),
        projectPath: asString(record.projectPath),
        model: asString(record.model),
        seq: asFiniteNumber(record.seq),
        role: asString(record.role),
        timestamp: asFiniteNumber(record.timestamp),
        entryId: asString(record.entryId),
        itemKey: asString(record.itemKey),
        toolName: asString(record.toolName),
        exitCode: asFiniteNumber(record.exitCode),
    };
}

/** DOM props to spread onto a message / tool-call container. */
export function sessionContextAttrs(meta: SessionCopyMeta): Record<string, string> {
    return {
        [CopyContextKindAttr]: CopyContextKindSession,
        [CopyContextMetaAttr]: JSON.stringify(meta),
    };
}

/**
 * Register the formatter for one session panel.
 *
 * Needed because the DOM layer cannot rebuild a multi-message range: the session
 * model lives in the panel, and virtualization may have unmounted the rows the
 * drag passed over. Module-level registration mirrors `session-note-events.ts`.
 */
export function registerSessionContextResolver(sessionId: string, resolver: SessionContextResolver): () => void {
    if (!sessionId) {
        return () => {};
    }
    resolversBySessionId.set(sessionId, resolver);
    return () => {
        // Only drop it if nobody replaced us meanwhile (rapid session switching).
        if (resolversBySessionId.get(sessionId) === resolver) {
            resolversBySessionId.delete(sessionId);
        }
    };
}

/** Resolve provenance to a pasteable context block, or null when unsupported. */
export function resolveSessionContext(meta: SessionCopyMeta, selectedText: string): string | null {
    const resolver = resolversBySessionId.get(meta.sessionId);
    if (resolver == null) {
        return null;
    }
    return resolver(meta, selectedText);
}

/** Test helper: drop every registration. */
export function clearSessionContextResolvers(): void {
    resolversBySessionId.clear();
}
