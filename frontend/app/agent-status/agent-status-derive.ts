// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type {
    AgentDisplayState,
    AgentPhase,
    AgentStatus,
    AgentStatusAggregate,
    AgentStatusConfidence,
} from "./agent-status-types";
import { normalizeTimeMs } from "@/app/agent-status/agent-status-unread";

const DoneSessionActivityMs = 15 * 60_000;

// Watchdog thresholds: a working agent that has not renewed its report within
// its phase's window is considered stuck. Mirrors the backend working TTLs so
// the live view flips to stale at the same time the backend decays the source.
//
// thinking = waiting on the model: silence here is almost always a hang, so
// the window is short (2min). tool / shell-command = a tool is running, which
// can legitimately take a long time (build, test), so the window stays wide
// (5min) to avoid false-stale.
export const AgentStaleThresholdMs = 5 * 60_000;
export const AgentThinkStaleThresholdMs = 2 * 60_000;

type DeriveAgentStatusInput = {
    blockId: string;
    provider?: string | null;
    sessionId?: string | null;
    controllerStatus?: BlockControllerRuntimeStatus | null;
    sessionUpdatedAtMs?: number;
    viewedAtMs?: number;
    nowMs: number;
};

type PresentAgentStatusInput = DeriveAgentStatusInput & {
    canonicalStatus?: AgentStatus | null;
};

type AgentStatusPresentation = {
    label: string;
    title: string;
    icon: string;
};

const stateRank: Record<AgentDisplayState, number> = {
    unknown: 0,
    idle: 1,
    stale: 2,
    done: 3,
    working: 4,
    blocked: 5,
    error: 5,
    "rate-limited": 5,
};

const workingPhaseRank: Record<AgentPhase, number> = {
    none: 0,
    unknown: 1,
    "shell-command": 2,
    thinking: 3,
    tool: 4,
    approval: 5,
};

function normalizeProvider(provider?: string | null): string {
    const normalized = provider?.trim().toLowerCase() ?? "";
    return normalized || "agent";
}

function isControllerRunning(status?: BlockControllerRuntimeStatus | null): boolean {
    return status?.shellprocstatus === "running";
}

function hasUnseenSessionActivity(sessionUpdatedAtMs: number, viewedAtMs: number): boolean {
    return sessionUpdatedAtMs > 0 && sessionUpdatedAtMs > viewedAtMs;
}

function isRecentEnoughForDone(sessionUpdatedAtMs: number, nowMs: number): boolean {
    return sessionUpdatedAtMs > 0 && nowMs - sessionUpdatedAtMs <= DoneSessionActivityMs;
}

export function deriveAgentStatus(input: DeriveAgentStatusInput): AgentStatus {
    const provider = normalizeProvider(input.provider);
    const sessionId = input.sessionId?.trim() || undefined;
    const sessionUpdatedAtMs = input.sessionUpdatedAtMs ?? 0;
    const viewedAtMs = input.viewedAtMs ?? 0;
    const controllerRunning = isControllerRunning(input.controllerStatus);
    const hasSessionActivity = sessionUpdatedAtMs > 0;
    const unseenSessionActivity = hasUnseenSessionActivity(sessionUpdatedAtMs, viewedAtMs);
    const recentDoneActivity = isRecentEnoughForDone(sessionUpdatedAtMs, input.nowMs);

    if (controllerRunning) {
        return {
            blockId: input.blockId,
            provider,
            sessionId,
            state: "idle",
            phase: "none",
            source: "controller",
            confidence: "low",
            reason: hasSessionActivity
                ? "controller-running-without-explicit-agent-report"
                : "no-explicit-agent-report",
            updatedAt: input.controllerStatus?.version ?? input.nowMs,
        };
    }

    if (unseenSessionActivity && recentDoneActivity) {
        return {
            blockId: input.blockId,
            provider,
            sessionId,
            state: "done",
            phase: "none",
            source: "session",
            confidence: "low",
            reason: "unseen-session-update",
            updatedAt: sessionUpdatedAtMs,
            activeSince: sessionUpdatedAtMs,
        };
    }

    if (hasSessionActivity) {
        return {
            blockId: input.blockId,
            provider,
            sessionId,
            state: "idle",
            phase: "none",
            source: "session",
            confidence: "low",
            reason: "session-seen-or-old",
            updatedAt: sessionUpdatedAtMs,
        };
    }

    return {
        blockId: input.blockId,
        provider,
        sessionId,
        state: "unknown",
        phase: "unknown",
        source: "controller",
        confidence: "low",
        reason: "no-status-data",
        updatedAt: input.controllerStatus?.version ?? input.nowMs,
    };
}

export function presentAgentStatus(input: PresentAgentStatusInput): AgentStatus {
    const canonicalStatus = input.canonicalStatus;
    const sessionUpdatedAtMs = input.sessionUpdatedAtMs ?? 0;
    const viewedAtMs = input.viewedAtMs ?? 0;
    const unseenSessionActivity = hasUnseenSessionActivity(sessionUpdatedAtMs, viewedAtMs);
    const recentDoneActivity = isRecentEnoughForDone(sessionUpdatedAtMs, input.nowMs);
    if (canonicalStatus != null) {
        const provider = normalizeProvider(canonicalStatus.provider || input.provider);
        const sessionId = canonicalStatus.sessionId?.trim() || input.sessionId?.trim() || undefined;
        if (canonicalStatus.state === "idle" && unseenSessionActivity && recentDoneActivity) {
            return {
                ...canonicalStatus,
                provider,
                sessionId,
                state: "done",
                phase: "none",
                source: "session",
                confidence: "low",
                reason: "idle-with-unseen-session-update",
                updatedAt: Math.max(canonicalStatus.updatedAt ?? 0, sessionUpdatedAtMs),
                activeSince: sessionUpdatedAtMs,
            };
        }
        return applyStaleness({ ...canonicalStatus, provider, sessionId }, input.nowMs);
    }
    return deriveAgentStatus(input);
}

function statusSortValue(status: AgentStatus): number {
    let value = stateRank[status.state] * 10;
    if (status.state === "working") {
        value += workingPhaseRank[status.phase] ?? 0;
    }
    return value;
}

export function aggregateAgentStatuses(statuses: AgentStatus[]): AgentStatusAggregate {
    const total = statuses.length;
    if (total === 0) {
        return {
            state: "unknown",
            phase: "unknown",
            total: 0,
            count: 0,
            inferredCount: 0,
        };
    }

    let top = statuses[0];
    for (const status of statuses.slice(1)) {
        if (statusSortValue(status) > statusSortValue(top)) {
            top = status;
        }
    }

    return {
        state: top.state,
        phase: top.phase,
        total,
        count: statuses.filter((status) => status.state === top.state).length,
        inferredCount: statuses.filter((status) => isInferredAgentStatus(status)).length,
    };
}

export function isInferredAgentStatus(status: AgentStatus): boolean {
    // "hook"/"provider"/"manual"/"screen" are real agent reports (direct hook
    // calls, agent-extension reports, user input, terminal sniffing); only the
    // derived sources are inferences from runtime/session signals.
    return status.source === "controller" || status.source === "session" || status.source === "shell-integration";
}

/**
 * Watchdog presentation: a working status whose last report is older than its
 * phase's staleness threshold is presented as "stale" (stuck) instead of
 * spinning forever. Only working decays — blocked is actionable (waiting on
 * the user) and error/rate-limited self-clear via their short TTLs.
 */
export function applyStaleness(status: AgentStatus, nowMs: number): AgentStatus {
    if (status.state !== "working") {
        return status;
    }
    const updatedAtMs = normalizeTimeMs(status.updatedAt);
    const threshold = status.phase === "thinking" ? AgentThinkStaleThresholdMs : AgentStaleThresholdMs;
    if (nowMs - updatedAtMs <= threshold) {
        return status;
    }
    return {
        ...status,
        state: "stale",
        phase: "none",
        reason: status.reason ?? "no-update-timeout",
    };
}

export function formatAgentProvider(provider: string): string {
    const normalized = normalizeProvider(provider);
    switch (normalized) {
        case "claude":
        case "claude-code":
            return "Claude";
        case "codex":
            return "Codex";
        case "gemini":
            return "Gemini";
        case "opencode":
        case "open-code":
            return "Opencode";
        case "pi":
            return "Pi";
        default:
            return normalized
                .split(/[-_\s]+/)
                .filter(Boolean)
                .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
                .join(" ");
    }
}

export function agentStatusPresentation(status: AgentStatus): AgentStatusPresentation {
    const inferred = isInferredAgentStatus(status);
    const titleSuffix = `${inferred ? " (inferred)" : ""}${status.reason ? `: ${status.reason}` : ""}`;
    switch (status.state) {
        case "blocked":
            return {
                label: "Blocked",
                title: `Blocked${titleSuffix}`,
                icon: "circle-exclamation",
            };
        case "error":
            return {
                label: "Error",
                title: `Error${titleSuffix}`,
                icon: "triangle-exclamation",
            };
        case "rate-limited":
            return {
                label: "Rate limited",
                title: `Rate limited${titleSuffix}`,
                icon: "gauge-high",
            };
        case "working": {
            const label =
                status.phase === "tool"
                    ? status.toolName
                        ? `Tool: ${status.toolName}`
                        : "Tools"
                    : status.phase === "thinking"
                      ? "Thinking"
                      : "Working";
            return {
                label,
                title: `${label}${titleSuffix}`,
                icon: status.phase === "tool" ? "screwdriver-wrench" : "sparkles",
            };
        }
        case "done":
            return {
                label: "Done",
                title: `Done${titleSuffix}`,
                icon: "circle-check",
            };
        case "idle":
            return {
                label: "Idle",
                title: `Idle${titleSuffix}`,
                icon: "circle",
            };
        case "stale":
            return {
                label: "Stale",
                title: `Stale${titleSuffix}`,
                icon: "clock-rotate-left",
            };
        case "unknown":
            return {
                label: "No data",
                title: `No data${titleSuffix}`,
                icon: "circle-question",
            };
    }
}

export function aggregateStatusLabel(aggregate: AgentStatusAggregate): string {
    if (aggregate.total === 0) {
        return "no agents";
    }
    switch (aggregate.state) {
        case "blocked":
            return `${aggregate.count} blocked`;
        case "error":
            return `${aggregate.count} error`;
        case "rate-limited":
            return `${aggregate.count} rate limited`;
        case "working":
            return `${aggregate.count} working`;
        case "done":
            return `${aggregate.count} done`;
        case "idle":
            return "agents idle";
        case "stale":
            return `${aggregate.count} stale`;
        case "unknown":
            return "no data";
    }
}

export type { AgentDisplayState, AgentPhase, AgentStatusConfidence };
