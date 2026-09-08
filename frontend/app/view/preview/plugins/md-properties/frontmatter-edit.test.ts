// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { deleteProperty, renameProperty, setProperty, setPropertyBefore } from "./frontmatter-edit";
import { parseFrontmatterBlock, replaceFrontmatter } from "./frontmatter-block";

// 测试基线：一份「人手写过」的 frontmatter，带注释、行尾注释、flow 序列、单引号、block 序列。
const Base = [
    "# 这是顶部注释",
    "title: Hello  # 行尾注释",
    "tags: [a, b]",
    "other: 'single'",
    "list:",
    "  - x",
    "  - y",
    "count: 3",
].join("\n");

describe("setProperty", () => {
    it("只改目标行，其他行字节不变", () => {
        const out = setProperty(Base, "title", "World");
        const expected = Base.split("\n").map((l, i) => (i === 1 ? "title: World  # 行尾注释" : l)).join("\n");
        expect(out).toBe(expected);
    });

    it("保留顶部注释与行尾注释", () => {
        const out = setProperty(Base, "title", "World")!;
        expect(out).toContain("# 这是顶部注释");
        expect(out).toContain("title: World  # 行尾注释");
    });

    it("flow 序列保持 flow", () => {
        expect(setProperty(Base, "tags", ["a", "b", "c"])).toContain("tags: [a, b, c]");
    });

    it("block 序列保持 block 且缩进不变", () => {
        const out = setProperty(Base, "list", ["x", "z"])!;
        expect(out).toContain("list:\n  - x\n  - z");
    });

    it("沿用原单引号风格", () => {
        expect(setProperty(Base, "other", "double")).toContain("other: 'double'");
    });

    it("值含特殊字符时自动加引号", () => {
        const out = setProperty(Base, "title", "a: b")!;
        expect(out.split("\n")[1]).toMatch(/^title: ["']a: b["']  # 行尾注释$/);
    });

    it("数字/布尔按标量写入", () => {
        expect(setProperty(Base, "count", 42)).toContain("count: 42");
        expect(setProperty(Base, "count", true)).toContain("count: true");
    });

    it("key 不存在时追加到末尾（不改原有行）", () => {
        const out = setProperty(Base, "newKey", "v")!;
        expect(out.split("\n").slice(0, 8).join("\n")).toBe(Base);
        expect(out.split("\n")[8]).toBe("newKey: v");
    });

    it("语法错误时返回 null，不做猜测改写", () => {
        expect(setProperty("a: [unclosed", "a", "b")).toBeNull();
    });

    it("空数组写成 flow 空序列", () => {
        expect(setProperty(Base, "tags", [])).toContain("tags: []");
    });
});

describe("deleteProperty", () => {
    it("删除整块（含多行值）且不影响其他行", () => {
        const out = deleteProperty(Base, "list")!;
        expect(out).not.toContain("- x");
        expect(out).toContain("title: Hello  # 行尾注释");
        expect(out).toContain("count: 3");
    });

    it("删除不存在的 key 返回 null", () => {
        expect(deleteProperty(Base, "nope")).toBeNull();
    });
});

describe("renameProperty", () => {
    it("保持位置与值", () => {
        const out = renameProperty(Base, "title", "name")!;
        expect(out.split("\n")[1]).toBe("name: Hello  # 行尾注释");
    });

    it("目标名已存在时拒绝", () => {
        expect(renameProperty(Base, "title", "count")).toBeNull();
    });
});

describe("setPropertyBefore", () => {
    it("把属性移到指定属性之前", () => {
        const out = setPropertyBefore(Base, "count", "title")!;
        expect(out.split("\n")[1]).toBe("count: 3");
        expect(out).toContain("# 这是顶部注释");
    });

    it("beforeKey 为 null 时移到末尾", () => {
        const out = setPropertyBefore(Base, "title", null)!;
        const lines = out.split("\n");
        expect(lines[lines.length - 1]).toBe("title: Hello  # 行尾注释");
    });

    it("移动后不丢失任何属性", () => {
        const out = setPropertyBefore(Base, "title", "count")!;
        for (const k of ["title", "tags", "other", "list", "count"]) {
            expect(out).toContain(k + ":");
        }
        expect(out).toContain("# 这是顶部注释");
    });
});

describe("端到端写回（配合 replaceFrontmatter）", () => {
    const md = ["---", ...Base.split("\n"), "---", "", "# 正文不受影响"].join("\n");

    it("改一个属性 → 整个文件只有那一行变化", () => {
        const fb = parseFrontmatterBlock(md)!;
        const newYaml = setProperty(fb.yamlText, "title", "World")!;
        const out = replaceFrontmatter(md, fb, newYaml);
        const before = md.split("\n");
        const after = out.split("\n");
        const changed = after.filter((line, i) => line !== before[i]);
        expect(changed).toEqual(["title: World  # 行尾注释"]);
    });

    it("正文与注释都不受影响", () => {
        const fb = parseFrontmatterBlock(md)!;
        const newYaml = setProperty(fb.yamlText, "count", 10)!;
        const out = replaceFrontmatter(md, fb, newYaml);
        expect(out).toContain("# 这是顶部注释");
        expect(out).toContain("# 正文不受影响");
        expect(out).toContain("tags: [a, b]");
        expect(out).toContain("other: 'single'");
    });
});

describe("round-trip", () => {
    it("连续多次编辑仍然合法且与 YAML.parse 一致", async () => {
        const YAML = (await import("yaml")).default;
        let text = Base;
        text = setProperty(text, "title", "第二版")!;
        text = setProperty(text, "tags", ["a", "c"])!;
        text = setProperty(text, "count", 9)!;
        const data = YAML.parse(text);
        expect(data).toMatchObject({ title: "第二版", tags: ["a", "c"], count: 9, other: "single", list: ["x", "y"] });
        expect(text).toContain("# 这是顶部注释");
        expect(text).toContain("# 行尾注释");
    });
});
