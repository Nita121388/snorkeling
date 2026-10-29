// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { getAgentIcon, normalizeAgentEmoji } from "./agent-logo";

describe("normalizeAgentEmoji", () => {
    it("accepts a single pictographic grapheme", () => {
        expect(normalizeAgentEmoji("🦊")).toBe("🦊");
        expect(normalizeAgentEmoji("  🐙  ")).toBe("🐙");
        expect(normalizeAgentEmoji("🦄")).toBe("🦄");
    });

    it("rejects multi-grapheme / non-pictographic / malformed input", () => {
        expect(normalizeAgentEmoji("🦊🦊")).toBeNull();
        expect(normalizeAgentEmoji("ab")).toBeNull();
        expect(normalizeAgentEmoji("42")).toBeNull();
        expect(normalizeAgentEmoji("")).toBeNull();
        expect(normalizeAgentEmoji("   ")).toBeNull();
        expect(normalizeAgentEmoji(null)).toBeNull();
        expect(normalizeAgentEmoji(42)).toBeNull();
        // Degenerate ZWJ fragment segments as one grapheme but is malformed.
        expect(normalizeAgentEmoji("🦊\u200d")).toBeNull();
    });
});

describe("getAgentIcon priority", () => {
    it("session emoji beats provider persona", () => {
        const spec = getAgentIcon("claude", {
            sessionEmojis: { "sess-1": "🦊" },
            personas: { claude: "🐙" },
        });
        // No sessionId provided and no meta → falls to provider persona.
        expect(spec).toEqual({ kind: "emoji", emoji: "🐙" });

        const withSession = getAgentIcon("claude", {
            sessionId: "sess-1",
            sessionEmojis: { "sess-1": "🦊" },
            personas: { claude: "🐙" },
        });
        expect(withSession).toEqual({ kind: "emoji", emoji: "🦊" });
    });

    it("resolves the session id from block meta when not passed explicitly", () => {
        const meta = { "agent:sessionid": "sess-2", "agent:provider": "codex" } as MetaType;
        const spec = getAgentIcon("codex", {
            meta,
            sessionEmojis: { "sess-2": "🧠" },
            personas: { codex: "🐙" },
        });
        expect(spec).toEqual({ kind: "emoji", emoji: "🧠" });
    });

    it("provider persona beats the brand logo", () => {
        const spec = getAgentIcon("pi", { sessionEmojis: {}, personas: { pi: "🤖" } });
        expect(spec).toEqual({ kind: "emoji", emoji: "🤖" });
    });

    it("falls back to the brand logo when no persona is set", () => {
        const spec = getAgentIcon("claude", { sessionEmojis: {}, personas: {} });
        expect(spec?.kind).toBe("logo");
    });

    it("returns null for an unknown provider", () => {
        expect(getAgentIcon("nope", { sessionEmojis: {}, personas: {} })).toBeNull();
    });

    it("ignores an invalid session emoji and keeps the provider persona", () => {
        const spec = getAgentIcon("claude", {
            sessionId: "sess-3",
            sessionEmojis: { "sess-3": "🦊🦊" },
            personas: { claude: "🐙" },
        });
        expect(spec).toEqual({ kind: "emoji", emoji: "🐙" });
    });
});
