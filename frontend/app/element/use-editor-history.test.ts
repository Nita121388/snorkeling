// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { HistoryStack, MAX_HISTORY, type EditorHistoryOp } from "./use-editor-history";

describe("HistoryStack — 统一 undo/redo 栈（P1-A 核心）", () => {
    it("记录一步后可以撤销/重做，文本正确回填", () => {
        const h = new HistoryStack();
        h.record("alpha", "beta");
        expect(h.canUndo).toBe(true);
        expect(h.canRedo).toBe(false);

        const undoEntry = h.popUndo();
        expect(undoEntry?.before).toBe("alpha");
        expect(undoEntry?.after).toBe("beta");
        expect(h.canUndo).toBe(false);
        expect(h.canRedo).toBe(true);

        const redoEntry = h.popRedo();
        expect(redoEntry?.before).toBe("alpha");
        expect(redoEntry?.after).toBe("beta");
        expect(h.canUndo).toBe(true);
        expect(h.canRedo).toBe(false);
    });

    it("连续 N 步可逐步撤销 N 次、再逐步重做 N 次", () => {
        const h = new HistoryStack();
        h.record("a", "b");
        h.record("b", "c");
        h.record("c", "d");
        expect(h.undoDepth).toBe(3);

        expect(h.popUndo()?.before).toBe("c");
        expect(h.popUndo()?.before).toBe("b");
        expect(h.popUndo()?.before).toBe("a");
        expect(h.popUndo()).toBeUndefined();

        expect(h.popRedo()?.after).toBe("b");
        expect(h.popRedo()?.after).toBe("c");
        expect(h.popRedo()?.after).toBe("d");
        expect(h.popRedo()).toBeUndefined();
    });

    it("撤销后再次编辑会清空 redo 分支", () => {
        const h = new HistoryStack();
        h.record("a", "b");
        h.record("b", "c");
        h.popUndo(); // 回到 "b"
        expect(h.canRedo).toBe(true);

        h.record("b", "x"); // 新编辑分支
        expect(h.canRedo).toBe(false);
        expect(h.undoDepth).toBe(2); // a→b, b→x
    });

    it("before===after 视为 no-op，不入栈", () => {
        const h = new HistoryStack();
        h.record("a", "a");
        expect(h.undoDepth).toBe(0);
        expect(h.popUndo()).toBeUndefined();
    });

    it("容量上限：超过 MAX_HISTORY 丢弃最旧条目", () => {
        const h = new HistoryStack();
        for (let i = 0; i < MAX_HISTORY + 50; i++) {
            h.record(`v${i}`, `v${i + 1}`);
        }
        expect(h.undoDepth).toBe(MAX_HISTORY);
        // 最旧的 v0→v1 已被挤出；栈顶是最新的。
        const top = h.popUndo();
        expect(top?.before).toBe(`v${MAX_HISTORY + 49}`);
        expect(top?.after).toBe(`v${MAX_HISTORY + 50}`);
    });

    it("clear 清空两栈", () => {
        const h = new HistoryStack();
        h.record("a", "b");
        h.record("b", "c");
        h.popUndo();
        expect(h.canUndo).toBe(true);
        expect(h.canRedo).toBe(true);
        h.clear();
        expect(h.canUndo).toBe(false);
        expect(h.canRedo).toBe(false);
        expect(h.undoDepth).toBe(0);
        expect(h.redoDepth).toBe(0);
    });
});

describe("HistoryStack — step3 S3 块级逆操作记账（数据层，行为零变化）", () => {
    const op: EditorHistoryOp = {
        blockId: "blk-1a2b3c4d-0",
        startLine: 3,
        endLine: 3,
        before: "hello",
        after: "HELLO",
    };

    it("条目携带 op；undo 弹出与 redo 回推后 op 仍在（快照 before/after 语义不变）", () => {
        const h = new HistoryStack();
        h.record("a\n\nhello", "a\n\nHELLO", op);
        const undoEntry = h.popUndo();
        expect(undoEntry?.op).toEqual(op);
        // 现有行为不变：快照仍是全文本，撤销/重做回填的就是它
        expect(undoEntry?.before).toBe("a\n\nhello");
        expect(undoEntry?.after).toBe("a\n\nHELLO");
        const redoEntry = h.popRedo();
        expect(redoEntry?.op).toEqual(op);
        expect(redoEntry?.before).toBe("a\n\nhello");
        expect(redoEntry?.after).toBe("a\n\nHELLO");
    });

    it("旧调用方不传 op 时条目形态与旧版一致（可选字段，不破契约）", () => {
        const h = new HistoryStack();
        h.record("a", "b");
        const entry = h.popUndo();
        expect(entry).toEqual({ before: "a", after: "b" });
        expect("op" in (entry as object)).toBe(false);
    });

    it("op 不参与 no-op 判定：before===after 仍不入栈", () => {
        const h = new HistoryStack();
        h.record("a", "a", op);
        expect(h.undoDepth).toBe(0);
    });

    it("连续多步各自携带自己的 op（阶段 4 逆操作需要逐步定位）", () => {
        const h = new HistoryStack();
        const opA: EditorHistoryOp = { blockId: "blk-a", startLine: 1, endLine: 1, before: "A", after: "AA" };
        const opB: EditorHistoryOp = { blockId: "blk-b", startLine: 3, endLine: 3, before: "B", after: "BB" };
        h.record("A\n\nB", "AA\n\nB", opA);
        h.record("AA\n\nB", "AA\n\nBB", opB);
        expect(h.popUndo()?.op?.blockId).toBe("blk-b");
        expect(h.popUndo()?.op?.blockId).toBe("blk-a");
    });
});
