// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { buildCreateCommand, mergePrefill, slugPreview, treeDepth, validateCreateDraft } from "./hero-create-model";

describe("slugPreview", () => {
    it("lowercases and separates words like the Go Slugify", () => {
        expect(slugPreview("Backup Guard")).toBe("backup-guard");
    });
    it("keeps explicit dashes (Go does not collapse a dash run)", () => {
        expect(slugPreview("A--B")).toBe("a--b");
    });
    it("trims leading and trailing separators", () => {
        expect(slugPreview("__x__")).toBe("x");
        expect(slugPreview("-y-")).toBe("y");
    });
    it("keeps ascii digits, dashes and underscores", () => {
        expect(slugPreview("backup-2_guard")).toBe("backup-2_guard");
    });
    it("collapses a non-ascii run into one dash (final id is Go's authority)", () => {
        expect(slugPreview("emoji🎭name")).toBe("emoji-name");
    });
    it("returns an empty preview for an empty name", () => {
        // Go appends a short hash here; the wizard labels the id a preview.
        expect(slugPreview("")).toBe("");
        expect(slugPreview(null)).toBe("");
    });
});

describe("buildCreateCommand", () => {
    it("emits name + --yes for a minimal draft", () => {
        expect(buildCreateCommand({ name: "X", emoji: "", role: "", provider: "", model: "" })).toBe(
            'wsh hero create --name "X" --yes'
        );
    });
    it("appends only the non-empty identity flags in a fixed order", () => {
        expect(
            buildCreateCommand({
                name: "Backup Guard",
                emoji: "🎭",
                role: "备份归档",
                provider: "pi",
                model: "deepseek",
            })
        ).toBe(
            'wsh hero create --name "Backup Guard" --emoji "🎭" --role "备份归档" --provider "pi" --model "deepseek" --yes'
        );
    });
    it("quotes embedded quotes and backslashes", () => {
        expect(buildCreateCommand({ name: 'a"b\\c', emoji: "", role: "", provider: "", model: "" })).toBe(
            'wsh hero create --name "a\\"b\\\\c" --yes'
        );
    });
    it("trims whitespace around fields", () => {
        expect(buildCreateCommand({ name: "  X  ", emoji: " ", role: "", provider: " pi ", model: "" })).toBe(
            'wsh hero create --name "X" --provider "pi" --yes'
        );
    });
    it("is safe on null", () => {
        expect(buildCreateCommand(null)).toBe('wsh hero create --name "" --yes');
    });
});

describe("mergePrefill / validateCreateDraft", () => {
    it("seeds the name from the session title", () => {
        expect(mergePrefill({ source: "aisessions", sessionTitle: " Fix the bug " })).toEqual({
            name: "Fix the bug",
            emoji: "",
            role: "",
            provider: "",
            model: "",
        });
    });
    it("returns an empty draft without a prefill", () => {
        expect(mergePrefill(undefined)).toEqual({
            name: "",
            emoji: "",
            role: "",
            provider: "",
            model: "",
        });
    });
    it("rejects a blank name and accepts a filled one", () => {
        expect(validateCreateDraft({ name: "   ", emoji: "", role: "", provider: "", model: "" })).not.toBe("");
        expect(validateCreateDraft({ name: "X", emoji: "", role: "", provider: "", model: "" })).toBe("");
        expect(validateCreateDraft(null)).not.toBe("");
    });
});

describe("treeDepth", () => {
    it("counts path segments minus one for indentation", () => {
        expect(treeDepth("AGENTS.md")).toBe(0);
        expect(treeDepth(".hero/MEMORY/facts.md")).toBe(2);
        expect(treeDepth("")).toBe(-1);
    });
});
