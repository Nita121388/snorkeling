// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { isAgentTerminalMeta, normalizeAgentProvider } from "./agent-meta";

describe("agent terminal metadata", () => {
    it("normalizes a missing or blank provider to the generic agent provider", () => {
        expect(normalizeAgentProvider(null)).toBe("agent");
        expect(normalizeAgentProvider("   ")).toBe("agent");
        expect(normalizeAgentProvider("  codex  ")).toBe("codex");
    });

    it("recognizes agent terminal metadata without loading the terminal view model", () => {
        expect(isAgentTerminalMeta({ cmd: "codex" } as MetaType)).toBe(true);
        expect(isAgentTerminalMeta({ "agent:sessionid": "session-1" } as MetaType)).toBe(true);
        expect(isAgentTerminalMeta({ cmd: "pwsh" } as MetaType)).toBe(false);
        expect(isAgentTerminalMeta(null)).toBe(false);
    });
});
