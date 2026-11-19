// Copyright 2026, Command Line AI Inc.
// SPDX-License-Identifier: Apache-2.0

// Agent model identity split (G2 red).
//
// design.md §4.1 requires ONE shared pure splitter — resolveAgentModelIdentity —
// and ONE shared formatter — formatAgentModel — consumed by the hover card / modal
// and the Tab mini row. Neither function exists today, so this file is red until
// the fix lands. Six split cases are locked here:
//   1. slash           mydeepseek/deepseek-v4.1-flash → provider mydeepseek / model deepseek-v4.1-flash
//   2. multi-slash     provider/model/sub            → provider provider   / model model/sub (split first slash only)
//   3. no-slash+provider bare-model + session provider magpie → provider magpie
//   4. provider=pi     bare-model + provider "pi"     → provider "" (agent type words are not model suppliers)
//   5. empty           ""                             → three empty strings, never throws
//   6. whitespace      "   "                          → three empty strings, never throws
//
// formatAgentModel(identity, displayProvider) drops a provider prefix that is the
// same as the display provider (case-insensitive) and otherwise renders
// "provider · model". raw is always the canonical input string (tooltip / copy).

import { describe, expect, it } from "vitest";
import { formatAgentModel, resolveAgentModelIdentity } from "./agent-identity";

describe("resolveAgentModelIdentity", () => {
    it("case-1 splits on the first slash", () => {
        const identity = resolveAgentModelIdentity("mydeepseek/deepseek-v4.1-flash");
        expect(identity).toEqual({
            provider: "mydeepseek",
            model: "deepseek-v4.1-flash",
            raw: "mydeepseek/deepseek-v4.1-flash",
        });
        // The prefix matches the display provider → no duplicate prefix in the text.
        expect(formatAgentModel(identity, "mydeepseek")).toBe("deepseek-v4.1-flash");
        expect(formatAgentModel(identity, "MyDeepSeek")).toBe("deepseek-v4.1-flash");
    });

    it("case-2 multi-slash keeps the remainder as the model", () => {
        const identity = resolveAgentModelIdentity("provider/model/sub");
        expect(identity.provider).toBe("provider");
        expect(identity.model).toBe("model/sub");
        expect(identity.raw).toBe("provider/model/sub");
        // Different display provider → both halves are shown, separated by · .
        expect(formatAgentModel(identity, "cc-switch")).toBe("provider · model/sub");
    });

    it("case-3 no slash adopts the session provider", () => {
        const identity = resolveAgentModelIdentity("deepseek-v4.1-flash", "magpie");
        expect(identity).toEqual({
            provider: "magpie",
            model: "deepseek-v4.1-flash",
            raw: "deepseek-v4.1-flash",
        });
        expect(formatAgentModel(identity, "magpie")).toBe("deepseek-v4.1-flash");
        expect(formatAgentModel(identity, "")).toBe("magpie · deepseek-v4.1-flash");
    });

    it("case-4 provider=pi is not a model supplier", () => {
        const identity = resolveAgentModelIdentity("deepseek-v4.1-flash", "pi");
        expect(identity.provider).toBe("");
        expect(identity.model).toBe("deepseek-v4.1-flash");
        expect(identity.raw).toBe("deepseek-v4.1-flash");
        expect(formatAgentModel(identity, "")).toBe("deepseek-v4.1-flash");
    });

    it("case-5 empty input yields empty identity without throwing", () => {
        expect(resolveAgentModelIdentity("")).toEqual({ provider: "", model: "", raw: "" });
        expect(resolveAgentModelIdentity(null)).toEqual({ provider: "", model: "", raw: "" });
        expect(resolveAgentModelIdentity(undefined, "magpie")).toEqual({ provider: "", model: "", raw: "" });
        expect(formatAgentModel(resolveAgentModelIdentity(""), "")).toBe("");
    });

    it("case-6 whitespace-only input normalizes to empty", () => {
        expect(resolveAgentModelIdentity("   ")).toEqual({ provider: "", model: "", raw: "" });
        expect(resolveAgentModelIdentity(" \t\n ", "  magpie ")).toEqual({ provider: "", model: "", raw: "" });
        expect(formatAgentModel(resolveAgentModelIdentity("   "), "magpie")).toBe("");
    });
});
