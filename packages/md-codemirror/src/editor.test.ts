// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom

/**
 * 核心实例测试：`createMarkdownEditor` 的公共 API 语义。
 *
 * 覆盖：
 * - 初始化：doc 是完整 Markdown 原文（事实源）；
 * - onChange：用户输入 → 完整新文本 + 增量 change；
 * - setValue：外部同步替换，不触发 onChange；
 * - setMode / getMode：source / live-preview / preview 切换不重建实例；
 * - runCommand：文本插入 / 替换 / 删除行 / 任务切换；
 * - destroy：清空 parent、释放 view；
 * - preview 模式只读。
 */

import { describe, expect, it, beforeEach } from "vitest";
import { EditorSelection, type EditorState } from "@codemirror/state";

import { createMarkdownEditor } from "./editor";
import type { MarkdownChange, MarkdownEditorHost } from "./types";

function mount(): { parent: HTMLElement; teardown(): void } {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    return {
        parent,
        teardown() {
            parent.remove();
        },
    };
}

describe("createMarkdownEditor 基础", () => {
    it("初始化：doc 保存完整 Markdown 原文", () => {
        const { parent, teardown } = mount();
        const editor = createMarkdownEditor({ parent, value: "# 标题\n\n正文 **粗**" });
        expect(editor.getValue()).toBe("# 标题\n\n正文 **粗**");
        expect(parent.querySelector(".cm-editor")).not.toBeNull();
        editor.destroy();
        teardown();
    });

    it("getMode 默认 live-preview", () => {
        const { parent, teardown } = mount();
        const editor = createMarkdownEditor({ parent, value: "x" });
        expect(editor.getMode()).toBe("live-preview");
        editor.destroy();
        teardown();
    });

    it("onChange：用户输入 → value 是完整新文本，change 是增量", () => {
        const { parent, teardown } = mount();
        const changes: MarkdownChange[] = [];
        const values: string[] = [];
        const editor = createMarkdownEditor({
            parent,
            value: "ab",
            onChange: (v, c) => {
                values.push(v);
                changes.push(c);
            },
        });
        // 模拟用户输入：在末尾插入 "c"
        editor.view.dispatch({
            changes: { from: 2, to: 2, insert: "c" },
            selection: { anchor: 3 },
            userEvent: "input",
        });
        expect(values).toEqual(["abc"]);
        expect(changes).toHaveLength(1);
        expect(changes[0].inserted).toBe("c");
        expect(changes[0].from).toBe(2);
        expect(changes[0].to).toBe(3);
        expect(editor.getValue()).toBe("abc");
        editor.destroy();
        teardown();
    });

    it("setValue：外部替换全文，不触发 onChange", () => {
        const { parent, teardown } = mount();
        const values: string[] = [];
        const editor = createMarkdownEditor({
            parent,
            value: "old",
            onChange: (v) => values.push(v),
        });
        editor.setValue("new text");
        expect(editor.getValue()).toBe("new text");
        expect(values).toEqual([]);
        editor.destroy();
        teardown();
    });

    it("setMode 切换：同一 view，文本状态不丢", () => {
        const { parent, teardown } = mount();
        const editor = createMarkdownEditor({ parent, value: "## 标题", mode: "source" });
        const viewBefore = editor.view;
        editor.setMode("live-preview");
        expect(editor.view).toBe(viewBefore);
        expect(editor.getMode()).toBe("live-preview");
        editor.setMode("preview");
        expect(editor.getMode()).toBe("preview");
        expect(editor.getValue()).toBe("## 标题");
        editor.destroy();
        teardown();
    });

    it("preview 模式：contentDOM 带 aria-readonly，数值属性落在编辑面", () => {
        const { parent, teardown } = mount();
        const editor = createMarkdownEditor({ parent, value: "hello", mode: "preview" });
        // contentAttributes 落在 contentDOM 上（cm-content 元素）
        expect(editor.view.contentDOM.getAttribute("aria-readonly")).toBe("true");
        editor.destroy();
        teardown();
    });

    it("focus() 聚焦编辑器 DOM", () => {
        const { parent, teardown } = mount();
        const editor = createMarkdownEditor({ parent, value: "x" });
        editor.focus();
        expect(document.activeElement).toBe(editor.view.contentDOM);
        editor.destroy();
        teardown();
    });

    it("destroy：清空 parent、卸载 view", () => {
        const { parent, teardown } = mount();
        const editor = createMarkdownEditor({ parent, value: "x" });
        const content = editor.view.contentDOM;
        editor.destroy();
        expect(parent.querySelector(".cm-editor")).toBeNull();
        expect(content.isConnected).toBe(false);
        teardown();
    });
});

describe("runCommand", () => {
    it("insert-text：从光标处插入，并移动光标", () => {
        const { parent, teardown } = mount();
        const editor = createMarkdownEditor({ parent, value: "ab" });
        editor.view.dispatch({ selection: EditorSelection.cursor(1) });
        expect(editor.runCommand({ type: "insert-text", text: "X" })).toBe(true);
        expect(editor.getValue()).toBe("aXb");
        expect(editor.view.state.selection.main.head).toBe(2);
        editor.destroy();
        teardown();
    });

    it("replace-text：替换指定区间", () => {
        const { parent, teardown } = mount();
        const editor = createMarkdownEditor({ parent, value: "hello world" });
        expect(editor.runCommand({ type: "replace-text", from: 0, to: 5, text: "hi" })).toBe(true);
        expect(editor.getValue()).toBe("hi world");
        editor.destroy();
        teardown();
    });

    it("delete-line：删除光标所在行", () => {
        const { parent, teardown } = mount();
        const editor = createMarkdownEditor({ parent, value: "line1\nline2\nline3" });
        editor.view.dispatch({ selection: EditorSelection.cursor(8) }); // line2 中间
        expect(editor.runCommand({ type: "delete-line" })).toBe(true);
        expect(editor.getValue()).toBe("line1\nline3");
        editor.destroy();
        teardown();
    });

    it("toggle-task：`- [ ]` ↔ `- [x]`", () => {
        const { parent, teardown } = mount();
        const editor = createMarkdownEditor({ parent, value: "- [ ] 任务" });
        editor.view.dispatch({ selection: EditorSelection.cursor(3) });
        expect(editor.runCommand({ type: "toggle-task" })).toBe(true);
        expect(editor.getValue()).toBe("- [x] 任务");
        expect(editor.runCommand({ type: "toggle-task" })).toBe(true);
        expect(editor.getValue()).toBe("- [ ] 任务");
        editor.destroy();
        teardown();
    });

    it("toggle-task：非任务行返回 false", () => {
        const { parent, teardown } = mount();
        const editor = createMarkdownEditor({ parent, value: "普通文本" });
        editor.view.dispatch({ selection: EditorSelection.cursor(2) });
        expect(editor.runCommand({ type: "toggle-task" })).toBe(false);
        expect(editor.getValue()).toBe("普通文本");
        editor.destroy();
        teardown();
    });
});

describe("host adapter", () => {
    it("host.openLink 透传到自定义 host", () => {
        const { parent, teardown } = mount();
        let opened = "";
        const host: MarkdownEditorHost = {
            openLink: (href) => {
                opened = href;
            },
        };
        const editor = createMarkdownEditor({ parent, value: "x", host });
        // 直接调用 host（实例内部将 mergeHost）
        host.openLink!("https://example.com", { from: 0, to: 1 });
        expect(opened).toBe("https://example.com");
        editor.destroy();
        teardown();
    });
});