// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// 编辑器类型契约（数据安全相关）：
//   expectEditor: "wysiwyg"  → 必须走 contentEditable（WYSIWYG）
//   expectEditor: "textarea" → 必须回退源码 textarea（折叠列表项就是这种情况：
//                              种子会展开隐藏子内容，丢弃又会丢数据，只能走 textarea）
// 不声明则跳过。

export default {
    id: "editor-kind",
    why: "编辑器类型必须符合 case 声明（折叠列表项必须回退 textarea，否则会丢子项数据）",
    run({ observation, caseDef }) {
        const expect = caseDef.expectEditor;
        if (expect == null) {
            return { skipped: true, detail: "case 未声明 expectEditor" };
        }
        const during = observation.during;
        const actualWysiwyg = during?.editorKind === "wysiwyg" && during?.hasTextarea !== true;
        const actualTextarea = during?.hasTextarea === true;
        const pass = expect === "wysiwyg" ? actualWysiwyg : actualTextarea;
        return {
            pass,
            detail: `期望 ${expect}，实际 data-block-kind=${during?.editorKind} hasTextarea=${during?.hasTextarea}`,
            evidence: { expect, editorKind: during?.editorKind, hasTextarea: during?.hasTextarea },
        };
    },
};
