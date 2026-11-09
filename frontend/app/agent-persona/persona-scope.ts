// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { normalizeSessionEmojiKey } from "./session-persona-store";

export type AgentEmojiScope = "session" | "block" | "provider";

export type AgentEmojiWriteTarget =
    | { kind: "session"; sessionId: string }
    | { kind: "block"; blockId: string }
    | { kind: "provider"; provider: string };

/**
 * Collapse a requested scope onto the scopes that are actually available.
 *
 * "仅此会话" needs a session id. Without one the picker used to fall through to
 * a provider-wide write (改一个 block = 整个 provider 的会话全部换 emoji). Now, when
 * the picker was opened from a concrete block (blockId known), the request
 * collapses onto the per-block scope ("仅此标签页", block meta `agent:emoji`)
 * instead — provider-wide writes stay available only as an explicit choice.
 */
export function resolveAgentEmojiScope(scope: AgentEmojiScope, sessionId: unknown, blockId?: unknown): AgentEmojiScope {
    const sessionKey = normalizeSessionEmojiKey(sessionId);
    const blockKey = normalizeSessionEmojiKey(blockId);
    if (scope === "provider") {
        return "provider";
    }
    if (scope === "block") {
        if (blockKey !== "") {
            return "block";
        }
        return sessionKey !== "" ? "session" : "provider";
    }
    // scope === "session"
    if (sessionKey !== "") {
        return "session";
    }
    if (blockKey !== "") {
        return "block";
    }
    return "provider";
}

export function resolveAgentEmojiWriteTarget(
    scope: AgentEmojiScope,
    sessionId: unknown,
    provider: string,
    blockId?: unknown
): AgentEmojiWriteTarget {
    const sessionKey = normalizeSessionEmojiKey(sessionId);
    if (resolveAgentEmojiScope(scope, sessionKey, blockId) === "session") {
        return { kind: "session", sessionId: sessionKey };
    }
    if (resolveAgentEmojiScope(scope, sessionKey, blockId) === "block") {
        return { kind: "block", blockId: normalizeSessionEmojiKey(blockId) };
    }
    return { kind: "provider", provider };
}
