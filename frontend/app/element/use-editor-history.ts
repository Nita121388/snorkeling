// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * P1-A 核心交付：统一 undo/redo 栈。
 *
 * 所有编辑（行内编辑、task checkbox、表格 cell、code 语言、列表重编号…）在
 * markdown.tsx 里收敛到单一提交通道 `handleInlineEditCommit`，其实现
 * `handleInlineEditCommitImplRef.current` 是唯一真正写 draft atom 的收敛点。
 *
 * `HistoryStack` 是纯逻辑（无 React/DOM 依赖，可单测）：记录「文本 A → 文本 B」为一步，
 * 支持撤销/重做。`useEditorHistory` 只是薄壳，用 ref 持一个实例并驱动 canUndo/canRedo
 * 重渲染。
 *
 * 粒度：按「单次提交通道调用」为一步（块级 undo，对标思源/我来的块编辑体验）。
 * 记录只需保存全文本快照 { before, after }——因为每次提交都是"给定 text 与锚点行
 * 算出 nextText"，无需 diff 重建。
 *
 * 要点：
 * - 栈上限 MAX_HISTORY 步，防内存膨胀。
 * - 撤销后再次编辑（record）清空 redo 分支。
 * - undo/redo 不自己应用文本，只弹出条目；应用由调用方负责（走 applyText 通道）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export const MAX_HISTORY = 200;

export interface EditorHistoryEntry {
    before: string;
    after: string;
}

/**
 * 纯 undo/redo 栈。线程模型：单线程顺序调用（React 渲染/事件处理器内同步）。
 */
export class HistoryStack {
    private undoStack: EditorHistoryEntry[] = [];
    private redoStack: EditorHistoryEntry[] = [];

    /** 记录一步 undo 条目，并清空 redo 分支。before===after 时视为 no-op，不入栈。 */
    record(before: string, after: string): void {
        if (before === after) {
            return;
        }
        this.undoStack.push({ before, after });
        if (this.undoStack.length > MAX_HISTORY) {
            this.undoStack.shift();
        }
        this.redoStack = [];
    }

    /** 弹出一步可撤销条目（未应用），无则返回 undefined。 */
    popUndo(): EditorHistoryEntry | undefined {
        const entry = this.undoStack.pop();
        if (entry != null) {
            this.redoStack.push(entry);
        }
        return entry;
    }

    /** 弹出一步可重做条目（未应用），无则返回 undefined。 */
    popRedo(): EditorHistoryEntry | undefined {
        const entry = this.redoStack.pop();
        if (entry != null) {
            this.undoStack.push(entry);
        }
        return entry;
    }

    get canUndo(): boolean {
        return this.undoStack.length > 0;
    }

    get canRedo(): boolean {
        return this.redoStack.length > 0;
    }

    get undoDepth(): number {
        return this.undoStack.length;
    }

    get redoDepth(): number {
        return this.redoStack.length;
    }

    /** 清空两栈。 */
    clear(): void {
        this.undoStack = [];
        this.redoStack = [];
    }
}

export interface UseEditorHistoryArgs {
    /** undo/redo 回填用的通道（P1 传入"仅更新 draft、不 arm autosave"的函数）。 */
    applyText: (newText: string) => void;
    /** 重置信号：变化时清空历史（文件切换/重载、编辑使能开关翻转）。 */
    resetKey?: unknown;
}

export interface EditorHistoryHandle {
    /** 在编辑收敛点调用：记录一步 undo 条目（薄壳，转发到 HistoryStack）。 */
    record: (before: string, after: string) => void;
    /** 有可撤销则回填 before 并返回 true，否则 false。 */
    undo: () => boolean;
    /** 有可重做则回填 after 并返回 true，否则 false。 */
    redo: () => boolean;
    canUndo: boolean;
    canRedo: boolean;
    /** 清空 undo 与 redo 两栈。 */
    clear: () => void;
}

/**
 * 薄壳 Hook：用 ref 持一个 HistoryStack，undo/redo 时把弹出条目经 applyText 应用。
 * canUndo/canRedo 通过版本号驱动重渲染保持最新。
 */
export function useEditorHistory(args: UseEditorHistoryArgs): EditorHistoryHandle {
    const { applyText, resetKey } = args;

    const applyTextRef = useRef(applyText);
    applyTextRef.current = applyText;

    const stackRef = useRef<HistoryStack | null>(null);
    if (stackRef.current == null) {
        stackRef.current = new HistoryStack();
    }

    // 版本号：每次栈变化时 bump，驱动 canUndo/canRedo 在渲染期正确更新。
    const [rev, setRev] = useState(0);
    const bump = useCallback(() => setRev((r) => r + 1), []);

    // resetKey 变化 → 清空历史。
    useEffect(() => {
        stackRef.current?.clear();
        bump();
    }, [resetKey, bump]);

    const record = useCallback(
        (before: string, after: string) => {
            stackRef.current?.record(before, after);
            bump();
        },
        [bump]
    );

    const undo = useCallback((): boolean => {
        const entry = stackRef.current?.popUndo();
        if (entry == null) {
            return false;
        }
        applyTextRef.current(entry.before);
        bump();
        return true;
    }, [bump]);

    const redo = useCallback((): boolean => {
        const entry = stackRef.current?.popRedo();
        if (entry == null) {
            return false;
        }
        applyTextRef.current(entry.after);
        bump();
        return true;
    }, [bump]);

    const clear = useCallback(() => {
        stackRef.current?.clear();
        bump();
    }, [bump]);

    const canUndo = stackRef.current?.canUndo ?? false;
    const canRedo = stackRef.current?.canRedo ?? false;

    const handle: EditorHistoryHandle = useMemo(
        () => ({ record, undo, redo, canUndo, canRedo, clear }),
        // rev 驱动栈长度变化时重建，保证 canUndo/canRedo 反映最新状态。
        [record, undo, redo, clear, rev] // eslint-disable-line react-hooks/exhaustive-deps
    );

    return handle;
}