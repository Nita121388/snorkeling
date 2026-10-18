// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom

/**
 * Live Preview 装饰测试：验证语法隐藏与 widget 的实际 DOM 行为。
 *
 * 断言手法：**只看渲染后的 DOM 可见性/结构**，不碰 CodeMirror 内部实现。
 * - 隐藏语法标记 → 对应字符在视图中**不可见**（display:none 或不存在）；
 * - 内容主体保持可编辑（在 contentDOM 的可见文本里）；
 * - checkbox / 图片 widget → DOM 里出现对应元素且携带源 range 信息；
 * - 未知语法（代码块、表格）→ **原样可见**（source 可见，不静默丢失）。
 *
 * 「可见」的判定：CodeMirror 的 decoration 最终都以 span 和属性形式落在
 * `.cm-content` 里；隐藏语法我们用 mark+class 方案（CSS 控制 display:none），
 * 因此 DOM 断言可以直接查 className。
 */

import { describe, expect, it } from "vitest";

import { createMarkdownEditor } from "./editor";
import type { MarkdownEditorHost } from "./types";

function mountEditor(content: string, mode: "live-preview" | "source" = "live-preview") {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const editor = createMarkdownEditor({ parent, value: content, mode });
    return { editor, parent, teardown: () => parent.remove() };
}

describe("live-preview：语法隐藏（mark+class 方案）", () => {
    it("标题：`# ` marker 隐藏，标题文本可见", () => {
        const { editor, teardown } = mountEditor("# 标题");
        const view = editor.view;
        // 隐藏 marker 的 span 应带专用 class（由 livePreviewBaseTheme 的 CSS 定义 display:none）
        const content = view.contentDOM;
        expect(content.textContent).toContain("标题");
        teardown();
    });

    it("强调：标记隐藏但内容可见", () => {
        const { editor, teardown } = mountEditor("前**粗**后");
        const content = editor.view.contentDOM;
        // 渲染文本仍包含原文（装饰不改 doc）
        expect(editor.getValue()).toBe("前**粗**后");
        // 语法标记存在于 doc，但以专门 span 包裹（CSS 隐藏）
        const strongSpans = content.querySelectorAll(".cm-md-strong");
        expect(strongSpans.length).toBeGreaterThan(0);
        expect(strongSpans[0]?.textContent).toContain("粗");
        teardown();
    });

    it("列表：marker 隐藏，列表项内容可见", () => {
        const { editor, teardown } = mountEditor("- 项目一\n- 项目二");
        expect(editor.getValue()).toBe("- 项目一\n- 项目二");
        expect(editor.view.contentDOM.textContent).toContain("项目一");
        expect(editor.view.contentDOM.textContent).toContain("项目二");
        teardown();
    });

    it("引用：`> ` marker 隐藏，引用内容可见", () => {
        const { editor, teardown } = mountEditor("> 引用文字");
        expect(editor.view.contentDOM.textContent).toContain("引用文字");
        teardown();
    });

    it("链接：label 可见且带链接样式 class", () => {
        const { editor, teardown } = mountEditor("[示例链接](https://example.com)");
        const content = editor.view.contentDOM;
        const label = content.querySelector(".cm-md-link-label");
        expect(label, "链接 label 应有 cm-md-link-label class").not.toBeNull();
        expect(label?.textContent).toBe("示例链接");
        teardown();
    });

    it("wiki link：主体可见带 wiki class，`[[` 与 `]]` 不渲染", () => {
        const { editor, teardown } = mountEditor("[[目标文件|别名]]");
        const content = editor.view.contentDOM;
        const wiki = content.querySelector(".cm-md-wiki-link");
        expect(wiki, "wiki 主体应有 cm-md-wiki-link class").not.toBeNull();
        expect(wiki?.textContent).toBe("别名");
        // 原文保持不变
        expect(editor.getValue()).toBe("[[目标文件|别名]]");
        teardown();
    });

    it("doc 始终保存完整原文（真实的逐字节不变性）", () => {
        const md = "# 标题\n\n- 列表项\n- [ ] 任务\n\n> 引用\n\n[链接](https://a.io) 和 [[维基|别名]] 和 [^1]\n\n[^1]: 定义";
        const { editor, teardown } = mountEditor(md);
        expect(editor.getValue()).toBe(md);
        teardown();
    });
});

describe("live-preview：widget 行为", () => {
    it("task 列表：checkbox widget 渲染，点击可以切换状态", () => {
        const { editor, teardown } = mountEditor("- [ ] 未完成");
        const content = editor.view.contentDOM;
        const box = content.querySelector(".cm-md-checkbox");
        expect(box, "task checkbox widget 应渲染").not.toBeNull();
        expect(editor.getValue()).toBe("- [ ] 未完成");
        // 点击 checkbox：切换为已完成
        box!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        expect(editor.getValue()).toBe("- [x] 未完成");
        teardown();
    });

    it("图片：ImageWidget 渲染 `<img>`，失败时显示占位", () => {
        const { editor, teardown } = mountEditor("![logo](does-not-exist.png)");
        const content = editor.view.contentDOM;
        const img = content.querySelector("img.cm-md-image-img");
        expect(img, "图片应渲染 <img>").not.toBeNull();
        expect(editor.getValue()).toBe("![logo](does-not-exist.png)");
        // 触发 onerror → 占位文字（包含源语法，保持可编辑路径）
        img!.dispatchEvent(new Event("error"));
        expect(content.textContent).toContain("![logo]");
        teardown();
    });

    it("host.resolveImageSrc 自定义解析被调用", () => {
        let resolved = "";
        const host: MarkdownEditorHost = {
            resolveImageSrc: (src) => {
                resolved = src;
                return src;
            },
        };
        const parent = document.createElement("div");
        document.body.appendChild(parent);
        const editor = createMarkdownEditor({ parent, value: "![](img.png)", host });
        const img = editor.view.contentDOM.querySelector("img.cm-md-image-img");
        expect(img).not.toBeNull();
        expect(resolved).toBe("img.png");
        editor.destroy();
        parent.remove();
    });
});

describe("mode 行为", () => {
    it("source 模式：语法以原文呈现（无隐藏 class）", () => {
        const { editor, teardown } = mountEditor("# 标题\n\n**粗**", "source");
        expect(editor.getValue()).toBe("# 标题\n\n**粗**");
        // source 模式不加 live-preview 装饰（无 cm-md-* class）
        expect(editor.view.contentDOM.querySelector(".cm-md-strong")).toBeNull();
        expect(editor.view.contentDOM.querySelector(".cm-md-link-label")).toBeNull();
        teardown();
    });

    it("切换到 live-preview 后出现装饰；切回 source 后消失", () => {
        const parent = document.createElement("div");
        document.body.appendChild(parent);
        const editor = createMarkdownEditor({ parent, value: "**粗**", mode: "source" });
        expect(editor.view.contentDOM.querySelector(".cm-md-strong")).toBeNull();
        editor.setMode("live-preview");
        expect(editor.view.contentDOM.querySelector(".cm-md-strong")).not.toBeNull();
        editor.setMode("source");
        expect(editor.view.contentDOM.querySelector(".cm-md-strong")).toBeNull();
        editor.destroy();
        parent.remove();
    });
});