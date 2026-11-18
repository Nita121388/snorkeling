// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// session-note-cache 的 origin 维度：
//   1. Summary RPC 必须带上 origin（外部 dump 会话靠它路由到正确的 manager）。
//   2. 缓存键必须含 origin：同一 id 在本机与 dump 两个 origin 下互不串台。
//   3. primeSessionNote 同样按 origin 隔离。
//
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    ensureSessionNote,
    getSessionNoteSnapshot,
    primeSessionNote,
    resetSessionNoteCache,
} from "./session-note-cache";
import type { AISessionsServiceType } from "@/app/store/services";

function makeSummary(sessionId: string, note: string, origin = ""): SessionSummary {
    return {
        key: `key-${sessionId}`,
        id: sessionId,
        source: "test",
        updatedAt: 0,
        messageCount: 1,
        note,
        origin,
    };
}

function makeMockService(): { service: AISessionsServiceType; summaryFn: ReturnType<typeof vi.fn> } {
    const summaryFn = vi.fn();
    const service = { Summary: summaryFn } as unknown as AISessionsServiceType;
    return { service, summaryFn };
}

describe("session-note-cache origin dimension", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        resetSessionNoteCache();
    });

    afterEach(() => {
        resetSessionNoteCache();
        vi.useRealTimers();
    });

    it("passes origin to the Summary request", async () => {
        const { service, summaryFn } = makeMockService();
        summaryFn.mockResolvedValue(makeSummary("sess-x", "note", "dump-x"));

        ensureSessionNote(service, "sess-x", "", "dump-x");
        expect(summaryFn).toHaveBeenCalledTimes(1);
        expect(summaryFn.mock.calls[0][0]).toMatchObject({ id: "sess-x", origin: "dump-x" });
        await vi.waitFor(() => {
            expect(getSessionNoteSnapshot("sess-x", "", "dump-x").status).toBe("loaded");
        });
    });

    it("isolates cache entries by origin for the same id", async () => {
        const { service, summaryFn } = makeMockService();
        summaryFn.mockImplementation((request) => {
            const origin = request.origin ?? "";
            return Promise.resolve(makeSummary("sess-dup", `note-${origin || "local"}`, origin));
        });

        ensureSessionNote(service, "sess-dup", "", "dump-x");
        ensureSessionNote(service, "sess-dup", "", "");
        expect(summaryFn).toHaveBeenCalledTimes(2);
        await vi.waitFor(() => {
            expect(getSessionNoteSnapshot("sess-dup", "", "dump-x").status).toBe("loaded");
            expect(getSessionNoteSnapshot("sess-dup", "", "").status).toBe("loaded");
        });
        expect(getSessionNoteSnapshot("sess-dup", "", "dump-x").summary?.note).toBe("note-dump-x");
        expect(getSessionNoteSnapshot("sess-dup", "", "").summary?.note).toBe("note-local");
    });

    it("primeSessionNote seeds the origin-scoped entry", () => {
        const summary = makeSummary("sess-prime", "primed", "dump-x");
        primeSessionNote("sess-prime", summary, "", "dump-x");
        const snapshot = getSessionNoteSnapshot("sess-prime", "", "dump-x");
        expect(snapshot.status).toBe("loaded");
        expect(snapshot.summary?.note).toBe("primed");
        // 本机 origin 下不得读到 dump 的条目。
        expect(getSessionNoteSnapshot("sess-prime", "", "").summary).toBeNull();
    });
});
