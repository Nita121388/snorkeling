// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    BUILTIN_SLASH_COMMANDS,
    filterSlashItems,
    mergeSlashItems,
    parseSlashQuery,
    slashSourceLabel,
} from "./chat-slash";

describe("parseSlashQuery", () => {
    it("extracts query from leading slash input", () => {
        expect(parseSlashQuery("/ski")).toBe("ski");
        expect(parseSlashQuery("/")).toBe("");
    });

    it("returns null once the message leaves pure-command shape", () => {
        expect(parseSlashQuery("hello /world")).toBeNull();
        expect(parseSlashQuery("/model high")).toBeNull(); // space = args typed
        expect(parseSlashQuery("/multi\nline")).toBeNull();
        expect(parseSlashQuery("")).toBeNull();
    });
});

describe("filterSlashItems", () => {
    const items = [
        { name: "skill:brave-search" },
        { name: "Model" },
        { name: "compact" },
    ];

    it("is case-insensitive prefix match", () => {
        expect(filterSlashItems(items, "mod").map((i) => i.name)).toEqual(["Model"]);
        expect(filterSlashItems(items, "SKILL:b").map((i) => i.name)).toEqual(["skill:brave-search"]);
    });

    it("returns everything for empty query", () => {
        expect(filterSlashItems(items, "")).toHaveLength(3);
    });
});

describe("mergeSlashItems", () => {
    it("puts builtins first and sorts dynamic commands by name", () => {
        const merged = mergeSlashItems([
            { name: "zeta" },
            { name: "alpha" },
        ]);
        expect(merged.slice(0, BUILTIN_SLASH_COMMANDS.length).map((i) => i.source)).toEqual([
            "gui",
            "gui",
            "gui",
        ]);
        expect(merged.map((i) => i.name)).toEqual(["model", "think", "compact", "alpha", "zeta"]);
    });

    it("does not mutate the dynamic input array", () => {
        const dynamic = [{ name: "b" }, { name: "a" }];
        mergeSlashItems(dynamic);
        expect(dynamic.map((i) => i.name)).toEqual(["b", "a"]);
    });
});

describe("slashSourceLabel", () => {
    it("maps known sources to badges", () => {
        expect(slashSourceLabel("extension")).toBe("扩展");
        expect(slashSourceLabel("prompt")).toBe("模板");
        expect(slashSourceLabel("skill")).toBe("技能");
        expect(slashSourceLabel("gui")).toBe("");
        expect(slashSourceLabel(undefined)).toBe("");
    });
});
