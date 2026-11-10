// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it } from "vitest";
import {
    clearPendingInput,
    computeInjectDecision,
    isPendingInputExpired,
    pendingInputCount,
    peekPendingInput,
    registerPendingInput,
    takePendingInput,
} from "./pending-input";

beforeEach(() => {
    clearPendingInput();
});

describe("pending-input registry", () => {
    it("registers, peeks and takes", () => {
        registerPendingInput("b1", "hello");
        expect(pendingInputCount()).toBe(1);
        expect(peekPendingInput("b1")?.text).toBe("hello");
        expect(takePendingInput("b1")).toBe("hello");
        expect(pendingInputCount()).toBe(0);
        expect(takePendingInput("b1")).toBeNull();
    });

    it("overwrites a previous registration for the same block", () => {
        registerPendingInput("b1", "first");
        registerPendingInput("b1", "second");
        expect(pendingInputCount()).toBe(1);
        expect(takePendingInput("b1")).toBe("second");
    });

    it("applies custom quiet/ttl options", () => {
        const entry = registerPendingInput("b1", "x", { quietMs: 100, ttlMs: 500 });
        expect(entry.quietMs).toBe(100);
        expect(entry.ttlMs).toBe(500);
        expect(peekPendingInput("b1")?.quietMs).toBe(100);
    });
});

describe("computeInjectDecision", () => {
    const t0 = 1_000_000;

    it("waits while no output has arrived after the baseline", () => {
        const entry = registerPendingInput("b1", "x", { now: () => t0 });
        expect(computeInjectDecision({ entry, baselineLastUpdated: 100, lastUpdated: 100, now: t0 + 5_000 }))
            .toEqual({ action: "wait" });
    });

    it("stays quiet after the first output until the quiet window passes", () => {
        const entry = registerPendingInput("b1", "x", { now: () => t0, quietMs: 600 });
        const firstOutput = t0 + 1_000;
        expect(computeInjectDecision({ entry, baselineLastUpdated: 100, lastUpdated: firstOutput, now: firstOutput + 300 }))
            .toEqual({ action: "quiet" });
        expect(computeInjectDecision({ entry, baselineLastUpdated: 100, lastUpdated: firstOutput, now: firstOutput + 600 }))
            .toEqual({ action: "inject" });
    });

    it("keeps waiting when new output keeps arriving (noisy TUI startup)", () => {
        const entry = registerPendingInput("b1", "x", { now: () => t0, quietMs: 600 });
        const out1 = t0 + 1_000;
        const out2 = out1 + 500;
        expect(computeInjectDecision({ entry, baselineLastUpdated: 100, lastUpdated: out2, now: out2 + 400 }))
            .toEqual({ action: "quiet" });
        expect(computeInjectDecision({ entry, baselineLastUpdated: 100, lastUpdated: out2, now: out2 + 600 }))
            .toEqual({ action: "inject" });
    });

    it("expires after the TTL even without output", () => {
        const entry = registerPendingInput("b1", "x", { now: () => t0, ttlMs: 1_000 });
        expect(computeInjectDecision({ entry, baselineLastUpdated: 100, lastUpdated: 100, now: t0 + 2_000 }))
            .toEqual({ action: "expire" });
        expect(isPendingInputExpired(entry, t0 + 1_000)).toBe(true);
        expect(isPendingInputExpired(entry, t0 + 999)).toBe(false);
    });

    it("quiet beats expire ordering: within quiet window but past ttl => expire", () => {
        const entry = registerPendingInput("b1", "x", { now: () => t0, quietMs: 600, ttlMs: 1_000 });
        const out = t0 + 100;
        expect(computeInjectDecision({ entry, baselineLastUpdated: 0, lastUpdated: out, now: t0 + 2_000 }))
            .toEqual({ action: "expire" });
    });
});
