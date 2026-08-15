// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { shouldShowClaudeFullscreenHint } from "./term";

describe("shouldShowClaudeFullscreenHint", () => {
    it("shows only when claude is active and not dismissed and mouse is not enabled", () => {
        expect(shouldShowClaudeFullscreenHint(true, false, false)).toBe(true);
    });

    it("hides when claude is not active", () => {
        expect(shouldShowClaudeFullscreenHint(false, false, false)).toBe(false);
        expect(shouldShowClaudeFullscreenHint(false, true, true)).toBe(false);
    });

    it("hides after the user dismisses the hint", () => {
        expect(shouldShowClaudeFullscreenHint(true, true, false)).toBe(false);
    });

    it("hides once Claude enables mouse reporting (fullscreen renderer active)", () => {
        expect(shouldShowClaudeFullscreenHint(true, false, true)).toBe(false);
    });
});