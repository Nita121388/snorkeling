// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    BUILTIN_PROP_KEYS,
    formatDateValue,
    formatValue,
    humanizeKey,
    isEmptyValue,
    schemaVisibleTo,
    slugifyPropertyKey,
    tagToOption,
    toPropertyDefs,
} from "./property-model";

function makeSummary(overrides: Partial<SessionSummary> = {}): SessionSummary {
    return {
        key: "codex:abc:/tmp/a.jsonl",
        id: "abc",
        source: "codex",
        ...overrides,
    } as SessionSummary;
}

describe("toPropertyDefs", () => {
    it("returns nothing for a null summary", () => {
        expect(toPropertyDefs(null)).toEqual([]);
    });

    it("virtually maps legacy fields to built-in properties", () => {
        const entries = toPropertyDefs(
            makeSummary({
                note: "follow up",
                tags: ["#fix", "snorkeling"],
                marked: true,
                titleSource: "ai",
                createdAt: 1000,
                updatedAt: 2000,
            })
        );
        const byKey = new Map(entries.map((entry) => [entry.def.key, entry]));

        const note = byKey.get(BUILTIN_PROP_KEYS.note);
        expect(note?.def.type).toBe("text");
        expect(note?.def.builtin).toBe(true);
        expect(note?.cell.value).toBe("follow up");

        const tags = byKey.get(BUILTIN_PROP_KEYS.tags);
        expect(tags?.def.type).toBe("multi_select");
        // 旧数据里的 "#fix" 会去掉井号
        expect(tags?.cell.value).toEqual(["fix", "snorkeling"]);

        expect(byKey.get(BUILTIN_PROP_KEYS.starred)?.cell.value).toBe(true);
        expect(byKey.get(BUILTIN_PROP_KEYS.titleSource)?.def.readOnly).toBe(true);
        expect(byKey.get(BUILTIN_PROP_KEYS.createdAt)?.def.readOnly).toBe(true);
        expect(byKey.get(BUILTIN_PROP_KEYS.updatedAt)?.def.type).toBe("updated_time");
    });

    it("keeps built-in order stable and appends custom props after them", () => {
        const entries = toPropertyDefs(
            makeSummary({
                note: "n",
                tags: ["t"],
                props: {
                    tech_stack: { value: ["Go", "React"], type: "multi_select", source: "ai", updatedAt: 5 },
                },
            })
        );
        const noteIndex = entries.findIndex((entry) => entry.def.key === BUILTIN_PROP_KEYS.note);
        const customIndex = entries.findIndex((entry) => entry.def.key === "tech_stack");
        expect(customIndex).toBeGreaterThan(noteIndex);
        expect(entries[customIndex].def.builtin).toBe(false);
        expect(entries[customIndex].cell.source).toBe("ai");
        expect(entries[customIndex].def.name).toBe("Tech Stack");
    });

    it("infers a type when the cell does not carry one", () => {
        const entries = toPropertyDefs(
            makeSummary({
                props: {
                    score: { value: 7, updatedAt: 1 },
                    done: { value: true, updatedAt: 1 },
                    // 没有 type 的裸数字回落为 number（后端写 props 时总是带 type，
                    // 这里只是容错兜底；明确的日期应显式声明 type=date）。
                    when: { value: new Date(2026, 0, 5).getTime(), type: "date", updatedAt: 1 },
                },
            })
        );
        const byKey = new Map(entries.map((entry) => [entry.def.key, entry]));
        expect(byKey.get("score")?.def.type).toBe("number");
        expect(byKey.get("done")?.def.type).toBe("checkbox");
        expect(byKey.get("when")?.def.type).toBe("date");
    });
});

describe("isEmptyValue", () => {
    const textDef = toPropertyDefs(makeSummary({ note: "" })).find((entry) => entry.def.key === "note")!.def;

    it("treats empty strings / arrays / false checkbox as empty", () => {
        expect(isEmptyValue(textDef, "")).toBe(true);
        expect(isEmptyValue(textDef, "  ")).toBe(true);
        expect(isEmptyValue(textDef, [])).toBe(true);
        expect(isEmptyValue(textDef, false)).toBe(true);
        expect(isEmptyValue(textDef, null)).toBe(true);
    });

    it("treats 0 and non-empty values as present", () => {
        expect(isEmptyValue(textDef, 0)).toBe(false);
        expect(isEmptyValue(textDef, "x")).toBe(false);
        expect(isEmptyValue(textDef, ["x"])).toBe(false);
        expect(isEmptyValue(textDef, true)).toBe(false);
    });
});

describe("formatting", () => {
    it("formats dates in a stable month-day-year shape (local time)", () => {
        const ms = new Date(2026, 0, 5).getTime();
        expect(formatDateValue(ms)).toBe("Jan 5, 2026");
        expect(formatDateValue(null)).toBe("");
    });

    it("formats multi-select values as a comma list", () => {
        const entries = toPropertyDefs(makeSummary({ tags: ["a", "b"] }));
        const tags = entries.find((entry) => entry.def.key === "tags")!;
        expect(formatValue(tags.def, tags.cell.value)).toBe("a, b");
    });

    it("humanizes snake/camel keys", () => {
        expect(humanizeKey("tech_stack")).toBe("Tech Stack");
        expect(humanizeKey("techStack")).toBe("Tech Stack");
    });

    it("maps tags to stable colors", () => {
        expect(tagToOption("#Fix").id).toBe("fix");
        expect(tagToOption("fix").color).toBe(tagToOption("Fix").color);
    });
});

describe("slugifyPropertyKey", () => {
    it("lowercases and converts to snake_case", () => {
        expect(slugifyPropertyKey("Tech Stack")).toBe("tech_stack");
        expect(slugifyPropertyKey("  Owner Name!! ")).toBe("owner_name");
        expect(slugifyPropertyKey("due-date")).toBe("due_date");
    });

    it("returns empty for blank input", () => {
        expect(slugifyPropertyKey("   ")).toBe("");
    });
});

describe("toPropertyDefs with global schema", () => {
    const schema: AgentPropertyDefType[] = [
        { key: "tech_stack", name: "Tech Stack", type: "multi_select", order: 1, options: ["go", "react"] },
        { key: "owner", name: "Owner", type: "person", order: 2 },
    ];

    it("uses the schema name when the session has no custom name", () => {
        const entries = toPropertyDefs(
            makeSummary({ props: { tech_stack: { value: ["go"], type: "multi_select" } } }),
            schema
        );
        const tech = entries.find((entry) => entry.def.key === "tech_stack")!;
        expect(tech.def.name).toBe("Tech Stack");
        expect(tech.def.options?.map((o) => o.id)).toEqual(["go", "react"]);
    });

    it("prefers the per-session name/order override", () => {
        const entries = toPropertyDefs(
            makeSummary({ props: { tech_stack: { value: ["go"], type: "multi_select", name: "Stack", order: 9 } } }),
            schema
        );
        const tech = entries.find((entry) => entry.def.key === "tech_stack")!;
        expect(tech.def.name).toBe("Stack");
    });

    it("renders schema-only properties with an empty value", () => {
        const entries = toPropertyDefs(makeSummary({ props: {} }), schema);
        const owner = entries.find((entry) => entry.def.key === "owner")!;
        expect(owner.def.name).toBe("Owner");
        expect(owner.cell.value).toBeNull();
        expect(owner.def.type).toBe("person");
    });
});

// ─── 模板 scope 过滤（仅此会话 / 仅此 Agent / 所有会话）───
describe("toPropertyDefs — 模板 scope 过滤", () => {
    const schema = [
        { key: "global_one", name: "Global One", type: "text", order: 1 },
        { key: "pi_only", name: "Pi Only", type: "text", order: 2, scope: "agent:pi" },
        { key: "codex_only", name: "Codex Only", type: "text", order: 3, scope: "agent:codex" },
    ];

    it("pi 会话只看到全局 + agent:pi 的定义，且映射出 scope", () => {
        const entries = toPropertyDefs(makeSummary({ source: "pi", props: {} }), schema);
        const keys = entries.filter((entry) => !entry.def.builtin).map((entry) => entry.def.key);
        expect(keys).toContain("global_one");
        expect(keys).toContain("pi_only");
        expect(keys).not.toContain("codex_only");

        const global = entries.find((entry) => entry.def.key === "global_one")!;
        const agent = entries.find((entry) => entry.def.key === "pi_only")!;
        expect(global.def.scope).toBe("global");
        expect(agent.def.scope).toBe("agent");
    });

    it("codex 会话看到的是 agent:codex，不是 agent:pi", () => {
        const entries = toPropertyDefs(makeSummary({ source: "codex", props: {} }), schema);
        const keys = entries.filter((entry) => !entry.def.builtin).map((entry) => entry.def.key);
        expect(keys).toContain("codex_only");
        expect(keys).not.toContain("pi_only");
    });

    it("source 缺失时只保留全局定义（安全降级）", () => {
        const entries = toPropertyDefs(makeSummary({ source: "", props: {} }), schema);
        const keys = entries.filter((entry) => !entry.def.builtin).map((entry) => entry.def.key);
        expect(keys).toEqual(["global_one"]);
    });

    it("别的 Agent 的模板项不参与 name/type 补全（同 key 不串味）", () => {
        const entries = toPropertyDefs(
            makeSummary({ source: "pi", props: { stage: { value: "plan", type: "text" } } }),
            [{ key: "stage", name: "Codex Stage", type: "select", options: ["plan"], order: 1, scope: "agent:codex" }]
        );
        const stage = entries.find((entry) => entry.def.key === "stage")!;
        // 值行用 props 自己推断的类型与 humanize 名称，而不是 codex 模板的名称/类型
        expect(stage.def.type).toBe("text");
        expect(stage.def.name).toBe("Stage");
    });

    it("schemaVisibleTo 只认空 scope 与匹配的 agent:<source>", () => {
        expect(schemaVisibleTo({ key: "a", scope: "" }, "pi")).toBe(true);
        expect(schemaVisibleTo({ key: "a" }, "pi")).toBe(true);
        expect(schemaVisibleTo({ key: "a", scope: "agent:pi" }, "pi")).toBe(true);
        expect(schemaVisibleTo({ key: "a", scope: "agent:pi" }, "PI")).toBe(true);
        expect(schemaVisibleTo({ key: "a", scope: "agent:pi" }, "codex")).toBe(false);
        expect(schemaVisibleTo({ key: "a", scope: "agent:pi" }, "")).toBe(false);
    });
});
