// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { AgentDisplayState, AgentPhase, AgentStatus, AgentStatusConfidence } from "./agent-status-types";

type RawCanonicalAgentStatus = {
    blockId?: unknown;
    provider?: unknown;
    sessionId?: unknown;
    state?: unknown;
    prevState?: unknown;
    phase?: unknown;
    source?: unknown;
    confidence?: unknown;
    reason?: unknown;
    message?: unknown;
    toolName?: unknown;
    updatedAt?: unknown;
    activeSince?: unknown;
    seq?: unknown;
    expiresAt?: unknown;
};

function normalizedState(state: string | undefined): AgentDisplayState {
    switch (state) {
        case "done":
        case "stale":
        case "blocked":
        case "working":
        case "idle":
        case "unknown":
            return state;
        default:
            return "unknown";
    }
}

function normalizedPhase(phase: string | undefined, state: AgentDisplayState): AgentPhase {
    switch (phase) {
        case "thinking":
        case "tool":
        case "shell-command":
        case "approval":
        case "none":
        case "unknown":
            return phase;
    }
    if (state === "idle") {
        return "none";
    }
    if (state === "unknown") {
        return "unknown";
    }
    return "unknown";
}

function normalizedConfidence(confidence: string | undefined, source: string): AgentStatusConfidence {
    switch (confidence) {
        case "high":
        case "medium":
        case "low":
            return confidence;
    }
    return source === "hook" ? "high" : "medium";
}

function numberValue(value: unknown): number | undefined {
    return typeof value === "number" && value > 0 ? value : undefined;
}

export function normalizeCanonicalAgentStatus(
    rawValue: RawCanonicalAgentStatus | null | undefined
): AgentStatus | null {
    const raw = rawValue;
    if (raw == null || typeof raw.blockId !== "string" || raw.blockId.trim() === "") {
        return null;
    }
    const source = typeof raw.source === "string" && raw.source.trim() !== "" ? raw.source.trim() : "hook";
    const state = normalizedState(typeof raw.state === "string" ? raw.state : undefined);
    const phase = normalizedPhase(typeof raw.phase === "string" ? raw.phase : undefined, state);
    const prevStateRaw = typeof raw.prevState === "string" ? raw.prevState.trim() : "";
    const prevState = prevStateRaw === "" ? undefined : prevStateRaw;
    return {
        blockId: raw.blockId.trim(),
        provider: typeof raw.provider === "string" && raw.provider.trim() !== "" ? raw.provider.trim() : "agent",
        sessionId: typeof raw.sessionId === "string" && raw.sessionId.trim() !== "" ? raw.sessionId.trim() : undefined,
        state,
        prevState,
        phase,
        source: source as AgentStatus["source"],
        confidence: normalizedConfidence(typeof raw.confidence === "string" ? raw.confidence : undefined, source),
        reason: typeof raw.reason === "string" && raw.reason.trim() !== "" ? raw.reason.trim() : undefined,
        message: typeof raw.message === "string" && raw.message.trim() !== "" ? raw.message.trim() : undefined,
        toolName: typeof raw.toolName === "string" && raw.toolName.trim() !== "" ? raw.toolName.trim() : undefined,
        updatedAt: numberValue(raw.updatedAt) ?? Date.now(),
        activeSince: numberValue(raw.activeSince),
        seq: numberValue(raw.seq),
        expiresAt: numberValue(raw.expiresAt),
    };
}
