// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { normalizeSessionEmojiKey } from "./session-persona-store";

export type AgentEmojiScope = "session" | "provider";

export type AgentEmojiWriteTarget = { kind: "session"; sessionId: string } | { kind: "provider"; provider: string };

/**
 * Collapse a requested scope onto the scopes that are actually available.
 *
 * "仅此会话" needs a session id. Without one the picker must show AND write the
 * provider scope — previously it kept `scope === "session"` internally while the
 * session radio was hidden, then silently wrote `setAgentPersona()` (provider-wide).
 */
export function resolveAgentEmojiScope(scope: AgentEmojiScope, sessionId: unknown): AgentEmojiScope {
    return scope === "session" && normalizeSessionEmojiKey(sessionId) !== "" ? "session" : "provider";
}

export function resolveAgentEmojiWriteTarget(
    scope: AgentEmojiScope,
    sessionId: unknown,
    provider: string
): AgentEmojiWriteTarget {
    const sessionKey = normalizeSessionEmojiKey(sessionId);
    if (resolveAgentEmojiScope(scope, sessionKey) === "session") {
        return { kind: "session", sessionId: sessionKey };
    }
    return { kind: "provider", provider };
}
