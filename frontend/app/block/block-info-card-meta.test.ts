// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    isAgentCardMeta,
    isChatBlockMeta,
    isSessionDetailBlockMeta,
    resolveBlockSessionId,
} from "./block-info-card-meta";

describe("resolveBlockSessionId", () => {
    it("prefers aisessions:sessionid (GUI chat / session detail)", () => {
        expect(resolveBlockSessionId({ "aisessions:sessionid": " chat-id " })).toBe("chat-id");
    });

    it("falls back to agent:sessionid when aisessions key is absent", () => {
        expect(resolveBlockSessionId({ "agent:sessionid": " tui-id " })).toBe("tui-id");
    });

    it("prefers aisessions:sessionid over agent:sessionid", () => {
        expect(
            resolveBlockSessionId({ "aisessions:sessionid": "chat-id", "agent:sessionid": "tui-id" })
        ).toBe("chat-id");
    });

    it("ignores blank values and falls through", () => {
        expect(resolveBlockSessionId({ "aisessions:sessionid": "  ", "agent:sessionid": "tui-id" })).toBe(
            "tui-id"
        );
    });

    it("resolves from cmd when no persisted id exists", () => {
        expect(resolveBlockSessionId({ cmd: "codex resume abc-123" })).toBe("abc-123");
    });

    it("returns empty string for empty/nullish meta", () => {
        expect(resolveBlockSessionId(undefined)).toBe("");
        expect(resolveBlockSessionId(null)).toBe("");
        expect(resolveBlockSessionId({})).toBe("");
        expect(resolveBlockSessionId({ view: "term" })).toBe("");
    });
});

describe("isSessionDetailBlockMeta", () => {
    it("matches aisessions view with a bound session id", () => {
        expect(
            isSessionDetailBlockMeta({ view: "aisessions", "aisessions:sessionid": "id-1" })
        ).toBe(true);
    });

    it("rejects aisessions blocks without a session id", () => {
        expect(isSessionDetailBlockMeta({ view: "aisessions" })).toBe(false);
        expect(isSessionDetailBlockMeta({ view: "aisessions", "aisessions:sessionid": "  " })).toBe(
            false
        );
    });

    it("rejects other views", () => {
        expect(isSessionDetailBlockMeta({ view: "term", "aisessions:sessionid": "id-1" })).toBe(false);
    });
});

describe("isChatBlockMeta", () => {
    it("matches a bound GUI chat block", () => {
        expect(isChatBlockMeta({ view: "aisessions", "aisessions:sessionid": "id-1" })).toBe(true);
    });

    it("matches the new-chat placeholder before the first message", () => {
        expect(isChatBlockMeta({ view: "aisessions", "aisessions:newchat": true })).toBe(true);
    });

    it("rejects plain aisessions list blocks", () => {
        expect(isChatBlockMeta({ view: "aisessions" })).toBe(false);
        expect(isChatBlockMeta({ view: "aisessions", "aisessions:newchat": false })).toBe(false);
    });
});

describe("isAgentCardMeta", () => {
    it("matches session detail blocks", () => {
        expect(
            isAgentCardMeta({ view: "aisessions", "aisessions:sessionid": "id-1" })
        ).toBe(true);
    });

    it("matches new-chat blocks", () => {
        expect(isAgentCardMeta({ view: "aisessions", "aisessions:newchat": true })).toBe(true);
    });

    it("matches term agent blocks with a session id", () => {
        expect(isAgentCardMeta({ "agent:sessionid": "id-1", "agent:provider": "codex" })).toBe(true);
    });

    it("keeps matching fresh agent blocks that only have provider meta", () => {
        expect(isAgentCardMeta({ "agent:provider": "claude" })).toBe(true);
        expect(isAgentCardMeta({ "agent:autoresume": true })).toBe(true);
    });

    it("rejects unrelated blocks", () => {
        expect(isAgentCardMeta({ view: "preview", file: "a.md" })).toBe(false);
        expect(isAgentCardMeta({ view: "term" })).toBe(false);
        expect(isAgentCardMeta(null)).toBe(false);
    });
});
