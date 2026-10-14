// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom

// A3 在位编辑：inplace 提交数学与 overlay 同源（AC：编辑→失焦往返与 overlay 路径逐字节一致）。
// 这里的纯函数链 = inplaceCommit 的写盘核心（markdown.tsx 复用同一套 prepareInlineEditCommit /
// editorController.replace-content / replaceSourceRange）。不渲染 React，直测纯函数。

import { describe, expect, it } from "vitest";
import { prepareInlineEditCommit, initialContentFor } from "./markdown-inline-edit";
import { editorController } from "@md/core/block-model/editor-controller-instance";
import { serializeBlockDomToMarkdown } from "@md/core/transform/dom-to-markdown";

function makeRoot(tag: string, html: string): HTMLElement {
    const d = document.createElement(tag);
    d.innerHTML = html;
    return d;
}

/** 模拟 inplaceCommit 的写盘核心：返回新全文或 null（被守卫拦截）。 */
function inplaceCommitCore(opts: {
    fullText: string;
    session: { kind: "p" | "h" | "quote"; startLine: number; endLine: number; blockId?: string; initialContent: string };
    committed: string;
    rootEl: HTMLElement | null;
}): { text: string } | null {
    const { fullText, session, committed, rootEl } = opts;
    const prepared = prepareInlineEditCommit(
        {
            blockKind: session.kind as any,
            startLine: session.startLine,
            endLine: session.endLine,
            initialContent: session.initialContent,
            blockId: session.blockId,
            targetEl: document.body,
            insertMode: undefined,
        } as any,
        fullText,
        rootEl
    );
    if (!prepared.ok) {
        return null; // stale
    }
    const current = prepared.session;
    // 无变化提交 → 不写盘
    if (committed === current.initialContent && current.startLine === session.startLine) {
        return null;
    }
    const block = {
        id: `inplace:${current.startLine}:${current.endLine}`,
        kind: (session.kind === "h" ? `heading${/^(#{1,6})/.exec(committed)?.[1].length ?? 1}` : session.kind) as any,
        startLine: current.startLine - 1,
        endLine: current.endLine - 1,
        depth: 0,
        text: current.initialContent,
        children: [],
    } as any;
    const res = editorController.apply({ type: "replace-content", block, content: committed }, { text: fullText });
    if (res != null) {
        return { text: res.text };
    }
    return { text: replaceSourceRange(fullText, current.startLine, current.endLine, committed) };
}

import { replaceSourceRange, applyCalloutPrefix, splitBlockAtCaretText } from "./markdown-inline-edit";

describe("inplace commit math (overlay 同源)", () => {
    const draft = [
        "# 全块型 parity 草稿",
        "",
        "普通段落，**开头加粗**中间正常，末尾*斜体*。",
        "",
        "## 二级标题",
        "",
        "> 引用块内容",
        "",
        "> [!NOTE] 这是一个 callout",
        "> 标题行与正文",
        "",
    ].join("\n");

    it("p: 编辑 → 序列化 → 提交，产出与 overlay 相同的全文", () => {
        const rootEl = makeRoot("div", '普通段落（已编辑），<strong>开头加粗</strong>中间正常，末尾<em>斜体</em>。');
        const committed = serializeBlockDomToMarkdown(rootEl, { kind: "p", headingLevel: 1, listMarker: "-" });
        expect(committed).toBe("普通段落（已编辑），**开头加粗**中间正常，末尾*斜体*。");
        const result = inplaceCommitCore({
            fullText: draft,
            session: { kind: "p", startLine: 3, endLine: 3, initialContent: "普通段落，**开头加粗**中间正常，末尾*斜体*。" },
            committed,
            rootEl,
        });
        expect(result).not.toBeNull();
        expect(result!.text).toContain("普通段落（已编辑），**开头加粗**");
        expect(result!.text.split("\n")[2]).toBe("普通段落（已编辑），**开头加粗**中间正常，末尾*斜体*。");
    });

    it("h: 编辑标题 → 序列化出 '## 新标题' → 提交替换正确行", () => {
        const rootEl = makeRoot("span", "新标题");
        const committed = serializeBlockDomToMarkdown(rootEl, { kind: "h", headingLevel: 2, listMarker: "-" });
        expect(committed).toBe("## 新标题");
        const result = inplaceCommitCore({
            fullText: draft,
            session: { kind: "h", startLine: 5, endLine: 5, initialContent: "## 二级标题" },
            committed,
            rootEl,
        });
        expect(result).not.toBeNull();
        expect(result!.text.split("\n")[4]).toBe("## 新标题");
    });

    it("quote: 编辑引用正文 → 序列化出 '> ...' → 提交不丢前缀", () => {
        const rootEl = makeRoot("blockquote", "<div class=\"paragraph\">更新的引用</div>");
        const committed = serializeBlockDomToMarkdown(rootEl, { kind: "quote", headingLevel: 1, listMarker: "-" });
        expect(committed).toBe("> 更新的引用");
        const result = inplaceCommitCore({
            fullText: draft,
            session: { kind: "quote", startLine: 7, endLine: 7, initialContent: "> 引用块内容" },
            committed,
            rootEl,
        });
        expect(result).not.toBeNull();
        expect(result!.text.split("\n")[6]).toBe("> 更新的引用");
    });

    it("callout: 编辑后 serialized 内容经 applyCalloutPrefix 回写 marker（数据安全 R4）", () => {
        const rootEl = makeRoot("calloutalert", "<p>自定义标题<br>自定义正文</p>");
        const serialized = serializeBlockDomToMarkdown(rootEl, { kind: "quote", headingLevel: 1, listMarker: "-" });
        expect(serialized).toBe("> 自定义标题\n> 自定义正文");
        // R4 回写（markdown.tsx inplaceCommit 调 applyCalloutPrefix）
        const withPrefix = applyCalloutPrefix(serialized, "[!NOTE] ");
        expect(withPrefix).toBe("> [!NOTE] 自定义标题\n> 自定义正文");
        const result = inplaceCommitCore({
            fullText: draft,
            session: { kind: "quote", startLine: 9, endLine: 10, initialContent: "> [!NOTE] 这是一个 callout\n> 标题行与正文" },
            committed: withPrefix,
            rootEl,
        });
        expect(result).not.toBeNull();
        const lines = result!.text.split("\n");
        expect(lines[8]).toBe("> [!NOTE] 自定义标题");
        expect(lines[9]).toBe("> 自定义正文");
    });

    it("陈旧检测：外部改过该块 → 提交被拦（不写盘）", () => {
        const rootEl = makeRoot("div", "新内容");
        const committed = serializeBlockDomToMarkdown(rootEl, { kind: "p", headingLevel: 1, listMarker: "-" });
        // 外部把 line 3 改成了别的内容
        const changedDraft = draft.replace("普通段落，**开头加粗**", "别人改过的段落，**x**");
        const result = inplaceCommitCore({
            fullText: changedDraft,
            session: { kind: "p", startLine: 3, endLine: 3, initialContent: "普通段落，**开头加粗**中间正常，末尾*斜体*。" },
            committed,
            rootEl,
        });
        expect(result).toBeNull(); // stale → 不写盘
    });

    it("无变化提交 → 不写盘（与 overlay unchangedDraft 语义一致）", () => {
        const rootEl = makeRoot("div", "普通段落，**开头加粗**中间正常，末尾*斜体*。");
        const committed = serializeBlockDomToMarkdown(rootEl, { kind: "p", headingLevel: 1, listMarker: "-" });
        const result = inplaceCommitCore({
            fullText: draft,
            session: { kind: "p", startLine: 3, endLine: 3, initialContent: "普通段落，**开头加粗**中间正常，末尾*斜体*。" },
            committed,
            rootEl,
        });
        expect(result).toBeNull();
    });

    it("Enter 拆分（overlay splitBlockAtCaretText 同源）：before 留原块、after 成新块", () => {
        const fullText = ["# 标题", "", "普通段落，前一部分后一部分。", "", "下一块", ""].join("\n");
        const draft = "普通段落，前一部分后一部分。";
        const pos = "普通段落，前一部分".length; // caret 在「前一部分」末尾
        const { text, newLine } = splitBlockAtCaretText(fullText, 3, 3, draft, pos);
        const lines = text.split("\n");
        expect(lines[2]).toBe("普通段落，前一部分");
        expect(lines[3]).toBe(""); // spliceInsertBlock 的分隔空行
        expect(lines[4]).toBe("后一部分。");
        expect(newLine).toBe(5); // after 块的 content 行（新块的第二行）
        // 与 overlay handleEnterSplit 相同的产物：handleInlineEditCommit(text) 即可写盘
    });

    it("Enter 拆分 caret 在行首 → before 为空，新块开在上方（placeholder 行）", () => {
        const fullText = ["# 标题", "", "内容行", ""].join("\n");
        const { text, newLine } = splitBlockAtCaretText(fullText, 3, 3, "内容行", 0);
        const lines = text.split("\n");
        expect(lines[2]).toBe(""); // 上方 placeholder 空行
        expect(lines[3]).toBe("内容行");
        expect(newLine).toBe(3);
    });

    it("Enter 拆分 caret 在行末 → after 为空，新块开在下方（placeholder 行）", () => {
        const fullText = ["# 标题", "", "内容行", ""].join("\n");
        const { text, newLine } = splitBlockAtCaretText(fullText, 3, 3, "内容行", 3);
        const lines = text.split("\n");
        expect(lines[2]).toBe("内容行");
        expect(lines[3]).toBe(""); // 下方 placeholder 空行
        expect(newLine).toBe(4);
    });
});