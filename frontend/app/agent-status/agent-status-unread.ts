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

// Is the agent's current status newer than what the user last acked ("marked as read")?
// idle/unknown never count as unread — there's nothing to dismiss. A state cycle like
// blocked → idle → blocked refreshes status.updatedAt, so the chip lights up again as
// "new" — matching the "state changed since you last looked" intent.
export function isAgentStatusUnread(status: AgentStatus, ackedAt: number): boolean {
    if (status.state === "idle" || status.state === "unknown") return false;
    const statusUpdatedAt = normalizeTimeMs(status.updatedAt);
    if (statusUpdatedAt <= 0) return false;
    return statusUpdatedAt > ackedAt;
}
