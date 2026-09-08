// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import React, { forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useRef } from "react";
import hljs from "highlight.js/lib/common";

export type CodeEditorHandle = {
    focus: (opts?: { start?: number; end?: number }) => void;
    getCaret: () => number;
    getContent: () => string;
};

type Props = {
    initialText: string;
    /** Code language for the hljs class + highlight; null/unknown → auto-detect. */
    language?: string | null;
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void;
    onInput: (text: string, caret: number) => void;
    onBlur: () => void;
};

/**
 * Map a plain-text offset to a DOM position inside `el` and collapse the selection there.
 * Works across the token spans the highlighter injects: text nodes are walked in order and the
 * offset is decremented by each node's length until the owner node is found.
 */
function placeCaret(el: HTMLElement, offset: number) {
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let pos = 0;
    let node: Node | null;
    while ((node = walker.nextNode())) {
        const text = node.textContent ?? "";
        if (pos + text.length >= offset) {
            range.setStart(node, Math.max(0, offset - pos));
            range.collapse(true);
            selection.removeAllRanges();
            selection.addRange(range);
            return;
        }
        pos += text.length;
    }
    // Offset past the end (empty node, or offset === text length): collapse to the very end.
    range.selectNodeContents(el);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
}

/**
 * Re-highlight `el`'s plain text in place. The result is hljs token spans — the SAME class
 * names the preview's rehype-highlight emits — so the overlay-scoped .hljs-* color rules in
 * markdown.scss style them identically to the rendered block.
 *
 * Undo note: this runs ONCE at edit-open, before any user input, so the contenteditable's
 * native undo stack starts clean. No re-highlight during typing (that would rewrite innerHTML
 * and corrupt undo) — the simple "highlight on enter only" version.
 */
function highlight(el: HTMLElement, language: string | null | undefined) {
    const text = el.textContent ?? "";
    if (text.length === 0) {
        el.innerHTML = "";
        return;
    }
    const result =
        language != null && hljs.getLanguage(language)
            ? hljs.highlight(text, { language, ignoreIllegals: true }).value
            : hljs.highlightAuto(text).value;
    el.innerHTML = result;
}

/**
 * Code-block inline editor: a `<code class="hljs language-x" contenteditable>` living inside the
 * overlay's `<pre class="codeblock">` — the SAME DOM structure as the rendered block, so the
 * overlay-scoped .codeblock styles (markdown.scss) apply unchanged and entering edit is
 * pixel-stable: same font/line-height/padding/background/token colors.
 *
 * Content ownership is imperative (React renders the element bare; textContent/innerHTML are
 * written directly): React reconciling children would fight the browser's caret + undo state.
 */
const ContentEditableCodeEditor = forwardRef<CodeEditorHandle, Props>(function ContentEditableCodeEditor(
    { initialText, language, onKeyDown, onInput, onBlur },
    ref,
) {
    const elRef = useRef<HTMLElement | null>(null);
    const initializedRef = useRef(false);

    // Write + highlight the initial content exactly once (child layout effect runs before the
    // parent hook's focus effect, so the caret lands on already-highlighted content).
    useLayoutEffect(() => {
        const el = elRef.current;
        if (!el || initializedRef.current) return;
        initializedRef.current = true;
        el.textContent = initialText;
        highlight(el, language);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const getCaret = useCallback(() => {
        const el = elRef.current;
        const selection = window.getSelection();
        if (!el || !selection?.rangeCount) return 0;
        const range = selection.getRangeAt(0);
        const before = document.createRange();
        before.selectNodeContents(el);
        try {
            before.setEnd(range.startContainer, range.startOffset);
        } catch {
            return 0;
        }
        return before.toString().length;
    }, []);

    const emitInput = useCallback(() => {
        onInput(elRef.current?.textContent ?? "", getCaret());
    }, [onInput, getCaret]);

    useImperativeHandle(
        ref,
        () => ({
            focus: (opts) => {
                const el = elRef.current;
                if (!el) return;
                el.focus({ preventScroll: true });
                const textLen = el.textContent?.length ?? 0;
                const start = Math.max(0, Math.min(opts?.start ?? textLen, textLen));
                placeCaret(el, start);
            },
            getCaret,
            getContent: () => elRef.current?.textContent ?? "",
        }),
        [getCaret]
    );

    const handleKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
        // Any bare Enter (incl. Shift+Enter — a soft break is the same newline inside code)
        // inserts a real newline. execCommand("insertText") keeps the native undo stack intact
        // and, with white-space:pre-wrap, lands as a "\n" text node (unlike the browser's
        // default Enter which spawns <div>/<br> that textContent would drop). Handled BEFORE
        // delegating: makeInlineEditKeydown preventDefaults Enter for its split flow, whose
        // textarea branch early-returns for code (textarea isn't mounted) → silent no-op.
        if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
            const native = e.nativeEvent as KeyboardEvent & { isComposing?: boolean };
            if (!native.isComposing) {
                e.preventDefault();
                document.execCommand("insertText", false, "\n");
                return;
            }
        }
        if (e.key === "Tab") {
            e.preventDefault();
            if (!e.shiftKey) {
                // Indent: insert 2 spaces at the caret (execCommand → undoable, spans survive).
                document.execCommand("insertText", false, "  ");
                return;
            }
            // Outdent: delete up to 2 leading spaces of the current line. Done via a selection +
            // execCommand("delete") rather than a textContent rewrite — the rewrite would nuke
            // the token spans AND the undo stack.
            const el = elRef.current;
            const caret = getCaret();
            const text = el?.textContent ?? "";
            const lineStart = text.lastIndexOf("\n", Math.max(0, caret - 1)) + 1;
            const remove =
                text.slice(lineStart, lineStart + 2) === "  " ? 2 : text[lineStart] === " " ? 1 : 0;
            if (remove > 0 && el) {
                const selection = window.getSelection();
                if (selection) {
                    const range = document.createRange();
                    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
                    let pos = 0;
                    let startNode: Node | null = null;
                    let startOffset = 0;
                    let node: Node | null;
                    while ((node = walker.nextNode())) {
                        const len = node.textContent?.length ?? 0;
                        if (!startNode && pos + len >= lineStart) {
                            startNode = node;
                            startOffset = lineStart - pos;
                        }
                        if (startNode && pos + len >= lineStart + remove) {
                            range.setStart(startNode, startOffset);
                            range.setEnd(node, lineStart + remove - pos);
                            selection.removeAllRanges();
                            selection.addRange(range);
                            document.execCommand("delete");
                            break;
                        }
                        pos += len;
                    }
                    placeCaret(el, Math.max(lineStart, caret - remove));
                }
            }
            return;
        }
        onKeyDown(e);
    };

    return (
        <code
            ref={elRef}
            className={`hljs${language ? ` language-${language}` : ""}`}
            contentEditable
            suppressContentEditableWarning
            spellCheck={false}
            onKeyDown={handleKeyDown}
            // execCommand-driven edits (typing, paste, Tab, Enter) all fire input; forward the
            // plain text + caret so the session's draftText stays in sync for commit/Cmd+S.
            onInput={emitInput}
            onPaste={(e) => {
                // Plain-text paste: strip rich HTML so source code stays source code.
                e.preventDefault();
                document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
            }}
            onBlur={onBlur}
        />
    );
});

export default ContentEditableCodeEditor;
