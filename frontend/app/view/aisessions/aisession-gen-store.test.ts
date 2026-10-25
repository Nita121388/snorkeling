// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AISessionsServiceType } from "@/app/store/services";
import { autoGenerate, getBatchGenCounts, getGenSnapshot, genCacheKey } from "./aisession-gen-store";

function fakeService(impl: Partial<AISessionsServiceType>): AISessionsServiceType {
    return impl as unknown as AISessionsServiceType;
}

describe("aisession-gen-store", () => {
    it("keys include the connection so remote/local never collide", () => {
        expect(genCacheKey("", "s1", "title")).toBe("|s1|title");
        expect(genCacheKey("ssh:a", "s1", "title")).toBe("ssh:a|s1|title");
    });

    it("records skipped sessions as failed with the reason", async () => {
        const key = "skip-test";
        const service = fakeService({
            AutoGenerate: async () => ({ queued: [], skipped: [{ id: key, reason: "user-title" }], errors: [] }),
        });
        const result = await autoGenerate(service, { ids: [key], kind: "title" });
        expect(result.ok).toBe(true);
        const snapshot = getGenSnapshot("", key, "title");
        expect(snapshot?.state).toBe("failed");
        expect(snapshot?.error).toBe("user-title");
    });

    it("records an RPC failure on every requested id", async () => {
        const key = "error-test";
        const service = fakeService({
            AutoGenerate: async () => {
                throw new Error("backend down");
            },
        });
        const result = await autoGenerate(service, { ids: [key], kind: "metadata" });
        expect(result.ok).toBe(false);
        expect(result.error).toBe("backend down");
        const snapshot = getGenSnapshot("", key, "metadata");
        expect(snapshot?.state).toBe("failed");
        expect(snapshot?.error).toBe("backend down");
    });

    it("aggregates batch counts per session", async () => {
        const ok = "batch-ok";
        const skipped = "batch-skipped";
        const service = fakeService({
            AutoGenerate: async () => ({ queued: [ok], skipped: [{ id: skipped, reason: "missing" }], errors: [] }),
        });
        await autoGenerate(service, { ids: [ok, skipped], kind: "title" });
        const counts = getBatchGenCounts("", [ok, skipped], "title");
        expect(counts.total).toBe(2);
        expect(counts.queued).toBe(1);
        expect(counts.failed).toBe(1);
    });
});
