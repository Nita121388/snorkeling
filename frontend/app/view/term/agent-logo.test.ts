// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { normalizeAgentEmoji, getAgentIcon } from "./agent-logo";

describe("normalizeAgentEmoji", () => {
    it("accepts a single emoji grapheme", () => {
        expect(normalizeAgentEmoji("🦊")).toBe("🦊");
        expect(normalizeAgentEmoji("🔥")).toBe("🔥");
        expect(normalizeAgentEmoji("👍🏻")).toBe("👍🏻");
    });

    it("rejects multi-grapheme strings", () => {
        expect(normalizeAgentEmoji("🦊🦊")).toBeNull();
        expect(normalizeAgentEmoji("ab")).toBeNull();
        expect(normalizeAgentEmoji("42")).toBeNull();
    });

    it("rejects non-pictographic characters", () => {
        expect(normalizeAgentEmoji("a")).toBeNull();
        expect(normalizeAgentEmoji("1")).toBeNull();
        expect(normalizeAgentEmoji(" ")).toBeNull();
    });

    it("rejects degenerate ZWJ fragments", () => {
        // Truncated ZWJ sequence segments as one grapheme but has no pictograph.
        expect(normalizeAgentEmoji("🦊\u200d")).toBeNull();
        expect(normalizeAgentEmoji("\u200d")).toBeNull();
    });

    it("rejects non-string and empty input", () => {
        expect(normalizeAgentEmoji(null)).toBeNull();
        expect(normalizeAgentEmoji(undefined)).toBeNull();
        expect(normalizeAgentEmoji(42)).toBeNull();
        expect(normalizeAgentEmoji("")).toBeNull();
        expect(normalizeAgentEmoji("   ")).toBeNull();
    });
});

describe("getAgentIcon priority chain (L2 → L1 → L3)", () => {
    const meta = { "agent:emoji": "🐙" } as MetaType;
    const personas = { claude: "🐱" } as Record<string, string>;

    it("L2 block meta overrides everything", () => {
        const spec = getAgentIcon("claude", { meta, personas });
        expect(spec).toEqual({ kind: "emoji", emoji: "🐙" });
    });

    it("L1 provider persona beats the logo when no L2", () => {
        const spec = getAgentIcon("claude", { meta: null, personas });
        expect(spec).toEqual({ kind: "emoji", emoji: "🐱" });
    });

    it("falls back to the brand logo", () => {
        const spec = getAgentIcon("claude", { meta: null, personas: {} });
        expect(spec?.kind).toBe("logo");
    });

    it("unknown provider with a block emoji still returns emoji", () => {
        const spec = getAgentIcon("mystery", { meta: { "agent:emoji": "🦖" } as MetaType, personas });
        expect(spec).toEqual({ kind: "emoji", emoji: "🦖" });
    });

    it("rejects a malformed block emoji and falls through", () => {
        const spec = getAgentIcon("claude", { meta: { "agent:emoji": "ab" } as MetaType, personas: {} });
        expect(spec?.kind).toBe("logo");
    });
});
