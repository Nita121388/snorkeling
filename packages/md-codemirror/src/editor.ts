// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * `createMarkdownEditor` —— CodeMirror 6 Markdown 编辑内核的对外实例。
 *
 * 生命周期：
 * ```ts
 * const editor = createMarkdownEditor({ parent, value, mode });
 * editor.destroy();
 * ```
 *
 * 关键约定：
 * - **文本状态 = CodeMirror EditorState**；`value` 是 Markdown 原文。
 * - `setValue` 是外部同步入口，**不触发** `onChange`（避免写盘循环）；
 * - 用户输入经 transaction → `onChange(value, change)`（`value` 是完整新文本）；
 * - 三种 mode 共用同一个 EditorState（`setMode` 只重配 Compartment，不重建实例）。
 */

import { Annotation, Compartment, EditorSelection, EditorState, Transaction, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";

import { mergeHost } from "./host";
import { livePreviewBaseTheme, livePreviewExtension } from "./live-preview";
import { runMarkdownEditorCommand } from "./commands";
import type { MarkdownChange, MarkdownEditor, MarkdownEditorHost, MarkdownEditorMode, MarkdownEditorOptions, MarkdownSelection } from "./types";

/** Compartment 用的 mode 扩展：把每档 mode 的内容装进来，方便动态替换。 */
export type ModeExtensions = ReturnType<typeof makeModeExtensions>;

export function makeModeExtensions(mode: MarkdownEditorMode, host: MarkdownEditorHost): Extension[] {
    switch (mode) {
        case "preview":
            return [
                EditorState.readOnly.of(true),
                EditorView.editable.of(false),
                previewBlocked(),
                livePreviewExtension(host),
            ];
        case "source":
            return [EditorState.readOnly.of(false), EditorView.editable.of(true)];
        case "live-preview":
        default:
            return [EditorState.readOnly.of(false), EditorView.editable.of(true), livePreviewExtension(host)];
    }
}

/** preview 模式：禁掉光标与选中绘制（纯展示）。 */
function previewBlocked(): Extension {
    return EditorView.contentAttributes.of({ "aria-readonly": "true" });
}

/** setValue 专用 annotation：onChange 里跳过（外部同步入口不触发写盘回调）。 */
const SetValueAnnotation = Annotation.define<boolean>();
/** 取原 doc 在 [from,to) 的文本（用于 change.removed）。 */
function docSlice(tr: import("@codemirror/state").Transaction, from: number, to: number): string {
    return tr.startState.doc.sliceString(from, to);
}


export type CreateMarkdownEditor = (options: MarkdownEditorOptions) => MarkdownEditor;

export function createMarkdownEditor(options: MarkdownEditorOptions): MarkdownEditor {
    const parent = options.parent;
    const host = mergeHost(options.host);
    const mode = options.mode ?? "live-preview";

    const modeCompartment = new Compartment();

    const updateListener = EditorView.updateListener.of((update) => {
        if (update.docChanged) {
            // 外部 setValue 不触发 onChange
            const isExternal = update.transactions.some(
                (tr) => tr.annotation(SetValueAnnotation) != null
            );
            if (isExternal) return;
            const value = update.state.doc.toString();
            for (const tr of update.transactions) {
                if (!tr.docChanged) continue;
                update.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
                    const changeInfo: MarkdownChange = {
                        from: fromB,
                        to: toB,
                        inserted: inserted.toString(),
                        removed: docSlice(tr, fromA, toA),
                        origin: "user",
                    };
                    if (options.onChange != null) {
                        options.onChange(value, changeInfo);
                    }
                });
            }
        }
        if (update.selectionSet && options.onSelectionChange != null) {
            const sel = update.state.selection.main;
            const range: MarkdownSelection = { from: sel.from, to: sel.to };
            options.onSelectionChange(range);
        }
    });

    const state = EditorState.create({
        doc: options.value,
        selection: EditorSelection.single(0, 0),
        extensions: [
            markdown({ base: markdownLanguage }),
            keymap.of([...defaultKeymap, ...historyKeymap]),
            history(),
            syntaxHighlighting(defaultHighlightStyle),
            livePreviewBaseTheme(),
            modeCompartment.of(makeModeExtensions(mode, host)),
            ...(options.extensions ?? []),
            updateListener,
        ],
    });

    const view = new EditorView({ state, parent });
    view.dom.classList.add("md-codemirror-editor");

    let destroyed = false;
    // destroy 后仍能拿到最后文本（journal 保存路径可能延迟读取）
    let lastValue = options.value;
    function getLastValue(): string {
        return lastValue;
    }
    let currentMode: MarkdownEditorMode = mode;

    const editor: MarkdownEditor = {
        view,
        focus() {
            if (destroyed) return;
            view.focus();
        },
        getValue() {
            return destroyed ? getLastValue() : view.state.doc.toString();
        },
        setValue(value: string) {
            if (destroyed) return;
            const tr = view.state.update({
                changes: { from: 0, to: view.state.doc.length, insert: value },
                annotations: SetValueAnnotation.of(true),
            });
            view.dispatch(tr);
        },
        setMode(next: MarkdownEditorMode) {
            if (destroyed) return;
            currentMode = next;
            const effects = modeCompartment.reconfigure(makeModeExtensions(next, host));
            view.dispatch({ effects });
        },
        getMode() {
            return currentMode;
        },
        dispatch(transaction: Transaction) {
            if (destroyed) return;
            view.dispatch(transaction);
        },
        runCommand(command) {
            if (destroyed) return false;
            return runMarkdownEditorCommand(view, command);
        },
        destroy() {
            if (destroyed) return;
            destroyed = true;
            lastValue = view.state.doc.toString();
            view.destroy();
        },
    };

    return editor;
}