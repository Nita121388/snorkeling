// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    CHAT_SOURCES,
    applyRpcSourceEntries,
    chatSourcesForAvailability,
    fetchChatSourceIds,
    getChatSource,
    mergeChatSources,
    resetRpcSourceCacheForTest,
} from "./sources";

describe("CHAT_SOURCES", () => {
    it("exposes a filterable chip for every scanned backend source incl. opencode", () => {
        const ids = CHAT_SOURCES.map((source) => source.id);
        expect(ids).toEqual(["pi", "codex", "claude", "opencode"]);
    });

    it("resolves opencode to a labelled source with a dot class", () => {
        expect(getChatSource("opencode")).toMatchObject({ label: "OpenCode", dotClass: "bg-source-opencode" });
    });
});

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

describe("declarative source merge", () => {
    beforeEach(() => {
        resetRpcSourceCacheForTest();
    });
    afterEach(() => {
        resetRpcSourceCacheForTest();
    });

    it("adds a declarative source with its configured label and keeps built-in labels", () => {
        const merged = mergeChatSources([
            { source: "antigravity", label: "Antigravity", available: true },
            // 后端对编译期 provider 回退裸 id：不能把 "Pi" 降级成 "pi"
            { source: "pi", label: "pi", available: true },
            // 用户配置了 db 但文件缺失：available=false 的来源仍在清单里
            { source: "offline-agent", label: "Offline Agent", available: false },
        ]);

        expect(merged.map((source) => source.id)).toEqual([
            "pi",
            "codex",
            "claude",
            "opencode",
            "antigravity",
            "offline-agent",
        ]);
        expect(merged.find((source) => source.id === "antigravity")?.label).toBe("Antigravity");
        expect(merged.find((source) => source.id === "pi")?.label).toBe("Pi");
    });

    it("getChatSource prefers the RPC label for a declared source", () => {
        // 未拉取 RPC 前：未知来源 label 回退裸 id，dotClass 为空（调用方用 bg-secondary 中性点）
        expect(getChatSource("antigravity")).toEqual({ id: "antigravity", label: "antigravity" });
        expect(getChatSource("antigravity").dotClass).toBeUndefined();

        applyRpcSourceEntries([{ source: "antigravity", label: "Antigravity", available: true }]);

        expect(getChatSource("antigravity")).toMatchObject({ id: "antigravity", label: "Antigravity" });
        // 内置来源的硬编码 label / 色点不被裸 id 覆盖
        expect(getChatSource("opencode")).toMatchObject({ label: "OpenCode", dotClass: "bg-source-opencode" });
    });

    it("unknown source without a configured label falls back to the bare id", () => {
        applyRpcSourceEntries([{ source: "unlabelled", label: "", available: false }]);

        expect(getChatSource("unlabelled")).toEqual({ id: "unlabelled", label: "unlabelled" });
        expect(mergeChatSources([{ source: "unlabelled", label: "", available: false }])).toContainEqual({
            id: "unlabelled",
            label: "unlabelled",
        });
    });
});
