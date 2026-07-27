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

// Compact string "state|phase|source" that identifies the *meaningful* agent state
// independent of timestamps. Used as a fingerprint to detect real state changes
// that should re-light a previously-acked status indicator.
export type AgentStatusFp = `${string}|${string}|${string}`;

export function statusFingerprint(status: AgentStatus): AgentStatusFp {
	return `${status.state}|${status.phase}|${status.source}`;
}

/**
 * R-class "is this status unread (should re-light the indicator)?"
 *
 * Old behavior: compared `updatedAt` vs ackedAt timestamp → buggy because the backend
 * continuously sends fresh updatedAt timestamps on the same blocked state, causing
 * acked indicators to re-light unpredictably.
 *
 * New behavior: compare a state fingerprint (state|phase|source). Only re-light when
 * the *meaningful* agent state has actually changed since the last ack.
 *
 * @param status current agent status
 * @param ackedFp the fingerprint at the moment the user acked, or null if never acked
 */
export function isAgentStatusUnread(status: AgentStatus, ackedFp: AgentStatusFp | null): boolean {
	const currentFp = statusFingerprint(status);
	if (ackedFp == null) return true;
	return currentFp !== ackedFp;
}