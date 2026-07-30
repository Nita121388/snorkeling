// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AgentStatus } from "./agent-status-types";
import { isAgentStatusUnread, statusFingerprint } from "./agent-status-unread";

function makeStatus(overrides: Partial<AgentStatus> = {}): AgentStatus {
    return {
        blockId: "block-1",
        provider: "codex",
        sessionId: "session-1",
        state: "working",
        phase: "tool",
        source: "hook",
        confidence: "high",
        toolName: "shell_command",
        updatedAt: 1_000,
        seq: 101,
        ...overrides,
    };
}

describe("agent status unread", () => {
    it("keeps the exact acknowledged event read", () => {
        const status = makeStatus();

        expect(isAgentStatusUnread(status, statusFingerprint(status))).toBe(false);
    });

    it("re-lights a new working event with the same state, phase, and source", () => {
        const acknowledged = makeStatus({ seq: 101 });
        const next = makeStatus({ seq: 102, updatedAt: 2_000 });

        expect(isAgentStatusUnread(next, statusFingerprint(acknowledged))).toBe(true);
    });

    it("re-lights a consecutive blocked event with a new sequence", () => {
        const acknowledged = makeStatus({ state: "blocked", phase: "approval", seq: 201 });
        const next = makeStatus({ state: "blocked", phase: "approval", seq: 202, updatedAt: 2_000 });

        expect(isAgentStatusUnread(next, statusFingerprint(acknowledged))).toBe(true);
    });

    it("does not re-light a duplicate event with the same sequence", () => {
        const acknowledged = makeStatus({ state: "blocked", phase: "approval", seq: 201 });
        const duplicate = makeStatus({ state: "blocked", phase: "approval", seq: 201, updatedAt: 2_000 });

        expect(isAgentStatusUnread(duplicate, statusFingerprint(acknowledged))).toBe(false);
    });

    it("does not re-light an unsequenced duplicate only because its timestamp changed", () => {
        const acknowledged = makeStatus({ state: "blocked", phase: "approval", seq: undefined });
        const duplicate = makeStatus({
            state: "blocked",
            phase: "approval",
            seq: undefined,
            updatedAt: 2_000,
        });

        expect(isAgentStatusUnread(duplicate, statusFingerprint(acknowledged))).toBe(false);
    });

    it("re-lights an unsequenced working event when its semantic content changes", () => {
        const acknowledged = makeStatus({ seq: undefined, toolName: "read" });
        const next = makeStatus({ seq: undefined, toolName: "shell_command", updatedAt: 2_000 });

        expect(isAgentStatusUnread(next, statusFingerprint(acknowledged))).toBe(true);
    });
});
