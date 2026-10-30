// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "vitest";
import { resolveAgentEmojiScope, resolveAgentEmojiWriteTarget } from "./persona-scope";

describe("resolveAgentEmojiScope", () => {
    test("keeps the session scope when a session id exists", () => {
        expect(resolveAgentEmojiScope("session", "sess-1")).toBe("session");
        expect(resolveAgentEmojiScope("session", "  sess-1  ")).toBe("session");
    });

    test("falls back to provider scope when the session id is missing", () => {
        expect(resolveAgentEmojiScope("session", null)).toBe("provider");
        expect(resolveAgentEmojiScope("session", undefined)).toBe("provider");
        expect(resolveAgentEmojiScope("session", "")).toBe("provider");
        expect(resolveAgentEmojiScope("session", "   ")).toBe("provider");
    });

    test("provider scope is never rewritten", () => {
        expect(resolveAgentEmojiScope("provider", "sess-1")).toBe("provider");
        expect(resolveAgentEmojiScope("provider", "")).toBe("provider");
    });
});

describe("resolveAgentEmojiWriteTarget", () => {
    test("writes the session store only when the session scope is available", () => {
        expect(resolveAgentEmojiWriteTarget("session", "sess-1", "opencode")).toEqual({
            kind: "session",
            sessionId: "sess-1",
        });
    });

    test("a session-scope request without a session id writes provider-wide, matching the visible radio", () => {
        expect(resolveAgentEmojiWriteTarget("session", "", "opencode")).toEqual({
            kind: "provider",
            provider: "opencode",
        });
    });

    test("provider scope always writes the provider store", () => {
        expect(resolveAgentEmojiWriteTarget("provider", "sess-1", "opencode")).toEqual({
            kind: "provider",
            provider: "opencode",
        });
    });
});
