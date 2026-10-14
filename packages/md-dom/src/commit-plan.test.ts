// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom

/**
 * `md-dom` 提交决策层的独立测试面 —— **数据安全红线**的收口点。
 *
 * 这里每条用例都对应一次真实事故类别。写用例时的取舍：宁可多写「不写盘」的用例，
 * 因为写多了只是脏，写错了（该拒的没拒）是**用户内容被覆盖**。
 */

import { beforeEach, describe, expect, it } from "vitest";
import { planBlockCommit } from "./commit-plan";

let root: HTMLElement;

beforeEach(() => {
    document.body.innerHTML = "";
    root = document.createElement("div");
    root.className = "markdown-render-root";
    document.body.appendChild(root);
});

function addBlock(line: number, text: string, opts: { endLine?: number; blockId?: string } = {}): void {
    const el = document.createElement("div");
    el.className = "paragraph";
    el.setAttribute("data-source-line", String(line));
    if (opts.endLine != null) {
        el.setAttribute("data-source-line-end", String(opts.endLine));
    }
    if (opts.blockId != null) {
        el.setAttribute("data-block-id", opts.blockId);
    }
    el.textContent = text;
    root.appendChild(el);
}

const DOC = ["# 标题", "", "alpha", "", "beta"].join("\n");

describe("planBlockCommit：写 / 不写 的四道判定", () => {
    it("正常改动 → write，且 blockOp 记住 before/after（供 undo 求逆）", () => {
        addBlock(3, "alpha", { blockId: "blk-a-0" });
        const plan = planBlockCommit({
            kind: "p",
            committed: "alpha 改过",
            startLine: 3,
            endLine: 3,
            initialContent: "alpha",
            blockId: "blk-a-0",
            fullText: DOC,
            root,
        });
        expect(plan.action).toBe("write");
        if (plan.action === "write") {
            expect(plan.text.split("\n")[2]).toBe("alpha 改过");
            expect(plan.blockOp).toMatchObject({
                blockId: "blk-a-0",
                startLine: 3,
                endLine: 3,
                before: "alpha",
                after: "alpha 改过",
            });
            // 其它行一字不动
            expect(plan.text.split("\n")[0]).toBe("# 标题");
            expect(plan.text.split("\n")[4]).toBe("beta");
        }
    });

    it("陈旧（原文已被外部改过）→ skip:stale。**绝不能写**（会覆盖别人的改动）", () => {
        // 真实场景：文本与 DOM 都已经是外部改后的样子（外部提交会同时更新两者）
        addBlock(3, "别人改成了这样", { blockId: "blk-a-0" });
        const plan = planBlockCommit({
            kind: "p",
            committed: "我的改动",
            startLine: 3,
            endLine: 3,
            initialContent: "alpha",
            blockId: "blk-a-0",
            fullText: ["# 标题", "", "别人改成了这样", "", "beta"].join("\n"),
            root,
        });
        expect(plan).toMatchObject({ action: "skip", reason: "stale" });
    });

    it("空壳草稿 + 原文非空 → skip:empty-shell（防丢引用内容）", () => {
        addBlock(3, ">", { blockId: "blk-q-0" });
        const plan = planBlockCommit({
            kind: "quote",
            committed: ">",
            startLine: 3,
            endLine: 3,
            initialContent: "> 原本有引用内容",
            blockId: "blk-q-0",
            fullText: ["", "", "> 原本有引用内容"].join("\n"),
            root,
        });
        expect(plan).toMatchObject({ action: "skip", reason: "empty-shell" });
    });

    // ⚠ 已知不一致（本测试是**现状钉子**）：
    // 宿主原来的注释写「若原文本就是空引用则放行（清空合法）」，但实际条件是
    // `original.trim() !== ""` —— 而 `">"` 的 trim() 非空，所以**不会**放行。
    // 注释与代码不一致。实际影响很小：用户不动空引用时会被第 4 条（无变化）先拦下；
    // 改了又删回去也是无变化。所以这里钉住现状，**不顺手改判定** ——
    // 这是一条数据安全守卫，“按注释改代码”和“按代码改注释”必须由人明确选一边。
    it("原文本来就是空引用（现状：**仍然 skip**，与宿主注释不一致）", () => {
        addBlock(3, ">", { blockId: "blk-q-0" });
        const plan = planBlockCommit({
            kind: "quote",
            committed: ">",
            startLine: 3,
            endLine: 3,
            initialContent: ">",
            blockId: "blk-q-0",
            fullText: ["", "", ">"].join("\n"),
            root,
        });
        expect(plan).toMatchObject({ action: "skip", reason: "empty-shell" });
    });

    it("无变化且未重定位 → skip:unchanged（不产生无谓的 undo 记账/磁盘抖动）", () => {
        addBlock(3, "alpha", { blockId: "blk-a-0" });
        const plan = planBlockCommit({
            kind: "p",
            committed: "alpha",
            startLine: 3,
            endLine: 3,
            initialContent: "alpha",
            blockId: "blk-a-0",
            fullText: DOC,
            root,
        });
        expect(plan).toMatchObject({ action: "skip", reason: "unchanged" });
    });

    it("行号被别的提交顶走后：内容没变**也要写**（要把 undo 记账对齐到新坐标）", () => {
        // 外部在文档**开头**插了一行 → 块从第 3 行变成第 4 行，DOM 坐标同步更新
        addBlock(4, "alpha", { blockId: "blk-a-0" });
        const shifted = ["插入的新行", "# 标题", "", "alpha", "", "beta"].join("\n");
        const plan = planBlockCommit({
            kind: "p",
            committed: "alpha",
            startLine: 3,
            endLine: 3,
            initialContent: "alpha",
            blockId: "blk-a-0",
            fullText: shifted,
            root,
        });
        expect(plan.action).toBe("write");
        if (plan.action === "write") {
            expect(plan.blockOp.startLine).toBe(4);
            expect(plan.text.split("\n")[3]).toBe("alpha");
        }
    });

    it("顺序不可颠倒：必须先重定位再比对，否则位移后合法提交会被判陈旧", () => {
        addBlock(4, "alpha", { blockId: "blk-a-0" });
        const shifted = ["插入的新行", "# 标题", "", "alpha", "", "beta"].join("\n");
        const plan = planBlockCommit({
            kind: "p",
            committed: "alpha 改过",
            startLine: 3, // 旧坐标
            endLine: 3,
            initialContent: "alpha",
            blockId: "blk-a-0",
            fullText: shifted,
            root,
        });
        expect(plan.action).toBe("write");
    });

    it("callout：前缀按捕获原文回写（保大小写），普通引用（prefix 为空）不动", () => {
        const text = ["> 标题", "> 正文"].join("\n");
        addBlock(1, "标题", { endLine: 2, blockId: "blk-c-0" });
        const plan = planBlockCommit({
            kind: "quote",
            committed: text,
            calloutPrefix: "[!Note] ",
            startLine: 1,
            endLine: 2,
            initialContent: text,
            blockId: "blk-c-0",
            fullText: text,
            root,
        });
        expect(plan.action).toBe("write");
        if (plan.action === "write") {
            expect(plan.text.split("\n")[0]).toBe("> [!Note] 标题");
            expect(plan.text.split("\n")[1]).toBe("> 正文");
        }
    });

    it("list：从草稿首行 marker 推断树模型 kind（供控制器统一意图使用）", () => {
        addBlock(1, "a", { endLine: 2, blockId: "blk-l-0" });
        // 注意：initialContentFor 对 list **只剥首行 marker**（正则无 /m），
        // 所以捕获值就是 `"a\n- b"`。陈旧检测两侧共用同一函数，所以恒等、不会误判。
        const plan = planBlockCommit({
            kind: "list",
            committed: "1. a\n2. b",
            startLine: 1,
            endLine: 2,
            initialContent: "a\n- b",
            blockId: "blk-l-0",
            fullText: "- a\n- b",
            root,
        });
        expect(plan.action).toBe("write");
        if (plan.action === "write") {
            expect(plan.text).toContain("1. a");
            expect(plan.text).toContain("2. b");
        }
    });
});
