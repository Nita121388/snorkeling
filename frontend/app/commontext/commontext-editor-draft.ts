// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// CommonText 弹窗 Editor 的持久草稿：localStorage 单槽，跨重启不丢（同机同源 last-writer-wins）。
// 刻意不走后端 settings / 云同步——条目同步是结构化数据语义（rev/deletedat），
// 半成品草稿跨机合并会撞车；先例：弹窗尺寸偏好（commontext:composeModalSize）同样只落 localStorage。
//
// 生命周期约定（与 commontext-compose-modal 接线）：
//   - 写：编辑停手 800ms 防抖；关弹窗/卸载前强制 flush；空文本即清键（空草稿不落盘）。
//   - 清：橡皮擦清空 / 「+」成功落条目后。
//   - 读：无外部 query 打开弹窗时还原（外部 query 打开不还原，避免与外部文本冲突）。

export type EditorDraft = {
    v: 1;
    text: string;
    caret: number;
    insertedIds: string[];
    savedat: number;
};

export const EditorDraftKey = "commontext:editorDraft";

function isValidEditorDraft(value: unknown): value is EditorDraft {
    if (value == null || typeof value !== "object") return false;
    const draft = value as Partial<EditorDraft>;
    if (draft.v !== 1) return false;
    if (typeof draft.text !== "string") return false;
    if (typeof draft.caret !== "number" || !Number.isFinite(draft.caret) || draft.caret < 0) return false;
    if (!Array.isArray(draft.insertedIds) || draft.insertedIds.some((id) => typeof id !== "string")) return false;
    if (typeof draft.savedat !== "number" || !Number.isFinite(draft.savedat)) return false;
    return true;
}

// 坏 JSON / 旧 schema / 隐私模式读失败：一律静默按「无草稿」处理，坏数据顺手清掉。
export function loadEditorDraft(): EditorDraft | null {
    try {
        const raw = localStorage.getItem(EditorDraftKey);
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        if (!isValidEditorDraft(parsed)) {
            localStorage.removeItem(EditorDraftKey);
            return null;
        }
        return parsed;
    } catch {
        // 坏 JSON 同样顺手清掉，避免每次打开都反复解析失败。
        try {
            localStorage.removeItem(EditorDraftKey);
        } catch {
            // 静默。
        }
        return null;
    }
}

// 写：空文本即清键。写失败（隐私模式 / 配额满）静默——草稿是兜底存储，不因它打断输入。
export function saveEditorDraft(draft: { text: string; caret: number; insertedIds: string[] }): void {
    const { text, caret, insertedIds } = draft;
    if (text === "") {
        clearEditorDraft();
        return;
    }
    try {
        const payload: EditorDraft = { v: 1, text, caret, insertedIds, savedat: Date.now() };
        localStorage.setItem(EditorDraftKey, JSON.stringify(payload));
    } catch {
        // 静默：下次仍按内存态工作，仅重启兜底失效。
    }
}

export function clearEditorDraft(): void {
    try {
        localStorage.removeItem(EditorDraftKey);
    } catch {
        // 静默。
    }
}
