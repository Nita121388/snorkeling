// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it, vi } from "vitest";
import { chatSourcesForAvailability, fetchChatSourceIds } from "./sources";

describe("fetchChatSourceIds", () => {
    beforeEach(() => {
        vi.unstubAllGlobals();
    });

    it("returns only valid source ids from the capability response", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({ sources: [{ source: "pi" }, { source: 1 }, {}] }),
            })
        );

        await expect(fetchChatSourceIds("/api/aisessions-chat")).resolves.toEqual(["pi"]);
    });

    it("rejects a failed source request", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503, statusText: "Unavailable" }));

        await expect(fetchChatSourceIds("/api/aisessions-chat")).rejects.toThrow(/503/);
    });

    it("adds a registered source without a dedicated visual definition", () => {
        const sources = chatSourcesForAvailability(new Set(["pi", "new-agent"]));

        expect(sources).toContainEqual(
            expect.objectContaining({ id: "new-agent", label: "new-agent", available: true })
        );
    });
});
