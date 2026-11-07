// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    agentStatusViewLabel,
    deriveAgentStatusView,
    isAgentDoneAwaitingView,
} from "./agent-status-view";
import { statusFingerprint } from "./agent-status-unread";
import type { AgentStatus } from "./agent-status-types";

const now = 1_790_000_000_000;

function baseStatus(overrides: Partial<AgentStatus> = {}): AgentStatus {
    return {
        blockId: "block-agent",
        provider: "codex",
        sessionId: "session-1",
        state: "idle",
        phase: "none",
        source: "hook",
        confidence: "high",
        updatedAt: now,
        ...overrides,
    };
}

function doneStatus(overrides: Partial<AgentStatus> = {}): AgentStatus {
    return baseStatus({
        state: "done",
        prevState: "working",
        completedAt: now - 180_000,
        updatedAt: now - 180_000,
        ...overrides,
    });
}

describe("deriveAgentStatusView", () => {
    it("returns null for a block with no canonical status", () => {
        expect(deriveAgentStatusView({ status: null, nowMs: now })).toBeNull();
    });

    it("returns an unread Done with elapsed text right after completion", () => {
        const view = deriveAgentStatusView({ status: doneStatus(), nowMs: now })!;
        expect(view.state).toBe("done");
        expect(view.read).toBe("unread");
        expect(view.ackable).toBe(true);
        expect(view.elapsedText).toBe("3m");
        expect(agentStatusViewLabel(view)).toBe("Done 3m");
    });

    it("keeps Done unread when doneAckedAt is older than completedAt", () => {
        const view = deriveAgentStatusView({
            status: doneStatus(),
            doneAckedAt: now - 600_000,
            nowMs: now,
        })!;
        expect(view.read).toBe("unread");
    });

    it("turns Done into seen once acked, and drops the elapsed suffix", () => {
        const view = deriveAgentStatusView({
            status: doneStatus(),
            doneAckedAt: now - 60_000,
            nowMs: now,
        })!;
        expect(view.read).toBe("seen");
        expect(view.ackable).toBe(false);
        expect(view.elapsedText).toBe("");
        expect(agentStatusViewLabel(view)).toBe("Done");
        expect(view.title).toContain("up to date");
    });

    it("treats a 'looked at it' write (same doneAckedAt channel) as read", () => {
        // 切到 block 看够 2s 与点徽章写的是同一条通道，因此对 read 完全等价。
        const view = deriveAgentStatusView({ status: doneStatus(), doneAckedAt: now - 60_000, nowMs: now })!;
        expect(view.read).toBe("seen");
    });

    it("treats invalid doneAckedAt as never read", () => {
        const view = deriveAgentStatusView({
            status: doneStatus(),
            doneAckedAt: Number.NaN,
            nowMs: now,
        })!;
        expect(view.read).toBe("unread");
    });

    it("does not light a Done forever: an acked Done stays seen after the old 15m window", () => {
        const old = doneStatus({ completedAt: now - 6 * 3_600_000, updatedAt: now - 6 * 3_600_000 });
        expect(deriveAgentStatusView({ status: old, nowMs: now })!.read).toBe("unread");
        expect(deriveAgentStatusView({ status: old, doneAckedAt: now - 3_600_000, nowMs: now })!.read).toBe(
            "seen"
        );
    });

    it("does not treat a never-completed idle block as unread", () => {
        const view = deriveAgentStatusView({ status: baseStatus(), nowMs: now })!;
        expect(view.state).toBe("idle");
        expect(view.read).toBe("seen");
        expect(view.ackable).toBe(false);
    });

    it("does not treat unknown as unread", () => {
        const view = deriveAgentStatusView({
            status: baseStatus({ state: "unknown", phase: "unknown", source: "controller" }),
            nowMs: now,
        })!;
        expect(view.read).toBe("seen");
    });

    it("derives R-class read from the status fingerprint", () => {
        const working = baseStatus({ state: "working", phase: "tool", toolName: "bash", updatedAt: now });
        const fp = statusFingerprint(working);
        expect(deriveAgentStatusView({ status: working, nowMs: now })!.read).toBe("unread");
        expect(deriveAgentStatusView({ status: working, ackedFp: fp, nowMs: now })!.read).toBe("seen");
        expect(deriveAgentStatusView({ status: working, ackedFp: "stale-fp", nowMs: now })!.read).toBe(
            "unread"
        );
    });

    it("re-lights R-class when a new report arrives after the ack", () => {
        const working = baseStatus({ state: "working", phase: "thinking", updatedAt: now });
        const ackedFp = statusFingerprint(working);
        const next = { ...working, seq: 9, phase: "tool" as const, toolName: "read" };
        expect(deriveAgentStatusView({ status: next, ackedFp, nowMs: now })!.read).toBe("unread");
    });

    it("does not let an R-class ack silence a fresh Done", () => {
        // 卡片面历史上不写 fp：ackedFp 为 null 时 isAgentStatusUnread 恒 true。
        // Done 必须只认 D 类，否则会被 R 判定无条件点亮。
        const done = doneStatus();
        const view = deriveAgentStatusView({
            status: done,
            ackedFp: null,
            doneAckedAt: now - 60_000,
            nowMs: now,
        })!;
        expect(view.read).toBe("seen");
    });

    it("maps blocked / error / stale tones straight from state", () => {
        for (const state of ["blocked", "error", "rate-limited", "stale"] as const) {
            const view = deriveAgentStatusView({
                status: baseStatus({ state, updatedAt: now }),
                nowMs: now,
            })!;
            expect(view.tone).toBe(state);
            expect(view.read).toBe("unread");
            expect(view.ackable).toBe(true);
        }
    });

    it("marks inferred statuses and keeps the hint in the title", () => {
        const view = deriveAgentStatusView({
            status: baseStatus({ state: "working", source: "controller", phase: "thinking", updatedAt: now }),
            nowMs: now,
        })!;
        expect(view.inferred).toBe(true);
        expect(view.title).toContain("(inferred)");
    });

    it("only treats an unread Done as awaiting a look", () => {
        expect(isAgentDoneAwaitingView(deriveAgentStatusView({ status: doneStatus(), nowMs: now }))).toBe(true);
        expect(
            isAgentDoneAwaitingView(
                deriveAgentStatusView({ status: doneStatus(), doneAckedAt: now - 60_000, nowMs: now })
            )
        ).toBe(false);
        expect(
            isAgentDoneAwaitingView(
                deriveAgentStatusView({ status: baseStatus({ state: "working", updatedAt: now }), nowMs: now })
            )
        ).toBe(false);
        expect(isAgentDoneAwaitingView(null)).toBe(false);
    });

    it("keeps idle blocks without a completion transition in the acked visual", () => {
        const view = deriveAgentStatusView({ status: baseStatus(), ackedFp: "anything", nowMs: now })!;
        expect(view.read).toBe("seen");
        expect(agentStatusViewLabel(view)).toBe("Idle");
    });
});
