// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom

/**
 * AC5 卡片闭环：journal 风格的零框架消费者验证。
 *
 * 模拟 journal card editor 的最小闭环：
 *   open(card) → createMarkdownEditor({ parent, value: card.content })
 *   → 用户编辑（dispatch）→ save() → editor.getValue() 写回 card.content
 *   → reopen → setValue / 新实例回填 → 预览与编辑结果一致
 *
 * 关键断言：
 * - 文档始终保存完整 Markdown（事实源）；
 * - 保存后 card.content 仍是 Markdown 文本；
 * - 重开后内容一致（往返保真跨实例）。
 */

import { describe, expect, it, beforeAll } from "vitest";

// 直接消费 ESM 构建产物（不是源码）——证明 journal 零打包器路径可用
let Api: typeof import("../dist/index.js");
beforeAll(async () => {
    Api = await import("../dist/index.js");
});

/** 模拟 journal 卡片对象。 */
type FakeCard = { id: string; content: string; title: string };

class FakeCardEditor {
    static domCount = 0;
    editor: ReturnType<typeof Api.createMarkdownEditor> | null = null;
    private parent: HTMLElement | null = null;
    card: FakeCard;
    constructor(card: FakeCard) {
        this.card = card;
    }
    open() {
        const parent = document.createElement("div");
        parent.id = `journal-editor-${FakeCardEditor.domCount++}`;
        document.body.appendChild(parent);
        this.parent = parent;
        this.editor = Api.createMarkdownEditor({
            parent,
            value: this.card.content,
            mode: "live-preview",
        });
        // journal：默认进入 live-preview（PRD R2：不是先进入 source 模式）
        return this.editor;
    }
    /** 模拟用户在编辑器里的输入。 */
    insertAt(text: string, at: number) {
        this.editor!.view.dispatch({
            changes: { from: at, to: at, insert: text },
            selection: { anchor: at + text.length },
            userEvent: "input",
        });
    }
    save() {
        // journal 保存：只提交 content 字段
        this.card.content = this.editor!.getValue();
        return this.card;
    }
    switchMode(mode: "source" | "live-preview" | "preview") {
        // 卡片提供 source/live-preview 切换（共用同一 CodeMirror 文本状态）
        this.editor!.setMode(mode);
    }
    close() {
        this.editor!.destroy();
        this.parent!.remove();
        this.editor = null;
        this.parent = null;
    }
    /** 重新打开：新实例回填保存后的 content。 */
    reopen() {
        this.close();
        this.open();
        return this.editor;
    }
}

describe("AC5：journal 卡片闭环（消费 dist 产物、无 React）", () => {
    it("消费产物导出全部公共 API", () => {
        expect(typeof Api.createMarkdownEditor).toBe("function");
        expect(typeof Api.runMarkdownEditorCommand).toBe("function");
        expect(typeof Api.livePreviewBaseTheme).toBe("function");
    });

    it("打开→编辑→保存：card.content 仍是完整 Markdown 且只增改目标", () => {
        const card: FakeCard = {
            id: "1",
            title: "今日记录",
            content: "# 今日\n\n- [ ] 任务一\n\n见 [[链接文档]]。",
        };
        const ed = new FakeCardEditor(card);
        const editor = ed.open();
        expect(editor.getMode()).toBe("live-preview");
        // 加一行
        const at = card.content.length;
        ed.insertAt("\n新段落 **重要**", at);
        // 保存
        ed.save();
        expect(card.content).toBe("# 今日\n\n- [ ] 任务一\n\n见 [[链接文档]]。\n新段落 **重要**");
        ed.close();
    });

    it("重开卡片：从保存后的 content 回填，预览/编辑内容一致", () => {
        const card: FakeCard = {
            id: "2",
            title: "复盘",
            content: "初始 **粗** 内容",
        };
        const ed = new FakeCardEditor(card);
        ed.open();
        ed.insertAt("追加", card.content.length);
        ed.save();
        const saved = card.content;
        ed.reopen();
        expect(ed.editor!.getValue()).toBe(saved);
        expect(ed.editor!.getValue()).toContain("**粗**");
        ed.close();
    });

    it("source / live-preview 切换共用同一文本状态（不丢内容）", () => {
        const card: FakeCard = { id: "3", title: "模式", content: "## 标题\n\n正文" };
        const ed = new FakeCardEditor(card);
        const editor = ed.open();
        editor.setMode("source");
        editor.setMode("live-preview");
        expect(editor.getValue()).toBe("## 标题\n\n正文");
        ed.close();
    });

    it("task checkbox 在 live-preview 中可点击切换（journal 交互）", () => {
        const card: FakeCard = { id: "4", title: "任务", content: "- [ ] 待办" };
        const ed = new FakeCardEditor(card);
        const editor = ed.open();
        const box = editor.view.contentDOM.querySelector(".cm-md-checkbox");
        expect(box).not.toBeNull();
        box!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        ed.save();
        expect(card.content).toBe("- [x] 待办");
        ed.close();
    });
});
