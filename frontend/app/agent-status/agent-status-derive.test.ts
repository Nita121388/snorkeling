// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    aggregateAgentStatuses,
    aggregateStatusLabel,
    deriveAgentStatus,
    formatAgentProvider,
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
});
