// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// AgentRuntimeMetadataStore TTL / composite key / failure semantics (G2 red).
//
// design.md §4.2 requires:
//   - the cache key is blockId|sessionId|source, so changing the session or
//     provider invalidates immediately;
//   - one RPC per composite key within the 5s success TTL (10 mounts →
//     rpc_calls=1/1 PASS);
//   - only a successful model resolution stamps loadedAt. A failure / empty
//     result records lastAttemptAt instead, so the next open retries
//     (failure_not_cached PASS).
//
// The current store keys on blockId only, has no TTL, and stamps loadedAt on
// failure, so all three behaviours are red until the fix lands. Each test
// re-imports the module so its module-level Map state starts clean.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { liveSessionStateMock } = vi.hoisted(() => ({ liveSessionStateMock: vi.fn() }));

vi.mock("@/app/store/services", () => ({
    AISessionsService: {
        LiveSessionState: (...args: unknown[]) => liveSessionStateMock(...args),
    },
}));

type StoreModule = typeof import("./agent-runtime-metadata-store");

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function loadStore(): Promise<StoreModule> {
    vi.resetModules();
    return (await import("./agent-runtime-metadata-store")) as StoreModule;
}

beforeEach(() => {
    liveSessionStateMock.mockReset();
});

afterEach(() => {
    vi.clearAllTimers();
});

describe("agent-runtime-metadata-store", () => {
    it("dedupes 10 mounts to 1 RPC within the TTL (rpc_calls=1/1 PASS)", async () => {
        const store = await loadStore();
        liveSessionStateMock.mockResolvedValue({
            live: true,
            modelProvider: "magpie",
            modelId: "mydeepseek/kimi-k3",
            modelName: "mydeepseek/kimi-k3",
            thinkingLevel: "medium",
        });

        for (let i = 0; i < 10; i++) {
            store.ensureAgentRuntimeMetadata("block-1", "session-1", "pi");
            await flush();
        }

        const calls = liveSessionStateMock.mock.calls.length;
        // eslint-disable-next-line no-console
        console.log(`rpc_calls=${calls}/1 ${calls === 1 ? "PASS" : "FAIL"}`);
        expect(calls).toBe(1);
        const entry = store.getAgentRuntimeMetadataSnapshot("block-1");
        expect(entry?.model).toBe("mydeepseek/kimi-k3");
        expect(entry?.provider).toBe("magpie");
        expect(entry?.loadedAt).toBeGreaterThan(0);
    });

    it("composite key invalidates when the session changes", async () => {
        const store = await loadStore();
        liveSessionStateMock.mockResolvedValue({
            live: true,
            modelProvider: "magpie",
            modelId: "mydeepseek/kimi-k3",
            modelName: "mydeepseek/kimi-k3",
        });

        store.ensureAgentRuntimeMetadata("block-1", "session-a", "pi");
        await flush();
        expect(liveSessionStateMock).toHaveBeenCalledTimes(1);

        // Same block, different session within the TTL: must NOT be served from
        // the previous session's cache (model bleed between sessions is the bug).
        store.ensureAgentRuntimeMetadata("block-1", "session-b", "pi");
        await flush();
        expect(liveSessionStateMock).toHaveBeenCalledTimes(2);
        expect(liveSessionStateMock.mock.calls[1]?.[0]).toMatchObject({ sessionId: "session-b" });

        // Same block+session but a different source is also a different key.
        store.ensureAgentRuntimeMetadata("block-1", "session-b", "codex");
        await flush();
        expect(liveSessionStateMock).toHaveBeenCalledTimes(3);
    });

    it("a failure does not stamp loadedAt and the next open retries (failure_not_cached PASS)", async () => {
        const store = await loadStore();
        liveSessionStateMock.mockRejectedValueOnce(new Error("rpc unavailable"));

        store.ensureAgentRuntimeMetadata("block-2", "session-2", "pi");
        await flush();

        const afterFailure = store.getAgentRuntimeMetadataSnapshot("block-2");
        const cachedOnFailure = afterFailure?.loadedAt != null && afterFailure.loadedAt > 0;
        // eslint-disable-next-line no-console
        console.log(`failure_not_cached ${cachedOnFailure ? "FAIL" : "PASS"}`);
        expect(cachedOnFailure).toBe(false);

        // Retry must reach the backend again (no TTL blocked by the failed attempt).
        liveSessionStateMock.mockResolvedValueOnce({
            live: true,
            modelProvider: "magpie",
            modelId: "mydeepseek/kimi-k3",
            modelName: "mydeepseek/kimi-k3",
        });
        store.ensureAgentRuntimeMetadata("block-2", "session-2", "pi");
        await flush();
        expect(liveSessionStateMock).toHaveBeenCalledTimes(2);
        expect(store.getAgentRuntimeMetadataSnapshot("block-2")?.model).toBe("mydeepseek/kimi-k3");
    });
});
