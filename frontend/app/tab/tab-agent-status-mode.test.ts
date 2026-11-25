// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { DefaultTabAgentStatusMode, normalizeTabAgentStatusMode } from "./tab-agent-status-mode";

describe("normalizeTabAgentStatusMode", () => {
    it("keeps the three supported modes", () => {
        expect(normalizeTabAgentStatusMode("avatars")).toBe("avatars");
        expect(normalizeTabAgentStatusMode("rail")).toBe("rail");
        expect(normalizeTabAgentStatusMode("hybrid")).toBe("hybrid");
    });

    it("falls back to hybrid for unset or invalid values", () => {
        expect(DefaultTabAgentStatusMode).toBe("hybrid");
        expect(normalizeTabAgentStatusMode(undefined)).toBe("hybrid");
        expect(normalizeTabAgentStatusMode(null)).toBe("hybrid");
        expect(normalizeTabAgentStatusMode("legacy-dots")).toBe("hybrid");
        expect(normalizeTabAgentStatusMode(42)).toBe("hybrid");
    });
});
