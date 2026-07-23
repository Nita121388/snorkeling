// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { agentDoneElapsedMs, formatDoneElapsed, isAgentDoneUnread } from "./agent-status-done-unread";
import type { AgentStatus } from "./agent-status-types";

const now = 1_790_000_000_000;

function baseStatus(overrides: Partial<AgentStatus> = {}): AgentStatus {
    return {
        blockId: "block-agent",
        provider: "codex",
        state: "idle",
        phase: "none",
        source: "hook",
        confidence: "high",
        updatedAt: now - 60_000,
        ...overrides,
    };
}

describe("isAgentDoneUnread", () => {
    it("lights D when prevState is non-idle and current state is idle", () => {
        const status = baseStatus({ prevState: "working" });
        expect(isAgentDoneUnread(status, 0)).toBe(true);
    });

    it("lights D when prevState was blocked", () => {
        const status = baseStatus({ prevState: "blocked" });
        expect(isAgentDoneUnread(status, 0)).toBe(true);
    });

    it("does not light D when prevState is missing (initial GetAgentStatus)", () => {
        const status = baseStatus({ prevState: undefined });
        expect(isAgentDoneUnread(status, 0)).toBe(false);
    });

    it("does not light D when prevState was idle (no transition)", () => {
        const status = baseStatus({ prevState: "idle" });
        expect(isAgentDoneUnread(status, 0)).toBe(false);
    });

    it("does not light D when prevState was unknown", () => {
        const status = baseStatus({ prevState: "unknown" });
        expect(isAgentDoneUnread(status, 0)).toBe(false);
    });

    it("does not light D when current state is not idle (still working)", () => {
        const status = baseStatus({ state: "working", prevState: "idle" });
        expect(isAgentDoneUnread(status, 0)).toBe(false);
    });

    it("treats null status as not unread", () => {
        expect(isAgentDoneUnread(null, 0)).toBe(false);
    });

    it("ack timestamp newer than updatedAt suppresses D", () => {
        const status = baseStatus({ prevState: "working" });
        // ack 10s after updatedAt → 已阅
        expect(isAgentDoneUnread(status, now - 60_000 + 10_000)).toBe(false);
    });

    it("ack timestamp older than updatedAt still lights D", () => {
        const status = baseStatus({ prevState: "working" });
        // ack before the transition → 未阅
        expect(isAgentDoneUnread(status, now - 120_000)).toBe(true);
    });

    it("zero updatedAt is treated as not unread", () => {
        const status = baseStatus({ updatedAt: 0, prevState: "working" });
        expect(isAgentDoneUnread(status, 0)).toBe(false);
    });
});

describe("agentDoneElapsedMs", () => {
    it("returns referenceMs - updatedAt", () => {
        const status = baseStatus({ updatedAt: now - 60_000 });
        expect(agentDoneElapsedMs(status, now)).toBe(60_000);
    });

    it("clamps to 0 when updatedAt is in the future", () => {
        const status = baseStatus({ updatedAt: now + 5_000 });
        expect(agentDoneElapsedMs(status, now)).toBe(0);
    });

    it("returns 0 when status is null", () => {
        expect(agentDoneElapsedMs(null, now)).toBe(0);
    });

    it("normalizes epoch-seconds updatedAt to ms", () => {
        const status = baseStatus({ updatedAt: (now - 60_000) / 1000 });
        expect(agentDoneElapsedMs(status, now)).toBe(60_000);
    });
});

describe("formatDoneElapsed", () => {
    it("returns 'Just now' for elapsed < 30s", () => {
        expect(formatDoneElapsed(0)).toBe("Just now");
        expect(formatDoneElapsed(10_000)).toBe("Just now");
        expect(formatDoneElapsed(29_999)).toBe("Just now");
    });

    it("returns seconds for elapsed < 60s (≥ 30s)", () => {
        expect(formatDoneElapsed(30_000)).toBe("30s");
        expect(formatDoneElapsed(59_999)).toBe("60s");
    });

    it("returns minutes for elapsed < 1h", () => {
        expect(formatDoneElapsed(60_000)).toBe("1m");
        expect(formatDoneElapsed(10 * 60_000)).toBe("10m");
        expect(formatDoneElapsed(59 * 60_000 + 59_999)).toBe("59m");
    });

    it("returns hours for elapsed < 24h", () => {
        expect(formatDoneElapsed(60 * 60_000)).toBe("1h");
        expect(formatDoneElapsed(2 * 60 * 60_000)).toBe("2h");
        expect(formatDoneElapsed(23 * 60 * 60_000 + 59_999)).toBe("23h");
    });

    it("returns days for elapsed ≥ 24h", () => {
        expect(formatDoneElapsed(24 * 60 * 60_000)).toBe("1d");
        expect(formatDoneElapsed(3 * 24 * 60 * 60_000)).toBe("3d");
    });
});
