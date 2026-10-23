// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import type { AgentProfileInfo } from "./agent-catalog";
import { findAgentProfile, modelOptionsFor, pickDefaultModel } from "./agent-catalog";

const catalog: AgentProfileInfo[] = [
    {
        name: "pi",
        label: "Pi",
        cmd: "pi",
        modelflag: "--model",
        defaultModel: "deepseek-v4-pro",
        models: [
            { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", provider: "deepseek", default: true },
            { id: "gpt-5", label: "GPT-5", provider: "openai" },
        ],
    },
    {
        name: "codex",
        label: "Codex",
        cmd: "codex",
        modelflag: "--model",
        models: [],
    },
];

describe("pickDefaultModel", () => {
    it("uses the profile default model", () => {
        expect(pickDefaultModel(findAgentProfile(catalog, "pi"))).toBe("deepseek-v4-pro");
    });

    it("falls back to the first model when no default is marked", () => {
        expect(pickDefaultModel(findAgentProfile(catalog, "codex"))).toBe("");
    });

    it("falls back to the first model of an unmarked catalog", () => {
        const profile: AgentProfileInfo = {
            name: "x",
            label: "X",
            cmd: "x",
            models: [{ id: "m1", label: "M1" }],
        };
        expect(pickDefaultModel(profile)).toBe("m1");
    });

    it("returns empty for a missing profile", () => {
        expect(pickDefaultModel(null)).toBe("");
    });
});

describe("modelOptionsFor", () => {
    it("returns the profile models", () => {
        expect(modelOptionsFor(findAgentProfile(catalog, "pi"), "gpt-5").map((m) => m.id)).toEqual([
            "deepseek-v4-pro",
            "gpt-5",
        ]);
    });

    it("keeps the current value selectable when it is not in the catalog", () => {
        const options = modelOptionsFor(findAgentProfile(catalog, "pi"), "hand-typed-model");
        expect(options[options.length - 1]).toEqual({
            id: "hand-typed-model",
            label: "hand-typed-model",
            source: "task",
        });
    });

    it("does not duplicate a value already in the catalog", () => {
        expect(modelOptionsFor(findAgentProfile(catalog, "pi"), "gpt-5")).toHaveLength(2);
    });

    it("returns empty for a missing profile", () => {
        expect(modelOptionsFor(null, "x")).toEqual([]);
    });
});

describe("findAgentProfile", () => {
    it("finds by name", () => {
        expect(findAgentProfile(catalog, "codex")?.cmd).toBe("codex");
    });

    it("returns null for blank or unknown names", () => {
        expect(findAgentProfile(catalog, "")).toBeNull();
        expect(findAgentProfile(catalog, undefined)).toBeNull();
        expect(findAgentProfile(catalog, "nope")).toBeNull();
    });
});
