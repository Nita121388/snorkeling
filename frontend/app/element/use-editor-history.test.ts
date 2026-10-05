// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { HistoryStack, MAX_HISTORY } from "./use-editor-history";

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
