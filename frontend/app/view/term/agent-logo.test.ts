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
        // Bare ASCII digit/letter/"#"/"*" are in the Unicode Emoji property set but
        // render as plain text — they must NOT become an agent face.
        expect(normalizeAgentEmoji("9")).toBeNull();
        expect(normalizeAgentEmoji("a")).toBeNull();
        expect(normalizeAgentEmoji("#")).toBeNull();
        expect(normalizeAgentEmoji("*")).toBeNull();
    });

    it("accepts emoji that render as color glyphs, including keycaps/flags/ZWJ", () => {
        // Keycaps: digit + VS16 + combining enclosing key (no Extended_Pictographic
        // code point, but carry VS16 so they render as color emoji). This is the
        // "9️⃣ doesn't stick" regression.
        expect(normalizeAgentEmoji("9\uFE0F\u20E3")).toBe("9\uFE0F\u20E3");
        expect(normalizeAgentEmoji("1\uFE0F\u20E3")).toBe("1\uFE0F\u20E3");
        expect(normalizeAgentEmoji("#\uFE0F\u20E3")).toBe("#\uFE0F\u20E3");
        // Regional indicator pairs (flags).
        expect(normalizeAgentEmoji("🇺🇸")).toBe("🇺🇸");
        expect(normalizeAgentEmoji("🇨🇳")).toBe("🇨🇳");
        // Complete ZWJ sequences are valid single emoji, not malformed.
        expect(normalizeAgentEmoji("👨\u200d👩\u200d👧")).toBe("👨\u200d👩\u200d👧");
        expect(normalizeAgentEmoji("\u{1F3F3}\uFE0F\u200d\u{1F308}")).toBe("\u{1F3F3}\uFE0F\u200d\u{1F308}");
        // Text-default emoji that carry VS16 (©️) still render as color glyphs.
        expect(normalizeAgentEmoji("\u00A9\uFE0F")).toBe("\u00A9\uFE0F");
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

    it("resolves keycap emoji personas from session and provider scope", () => {
        // Regression: 9️⃣ was stored by the picker but normalizeAgentEmoji rejected it
        // (no Extended_Pictographic code point), so the icon silently fell back to the
        // brand logo. The picker → store → getAgentIcon path must now round-trip it.
        const keycap = "9\uFE0F\u20E3";
        const meta = { "agent:sessionid": "sess-9", "agent:provider": "pi" } as MetaType;
        expect(
            getAgentIcon("pi", { meta, sessionEmojis: { "sess-9": keycap }, personas: {} })
        ).toEqual({ kind: "emoji", emoji: keycap });
        expect(getAgentIcon("pi", { sessionEmojis: {}, personas: { pi: keycap } })).toEqual({
            kind: "emoji",
            emoji: keycap,
        });
    });
});
