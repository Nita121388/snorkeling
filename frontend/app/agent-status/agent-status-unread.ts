// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { AgentStatus } from "@/app/agent-status/agent-status-types";

// Normalize an epoch-ms or epoch-seconds timestamp to epoch-ms. Returns 0 for falsy/invalid.
// Shared between Session Overview ack (chip淡化判定) and the agent block header ack
// (`term-model.getAgentStatusHeaderElem`) so both surfaces judge `status.updatedAt`
// against `agentStatusAckedAt` with the same conversion.
export function normalizeTimeMs(timestamp: number | null | undefined): number {
    if (!timestamp) return 0;
    return timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
}

export type AgentStatusFp = string;

export function statusFingerprint(status: AgentStatus): AgentStatusFp {
    return JSON.stringify([
        "v2",
        status.provider,
        status.sessionId ?? "",
        status.source,
        status.seq ?? "",
        status.state,
        status.phase,
        status.toolName ?? "",
    ]);
}

/**
 * R-class "is this status unread (should re-light the indicator)?"
 *
 * Compare the canonical event revision. A duplicate event stays read, while a new
 * report re-lights even when state, phase, and source remain unchanged.
 *
 * @param status current agent status
 * @param ackedFp the fingerprint at the moment the user acked, or null if never acked
 */
export function isAgentStatusUnread(status: AgentStatus, ackedFp: AgentStatusFp | null): boolean {
    const currentFp = statusFingerprint(status);
    if (ackedFp == null) return true;
    return currentFp !== ackedFp;
}
