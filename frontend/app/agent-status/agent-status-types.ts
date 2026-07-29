// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export type AgentDisplayState = "blocked" | "working" | "done" | "idle" | "stale" | "unknown";

export type AgentPhase = "thinking" | "tool" | "shell-command" | "approval" | "none" | "unknown";

export type AgentStatusSource = "hook" | "screen" | "shell-integration" | "controller" | "session" | "manual";

export type AgentStatusConfidence = "high" | "medium" | "low";

export type AgentShellIntegrationSignal = {
    integration: boolean;
    state?: string;
    lastCommand?: string;
    lastCommandExitCode?: number | null;
    updatedAt: number;
};

export type AgentStatus = {
    blockId: string;
    provider: string;
    sessionId?: string;
    state: AgentDisplayState;
    // 完成跳变前的 state. canonical idle 状态会保留它, 供晚加载的 renderer 恢复 D.
    prevState?: string;
    phase: AgentPhase;
    source: AgentStatusSource;
    confidence: AgentStatusConfidence;
    reason?: string;
    message?: string;
    toolName?: string;
    updatedAt: number;
    completedAt?: number;
    activeSince?: number;
    seq?: number;
    expiresAt?: number;
};

export type AgentStatusAggregate = {
    state: AgentDisplayState;
    phase: AgentPhase;
    total: number;
    count: number;
    inferredCount: number;
};
