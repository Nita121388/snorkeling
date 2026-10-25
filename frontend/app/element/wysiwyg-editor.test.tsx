// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// WysiwygEditor.focus(offset) 的光标落点契约。
//
// 背景 bug：`offset > 0` 把「点在块首（offset 0）」当成「没给 offset」，光标被放到块尾，
// 于是单击进入编辑时光标总在末尾，用户必须再点一次才落到想改的位置。这里把 0 也当成
// 有效 offset 锁死。
//
// 不依赖 @testing-library：用 react-dom/client + act 直接挂载（与 marquee.dom.test.tsx
// 同一套写法），首个 plain 的测试文件就能跑。jsdom 没有排版引擎，但 placeCaretByTextOffset
// 只用 TreeWalker + Range + Selection，全部可用。
//
// @vitest-environment jsdom

import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WysiwygEditor, type WysiwygEditorHandle } from "./wysiwyg-editor";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLElement;
let root: Root;

beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    window.getSelection()?.removeAllRanges();
});

function mountEditor(
    html: string,
    blockKind: "p" | "h" | "list" | "quote" = "p"
): { ref: React.RefObject<WysiwygEditorHandle | null>; editorRoot: HTMLElement } {
    const ref = createRef<WysiwygEditorHandle>();
    act(() => {
        root.render(
            <WysiwygEditor
                ref={ref}
                initialHtml={html}
                blockKind={blockKind}
                onInput={() => {}}
                onBlur={() => {}}
                onKeyDown={() => {}}
            />
        );
    });
    const editorRoot = container.querySelector<HTMLElement>(".wysiwyg-editor");
    if (editorRoot == null) {
        throw new Error("WysiwygEditor did not render");
    }
    return { ref, editorRoot };
}

/** Caret offset measured against the editor root's text content (tags ignored). */
function caretOffsetIn(editorRoot: HTMLElement): number {
    const sel = window.getSelection();
    if (sel == null || sel.rangeCount === 0) {
        return -1;
    }
    const range = sel.getRangeAt(0);
    const before = document.createRange();
    before.selectNodeContents(editorRoot);
    try {
        before.setEnd(range.startContainer, range.startOffset);
    } catch {
        return -1;
    }
    return before.toString().length;
}

describe("WysiwygEditor.focus(offset) — caret placement", () => {
    it("places the caret at offset 0 (the block's first character)", () => {
        // Regression: offset 0 used to be treated as "no offset given" → caret at block end.
        const { ref, editorRoot } = mountEditor("先说结论：根因就在通信库里");
        act(() => ref.current!.focus(0));
        expect(caretOffsetIn(editorRoot)).toBe(0);
    });

    it("places the caret at a mid-block offset", () => {
        const { ref, editorRoot } = mountEditor("先说结论：根因就在通信库里");
        act(() => ref.current!.focus(6));
        expect(caretOffsetIn(editorRoot)).toBe(6);
    });

    it("places the caret at the block's end when no offset is given (dblclick path)", () => {
        const text = "先说结论：根因就在通信库里";
        const { ref, editorRoot } = mountEditor(text);
        act(() => ref.current!.focus());
        expect(caretOffsetIn(editorRoot)).toBe(text.length);
    });

    it("counts only text, ignoring inline markdown tags", () => {
        // <strong>/<code> wrappers must not shift the offset — the value handed in is a
        // RENDERED text offset, which is exactly what computeRenderedOffset produces.
        const { ref, editorRoot } = mountEditor("<strong>先说结论</strong>：根因在<code>库里</code>");
        act(() => ref.current!.focus(5)); // right after "先说结论："
        expect(caretOffsetIn(editorRoot)).toBe(5);
    });

    it("clamps an offset past the end to the block's end", () => {
        const { ref, editorRoot } = mountEditor("短句");
        act(() => ref.current!.focus(999));
        expect(caretOffsetIn(editorRoot)).toBe(2);
    });

    it("places the caret inside the first list item for list blocks", () => {
        const { ref, editorRoot } = mountEditor("<ul><li>第一项</li><li>第二项</li></ul>", "list");
        act(() => ref.current!.focus(2));
        expect(caretOffsetIn(editorRoot)).toBe(2);
    });

    it("keeps a zero offset inside the first list item", () => {
        const { ref, editorRoot } = mountEditor("<ul><li>第一项</li></ul>", "list");
        act(() => ref.current!.focus(0));
        expect(caretOffsetIn(editorRoot)).toBe(0);
    });
});
