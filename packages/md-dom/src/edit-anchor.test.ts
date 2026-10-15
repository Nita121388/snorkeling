// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom

/**
 * 锚点解析的独立测试面。
 *
 * 关注点不是"能不能跑"，而是**两条路径必须算出同一个基准** —— `initialContent` 是
 * 陈旧检测的比较基准，它一旦漂移，要么合法提交被判陈旧（静默丢弃用户的编辑），
 * 要么拿错的基准去覆盖别人的改动。所以这里刻意把边界逐条钉住。
 */

import { beforeEach, describe, expect, it } from "vitest";
import { resolveEditAnchor } from "./edit-anchor";

let target: HTMLElement;

beforeEach(() => {
    document.body.innerHTML = "";
    target = document.createElement("div");
    target.className = "paragraph";
    document.body.appendChild(target);
});

const DOC = ["# 标题", "", "alpha", "", "beta"].join("\n");

describe("resolveEditAnchor：块定位与内容基准", () => {
    it("单行块：按行号切片，归一化后作为基准", () => {
        const r = resolveEditAnchor({ blockKind: "p", line: 3, targetEl: target, fullText: DOC });
        expect(r.ok).toBe(true);
        if (r.ok) {
            expect(r.anchor).toMatchObject({ safeLine: 3, endLine: 3, sourceContent: "alpha", initialContent: "alpha" });
        }
    });

    it("多行视觉块：data-source-line-end 决定范围（软换行段落必须整块切）", () => {
        target.setAttribute("data-source-line-end", "5");
        const r = resolveEditAnchor({ blockKind: "p", line: 3, targetEl: target, fullText: DOC });
        expect(r.ok).toBe(true);
        if (r.ok) {
            expect(r.anchor.endLine).toBe(5);
            expect(r.anchor.sourceContent).toBe("alpha\n\nbeta");
        }
    });

    it("end 属性缺失 / 非法 / 小于 start → 一律退回单行（旧块不能被锁死）", () => {
        for (const bad of ["", "abc", "0", "2", "-5"]) {
            target.setAttribute("data-source-line-end", bad);
            const r = resolveEditAnchor({ blockKind: "p", line: 3, targetEl: target, fullText: DOC });
            expect(r.ok, `end="${bad}"`).toBe(true);
            if (r.ok) expect(r.anchor.endLine, `end="${bad}"`).toBe(3);
        }
    });

    it("end 超出全文行数 → 截到末行（不产生越界切片）", () => {
        target.setAttribute("data-source-line-end", "999");
        const r = resolveEditAnchor({ blockKind: "p", line: 3, targetEl: target, fullText: DOC });
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.anchor.endLine).toBe(5);
    });

    it("行号超出全文 → 拒绝（调用方据此回落 overlay，不能拿不存在的位置开会话）", () => {
        const r = resolveEditAnchor({ blockKind: "p", line: 99, targetEl: target, fullText: DOC });
        expect(r).toMatchObject({ ok: false, reason: "line-out-of-range" });
    });

    it("行号非法（0 / 负数 / 小数）→ 收敛到合法值，不抛错", () => {
        for (const [input, expected] of [
            [0, 1],
            [-7, 1],
            [2.9, 2],
        ] as const) {
            const r = resolveEditAnchor({ blockKind: "p", line: input, targetEl: target, fullText: DOC });
            expect(r.ok).toBe(true);
            if (r.ok) expect(r.anchor.safeLine, `line=${input}`).toBe(expected);
        }
    });

    it("块身份从 DOM 上读（提交时靠它重定位，行号位移也能写对位置）", () => {
        target.setAttribute("data-block-id", "blk-42");
        const r = resolveEditAnchor({ blockKind: "p", line: 3, targetEl: target, fullText: DOC });
        if (r.ok) expect(r.anchor.blockId).toBe("blk-42");
    });

    it("无块身份 → undefined（提交时跳过重定位，而不是崩溃）", () => {
        const r = resolveEditAnchor({ blockKind: "p", line: 3, targetEl: target, fullText: DOC });
        if (r.ok) expect(r.anchor.blockId).toBeUndefined();
    });

    it("heading：归一化**不**剥 #（基准必须逐字节等于源码行）", () => {
        const r = resolveEditAnchor({ blockKind: "h", line: 1, targetEl: target, fullText: DOC });
        expect(r.ok).toBe(true);
        if (r.ok) {
            expect(r.anchor.sourceContent).toBe("# 标题");
            // 只有 list/code 会剥源码专属的语法（marker / 围栏）。heading 不剥是**必需的**：
            // 基准一旦不等于源码行，陈旧检测会把每次合法提交都判成陈旧而静默丢弃。
            expect(r.anchor.initialContent).toBe("# 标题");
        }
    });

    it("callout + 正文已剥 marker → 给出前缀（提交时按原文大小写回写）", () => {
        target = document.createElement("calloutalert");
        document.body.appendChild(target);
        const doc = "> [!Note] 引用标题\n> 正文";
        const r = resolveEditAnchor({
            blockKind: "quote",
            line: 1,
            targetEl: target,
            fullText: doc,
            stripsCalloutMarker: true,
        });
        expect(r.ok).toBe(true);
        if (r.ok) {
            expect(r.anchor.isCallout).toBe(true);
            expect(r.anchor.calloutPrefix).toBe("[!Note] ");
        }
    });

    it("callout 但 stripsCalloutMarker=false（textarea 回落）→ **不给前缀**，防提交写两遍 marker", () => {
        target = document.createElement("calloutalert");
        document.body.appendChild(target);
        const doc = "> [!Note] 引用标题\n> 正文";
        const r = resolveEditAnchor({
            blockKind: "quote",
            line: 1,
            targetEl: target,
            fullText: doc,
            stripsCalloutMarker: false,
        });
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.anchor.calloutPrefix).toBeUndefined();
    });

    it("普通引用 → 无前缀（不是 callout，不该走回写分支）", () => {
        const doc = "> 普通引用";
        const r = resolveEditAnchor({
            blockKind: "quote",
            line: 1,
            targetEl: target,
            fullText: doc,
            stripsCalloutMarker: true,
        });
        expect(r.ok).toBe(true);
        if (r.ok) {
            expect(r.anchor.isCallout).toBe(false);
            expect(r.anchor.calloutPrefix).toBeUndefined();
        }
    });

    it("列表：归一化只剥首行 marker（正则无 /m；两侧共用同一函数所以恒等、不会误判陈旧）", () => {
        target.setAttribute("data-source-line-end", "2");
        const doc = "- a\n- b";
        const r = resolveEditAnchor({ blockKind: "list", line: 1, targetEl: target, fullText: doc });
        expect(r.ok).toBe(true);
        if (r.ok) {
            expect(r.anchor.sourceContent).toBe("- a\n- b");
            expect(r.anchor.initialContent).toBe("a\n- b");
        }
    });

    it("列表没带 end 属性 → 只切到首行（这是**已知限制**：多行列表需渲染器给出 end）", () => {
        const doc = "- a\n- b";
        const r = resolveEditAnchor({ blockKind: "list", line: 1, targetEl: target, fullText: doc });
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.anchor.sourceContent).toBe("- a");
    });

    it("CRLF 也按行正确切分（Windows 写盘不能错位）", () => {
        const doc = "# 标题\r\n\r\nalpha";
        const r = resolveEditAnchor({ blockKind: "p", line: 3, targetEl: target, fullText: doc });
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.anchor.initialContent).toBe("alpha");
    });
});
