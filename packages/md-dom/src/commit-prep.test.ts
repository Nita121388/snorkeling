// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom

/**
 * `md-dom` 提交前置层的独立测试面：块身份重定位 + 陈旧检测。
 *
 * 这层是**数据安全红线**的执行点。它的失效方式非常安静：
 *   - 重定位错 → 改动落到**另一个块**上（别人的内容被覆盖）
 *   - 陈旧漏检 → 覆盖编辑期间的外部改动
 * 所以这里的用例按「失败会写错哪里」来组织，而不是按函数签名。
 *
 * 关键不变量（改这层时不要破）：
 *   ① id 命中优先；② id 落空才按内容唯一匹配；③ 多候选 = 真歧义 → **不猜**，退回捕获范围；
 *   ④ 陈旧必须拒写；⑤ 先重定位再比对（顺序颠倒会把所有合法提交都拦死）。
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
    isStaleTargetBlock,
    MarkdownRenderRootSelector,
    prepareInlineEditCommit,
    relocateByBlockId,
    relocateByContent,
    type BlockEditTarget,
} from "./commit-prep";

let root: HTMLElement;

beforeEach(() => {
    root = document.createElement("div");
    root.className = MarkdownRenderRootSelector.replace(".", "");
    document.body.appendChild(root);
});

afterEach(() => {
    root.remove();
});

function addBlock(attrs: { line: number; endLine?: number; blockId?: string; text: string }): HTMLElement {
    const el = document.createElement("div");
    el.setAttribute("data-source-line", String(attrs.line));
    if (attrs.endLine != null) {
        el.setAttribute("data-source-line-end", String(attrs.endLine));
    }
    if (attrs.blockId != null) {
        el.setAttribute("data-block-id", attrs.blockId);
    }
    el.textContent = attrs.text;
    root.appendChild(el);
    return el;
}

// 注意：endLine 必须显式给。单行块 end===start，但**默认值不会跟随 startLine 覆盖** ——
// 只写 startLine 会让 endLine 停在 1，切片变成空，于是所有用例都“陈旧”。
const session = (over: Partial<BlockEditTarget> = {}): BlockEditTarget => ({
    blockKind: "p",
    startLine: 1,
    initialContent: "alpha",
    ...over,
    endLine: over.endLine ?? over.startLine ?? 1,
});

describe("relocateByBlockId：id 是身份，行号是坐标", () => {
    it("命中：返回**当前**行号（不是捕获时的）", () => {
        addBlock({ line: 7, blockId: "blk-a-0", text: "alpha" });
        expect(relocateByBlockId(root, "blk-a-0")).toEqual({ startLine: 7, endLine: 7 });
    });

    it("多行块：data-source-line-end 一起返回", () => {
        addBlock({ line: 3, endLine: 5, blockId: "blk-b-0", text: "multi" });
        expect(relocateByBlockId(root, "blk-b-0")).toEqual({ startLine: 3, endLine: 5 });
    });

    it("未命中 / 无 id / 空 id → null（退化为不做重定位，不报错）", () => {
        addBlock({ line: 1, blockId: "blk-a-0", text: "alpha" });
        expect(relocateByBlockId(root, "blk-nope")).toBeNull();
        expect(relocateByBlockId(root, undefined)).toBeNull();
        expect(relocateByBlockId(root, "")).toBeNull();
        expect(relocateByBlockId(null, "blk-a-0")).toBeNull();
    });

    it("带同一 id 但没有坐标的元素被跳过（表格 wrapper vs 内层 <table> 的真实形状）", () => {
        const wrapper = document.createElement("div");
        wrapper.setAttribute("data-block-id", "blk-t-0"); // 无 data-source-line
        wrapper.textContent = "wrapper";
        root.appendChild(wrapper);
        addBlock({ line: 4, blockId: "blk-t-0", text: "inner" });
        expect(relocateByBlockId(root, "blk-t-0")).toEqual({ startLine: 4, endLine: 4 });
    });
});

describe("isStaleTargetBlock：陈旧就拒写", () => {
    const fullText = ["# h", "", "alpha", "", "beta"].join("\n");

    it("一致 → 不陈旧", () => {
        expect(isStaleTargetBlock(session({ startLine: 3, initialContent: "alpha" }), fullText)).toBe(false);
    });

    it("当前切片与捕获时不符 → 陈旧", () => {
        expect(isStaleTargetBlock(session({ startLine: 5, initialContent: "alpha" }), fullText)).toBe(true);
    });

    it("initialContent 为 \"\"（placeholder / 空块）→ 没有可比基准，不判陈旧", () => {
        expect(isStaleTargetBlock(session({ startLine: 3, initialContent: "" }), fullText)).toBe(false);
    });

    it("insertMode（块边缘插入，写的是新增内容）→ 不判陈旧", () => {
        expect(
            isStaleTargetBlock(session({ startLine: 3, initialContent: "alpha", insertMode: "after" }), fullText)
        ).toBe(false);
    });

    it("列表归一化两侧共用：marker 差异不误判（`- a` vs 捕获的 `a`）", () => {
        const text = "- alpha";
        // 捕获时用 initialContentFor("list", "- alpha") === "alpha"
        expect(isStaleTargetBlock(session({ blockKind: "list", startLine: 1, initialContent: "alpha" }), text)).toBe(
            false
        );
    });
});

describe("relocateByContent：id 落空时的退化重定位（只在唯一候选时采用）", () => {
    it("唯一候选 → 命中", () => {
        addBlock({ line: 3, text: "alpha" });
        addBlock({ line: 9, text: "beta" });
        const fullText = ["", "", "alpha", "", "", "", "", "", "beta"].join("\n");
        expect(relocateByContent(root, session({ initialContent: "alpha" }), fullText)).toEqual({
            startLine: 3,
            endLine: 3,
        });
    });

    it("多候选 → null（真歧义不猜：宁可失去重定位，也不让改动落到另一个块）", () => {
        addBlock({ line: 3, text: "alpha" });
        addBlock({ line: 9, text: "alpha" });
        const fullText = ["", "", "alpha", "", "", "", "", "", "alpha"].join("\n");
        expect(relocateByContent(root, session({ initialContent: "alpha" }), fullText)).toBeNull();
    });

    it("没有候选 → null", () => {
        addBlock({ line: 3, text: "zzz" });
        expect(relocateByContent(root, session({ initialContent: "alpha" }), "alpha")).toBeNull();
    });

    it("只实现 querySelector 的桩 root → 安全返回 null（不抛）", () => {
        const stub = { querySelector: () => null } as unknown as ParentNode;
        expect(relocateByContent(stub, session({ initialContent: "alpha" }), "alpha")).toBeNull();
    });
});

describe("prepareInlineEditCommit：顺序与决策不可颠倒", () => {
    it("顺序：**先重定位再比对**。行号位移后合法提交必须放行，而不是被判陈旧", () => {
        // 块被外部插入推后一行：文本位移 + DOM 坐标同步更新（真实场景）
        addBlock({ line: 4, blockId: "blk-a-0", text: "alpha" });
        const fullText = ["", "# h", "", "alpha"].join("\n"); // alpha 现在在第 4 行
        const prepared = prepareInlineEditCommit(
            session({ startLine: 3, initialContent: "alpha", blockId: "blk-a-0" }),
            fullText,
            root
        );
        expect(prepared.ok).toBe(true);
        if (prepared.ok) {
            expect(prepared.session.startLine).toBe(4);
            expect(prepared.relocated).toBe(true);
            expect(prepared.relocatedBy).toBe("id");
        }
    });

    it("id 落空但内容唯一 → 用 content 重定位", () => {
        addBlock({ line: 4, text: "alpha" });
        const fullText = ["", "# h", "", "alpha"].join("\n");
        const prepared = prepareInlineEditCommit(
            session({ startLine: 1, initialContent: "alpha", blockId: "blk-gone" }),
            fullText,
            root
        );
        expect(prepared.ok).toBe(true);
        if (prepared.ok) {
            expect(prepared.relocatedBy).toBe("content");
            expect(prepared.session.startLine).toBe(4);
        }
    });

    it("外部改过本块内容 → 拒写（ok=false, reason=stale）", () => {
        addBlock({ line: 4, blockId: "blk-a-0", text: "已被改成别的" });
        const fullText = ["", "# h", "", "已被改成别的"].join("\n");
        const prepared = prepareInlineEditCommit(
            session({ startLine: 4, initialContent: "alpha", blockId: "blk-a-0" }),
            fullText,
            root
        );
        expect(prepared.ok).toBe(false);
        if (!prepared.ok) {
            expect(prepared.reason).toBe("stale");
        }
    });

    it("拿不到 id、也拿不到坐标 → 退回捕获范围，仍过内容守卫（不漏防护）", () => {
        const fullText = ["", "", "alpha"].join("\n");
        const prepared = prepareInlineEditCommit(
            session({ startLine: 3, initialContent: "alpha", blockId: "blk-gone" }),
            fullText,
            root
        );
        expect(prepared.ok).toBe(true);
        if (prepared.ok) {
            expect(prepared.relocated).toBe(false);
            expect(prepared.session.startLine).toBe(3); // 保持捕获范围
        }
    });

    it("保留调用方会话类型（泛型）：额外字段在 ok 分支里仍可见", () => {
        const fullText = ["", "", "alpha"].join("\n");
        const prepared = prepareInlineEditCommit(
            { ...session({ startLine: 3, initialContent: "alpha" }), extra: 42 },
            fullText,
            root
        );
        expect(prepared.ok).toBe(true);
        if (prepared.ok) {
            expect((prepared.session as { extra: number }).extra).toBe(42);
        }
    });
});
