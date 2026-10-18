// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * 结构化命令执行器。
 *
 * 设计：所有 command 必须产生明确的文本 change（经 `view.dispatch`），
 * **不允许直接改 DOM**。这样历史记录、往返校验、undo 才有据可依。
 */

import type { EditorView } from "@codemirror/view";
import { deleteLine } from "@codemirror/commands";

import type { MarkdownCommand } from "./types";

/** 任务列表行 marker：`- [ ] ` / `- [x] ` / `1. [ ] ` 等（marker 后跟的内容不参与匹配）。 */
const TASK_MARKER_RE = /^(\s*[-\*+]|\s*\d+\.)\s+\[( |x|X)\]\s/;

/**
 * 执行一个结构化命令。返回是否产生了实际 changes。
 * @param view 目标 EditorView
 * @param command 结构化的命令描述
 */
export function runMarkdownEditorCommand(view: EditorView, command: MarkdownCommand): boolean {
    const { state } = view;
    switch (command.type) {
        case "insert-text": {
            const pos = clamp(command.at ?? state.selection.main.head, 0, state.doc.length);
            if (command.text === "") {
                return false;
            }
            view.dispatch({
                changes: { from: pos, to: pos, insert: command.text },
                selection: { anchor: pos + command.text.length },
                userEvent: "input",
            });
            return true;
        }
        case "replace-text": {
            const from = clamp(command.from, 0, state.doc.length);
            const to = clamp(command.to, from, state.doc.length);
            if (from === to && command.text === "") {
                return false;
            }
            view.dispatch({
                changes: { from, to, insert: command.text },
                selection: { anchor: from + command.text.length },
                userEvent: "input",
            });
            return true;
        }
        case "delete-line": {
            const pos = command.at ?? state.selection.main.head;
            const line = state.doc.lineAt(clamp(pos, 0, state.doc.length));
            view.dispatch({
                changes: {
                    from: line.from,
                    to: line.to < state.doc.length ? line.to + 1 : line.to,
                },
                // 光标保持在行首（若删除后还有内容）
                selection: { anchor: line.from },
                userEvent: "delete",
            });
            return true;
        }
        case "toggle-task": {
            const pos = clamp(command.at ?? state.selection.main.head, 0, state.doc.length);
            const line = state.doc.lineAt(pos);
            const match = TASK_MARKER_RE.exec(line.text);
            if (match == null) {
                return false;
            }
            const marker = match[0];
            const checked = /\[x\]/i.test(marker);
            const replacement = marker.replace(/\[( |x|X)\]/i, checked ? "[ ]" : "[x]");
            // 只替换 `[ ]`/`[x]` 这一小段，保留 marker 前缀与内容不动
            const boxStart = line.from + match.index + marker.indexOf("[");
            view.dispatch({
                changes: { from: boxStart, to: boxStart + 3, insert: checked ? "[ ]" : "[x]" },
                userEvent: "input",
            });
            return true;
        }
        default: {
            const _exhaustive: never = command;
            void _exhaustive;
            return false;
        }
    }
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

/** 便捷命令集合：可直接用于 CodeMirror keymap 绑定。 */
export type MarkdownKeymapCommands = {
    /** 光标行切换 task checkbox。 */
    toggleTask: () => boolean;
};

/** 生成一组可塞进 keymap 的命名命令。 */
export function createMarkdownCommands(view: EditorView): MarkdownKeymapCommands {
    return {
        toggleTask: () => runMarkdownEditorCommand(view, { type: "toggle-task" }),
    };
}

// 保留 deleteLine 导入的显式引用（供未来 keymap 扩展），避免未使用告警。
export { deleteLine };