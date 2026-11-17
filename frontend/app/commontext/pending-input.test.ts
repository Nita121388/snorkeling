// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    clearPendingInput,
    computeInjectDecision,
    getPendingMountTabIds,
    isPendingInputExpired,
    mountPendingInputTab,
    pendingInputCount,
    pendingInputTabCount,
    peekPendingInput,
    pruneExpiredPendingInputTabs,
    prunePendingInputTabs,
    registerPendingInput,
    subscribePendingInput,
    takePendingInput,
    unmountPendingInputTab,
    unmountPendingInputTabByBlock,
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

describe("pending Tab hidden-mount queue", () => {
    it("mounts, dedupes and moves an existing tab to the tail (FIFO)", () => {
        mountPendingInputTab("t1", "b1");
        mountPendingInputTab("t2", "b2");
        expect(getPendingMountTabIds()).toEqual(["t1", "t2"]);
        mountPendingInputTab("t1", "b1");
        expect(getPendingMountTabIds()).toEqual(["t2", "t1"]);
    });

    it("caps the exposed mount list but keeps the rest queued", () => {
        for (const [tabId, blockId] of [["t1", "b1"], ["t2", "b2"], ["t3", "b3"]] as const) {
            registerPendingInput(blockId, "x");
            mountPendingInputTab(tabId, blockId);
        }
        expect(getPendingMountTabIds()).toEqual(["t1", "t2"]);
        expect(pendingInputTabCount()).toBe(3);
        unmountPendingInputTab("t1");
        expect(getPendingMountTabIds()).toEqual(["t2", "t3"]);
    });

    it("unmounts by block (inject/expire path) and ignores unknown ids", () => {
        registerPendingInput("b1", "x");
        registerPendingInput("b2", "y");
        mountPendingInputTab("t1", "b1");
        mountPendingInputTab("t2", "b2");
        unmountPendingInputTabByBlock("b1");
        expect(getPendingMountTabIds()).toEqual(["t2"]);
        unmountPendingInputTabByBlock("nope");
        expect(pendingInputTabCount()).toBe(1);
        unmountPendingInputTab("nope");
        expect(pendingInputTabCount()).toBe(1);
    });

    it("prunes tabs that no longer exist in the workspace or lost their pending input", () => {
        registerPendingInput("b1", "x");
        registerPendingInput("b2", "y");
        mountPendingInputTab("t1", "b1");
        mountPendingInputTab("t2", "b2");
        prunePendingInputTabs(["t1"]); // t2 已被关闭 / 从 workspace 消失
        expect(getPendingMountTabIds()).toEqual(["t1"]);
        takePendingInput("b1"); // 已注入但 unmountByBlock 还没跑：自愈移除
        prunePendingInputTabs(["t1"]);
        expect(getPendingMountTabIds()).toEqual([]);
    });

    it("hard-expires a pending tab even when the inject path never runs (block deleted)", () => {
        const t0 = 1_000_000;
        const entry = registerPendingInput("b1", "x", { now: () => t0, ttlMs: 1_000 });
        mountPendingInputTab("t1", "b1");
        expect(getPendingMountTabIds()).toEqual(["t1"]);
        pruneExpiredPendingInputTabs(entry.registeredAt + entry.ttlMs + 4_999);
        expect(getPendingMountTabIds()).toEqual(["t1"]);
        pruneExpiredPendingInputTabs(entry.registeredAt + entry.ttlMs + 5_000);
        expect(getPendingMountTabIds()).toEqual([]);
    });

    it("notifies subscribers on register/take/mount/unmount and stops after unsubscribe", () => {
        let calls = 0;
        const unsubscribe = subscribePendingInput(() => {
            calls++;
        });
        registerPendingInput("b1", "x");
        mountPendingInputTab("t1", "b1");
        takePendingInput("b1");
        unmountPendingInputTab("t1");
        expect(calls).toBe(4);
        unsubscribe();
        registerPendingInput("b2", "y");
        expect(calls).toBe(4);
    });

    it("keeps a throwing listener from breaking the others", () => {
        let good = 0;
        const offBad = subscribePendingInput(() => {
            throw new Error("boom");
        });
        const offGood = subscribePendingInput(() => {
            good++;
        });
        expect(() => registerPendingInput("b1", "x")).not.toThrow();
        expect(good).toBe(1);
        offBad();
        offGood();
    });

    it("applies the verify-only runtime override when no explicit options are passed", () => {
        vi.stubGlobal("window", {});
        try {
            (window as any).__snorkelingPendingInputOverride = { ttlMs: 1234, quietMs: 42 };
            const entry = registerPendingInput("b1", "x");
            expect(entry.ttlMs).toBe(1234);
            expect(entry.quietMs).toBe(42);
            const explicit = registerPendingInput("b2", "y", { ttlMs: 7 });
            expect(explicit.ttlMs).toBe(7);
        } finally {
            vi.unstubAllGlobals();
        }
    });
});
