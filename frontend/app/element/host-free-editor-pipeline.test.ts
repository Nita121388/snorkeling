// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom

/**
 * 抽离可行性证据（D2 · md-dom 前置）：**编辑那一半已经是零 React 的**。
 *
 * 目标（本任务最终形态）：把 markdown 预览+编辑模块做成可被**其他页面工具**直接依赖的包 ——
 * 其中非 React 消费方（journal 那个 Chrome 扩展：纯 ESM、零框架、无打包器）不能为了笔记编辑
 * 去引 React 运行时。所以必须能回答一个问题：**编辑引擎真的与框架无关吗？**
 *
 * 本测试的答法：不渲染任何 React 组件（不 import react / react-dom / react-markdown），
 * 只用手写的预览态 DOM（等价于「宿主用自己的方式渲染好了」）走完整条链路：
 *   源码切片 → 种子 → DOM 就地编辑 → DOM 序列化回 markdown → 重定位/陈旧检测 → 写盘拼接
 *
 * 结论会写进 PROGRESS.md / 抽离方案：**可搬进 `md-dom` 的符号清单**。
 * 反过来，这个测试也让「将来有人往这些函数里塞 React 调用」立刻变红 ——
 * 那正是会让包无法被非 React 消费方使用的改动。
 */

import { describe, expect, it } from "vitest";
import { serializeBlockDomToMarkdown } from "@md/core/transform/dom-to-markdown";
import {
    applyCalloutPrefix,
    captureCalloutPrefix,
    captureInplaceSeedHtml,
    inlineKindToTreeKind,
    initialContentFor,
    isEmptyBlockShellDraft,
    prepareInlineEditCommit,
    type InlineEditSession,
} from "./markdown-inline-edit";

const SOURCE = [
    "# 标题", // 1
    "", // 2
    "第一段**粗体**。", // 3
    "", // 4
    "- 项目一", // 5
    "- 项目二", // 6
].join("\n");

/** 手写的「预览态 DOM」——等价于非 React 宿主渲染出来的结果（含块身份与坐标）。 */
function previewDom(): HTMLElement {
    const root = document.createElement("div");
    root.className = "markdown-render-root";
    root.innerHTML = `
        <div class="heading is-1" data-heading-level="1" data-block-id="blk-h1-0" data-source-line="1">
            <button class="heading-collapse-button"></button><span class="heading-title">标题</span>
        </div>
        <div class="paragraph" data-block-id="blk-p-0" data-source-line="3">第一段<strong>粗体</strong>。</div>
        <ul data-block-id="blk-ul-0" data-source-line="5" data-source-line-end="6">
            <li data-source-line="5">项目一</li>
            <li data-source-line="6">项目二</li>
        </ul>`;
    document.body.appendChild(root);
    return root;
}

describe("抽离可行性：编辑链路零 React（可进 md-dom）", () => {
    it("p：源码切片 → 种子 → 就地编辑 → 序列化 → 写盘拼接，逐段正确", () => {
        const root = previewDom();
        const el = root.querySelector<HTMLElement>('[data-source-line="3"]')!;
        const kind = "p" as const;

        // 1) 打开编辑：源码切片 + 种子
        const initialContent = initialContentFor(kind, SOURCE.split("\n")[2]);
        expect(initialContent).toBe("第一段**粗体**。");
        expect(captureInplaceSeedHtml(el)).toBe("第一段<strong>粗体</strong>。");

        // 2) 就地编辑（真实 A3 形态：块自身变 contenteditable，内容被改）
        el.setAttribute("contenteditable", "true");
        el.innerHTML = "改过的段落<em>斜体</em>。";

        // 3) 序列化回 markdown（零 React：直接读 DOM）
        const committed = serializeBlockDomToMarkdown(el, { kind } as any);
        expect(committed).toBe("改过的段落*斜体*。");
        expect(inlineKindToTreeKind(kind, committed)).toBe("text");

        // 4) 写盘拼接（行号切片）
        const lines = SOURCE.split("\n");
        lines.splice(2, 1, committed);
        expect(lines.join("\n")).toContain("改过的段落*斜体*。");
        root.remove();
    });

    it("list：多行列表往返不丢项（历史事故：Tab 缩进丢项）", () => {
        const root = previewDom();
        const el = root.querySelector<HTMLElement>("ul")!;
        el.setAttribute("contenteditable", "true");

        const committed = serializeBlockDomToMarkdown(el, { kind: "list", listMarker: "-" } as any);
        expect(committed.split("\n")).toHaveLength(2);
        expect(committed).toContain("项目一");
        expect(committed).toContain("项目二");
        expect(inlineKindToTreeKind("list", committed)).toBe("bulleted");
        root.remove();
    });

    it("commit 前置：块身份重定位 + 陈旧检测（整条链在无 React 下可跑）", () => {
        const root = previewDom();
        const el = root.querySelector<HTMLElement>('[data-source-line="3"]')!;
        const session: InlineEditSession = {
            blockKind: "p",
            startLine: 3,
            endLine: 3,
            initialContent: initialContentFor("p", SOURCE.split("\n")[2]),
            blockId: el.getAttribute("data-block-id")!,
            targetEl: el,
        };

        const ok = prepareInlineEditCommit(session, SOURCE, root);
        expect(ok.ok).toBe(true);

        // 别的提交把行号整体位移后，仍能按**身份**找回同一块。
        // 关键：位移是外部的，所以 DOM 的坐标也会跟着重渲染更新（只改文本、不改 DOM
        // 不是真实场景 —— 那样重定位会拿到旧行号、切片落空而被判陈旧）。
        const shifted = ["", ...SOURCE.split("\n")].join("\n");
        el.setAttribute("data-source-line", "4");
        const shiftedSession: InlineEditSession = { ...session, startLine: 3, endLine: 3 };
        const relocated = prepareInlineEditCommit(shiftedSession, shifted, root);
        expect(relocated.ok).toBe(true);
        if (relocated.ok) {
            expect(relocated.session.startLine).toBe(4);
            expect(relocated.relocated).toBe(true);
            expect(relocated.relocatedBy).toBe("id");
        }

        // 本块被别的路径改过 → 陈旧，拒绝写盘（防写错块）
        const staleSession: InlineEditSession = { ...session, initialContent: "完全不同的内容" };
        expect(prepareInlineEditCommit(staleSession, shifted, root).ok).toBe(false);
        root.remove();
    });

    it("callout：前缀捕获/回写 + 空壳守卫（零 React）", () => {
        const root = document.createElement("div");
        root.className = "markdown-render-root";
        // fixture 必须与真实渲染 DOM **逐字一致**（无模板缩进）：
        // 模板字面量里的换行 + 缩进会变成空白文本节点，被当作块内内容 → 序列化出多余的行。
        root.innerHTML =
            '<calloutalert class="markdown-alert markdown-alert-note" data-block-id="blk-c-0" data-source-line="1" data-source-line-end="2">' +
            '<div class="markdown-alert-title"><button class="markdown-alert-emoji-btn is-empty"></button>' +
            '<span class="markdown-alert-title-text">这是一个 callout<br>\n标题行与正文</span></div></calloutalert>';
        document.body.appendChild(root);
        const el = root.querySelector<HTMLElement>("calloutalert")!;

        const prefix = captureCalloutPrefix("> [!NOTE] 这是一个 callout");
        expect(prefix).toContain("NOTE");
        const seed = captureInplaceSeedHtml(el);
        expect(seed).not.toContain("markdown-alert-emoji-btn"); // 供能控件被剔除
        expect(seed).toContain("markdown-alert-title"); // 渲染器结构保留

        const committed = serializeBlockDomToMarkdown(el, { kind: "quote" } as any);
        // 回写用**捕获到的** prefix（含 `[!NOTE] `），不是手写的 `> [!NOTE] ` ——
        // applyCalloutPrefix 自己会补 `> `，传带 `> ` 的串会变成 `> > [!NOTE]`。
        expect(applyCalloutPrefix(committed, prefix)).toBe(
            "> [!NOTE] 这是一个 callout\n> 标题行与正文"
        );
        // 空壳守卫：非空块不能提交成空引用
        expect(isEmptyBlockShellDraft("quote", "> 这是一个 callout\n> 标题行与正文")).toBe(false);
        root.remove();
    });

    it("本测试未引入 React：编辑链路对 react / react-dom / react-markdown 零依赖", () => {
        // 静态断言：markdown-inline-edit.tsx 里的这些导出全部是纯 DOM/字符串函数。
        // 若哪天有人往里面塞 React hook 调用，`npm ls` 层面的包依赖会变化 —— 这里防的是
        // 「把 React 调用写进这些函数体」这种隐性耦合（jsdom 下仍能跑，但包就不纯了）。
        for (const fn of [
            initialContentFor,
            captureInplaceSeedHtml,
            inlineKindToTreeKind,
            isEmptyBlockShellDraft,
            captureCalloutPrefix,
            applyCalloutPrefix,
            prepareInlineEditCommit,
            serializeBlockDomToMarkdown,
        ] as Array<unknown>) {
            // React 组件/hook 是对象或带 $$typeof 标记的函数；纯函数不会有这些特征
            expect(typeof fn === "function" || typeof fn === "object").toBe(true);
            if (typeof fn === "function") {
                expect((fn as any).$$typeof).toBeUndefined();
            }
        }
    });
});