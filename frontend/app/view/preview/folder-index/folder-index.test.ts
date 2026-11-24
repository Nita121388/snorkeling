// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 文件夹索引徽标（N-1124-folder-index-badges-2）— 红证先行：
// 数据源 1（index.md 表格解析）/ 归一化 / 合并策略 的单测。
// 契约见 .trellis/tasks/11-24-folder-index-badges/prd.md。

import { describe, expect, it } from "vitest";
import {
    STATUS_DEF,
    type BadgeDeco,
    mergeDecorations,
    normalizeDeco,
    parseIndexDoc,
} from "@/app/view/preview/folder-index/folder-index-model";
import { executeDecorate, normalizeScriptRun } from "@/app/view/preview/folder-index/folder-index-worker";

describe("parseIndexDoc（数据源 1：index.md 状态表）", () => {
    it("解析状态表：相对路径键 + 备注 + source 标记", () => {
        const r = parseIndexDoc(
            [
                "---",
                "title: 本目录索引",
                "---",
                "| 文件 | 状态 | 备注 |",
                "|---|---|---|",
                "| 需求规格 v3.md | 会改版 | Q4 还要改三处 |",
                "| 评审记录/2024-年报.md | 归档 | 历史资料 |",
                "",
            ].join("\n")
        );
        expect(r.rows).toBe(2);
        expect(r.map["需求规格 v3.md"]).toMatchObject({ status: "会改版", note: "Q4 还要改三处", source: "index" });
        expect(r.map["评审记录/2024-年报.md"].status).toBe("归档");
    });

    it("静默降级：无表格 → rows=0 + 空 map，不抛错", () => {
        const r = parseIndexDoc("# 普通文档\n\n没有状态表。");
        expect(r.rows).toBe(0);
        expect(r.map).toEqual({});
    });

    it("未知状态的行跳过该条，不抛错（lenient）", () => {
        const r = parseIndexDoc("| 文件 | 状态 |\n|---|---|\n| a.md | 状态甲 |\n| b.md | 冻结 |");
        expect(r.rows).toBe(1);
        expect(r.map["b.md"].status).toBe("冻结");
        expect(r.map["a.md"]).toBeUndefined();
    });

    it("表头 / 分隔行 / 状态列空行不算数据行", () => {
        const r = parseIndexDoc("| 文件 | 状态 |\n|---|---|\n| b.md | 冻结 |");
        expect(r.rows).toBe(1);
    });
});

describe("normalizeDeco（脚本返回值归一化）", () => {
    it("{ status } 用内置注册表的 emoji 与颜色", () => {
        const d = normalizeDeco({ status: "冻结" });
        expect(d.emoji).toBe(STATUS_DEF["冻结"].emoji);
        expect(d.color).toBe(STATUS_DEF["冻结"].color);
    });

    it("自定义 color 覆盖注册表颜色", () => {
        const d = normalizeDeco({ status: "冻结", color: "#123456" });
        expect(d.color).toBe("#123456");
    });

    it("全自定义徽标：emoji + label + color + title", () => {
        const d = normalizeDeco({ emoji: "⏳", label: "陈旧", color: "#e0a83a", title: "脚本规则：超过一年未修改" });
        expect(d.emoji).toBe("⏳");
        expect(d.label).toBe("陈旧");
        expect(d.title).toBe("脚本规则：超过一年未修改");
    });

    it("既无合法 status 也无 emoji → null（跳过该条）", () => {
        expect(normalizeDeco({})).toBeNull();
        expect(normalizeDeco({ status: "不存在的状态" } as { status: string })).toBeNull();
    });
});

describe("mergeDecorations（合并策略）", () => {
    it("脚本 > 表格 > 无徽标：脚本覆盖同名键", () => {
        const indexMap: Record<string, BadgeDeco> = {
            "实验笔记.md": { status: "冻结", emoji: "🧊", note: "先不动", source: "index" },
            "接口设计.md": { status: "冻结", emoji: "🧊", source: "index" },
        };
        const scriptMap: Record<string, BadgeDeco> = {
            "实验笔记.md": { emoji: "⏳", label: "陈旧", color: "#e0a83a", title: "脚本规则", source: "script" },
            "README.md": { status: "归档", emoji: "🗄", source: "script" },
        };
        const merged = mergeDecorations(indexMap, scriptMap);
        expect(merged["实验笔记.md"].emoji).toBe("⏳");
        expect(merged["实验笔记.md"].source).toBe("script");
        expect(merged["接口设计.md"].status).toBe("冻结");
        expect(merged["README.md"].status).toBe("归档");
    });

    it("两个源都空 → 空 map", () => {
        expect(mergeDecorations({}, {})).toEqual({});
    });
});

describe("脚本源（executeDecorate + normalizeScriptRun）", () => {
    const entries = [
        {
            name: "v1-草案.md",
            path: "/r/旧版方案/v1-草案.md",
            relPath: "旧版方案/v1-草案.md",
            isDir: false,
            modtime: Date.now() - 200 * 86400e3,
        },
        { name: "README.md", path: "/r/README.md", relPath: "README.md", isDir: false, modtime: Date.now() },
    ];

    it("脚本补表格没登记的文件：草案 → 会改版", () => {
        const run = normalizeScriptRun(
            executeDecorate('function decorate(e){ if (e.name.includes("草案")) return { status: "会改版" }; return null; }', entries)
        );
        expect(run.rows).toBe(1);
        expect(run.map["旧版方案/v1-草案.md"].emoji).toBe("🔄");
        expect(run.map["旧版方案/v1-草案.md"].source).toBe("script");
    });

    it("坏语法 → 编译失败，脚本源降级（空 map + 1 错）", () => {
        const run = normalizeScriptRun(executeDecorate("function decorate({", entries));
        expect(run.map).toEqual({});
        expect(run.errors).toBe(1);
        expect(run.errorSample).toContain("编译失败");
    });

    it("未定义 decorate → 降级", () => {
        const run = normalizeScriptRun(executeDecorate("const x = 1;", entries));
        expect(run.map).toEqual({});
        expect(run.errorSample).toContain("decorate");
    });

    it("单条抛错 → 只跳过该条，其余条照常出徽标", () => {
        const run = normalizeScriptRun(
            executeDecorate(
                'function decorate(e){ if (e.name === "README.md") throw new Error("boom"); return { status: "归档" }; }',
                entries
            )
        );
        expect(run.rows).toBe(1);
        expect(run.errors).toBe(1);
        expect(run.map["旧版方案/v1-草案.md"].status).toBe("归档");
        expect(run.map["README.md"]).toBeUndefined();
        expect(run.errorSample).toContain("README.md");
    });
});

describe("STATUS_DEF（状态注册表）", () => {
    it("四态齐备：会改版 / 冻结 / 只读 / 归档", () => {
        expect(Object.keys(STATUS_DEF).sort()).toEqual(["会改版", "冻结", "只读", "归档"].sort());
        for (const def of Object.values(STATUS_DEF)) {
            expect(def.emoji).toBeTruthy();
            expect(def.color).toMatch(/^#[0-9a-f]{6}$/i);
            expect(def.desc).toBeTruthy();
        }
    });
});
