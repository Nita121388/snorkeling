// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { decideNotifyKind } from "./agent-status-notify";
import type { AgentStatus, AgentDisplayState } from "./agent-status-types";

function mkStatus(state: AgentDisplayState, blockId = "blk1", provider = "claude"): AgentStatus {
    return {
        blockId,
        provider,
        state,
        phase: "none",
        source: "hook",
        confidence: "high",
        updatedAt: 1,
    };
}

describe("decideNotifyKind", () => {
    it("fires 'done' on working → idle", () => {
        const next = mkStatus("idle");
        const prev = mkStatus("working");
        expect(decideNotifyKind(next, prev)).toBe("done");
    });

    it("fires 'done' on thinking → idle (any non-idle working band)", () => {
        const next = mkStatus("idle");
        const prev = mkStatus("thinking");
        expect(decideNotifyKind(next, prev)).toBe("done");
    });

    it("does NOT fire 'done' on blocked → idle (user just resumed)", () => {
        const next = mkStatus("idle");
        const prev = mkStatus("blocked");
        expect(decideNotifyKind(next, prev)).toBeNull();
    });

    it("does NOT fire 'done' on idle → idle (wobble)", () => {
        const next = mkStatus("idle");
        const prev = mkStatus("idle");
        expect(decideNotifyKind(next, prev)).toBeNull();
    });

    it("does NOT fire 'done' on stale → idle (prior was noise)", () => {
        const next = mkStatus("idle");
        const prev = mkStatus("stale");
        expect(decideNotifyKind(next, prev)).toBeNull();
    });

    it("does NOT fire 'done' on unknown → idle (prior was noise)", () => {
        const next = mkStatus("idle");
        const prev = mkStatus("unknown");
        expect(decideNotifyKind(next, prev)).toBeNull();
    });

    it("does NOT fire 'done' when prev is null (no prior working state observed)", () => {
        const next = mkStatus("idle");
        expect(decideNotifyKind(next, null)).toBeNull();
    });

    it("fires 'blocked' on working → blocked", () => {
        const next = mkStatus("blocked");
        const prev = mkStatus("working");
        expect(decideNotifyKind(next, prev)).toBe("blocked");
    });

    it("fires 'blocked' on idle → blocked regardless of prev", () => {
        const next = mkStatus("blocked");
        expect(decideNotifyKind(next, null)).toBe("blocked");
        expect(decideNotifyKind(next, mkStatus("idle"))).toBe("blocked");
        expect(decideNotifyKind(next, mkStatus("working"))).toBe("blocked");
    });

    it("does NOT fire 'blocked' on blocked → blocked", () => {
        const next = mkStatus("blocked");
        const prev = mkStatus("blocked");
        expect(decideNotifyKind(next, prev)).toBeNull();
    });

    it("does NOT fire on noise-class next (stale / unknown)", () => {
        expect(decideNotifyKind(mkStatus("stale"), mkStatus("working"))).toBeNull();
        expect(decideNotifyKind(mkStatus("unknown"), mkStatus("working"))).toBeNull();
    });

    it("does NOT fire when next is null", () => {
        expect(decideNotifyKind(null, mkStatus("working"))).toBeNull();
        expect(decideNotifyKind(null, null)).toBeNull();
    });

    it("does NOT fire on transitions within the working band (working → working)", () => {
        const next = mkStatus("working");
        const prev = mkStatus("working");
        expect(decideNotifyKind(next, prev)).toBeNull();
    });

    it("does NOT fire on working → thinking (mid-flight phase change, no toast)", () => {
        const next = mkStatus("thinking");
        const prev = mkStatus("working");
        expect(decideNotifyKind(next, prev)).toBeNull();
    });
});
