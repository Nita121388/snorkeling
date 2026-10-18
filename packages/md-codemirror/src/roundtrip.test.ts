// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// @vitest-environment jsdom

/**
 * Markdown 往返保真测试（AC4）：编辑只改目标内容，其余逐字节保留。
 *
 * 判据：`用户输入一个字符 → 除目标插入点外，doc 与原文逐字节相同`。
 * CodeMirror 以完整 Markdown 为 doc，未编辑片段天然逐字节保留；
 * 这里用 diff 断言锁死「不会出现额外重写」。
 */

import { describe, expect, it } from "vitest";

import { createMarkdownEditor } from "./editor";

function byteDiff(a: string, b: string): { commonPrefix: number; commonSuffix: number } {
    let prefix = 0;
    while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
    let suffix = 0;
    while (
        suffix < a.length - prefix &&
        suffix < b.length - prefix &&
        a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
    ) {
        suffix++;
    }
    return { commonPrefix: prefix, commonSuffix: suffix };
}

describe("往返保真（AC4）：只改目标插入点", () => {
    const ORIGINAL = [
        "# 标题",
        "",
        "第一段包含 **粗体** 和 *斜体* 和 `代码`。",
        "",
        "- 列表一",
        "- [ ] 任务",
        "",
        "> 引用块",
        "",
        "见 [[维基链接|别名]] 与 [外部链接](https://example.com) 与 [^1]。",
        "",
        "![图片](a.png|300)",
        "",
        "[^1]: 脚注定义",
        "",
    ].join("\n");

    it("在正文中间插入字符：只有插入点不同", () => {
        const { editor, teardown } = mountWith(ORIGINAL);
        // 在「第一段包含」的「包含」之后插入「内容」
        const insertPos = ORIGINAL.indexOf("包含") + 2;
        editor.view.dispatch({
            changes: { from: insertPos, to: insertPos, insert: "内容" },
            selection: { anchor: insertPos + 2 },
            userEvent: "input",
        });
        const next = editor.getValue();
        const { commonPrefix, commonSuffix } = byteDiff(ORIGINAL, next);
        expect(commonPrefix).toBe(insertPos);
        // 后缀应覆盖到文末（插入点之后无变化）
        expect(commonSuffix).toBe(ORIGINAL.length - insertPos);
        editor.destroy();
        teardown();
    });

    it("列表内编辑：只改该行，其他列表项不动", () => {
        const { editor, teardown } = mountWith(ORIGINAL);
        const line = "- 列表一";
        const pos = ORIGINAL.indexOf(line) + line.length;
        editor.view.dispatch({
            changes: { from: pos, to: pos, insert: "（编辑）" },
            selection: { anchor: pos + 5 },
            userEvent: "input",
        });
        const next = editor.getValue();
        expect(next).toBe(ORIGINAL.replace("- 列表一", "- 列表一（编辑）"));
        editor.destroy();
        teardown();
    });

    it("删除一个字符：只删目标字符", () => {
        const { editor, teardown } = mountWith(ORIGINAL);
        const target = "第一段包含";
        const delPos = ORIGINAL.indexOf(target) + 3; // 删掉「包」
        editor.view.dispatch({
            changes: { from: delPos, to: delPos + 1, insert: "" },
            selection: { anchor: delPos },
            userEvent: "delete",
        });
        const next = editor.getValue();
        expect(next).toBe(ORIGINAL.replace("第一段包含", "第一段含"));
        editor.destroy();
        teardown();
    });

    it("跨块编辑后 wiki/footnote/image/尺寸逐字节保留", () => {
        const { editor, teardown } = mountWith(ORIGINAL);
        // 文末追加一行
        const end = ORIGINAL.length;
        editor.view.dispatch({
            changes: { from: end, to: end, insert: "\n追加内容" },
            selection: { anchor: end + 5 },
            userEvent: "input",
        });
        const next = editor.getValue();
        // 所有有损构造的原文必须逐字节仍在
        for (const frag of ["[[维基链接|别名]]", "[^1]", "![图片](a.png|300)", "[外部链接](https://example.com)"]) {
            expect(next).toContain(frag);
        }
        expect(next).toBe(ORIGINAL + "\n追加内容");
        editor.destroy();
        teardown();
    });

    it("setValue 后 doc 完全替换为新文本（外部同步语义）", () => {
        const { editor, teardown } = mountWith(ORIGINAL);
        editor.setValue("# 新标题\n\n新正文");
        expect(editor.getValue()).toBe("# 新标题\n\n新正文");
        editor.destroy();
        teardown();
    });
});

function mountWith(content: string) {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const editor = createMarkdownEditor({ parent, value: content });
    return {
        editor,
        teardown() {
            parent.remove();
        },
    };
}