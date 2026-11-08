// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { formatExpiry, scopeSummary, tokenState } from "./agentaccesssettings";

describe("tokenState", () => {
    it("reports live for an unrevoked, unexpired token", () => {
        expect(tokenState({ revoked: false, expired: false })).toBe("live");
    });

    it("prefers revoked over expired", () => {
        // A revoked token that later expires is still "revoked": that is the
        // reason it stopped working, and saying "expired" would hide the action.
        expect(tokenState({ revoked: true, expired: true })).toBe("revoked");
        expect(tokenState({ revoked: true, expired: false })).toBe("revoked");
    });

    it("reports expired", () => {
        expect(tokenState({ revoked: false, expired: true })).toBe("expired");
    });
});

describe("formatExpiry", () => {
    const now = 1_000_000_000_000;

    it("handles a missing expiry", () => {
        expect(formatExpiry(0, now)).toBe("no expiry");
    });

    it("uses minutes below an hour", () => {
        expect(formatExpiry(now + 15 * 60_000, now)).toBe("in 15m");
    });

    it("uses hours below two days", () => {
        expect(formatExpiry(now + 8 * 3_600_000, now)).toBe("in 8h");
    });

    it("uses days beyond that", () => {
        expect(formatExpiry(now + 72 * 3_600_000, now)).toBe("in 3d");
    });

    it("says expired for a past timestamp", () => {
        expect(formatExpiry(now - 1, now)).toBe("expired");
    });
});

describe("scopeSummary", () => {
    it("joins scopes in the order the token carries them", () => {
        expect(scopeSummary(["observe", "navigate"])).toBe("observe, navigate");
    });

    it("falls back to observe when the list is empty", () => {
        // The backend defaults an empty scope list to observe; the panel must
        // display the effective value, not an empty cell that reads as "no rights".
        expect(scopeSummary([])).toBe("observe");
        expect(scopeSummary(undefined)).toBe("observe");
    });
});
