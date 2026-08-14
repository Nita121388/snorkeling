// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { parseBaseConfig } from "@/app/view/preview/plugins/base-view/base-config";
import {
    collectScanFolders,
    evalFilter,
    NoteMeta,
    parseFrontmatter,
} from "@/app/view/preview/plugins/base-view/base-filter";
import { describe, expect, it } from "vitest";

const meta = (overrides: Partial<NoteMeta> = {}): NoteMeta => ({
    filePath: "/vault/My Projects/Snorkling/00-总览.base",
    fileName: "00-总览.base",
    ext: "base",
    frontmatter: {},
    ...overrides,
});

describe("parseBaseConfig", () => {
    it("parses the Snorkling 00-总览.base structure", () => {
        const content = `
filters:
  and:
    - file.ext == "md"
    - '!file.inFolder("_archive")'
properties:
  file.name:
    displayName: 笔记
  area:
    displayName: 业务
views:
  - type: table
    name: 全量笔记
    order:
      - file.name
      - area
`;
        const result = parseBaseConfig(content);
        expect(result.ok).toBe(true);
        if (!result.ok) {
            return;
        }
        expect(result.config.filters).toBeDefined();
        expect(result.config.columns).toContainEqual({ property: "file.name", displayName: "笔记" });
        expect(result.config.columns).toContainEqual({ property: "area", displayName: "业务" });
        expect(result.config.views[0].name).toBe("全量笔记");
        expect(result.config.views[0].order).toEqual(["file.name", "area"]);
    });

    it("returns error on invalid YAML", () => {
        const result = parseBaseConfig("filters: [unclosed");
        expect(result.ok).toBe(false);
    });
});

describe("parseFrontmatter", () => {
    it("parses YAML frontmatter between --- fences", () => {
        const content = `---
tags:
  - Snorkeling
area: 需求
status: "⏳进行中"
---

# Title
`;
        expect(parseFrontmatter(content)).toEqual({
            tags: ["Snorkeling"],
            area: "需求",
            status: "⏳进行中",
        });
    });

    it("returns empty object when no frontmatter", () => {
        expect(parseFrontmatter("# no frontmatter")).toEqual({});
    });
});

describe("evalFilter", () => {
    const note = meta({
        filePath: "/vault/My Projects/Snorkling/需求/标签系统统一管理需求.md",
        fileName: "标签系统统一管理需求.md",
        ext: "md",
        frontmatter: { area: "需求", type: "需求", status: "⏳进行中" },
    });

    it("matches file.ext predicate", () => {
        expect(evalFilter({ kind: "predicate", expr: 'file.ext == "md"' }, note)).toBe(true);
        expect(evalFilter({ kind: "predicate", expr: 'file.ext == "base"' }, note)).toBe(false);
    });

    it("matches file.name != predicate", () => {
        expect(evalFilter({ kind: "predicate", expr: 'file.name != "CLAUDE"' }, note)).toBe(true);
        expect(evalFilter({ kind: "predicate", expr: 'file.name != "标签系统统一管理需求.md"' }, note)).toBe(false);
    });

    it("matches negated inFolder predicate", () => {
        expect(evalFilter({ kind: "predicate", expr: '!file.inFolder("_archive")' }, note)).toBe(true);
        const archived = meta({ filePath: "/vault/_archive/old.md", fileName: "old.md", ext: "md" });
        expect(evalFilter({ kind: "predicate", expr: '!file.inFolder("_archive")' }, archived)).toBe(false);
    });

    it("matches inFolder with subfolder containment", () => {
        expect(evalFilter({ kind: "predicate", expr: 'file.inFolder("需求")' }, note)).toBe(true);
        const nested = meta({ filePath: "/vault/My Projects/Snorkling/需求/子目录/x.md", fileName: "x.md", ext: "md" });
        expect(evalFilter({ kind: "predicate", expr: 'file.inFolder("需求")' }, nested)).toBe(true);
        const outside = meta({ filePath: "/vault/方案/y.md", fileName: "y.md", ext: "md" });
        expect(evalFilter({ kind: "predicate", expr: 'file.inFolder("需求")' }, outside)).toBe(false);
    });

    it("matches property predicate from frontmatter", () => {
        expect(evalFilter({ kind: "predicate", expr: 'area == "需求"' }, note)).toBe(true);
        expect(evalFilter({ kind: "predicate", expr: 'note.area == "需求"' }, note)).toBe(true);
        expect(evalFilter({ kind: "predicate", expr: 'area == "方案"' }, note)).toBe(false);
    });

    it("evaluates and/or/not structures", () => {
        const andFilter = { kind: "and" as const, items: [
            { kind: "predicate" as const, expr: 'file.ext == "md"' },
            { kind: "predicate" as const, expr: 'area == "需求"' },
        ]};
        expect(evalFilter(andFilter, note)).toBe(true);

        const orFilter = { kind: "or" as const, items: [
            { kind: "predicate" as const, expr: 'area == "方案"' },
            { kind: "predicate" as const, expr: 'area == "需求"' },
        ]};
        expect(evalFilter(orFilter, note)).toBe(true);

        const notFilter = { kind: "not" as const, items: [
            { kind: "predicate" as const, expr: 'area == "方案"' },
        ]};
        expect(evalFilter(notFilter, note)).toBe(true);
    });

    it("returns false for unsupported predicates (conservative)", () => {
        expect(evalFilter({ kind: "predicate", expr: 'file.mtime > "2024-01-01"' }, note)).toBe(false);
    });
});

describe("collectScanFolders", () => {
    it("collects inFolder folders from and/or/not trees", () => {
        const filter = {
            kind: "and" as const,
            items: [
                { kind: "predicate" as const, expr: 'file.ext == "md"' },
                { kind: "or" as const, items: [
                    { kind: "predicate" as const, expr: 'file.inFolder("方案")' },
                    { kind: "predicate" as const, expr: '!file.inFolder("_archive")' },
                ]},
            ],
        };
        const folders = collectScanFolders(filter);
        expect(folders.has("方案")).toBe(true);
        expect(folders.has("_archive")).toBe(true);
    });

    it("returns empty set for no inFolder", () => {
        expect(collectScanFolders({ kind: "predicate", expr: 'file.ext == "md"' }).size).toBe(0);
    });
});

describe("evalFilter - 真实 .base 谓词（file.path.contains / file.hasProperty）", () => {
    const real = meta({
        filePath: "/vault/Primary Mission/70-专业知识学习/机器学习/10-专题笔记/医疗AI应用/子题/Westgard 规则与质控时序异常检测.md",
        fileName: "Westgard 规则与质控时序异常检测.md",
        ext: "md",
        frontmatter: { 纳入调研: "是", order: 3 },
    });

    it("matches file.path.contains with subfolder path", () => {
        expect(
            evalFilter({ kind: "predicate", expr: 'file.path.contains("Primary Mission/70-专业知识学习/机器学习/10-专题笔记/医疗AI应用/")' }, real)
        ).toBe(true);
        const outside = meta({ filePath: "/vault/其他/x.md", fileName: "x.md", ext: "md" });
        expect(evalFilter({ kind: "predicate", expr: 'file.path.contains("医疗AI应用")' }, outside)).toBe(false);
    });

    it("matches file.hasProperty", () => {
        expect(evalFilter({ kind: "predicate", expr: 'file.hasProperty("纳入调研")' }, real)).toBe(true);
        const noProp = meta({ filePath: "/vault/a.md", fileName: "a.md", ext: "md", frontmatter: {} });
        expect(evalFilter({ kind: "predicate", expr: 'file.hasProperty("纳入调研")' }, noProp)).toBe(false);
    });

    it("matches 纳入调研 == 是", () => {
        expect(evalFilter({ kind: "predicate", expr: '纳入调研 == "是"' }, real)).toBe(true);
    });

    it("matches not: file.hasProperty with fallback", () => {
        const noProp = meta({ filePath: "/vault/b.md", fileName: "b.md", ext: "md", frontmatter: {} });
        expect(evalFilter({ kind: "predicate", expr: '!file.hasProperty("纳入调研")' }, noProp)).toBe(true);
    });
});
