// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * 阶段 4 M1：结构操作可独立求逆（`invertStructuralOp(op)(after) === before`）。
 *
 * 契约（design.md）：
 *   - 三种操作用控制器 apply 后的文本正确（含多块范围、首末边界、目标在源前/后）。
 *   - 每种操作都能只凭 `op` 还原（不依赖历史快照）。
 *
 * 求逆成立的定义域：**空行分隔的真实块**，move 的锚点取「块边界」（某块起始行之前 /
 * 某块末行之后）。这是因为前向纯函数 `moveBlockRange` / `deleteBlockRange` 本身就：
 *   · 会把文档首/尾空行裁掉（有损；op 里以 `edgeBlanks` 记下并补回）；
 *   · 对相邻（无空行分隔）的块插入分隔空行（会把 `- a\n- b` 变成带空行结构）。
 * 这两条是既有行为（M2 要求逐字节不变），所以 invert 的目标域就是它们不变的场景：
 * 空行分隔的块 + 块边界锚点。文件末尾用一个 sweep 用例把这条边界固化成回归护栏。
 */

import { describe, expect, it } from "vitest";
import { buildBlockTree } from "./tree";
import {
    edgeBlankCounts,
    invertStructuralOp,
    makeDeleteOp,
    moveBlockRange,
    deleteBlockRange,
    type StructuralOp,
} from "./structural-ops";
import { spliceInsertBlock } from "../markdown-inline-edit";

/** 用既有纯函数造一个 move op（与控制器 move-block 分支同构，便于独立测 invert）。 */
function makeMoveOp(text: string, s: number, e: number, tgt: number, mode: "before" | "after") {
    const res = moveBlockRange(text, s, e, tgt, mode);
    const h = e - s + 1;
    const op: StructuralOp = {
        type: "move",
        from: { start: s, end: e },
        to: { start: res.newStartLine, end: res.newStartLine + h - 1 },
        edgeBlanks: edgeBlankCounts(text.split("\n")),
    };
    return { text: res.text, op };
}

function makeDuplicateOp(text: string, s: number, e: number) {
    const lines = text.split("\n");
    const blockLines = lines.slice(s - 1, e);
    const next = spliceInsertBlock(lines, s, e, "after", blockLines).join("\n");
    const op: StructuralOp = {
        type: "duplicate",
        range: { start: s, end: e },
        copyRange: { start: e + 2, end: e + 1 + blockLines.length },
    };
    return { text: next, op };
}

describe("invertStructuralOp — move", () => {
    it("单块下移：移回原位", () => {
        const before = "A\n\nB\n\nC";
        const { text, op } = makeMoveOp(before, 3, 3, 5, "after"); // B 到 C 之后
        expect(text).toBe("A\n\nC\n\nB");
        expect(invertStructuralOp(op)(text)).toBe(before);
    });

    it("单块上移：移回原位", () => {
        const before = "A\n\nB\n\nC";
        const { text, op } = makeMoveOp(before, 5, 5, 1, "before"); // C 到 A 之前
        expect(text).toBe("C\n\nA\n\nB");
        expect(invertStructuralOp(op)(text)).toBe(before);
    });

    it("多块范围上移（from.start 会落进 to 范围——锚点必须避开）", () => {
        const before = "A\n\nB\n\nC\n\nD";
        const { text, op } = makeMoveOp(before, 5, 7, 1, "before"); // C,D 到 A 之前
        expect(text).toBe("C\n\nD\n\nA\n\nB");
        expect(invertStructuralOp(op)(text)).toBe(before);
    });

    it("多块范围下移：移回原位", () => {
        const before = "A\n\nB\n\nC\n\nD";
        const { text, op } = makeMoveOp(before, 1, 3, 7, "after"); // A,B 到 D 之后
        expect(text).toBe("C\n\nD\n\nA\n\nB");
        expect(invertStructuralOp(op)(text)).toBe(before);
    });

    it("末块上移到首块之前（首末边界）", () => {
        const before = "A\n\nB\n\nC";
        const { text, op } = makeMoveOp(before, 5, 5, 1, "before");
        expect(invertStructuralOp(op)(text)).toBe(before);
    });

    it("文档以空行结尾：invert 把尾部换行补回（edgeBlanks）", () => {
        const before = "A\n\nB\n\nC\n";
        const { text, op } = makeMoveOp(before, 1, 1, 5, "after");
        expect(invertStructuralOp(op)(text)).toBe(before);
    });
});

describe("invertStructuralOp — delete", () => {
    it("删除中段块：content 含折叠掉的分隔空行，插回原位", () => {
        const before = "A\n\nB\n\nC";
        const after = deleteBlockRange(before, 3, 3);
        expect(after).toBe("A\n\nC");
        const op = makeDeleteOp(before, after, { start: 3, end: 3 });
        expect(invertStructuralOp(op)(after)).toBe(before);
    });

    it("删除首块（首边界）", () => {
        const before = "A\n\nB\n\nC";
        const after = deleteBlockRange(before, 1, 1);
        expect(after).toBe("B\n\nC");
        const op = makeDeleteOp(before, after, { start: 1, end: 1 });
        expect(invertStructuralOp(op)(after)).toBe(before);
    });

    it("删除末块（末边界）", () => {
        const before = "A\n\nB\n\nC";
        const after = deleteBlockRange(before, 5, 5);
        expect(after).toBe("A\n\nB");
        const op = makeDeleteOp(before, after, { start: 5, end: 5 });
        expect(invertStructuralOp(op)(after)).toBe(before);
    });

    it("删除多块范围", () => {
        const before = "A\n\nB\n\nC\n\nD";
        const after = deleteBlockRange(before, 3, 5);
        expect(after).toBe("A\n\nD");
        const op = makeDeleteOp(before, after, { start: 3, end: 5 });
        expect(invertStructuralOp(op)(after)).toBe(before);
    });

    it("文档以空行结尾：tail 换行也逐字节还原", () => {
        const before = "A\n\nB\n\nC\n";
        const after = deleteBlockRange(before, 3, 3);
        const op = makeDeleteOp(before, after, { start: 3, end: 3 });
        expect(invertStructuralOp(op)(after)).toBe(before);
    });
});

describe("invertStructuralOp — duplicate", () => {
    it("单块复制：副本紧随其后，逆操作删掉副本", () => {
        const before = "A\n\nB\n\nC";
        const { text, op } = makeDuplicateOp(before, 3, 3);
        expect(text).toBe("A\n\nB\n\nB\n\nC");
        expect(invertStructuralOp(op)(text)).toBe(before);
    });

    it("多块范围复制", () => {
        const before = "A\n\nB\n\nC\n\nD";
        const { text, op } = makeDuplicateOp(before, 3, 5);
        expect(text).toBe("A\n\nB\n\nC\n\nB\n\nC\n\nD");
        expect(invertStructuralOp(op)(text)).toBe(before);
    });

    it("复制末块（末边界）", () => {
        const before = "A\n\nB";
        const { text, op } = makeDuplicateOp(before, 3, 3);
        expect(text).toBe("A\n\nB\n\nB");
        expect(invertStructuralOp(op)(text)).toBe(before);
    });
});

/**
 * 边界 sweep（回归护栏）：在「空行分隔的真实块 + 块边界锚点」域内穷举，三种操作都必须
 * 逐字节可逆。任何让 invert 漂移的改动都会在这里被抓住。
 */
describe("invertStructuralOp — 域内穷举（move/delete/duplicate 均可逆）", () => {
    const DOCS = [
        "A\n\nB\n\nC",
        "A\n\nB\n\nC\n",
        "A\n\nB\n\nC\n\nD",
        "\n\nA\n\nB\n\nC",
        "A\n\nB\n\nC\n\n",
        "\nA\n\nB\n\nC\n\n",
        "- a\n\n- b\n\n- c",
        "> q1\n\n> q2\n\nplain",
        "```js\nconst a=1;\n```\n\nafter",
        "# T\n\np1\n\np2\n\np3",
        "only",
    ];

    function blockRanges(doc: string): { s: number; e: number }[] {
        const lines = doc.split("\n");
        const blocks = buildBlockTree(lines);
        const out: { s: number; e: number }[] = [];
        const separated = (s0: number, e0: number) =>
            (s0 === 1 || lines[s0 - 2] === "") && (e0 === lines.length || lines[e0] === "");
        for (let i = 0; i < blocks.length; i++) {
            for (let j = i; j < blocks.length; j++) {
                const s0 = blocks[i].startLine + 1;
                const e0 = blocks[j].endLine + 1;
                if (separated(s0, e0)) out.push({ s: s0, e: e0 });
            }
        }
        return out;
    }

    function anchors(doc: string): { tgt: number; mode: "before" | "after" }[] {
        const blocks = buildBlockTree(doc.split("\n"));
        const out: { tgt: number; mode: "before" | "after" }[] = [];
        for (const b of blocks) {
            out.push({ tgt: b.startLine + 1, mode: "before" });
            out.push({ tgt: b.endLine + 1, mode: "after" });
        }
        return out;
    }

    it("move：全部 (范围 × 锚点) 组合可逆", () => {
        const fails: string[] = [];
        for (const doc of DOCS) {
            for (const { s, e } of blockRanges(doc)) {
                for (const { tgt, mode } of anchors(doc)) {
                    const { text, op } = makeMoveOp(doc, s, e, tgt, mode);
                    if (text === doc) continue;
                    const back = invertStructuralOp(op)(text);
                    if (back !== doc) fails.push(JSON.stringify({ doc, s, e, tgt, mode, text, op, back }));
                }
            }
        }
        expect(fails.slice(0, 5)).toEqual([]);
    });

    it("delete：全部块范围可逆（含末块/首块/多块）", () => {
        const fails: string[] = [];
        for (const doc of DOCS) {
            for (const { s, e } of blockRanges(doc)) {
                const after = deleteBlockRange(doc, s, e);
                if (after === doc) continue;
                const op = makeDeleteOp(doc, after, { start: s, end: e });
                const back = invertStructuralOp(op)(after);
                if (back !== doc) fails.push(JSON.stringify({ doc, s, e, after, op, back }));
            }
        }
        expect(fails.slice(0, 5)).toEqual([]);
    });

    it("duplicate：全部块范围可逆", () => {
        const fails: string[] = [];
        for (const doc of DOCS) {
            for (const { s, e } of blockRanges(doc)) {
                const { text, op } = makeDuplicateOp(doc, s, e);
                if (text === doc) continue;
                const back = invertStructuralOp(op)(text);
                if (back !== doc) fails.push(JSON.stringify({ doc, s, e, text, op, back }));
            }
        }
        expect(fails.slice(0, 5)).toEqual([]);
    });
});
