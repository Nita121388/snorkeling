// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom

// A3 在位编辑：EditableBlock 组件（宿主侧）。
// 验证核心契约：
//   1) 根 tag + className 与预览渲染器输出逐字一致（同一套样式）；
//   2) 内部复用 WysiwygEditor：contenteditable 能编辑、blur 序列化出完整块 markdown；
//   3) Esc → onCancel；blur → onCommit（宿主侧守卫 + 写盘由 markdown.tsx 负责）；
//   4) 冻结：会话期间 textAtom 更新不重写该块 DOM（组件 props 稳定 + memo 命中）。

import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EditableBlock, inplaceRootShape } from "./editable-block";

let host: HTMLElement;
let root: Root;

beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
});

afterEach(() => {
    act(() => root.unmount());
    host.remove();
});

function renderInplace(
    session: any,
    onCommit?: (c: string) => void,
    onCancel?: () => void,
    line = 2,
    rootClassName?: string,
    onSplit?: (c: string, caret: number) => void,
    onSave?: () => void
) {
    act(() => {
        root.render(
            <EditableBlock
                session={session}
                blockProps={{
                    node: { position: { start: { line }, end: { line } } },
                    className: rootClassName,
                }}
                onCommit={onCommit}
                onCancel={onCancel}
                onSplit={onSplit}
                onSave={onSave}
            />
        );
    });
}

describe("EditableBlock root shape matches preview renderer", () => {
    it("p → <div class=\"paragraph\">", () => {
        expect(inplaceRootShape({ kind: "p" } as any)).toEqual({
            tag: "div",
            className: "paragraph",
            contentEditableIsTitleSpan: false,
        });
    });

    it("h → <div class=\"heading is-2\"> with inner span.heading-title", () => {
        expect(inplaceRootShape({ kind: "h", headingLevel: 2 } as any)).toEqual({
            tag: "div",
            className: "heading is-2",
            contentEditableIsTitleSpan: true,
        });
    });

    it("quote → <blockquote> (no class)", () => {
        expect(inplaceRootShape({ kind: "quote" } as any)).toEqual({
            tag: "blockquote",
            contentEditableIsTitleSpan: false,
        });
    });

    it("callout → <calloutalert class=\"markdown-alert\">", () => {
        expect(
            inplaceRootShape({ kind: "quote", isCallout: true } as any, { className: "markdown-alert" })
        ).toEqual({
            tag: "calloutalert",
            className: "markdown-alert",
            contentEditableIsTitleSpan: false,
        });
    });

    it("callout → className 保留类型后缀（markdown-alert-note）", () => {
        expect(
            inplaceRootShape({ kind: "quote", isCallout: true } as any, {
                className: "markdown-alert markdown-alert-note",
            })
        ).toEqual({
            tag: "calloutalert",
            className: "markdown-alert markdown-alert-note",
            contentEditableIsTitleSpan: false,
        });
    });
});

describe("EditableBlock rendering", () => {
    it("p: root div.paragraph carries data-source-line + contentEditable editor", () => {
        renderInplace({
            kind: "p",
            startLine: 2,
            endLine: 2,
            seedHtml: "hello <strong>world</strong>",
        });
        const root2 = host.firstElementChild as HTMLElement;
        expect(root2.tagName.toLowerCase()).toBe("div");
        expect(root2.className).toBe("paragraph");
        expect(root2.getAttribute("data-source-line")).toBe("2");
        expect(root2.getAttribute("contenteditable")).toBe("true");
    });

    it("h: outer heading.is-N + inner span.heading-title contentEditable", () => {
        renderInplace(
            {
                kind: "h",
                startLine: 1,
                endLine: 1,
                headingLevel: 3,
                seedHtml: "Title",
            },
            undefined,
            undefined,
            1
        );
        const outer = host.firstElementChild as HTMLElement;
        expect(outer.tagName.toLowerCase()).toBe("div");
        expect(outer.className).toBe("heading is-3");
        // data-source-line 落在外层 .heading（与预览一致，供点击识别/提交重定位）。
        expect(outer.getAttribute("data-source-line")).toBe("1");
        const title = outer.querySelector(".heading-title");
        expect(title).not.toBeNull();
        expect((title as HTMLElement).getAttribute("contenteditable")).toBe("true");
        // collapse 按钮占位保留（flex 布局不跳变）。
        expect(outer.querySelector(".heading-collapse-button")).not.toBeNull();
    });

    it("quote: root blockquote with contenteditable editor", () => {
        renderInplace(
            {
                kind: "quote",
                startLine: 4,
                endLine: 4,
                seedHtml: "<div class=\"paragraph\">quote body</div>",
            },
            undefined,
            undefined,
            4
        );
        const root2 = host.firstElementChild as HTMLElement;
        expect(root2.tagName.toLowerCase()).toBe("blockquote");
        expect(root2.getAttribute("contenteditable")).toBe("true");
        expect(root2.getAttribute("data-source-line")).toBe("4");
    });

    it("callout: root calloutalert.markdown-alert", () => {
        renderInplace(
            {
                kind: "quote",
                startLine: 5,
                endLine: 5,
                isCallout: true,
                seedHtml: "<p>note</p>",
            },
            undefined,
            undefined,
            5,
            "markdown-alert markdown-alert-note"
        );
        const root2 = host.firstElementChild as HTMLElement;
        expect(root2.tagName.toLowerCase()).toBe("calloutalert");
        expect(root2.className).toBe("markdown-alert markdown-alert-note");
        expect(root2.getAttribute("contenteditable")).toBe("true");
    });
});

describe("EditableBlock commit/cancel wiring", () => {
    it("blur serializes edited DOM to markdown and fires onCommit", () => {
        const commits: string[] = [];
        renderInplace(
            { kind: "p", startLine: 2, endLine: 2, seedHtml: "hello" },
            (c) => commits.push(c)
        );
        const editor = host.querySelector("[contenteditable]") as HTMLElement;
        editor.focus();
        // 浏览器编辑：把根文本改成新内容。
        editor.textContent = "hello world";
        // React onBlur 监听 focusout：直接派发保证在 jsdom 中触发。
        act(() => {
            editor.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
        });
        expect(commits.length).toBe(1);
        expect(commits[0]).toBe("hello world");
    });

    it("Esc key → onCancel (no commit)", () => {
        const commits: string[] = [];
        let cancelled = 0;
        renderInplace(
            { kind: "p", startLine: 2, endLine: 2, seedHtml: "hello" },
            (c) => commits.push(c),
            () => cancelled++
        );
        const editor = host.querySelector("[contenteditable]") as HTMLElement;
        act(() => {
            editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        });
        expect(cancelled).toBe(1);
        expect(commits.length).toBe(0);
    });

    it("ordinary keydown does NOT cancel/commit (browser default preserved)", () => {
        const commits: string[] = [];
        let cancelled = 0;
        renderInplace(
            { kind: "p", startLine: 2, endLine: 2, seedHtml: "hi" },
            (c) => commits.push(c),
            () => cancelled++
        );
        const editor = host.querySelector("[contenteditable]") as HTMLElement;
        act(() => {
            editor.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
        });
        expect(cancelled).toBe(0);
        expect(commits.length).toBe(0);
    });

    it("bare Enter → onSplit with serialized content + caret (IME-guarded)", () => {
        const splits: Array<{ content: string; caret: number }> = [];
        renderInplace(
            { kind: "p", startLine: 2, endLine: 2, seedHtml: "hello world" },
            undefined,
            undefined,
            2,
            undefined,
            (content, caret) => splits.push({ content, caret })
        );
        const editor = host.querySelector("[contenteditable]") as HTMLElement;
        act(() => {
            editor.dispatchEvent(
                new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
            );
        });
        expect(splits.length).toBe(1);
        expect(splits[0].content).toBe("hello world");
        expect(splits[0].caret).toBe(0); // jsdom 无真实 caret → 默认 0
    });

    it("Shift+Enter → NOT split (soft line break preserved)", () => {
        const splits: string[] = [];
        renderInplace(
            { kind: "p", startLine: 2, endLine: 2, seedHtml: "hi" },
            undefined,
            undefined,
            2,
            undefined,
            (c) => splits.push(c)
        );
        const editor = host.querySelector("[contenteditable]") as HTMLElement;
        act(() => {
            editor.dispatchEvent(
                new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true })
            );
        });
        expect(splits.length).toBe(0);
    });

    it("IME-composing Enter → NOT split", () => {
        const splits: string[] = [];
        renderInplace(
            { kind: "p", startLine: 2, endLine: 2, seedHtml: "hi" },
            undefined,
            undefined,
            2,
            undefined,
            (c) => splits.push(c)
        );
        const editor = host.querySelector("[contenteditable]") as HTMLElement;
        act(() => {
            const evt = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
            Object.defineProperty(evt, "isComposing", { value: true });
            editor.dispatchEvent(evt);
        });
        expect(splits.length).toBe(0);
    });

    it("⌘/Ctrl+S → commits then saves (both callbacks fired)", () => {
        const commits: string[] = [];
        let saves = 0;
        renderInplace(
            { kind: "p", startLine: 2, endLine: 2, seedHtml: "hello" },
            (c) => commits.push(c),
            undefined,
            2,
            undefined,
            undefined,
            () => saves++
        );
        const editor = host.querySelector("[contenteditable]") as HTMLElement;
        act(() => {
            editor.dispatchEvent(
                new KeyboardEvent("keydown", { key: "s", metaKey: true, bubbles: true, cancelable: true })
            );
        });
        expect(commits.length).toBe(1);
        expect(saves).toBe(1);
    });

    it("memo: identical props → editor DOM not rewritten (freeze)", () => {
        // 冻结机制（prd R2）：会话期间渲染树冻结，EditableBlock props 稳定 → memo 命中，
        // React 不重写 contentEditable DOM（用户输入 / 光标不被冲掉）。
        renderInplace({
            kind: "p",
            startLine: 2,
            endLine: 2,
            seedHtml: "hello",
        });
        const editor = host.querySelector("[contenteditable]") as HTMLElement;
        // 用户输入（DOM 手术，不走 React 受控更新）。
        editor.textContent = "hello edited";
        const before = editor;
        // 同一 props 重新渲染（父层 textAtom 若更新但 renderText 冻结 → props 引用不变）。
        const session = {
            kind: "p" as const,
            startLine: 2,
            endLine: 2,
            seedHtml: "hello",
        };
        act(() => {
            root.render(
                <EditableBlock
                    session={session}
                    blockProps={{ node: { position: { start: { line: 2 }, end: { line: 2 } } } }}
                />
            );
        });
        const after = host.querySelector("[contenteditable]") as HTMLElement;
        // memo 命中：同一 DOM 节点，用户输入未被重置。
        expect(after).toBe(before);
        expect(after.textContent).toBe("hello edited");
    });

    it("heading blur serializes to '# Title' (round-trip with overlay serializer)", () => {
        const commits: string[] = [];
        renderInplace(
            {
                kind: "h",
                startLine: 1,
                endLine: 1,
                headingLevel: 2,
                seedHtml: "Title",
            },
            (c) => commits.push(c),
            undefined,
            1
        );
        const editor = host.querySelector("[contenteditable]") as HTMLElement;
        editor.focus();
        editor.textContent = "New Title";
        act(() => {
            editor.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
        });
        expect(commits.length).toBe(1);
        expect(commits[0]).toBe("## New Title");
    });

    it("quote blur serializes to '> body' (round-trip with overlay serializer)", () => {
        const commits: string[] = [];
        renderInplace(
            {
                kind: "quote",
                startLine: 3,
                endLine: 3,
                seedHtml: "<div class=\"paragraph\">quote body</div>",
            },
            (c) => commits.push(c),
            undefined,
            3
        );
        const editor = host.querySelector("[contenteditable]") as HTMLElement;
        editor.focus();
        act(() => {
            editor.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
        });
        expect(commits.length).toBe(1);
        expect(commits[0]).toBe("> quote body");
    });
});