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
    // 上一帧的 state. 仅由 agentstatus 事件 emit 时附带 (见 pkg/agentstatus/agentstatus.go
    // attachPrevState); GetAgentStatus 主动拉取不带 (没有"上一帧"概念), 留空.
    // 用于判别"非 idle → idle"跳变, 即完成态 D 信号的事件层依据 (决策 1).
    prevState?: string;
    phase: AgentPhase;
    source: AgentStatusSource;
    confidence: AgentStatusConfidence;
    reason?: string;
    message?: string;
    toolName?: string;
    updatedAt: number;
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
