// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { buildBlockTree, type Block } from "./tree";

describe("buildBlockTree — M1 只读块模型（P1-B）", () => {
    it("标题与段落：正确产出行坐标", () => {
        const lines = ["# Title", "", "Some paragraph text", "", "More text"].map((l) => l);
        const tree = buildBlockTree(lines);
        expect(tree).toHaveLength(3);
        expect(tree[0]).toMatchObject({ kind: "heading1", startLine: 0, endLine: 0 });
        expect(tree[1]).toMatchObject({ kind: "text", startLine: 2, endLine: 2 });
        expect(tree[2]).toMatchObject({ kind: "text", startLine: 4, endLine: 4 });
    });

    it("代码围栏：跨行合并为一块 code", () => {
        const lines = ["before", "```js", "const x = 1;", "```", "after"];
        const tree = buildBlockTree(lines);
        expect(tree).toHaveLength(3);
        expect(tree[1]).toMatchObject({ kind: "code", startLine: 1, endLine: 3 });
        expect(tree[1].text).toBe("```js\nconst x = 1;\n```");
    });

    it("表格：header+分隔+body 合并为一块 table", () => {
        const lines = ["| a | b |", "| --- | --- |", "| 1 | 2 |"];
        const tree = buildBlockTree(lines);
        expect(tree).toHaveLength(1);
        expect(tree[0]).toMatchObject({ kind: "table", startLine: 0, endLine: 2 });
    });

    it("列表组：每项一个顶层块，项间坐标精确", () => {
        const lines = ["- alpha", "- beta", "- gamma"];
        const tree = buildBlockTree(lines);
        expect(tree).toHaveLength(3);
        expect(tree[0]).toMatchObject({ kind: "bulleted", startLine: 0, endLine: 0 });
        expect(tree[1]).toMatchObject({ kind: "bulleted", startLine: 1, endLine: 1 });
        expect(tree[2]).toMatchObject({ kind: "bulleted", startLine: 2, endLine: 2 });
    });

    it("有序列表项：kind 为 numbered", () => {
        const lines = ["1. first", "2. second"];
        const tree = buildBlockTree(lines);
        expect(tree[0]).toMatchObject({ kind: "numbered", startLine: 0 });
        expect(tree[1]).toMatchObject({ kind: "numbered", startLine: 1 });
    });

    it("任务列表项：kind 为 todo", () => {
        const lines = ["- [ ] open", "- [x] done"];
        const tree = buildBlockTree(lines);
        expect(tree[0]).toMatchObject({ kind: "todo", startLine: 0 });
        expect(tree[1]).toMatchObject({ kind: "todo", startLine: 1 });
    });

    it("引用：连续 > 行合并为一块 quote", () => {
        const lines = ["> line one", "> line two"];
        const tree = buildBlockTree(lines);
        expect(tree).toHaveLength(1);
        expect(tree[0]).toMatchObject({ kind: "quote", startLine: 0, endLine: 1 });
    });

    it("callout：> [!note] 识别为 callout", () => {
        const lines = ["> [!note] Important", "> body"];
        const tree = buildBlockTree(lines);
        expect(tree).toHaveLength(1);
        expect(tree[0]).toMatchObject({ kind: "callout", startLine: 0, endLine: 1 });
    });

    it("分隔线：识别为 hr 块，坐标精确", () => {
        const doc = ["a", "***", "b"];
        const tree = buildBlockTree(doc);
        expect(tree).toHaveLength(3);
        expect(tree[0]).toMatchObject({ kind: "text", startLine: 0 });
        expect(tree[1]).toMatchObject({ kind: "hr", startLine: 1, endLine: 1 });
        expect(tree[2]).toMatchObject({ kind: "text", startLine: 2 });
    });

    it("分隔线变体：--- / ___ 与 - - - 均识别为 hr，且不吞并相邻段落", () => {
        for (const sep of ["---", "___", "- - -"]) {
            const tree = buildBlockTree(["a", sep, "b"]);
            expect(tree).toHaveLength(3);
            expect(tree[1]).toMatchObject({ kind: "hr", startLine: 1, endLine: 1 });
            expect(tree[0]).toMatchObject({ kind: "text", startLine: 0 });
            expect(tree[2]).toMatchObject({ kind: "text", startLine: 2 });
        }
    });

    it("多段文本隔 hr：坐标严格不重叠且不跨 hr", () => {
        const lines = ["P1", "***", "P2", "***", "P3"];
        const tree = buildBlockTree(lines);
        expect(tree).toHaveLength(5);
        expect(tree.map((b) => [b.kind, b.startLine, b.endLine])).toEqual([
            ["text", 0, 0],
            ["hr", 1, 1],
            ["text", 2, 2],
            ["hr", 3, 3],
            ["text", 4, 4],
        ]);
    });

    it("嵌套列表：两层缩进，内层为 children", () => {
        const lines = ["- parent", "  - child a", "  - child b"];
        const tree = buildBlockTree(lines);
        expect(tree).toHaveLength(1); // parent 一项，内层两个孩子
        expect(tree[0]).toMatchObject({ kind: "bulleted", startLine: 0, endLine: 2 });
        expect(tree[0].children).toHaveLength(2);
        expect(tree[0].children[0]).toMatchObject({ kind: "bulleted", startLine: 1, depth: 1 });
        expect(tree[0].children[1]).toMatchObject({ kind: "bulleted", startLine: 2, depth: 1 });
    });

    it("多类型组合文档：坐标不重叠、顺序正确", () => {
        const lines = [
            "# H",
            "",
            "para",
            "",
            "- a",
            "- b",
            "",
            "```",
            "code",
            "```",
            "",
            "| x |",
            "| --- |",
        ];
        const tree = buildBlockTree(lines);
        // heading, para, list(a), list(b), code, table
        expect(tree).toHaveLength(6);
        expect(tree[0]).toMatchObject({ kind: "heading1", startLine: 0 });
        expect(tree[1]).toMatchObject({ kind: "text", startLine: 2 });
        expect(tree[2]).toMatchObject({ kind: "bulleted", startLine: 4 });
        expect(tree[3]).toMatchObject({ kind: "bulleted", startLine: 5 });
        expect(tree[4]).toMatchObject({ kind: "code", startLine: 7, endLine: 9 });
        expect(tree[5]).toMatchObject({ kind: "table", startLine: 11, endLine: 12 });
        // 坐标不重叠
        for (let k = 1; k < tree.length; k++) {
            expect(tree[k].startLine).toBeGreaterThan(tree[k - 1].endLine);
        }
    });

    it("块 id 稳定且唯一", () => {
        const lines = ["# A", "", "# B"];
        const tree = buildBlockTree(lines);
        expect(tree[0].id).toBeTypeOf("string");
        expect(tree[0].id.length).toBeGreaterThan(0);
        expect(tree[0].id).not.toBe(tree[1].id);
        // 幂等：同样输入产出相同 id
        const again = buildBlockTree(lines);
        expect(again[0].id).toBe(tree[0].id);
        expect(again[1].id).toBe(tree[1].id);
    });

    it("空输入产出空树", () => {
        expect(buildBlockTree([])).toHaveLength(0);
        expect(buildBlockTree(["", "", ""])).toHaveLength(0);
    });
});

// 帮助 assert Block 形状的类型守卫（供上面的测试引用，避免未使用告警）
export type { Block };
