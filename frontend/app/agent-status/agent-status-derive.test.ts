// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    AgentStaleThresholdMs,
    AgentThinkStaleThresholdMs,
    aggregateAgentStatuses,
    aggregateStatusLabel,
    agentStatusPresentation,
    applyStaleness,
    deriveAgentStatus,
    formatAgentProvider,
    isInferredAgentStatus,
    presentAgentStatus,
} from "./agent-status-derive";
import type { AgentStatus } from "./agent-status-types";

const now = 1_790_000_000_000;

function controllerStatus(status: string): BlockControllerRuntimeStatus {
    return {
        blockid: "block-agent",
        version: now - 10_000,
        shellprocstatus: status,
        shellprocexitcode: 0,
    };
}

describe("deriveAgentStatus", () => {
    it("does not infer working when the controller is running and the session updated recently", () => {
        const status = deriveAgentStatus({
            blockId: "block-agent",
            provider: "codex",
            sessionId: "session-1",
            controllerStatus: controllerStatus("running"),
            sessionUpdatedAtMs: now - 20_000,
            viewedAtMs: now - 60_000,
            nowMs: now,
        });

        expect(status).toMatchObject({
            state: "idle",
            phase: "none",
            source: "controller",
            confidence: "low",
            reason: "controller-running-without-explicit-agent-report",
        });
    });

    it("marks unseen recent session activity as done when the controller is not running", () => {
        const status = deriveAgentStatus({
            blockId: "block-agent",
            provider: "claude",
            sessionId: "session-1",
            controllerStatus: controllerStatus("done"),
            sessionUpdatedAtMs: now - 60_000,
            viewedAtMs: now - 120_000,
            nowMs: now,
        });

        expect(status).toMatchObject({
            state: "done",
            phase: "none",
            source: "session",
            confidence: "low",
        });
    });

    it("does not mark unseen session activity done while a long-running agent terminal is open", () => {
        const status = deriveAgentStatus({
            blockId: "block-agent",
            provider: "claude",
            sessionId: "session-1",
            controllerStatus: controllerStatus("running"),
            sessionUpdatedAtMs: now - 120_000,
            viewedAtMs: now - 180_000,
            nowMs: now,
        });

        expect(status).toMatchObject({
            state: "idle",
            phase: "none",
            source: "controller",
            confidence: "low",
            reason: "controller-running-without-explicit-agent-report",
        });
    });

    it("does not call a long-running agent working without recent activity", () => {
        const status = deriveAgentStatus({
            blockId: "block-agent",
            provider: "codex",
            controllerStatus: controllerStatus("running"),
            sessionUpdatedAtMs: now - 10 * 60_000,
            viewedAtMs: now - 11 * 60_000,
            nowMs: now,
        });

        expect(status).toMatchObject({
            state: "idle",
            source: "controller",
            reason: "controller-running-without-explicit-agent-report",
        });
    });

    it("returns unknown when no runtime or session signal exists", () => {
        const status = deriveAgentStatus({
            blockId: "block-agent",
            provider: "gemini",
            nowMs: now,
        });

        expect(status).toMatchObject({
            state: "unknown",
            phase: "unknown",
            reason: "no-status-data",
        });
    });
});

describe("presentAgentStatus", () => {
    it("uses canonical hook working status instead of runtime inference", () => {
        const canonical: AgentStatus = {
            blockId: "block-agent",
            provider: "codex",
            sessionId: "session-1",
            state: "working",
            phase: "tool",
            source: "hook",
            confidence: "high",
            reason: "explicit-report",
            toolName: "read",
            updatedAt: now - 1_000,
            activeSince: now - 5_000,
            seq: 20,
        };

        const status = presentAgentStatus({
            blockId: "block-agent",
            provider: "codex",
            sessionId: "session-1",
            canonicalStatus: canonical,
            controllerStatus: controllerStatus("running"),
            sessionUpdatedAtMs: now - 20_000,
            viewedAtMs: now - 60_000,
            nowMs: now,
        });

        expect(status).toMatchObject({
            state: "working",
            phase: "tool",
            source: "hook",
            confidence: "high",
            toolName: "read",
        });
    });

    it("presents canonical idle with unseen session activity as done", () => {
        const canonical: AgentStatus = {
            blockId: "block-agent",
            provider: "codex",
            sessionId: "session-1",
            state: "idle",
            phase: "none",
            source: "hook",
            confidence: "high",
            reason: "explicit-report",
            updatedAt: now - 1_000,
            activeSince: now - 60_000,
            seq: 21,
        };

        const status = presentAgentStatus({
            blockId: "block-agent",
            provider: "codex",
            sessionId: "session-1",
            canonicalStatus: canonical,
            controllerStatus: controllerStatus("running"),
            sessionUpdatedAtMs: now - 20_000,
            viewedAtMs: now - 60_000,
            nowMs: now,
        });

        expect(status).toMatchObject({
            state: "done",
            phase: "none",
            source: "session",
            confidence: "low",
            reason: "idle-with-unseen-session-update",
        });
    });
});

describe("aggregateAgentStatuses", () => {
    it("prioritizes working over done and idle", () => {
        const idle = deriveAgentStatus({
            blockId: "idle",
            provider: "codex",
            controllerStatus: controllerStatus("running"),
            nowMs: now,
        });
        const done = deriveAgentStatus({
            blockId: "done",
            provider: "claude",
            controllerStatus: controllerStatus("done"),
            sessionUpdatedAtMs: now - 60_000,
            viewedAtMs: now - 120_000,
            nowMs: now,
        });
        const working: AgentStatus = {
            blockId: "working",
            provider: "codex",
            state: "working",
            phase: "thinking",
            source: "hook",
            confidence: "high",
            reason: "explicit-report",
            updatedAt: now - 20_000,
            activeSince: now - 20_000,
        };

        const aggregate = aggregateAgentStatuses([idle, done, working]);

        expect(aggregate).toMatchObject({
            state: "working",
            count: 1,
            total: 3,
            inferredCount: 2,
        });
        expect(aggregateStatusLabel(aggregate)).toBe("1 working");
    });

    it("formats provider labels", () => {
        expect(formatAgentProvider("codex")).toBe("Codex");
        expect(formatAgentProvider("claude-code")).toBe("Claude");
        expect(formatAgentProvider("custom-agent")).toBe("Custom Agent");
    });

    it("labels opencode and pi providers", () => {
        expect(formatAgentProvider("opencode")).toBe("Opencode");
        expect(formatAgentProvider("open-code")).toBe("Opencode");
        expect(formatAgentProvider("pi")).toBe("Pi");
    });
});

describe("applyStaleness", () => {
    const working: AgentStatus = {
        blockId: "block-agent",
        provider: "pi",
        state: "working",
        phase: "thinking",
        source: "hook",
        confidence: "high",
        reason: "explicit-report",
        updatedAt: now - 1_000,
        activeSince: now - 1_000,
    };

    it("keeps a fresh working status unchanged", () => {
        const presented = applyStaleness(working, now);
        expect(presented).toBe(working);
        expect(presented.state).toBe("working");
    });

    it("decays a working thinking status past the think threshold to stale", () => {
        const old: AgentStatus = {
            ...working,
            updatedAt: now - AgentThinkStaleThresholdMs - 1_000,
            activeSince: now - AgentThinkStaleThresholdMs - 1_000,
        };
        const presented = applyStaleness(old, now);
        expect(presented.state).toBe("stale");
        expect(presented.phase).toBe("none");
        expect(presented.reason).toBe("explicit-report");
    });

    it("keeps a working tool status fresh past the think threshold", () => {
        // A long-running tool (4min, no renewal) must NOT flip to stale just
        // because the thinking threshold (2min) passed — tools get the wider
        // 5min window.
        const tool: AgentStatus = {
            ...working,
            phase: "tool",
            toolName: "bash",
            updatedAt: now - AgentThinkStaleThresholdMs - 60_000,
            activeSince: now - AgentThinkStaleThresholdMs - 60_000,
        };
        const presented = applyStaleness(tool, now);
        expect(presented.state).toBe("working");
        expect(presented.phase).toBe("tool");
    });

    it("decays a working tool status past the tool threshold to stale", () => {
        const tool: AgentStatus = {
            ...working,
            phase: "tool",
            updatedAt: now - AgentStaleThresholdMs - 1_000,
            activeSince: now - AgentStaleThresholdMs - 1_000,
        };
        expect(applyStaleness(tool, now).state).toBe("stale");
    });

    it("uses the wide threshold for non-thinking phases", () => {
        for (const phase of ["shell-command", "unknown", "none"] as const) {
            const status: AgentStatus = {
                ...working,
                phase,
                updatedAt: now - AgentThinkStaleThresholdMs - 60_000,
            };
            expect(applyStaleness(status, now).state).toBe("working");
        }
    });

    it("does not decay non-working states", () => {
        for (const state of ["blocked", "idle", "error", "rate-limited", "done", "unknown"] as const) {
            const status: AgentStatus = {
                ...working,
                state,
                updatedAt: now - AgentStaleThresholdMs - 60_000,
            };
            expect(applyStaleness(status, now).state).toBe(state);
        }
    });

    it("treats seconds-epoch updatedAt as seconds before comparing", () => {
        const secondsOld: AgentStatus = {
            ...working,
            updatedAt: Math.floor((now - AgentThinkStaleThresholdMs - 1_000) / 1000),
        };
        expect(applyStaleness(secondsOld, now).state).toBe("stale");
    });

    it("is applied by presentAgentStatus to a canonical working status", () => {
        const old: AgentStatus = {
            ...working,
            updatedAt: now - AgentThinkStaleThresholdMs - 1_000,
        };
        const status = presentAgentStatus({
            blockId: "block-agent",
            provider: "pi",
            canonicalStatus: old,
            controllerStatus: controllerStatus("running"),
            nowMs: now,
        });
        expect(status.state).toBe("stale");
    });
});

describe("error state presentation", () => {
    const base: AgentStatus = {
        blockId: "block-agent",
        provider: "pi",
        state: "error",
        phase: "unknown",
        source: "provider",
        confidence: "high",
        reason: "model-http-500",
        updatedAt: now,
    };

    it("presents error with a red warning icon and the reason in the title", () => {
        const p = agentStatusPresentation(base);
        expect(p.label).toBe("Error");
        expect(p.icon).toBe("triangle-exclamation");
        expect(p.title).toContain("model-http-500");
    });

    it("presents rate-limited separately", () => {
        const p = agentStatusPresentation({ ...base, state: "rate-limited", reason: "model-http-429" });
        expect(p.label).toBe("Rate limited");
    });

    it("does not mark provider-source reports as inferred", () => {
        expect(isInferredAgentStatus(base)).toBe(false);
    });

    it("aggregates error and rate-limited labels", () => {
        expect(aggregateStatusLabel(aggregateAgentStatuses([{ ...base, state: "error" }]))).toBe("1 error");
        expect(
            aggregateStatusLabel(aggregateAgentStatuses([{ ...base, state: "rate-limited" }]))
        ).toBe("1 rate limited");
    });
});
