// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * WysiwygEditor — contentEditable WYSIWYG editor for prose blocks (方案 08).
 *
 * Replaces the textarea overlay for paragraph, heading, list, quote, and blank
 * blocks when the `wysiwyg` feature flag is ON. The editor renders the block's
 * RENDERED HTML (bold shows as bold, no `#`/`-`/`>` markers visible) and
 * serializes the contentEditable DOM back to markdown source on commit.
 *
 * The editor maintains an internal `liveKind` state (the block may convert
 * from "p" to "h" or "list" via typing triggers). Commit serialization uses
 * the current live kind + marker style to emit the correct markdown prefix.
 *
 * The component follows the same imperative pattern as ContentEditableCodeEditor:
 * React renders a bare element; text/HTML content is written imperatively to
 * avoid React reconciling away the user's caret and undo state.
 */

import React, { forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import {
    detectLiveTypingMarker,
    detectClosedInlinePair,
    type BlockKind,
    type ClosedInlinePair,
} from "@md/core/transform/block-type";
import { serializeBlockDomToMarkdown, type WysiwygBlockKind } from "@md/core/transform/dom-to-markdown";
// caret 桥（DOM 位置 ↔ markdown 偏移）已搬进 md-dom：编辑引擎里最易错的一环，
// 且必须是框架无关的（任何非 React 消费方都要用它）。
import { caretToMarkdownOffset, placeCaretByTextOffset, selectionToMarkdownRange } from "@md/dom/caret";
import {
    focusByAnchor,
    indentListItem,
    liFromSelection,
    normalizeListDom,
    outdentListItem,
    plantCaretAnchor,
} from "@md/core/transform/list-dom";

// ---------------------------------------------------------------------------
// Public handle — consumed by markdown.tsx via ref.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Closed-inline DOM surgery (P3 F5) — extracted as a pure-ish DOM helper so it can be
// unit-tested in jsdom without a real Selection/caret.
// ---------------------------------------------------------------------------

const INLINE_MARKER_TAGS: Record<string, string> = {
    "**": "strong",
    "*": "em",
    "~~": "del",
    "`": "code",
};

/**
 * 在文本节点 `anchor` 中把 caret 前的闭合行内配对转成对应行内元素（`**bold**` → `<strong>`）。
 * 返回 `{ el, parent }`（成功时 el 位于 parent 中紧随前文节点之后），或 null（未满足条件：
 * anchor 非文本节点 / 配对不完整 / 文本不匹配——调用方据此静默跳过）。
 *
 * 组件层（applyClosedInlineFormatting）负责读取 caret、组合态守卫与光标重定位；
 * 这里的 DOM 结构变换本身不含 selection 依赖，可在 jsdom 中直接验证。
 * parent 在 removeChild(anchor) 之前捕获并随返回值带出——调用方若事后读
 * anchor.parentNode 会是 null（死代码，P3 复核 P1-1）。
 */
export function convertClosedInlineAtCaret(
    anchor: Node,
    caretOffset: number,
    pair: ClosedInlinePair
): { el: HTMLElement; parent: Node } | null {
    if (anchor.nodeType !== 3) {
        return null;
    }
    const text = anchor.textContent ?? "";
    const pairLen = pair.marker.length * 2 + pair.inner.length;
    const startInNode = caretOffset - pairLen;
    if (startInNode < 0) {
        return null;
    }
    // 配对必须完整落在 anchor 节点内（不匹配 → 跨节点/中间被改动 → 静默跳过）。
    if (text.slice(startInNode, caretOffset) !== `${pair.marker}${pair.inner}${pair.marker}`) {
        return null;
    }
    const before = text.slice(0, startInNode);
    const afterText = text.slice(caretOffset);
    const el = document.createElement(INLINE_MARKER_TAGS[pair.marker] ?? "strong");
    el.textContent = pair.inner;
    const nodes: Node[] = [];
    if (before.length > 0) {
        nodes.push(document.createTextNode(before));
    }
    nodes.push(el);
    if (afterText.length > 0) {
        nodes.push(document.createTextNode(afterText));
    }
    const parent = anchor.parentNode;
    if (parent == null) {
        return null;
    }
    for (const n of nodes) {
        parent.insertBefore(n, anchor);
    }
    parent.removeChild(anchor);
    return { el, parent };
}

export type WysiwygEditorHandle = {
    /** Place the caret in the editor (rendered-text offset, clamped to content). */
    focus(offset?: number): void;
    /** Serialize the current DOM to markdown (uses liveKind + headingLevel + listMarker). */
    getMarkdown(): string;
    /** Get the caret offset in MARKDOWN space (via sentinel serialization). */
    getCaretMarkdown(): number;
    /** Get the selection range in MARKDOWN space, null when collapsed (P3 G4). */
    getSelectionRange(): { start: number; end: number } | null;
    /** Get the plain visible text content (no markdown markers). */
    getText(): string;
    /** Wrap the current selection with an inline style (execCommand-based). */
    applyInlineStyle(style: "bold" | "italic" | "strike" | "code"): void;
    /** Which inline styles are active at the caret. */
    getActiveInlineStyles(): Set<string>;
    /** Insert plain text at the caret (used by paste-image / emoji DOM insert paths). */
    insertTextAtCaret(text: string): void;
    /** Delete `count` characters immediately before the caret (used to strip `::query` triggers). */
    deleteCharsBeforeCaret(count: number): void;
    /** Indent/outdent the current list item with an explicit DOM move (方案 10 step2 F3:
     *  self-owned structure operation — no `document.execCommand`). Nested lists end up inside
     *  the previous sibling `<li>` (canonical structure); serialization re-emits nested markers. */
    applyListIndent(dir: 1 | -1): void;
    /** Live-convert the block to a new kind (called by slash/toolbar commands). */
    applyLiveKind(kind: BlockKind, headingLevel?: number): void;
    /**
     * Delete the text from the current line's start to the caret (used to clear a
     * slash/emoji trigger once a palette command is picked).
     */
    deleteCaretLinePrefix(): void;
    /** Current live kind (may differ from initial blockKind due to typing triggers). */
    getLiveKind(): WysiwygBlockKind;
    getHeadingLevel(): number;
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type WysiwygEditorProps = {
    /** Rendered HTML clone of the block's content (no block markers). */
    initialHtml: string;
    /** Initial block kind from the session. */
    blockKind: WysiwygBlockKind;
    /** Heading level (1-6) if blockKind === "h". */
    headingLevel?: number;
    /** Original list marker from source: "-" | "*" | "+" | "1." | "1)" etc. */
    listMarker?: string;
    /** Typography snapshot from the rendered block (for CSS overlay matching). */
    typography?: React.CSSProperties;
    /** Placeholder text shown when empty. */
    placeholder?: string;
    /** Called on every input with (serialized markdown, markdown-caret offset). */
    onInput: (markdown: string, caretMarkdown: number) => void;
    /** Called on blur with the serialized markdown content. */
    onBlur: (content: string) => void;
    /** Called on keydown (parent handles Enter-split, Esc, mod shortcuts). */
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void;
    /** Called on paste (parent handles image upload to assets / text passthrough). */
    onPaste?: (e: React.ClipboardEvent<HTMLElement>) => void;
    /** Called on selection change with the markdown-space range (P3 G4: floating toolbar). */
    onSelectionChange?: (sel: { start: number; end: number } | null) => void;
    // --- A3 在位编辑（wysiwyg-inplace）：渲染器对活跃会话块直接渲染 EditableBlock，
    // 根 tag + className 必须与预览逐字一致（命中同一套 .markdown .content 样式）。
    // 默认缺省时退化为既有行为（固定 div + wysiwyg-* class），overlay 路径零影响。
    /** 根元素 tag（默认 "div"）。calloutalert / blockquote 等预览根 tag。 */
    rootTag?: string;
    /**
     * 根元素 className。
     * - `undefined`：不指定 → 用 cssClassForKind 的 wysiwyg-* class（overlay 路径）。
     * - `null` / `""`：**显式不要 class** —— 预览根本就没有 class（如 `<blockquote>`）。
     *   必须与「不传」区分开，否则会退回 wysiwyg-quote，根形态与预览不一致。
     */
    rootClassName?: string | null;
    /** 追加到根元素上的 data-* 属性（data-source-line / data-block-id 等）。 */
    rootAttrs?: Record<string, string | undefined>;
};


/**
 * Insert a sentinel character at the current selection in `root`, serialize
 * the whole root, find the sentinel in the output, remove it, and return
 * the index — i.e. the exact markdown-space offset of the original caret.
 */
// ---------------------------------------------------------------------------
// Live kind state: the block may convert from p → h/list/quote via typing
// ---------------------------------------------------------------------------

function tagForKind(kind: WysiwygBlockKind): string {
    switch (kind) {
        case "list":
            return "ul";
        case "quote":
            return "blockquote";
        default:
            return "div";
    }
}

function dataAttrForKind(kind: WysiwygBlockKind, level?: number): Record<string, string> {
    if (kind === "h" && level != null) {
        return { "data-kind": "h", "data-level": String(level) };
    }
    return { "data-kind": kind };
}

function cssClassForKind(kind: WysiwygBlockKind, level?: number): string {
    switch (kind) {
        case "h":
            return `wysiwyg-editor wysiwyg-heading is-${level ?? 1}`;
        case "list":
            return "wysiwyg-editor wysiwyg-list";
        case "quote":
            return "wysiwyg-editor wysiwyg-quote";
        default:
            return "wysiwyg-editor wysiwyg-paragraph";
    }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const WysiwygEditor = forwardRef<WysiwygEditorHandle, WysiwygEditorProps>(function WysiwygEditor(
    {
        initialHtml,
        blockKind,
        headingLevel: initialHeadingLevel = 1,
        listMarker: initialListMarker = "-",
        typography,
        placeholder,
        onInput,
        onBlur,
        onKeyDown,
        onPaste,
        onSelectionChange,
        rootTag: rootTagProp,
        rootClassName,
        rootAttrs,
    },
    ref
) {
    const rootRef = useRef<HTMLDivElement>(null);
    const [liveKind, setLiveKind] = useState<WysiwygBlockKind>(blockKind);
    const [headingLevel, setHeadingLevel] = useState(initialHeadingLevel);
    const liveKindRef = useRef(liveKind);
    liveKindRef.current = liveKind;
    const headingLevelRef = useRef(headingLevel);
    headingLevelRef.current = headingLevel;
    const listMarkerRef = useRef(initialListMarker);
    const initializedRef = useRef(false);
    // IME composition 活跃标记（P3 F2）：组合期间禁止任何 DOM 手术（sentinel 插/删节点、
    // detectTypingTrigger 的 live-kind 转换、normalize），这些会打断中文/日文输入法的候选
    // 状态；所有序列化/转换推迟到 compositionend 之后统一做一次。
    const compositionActiveRef = useRef(false);

    // --- Commit context (used by serialize) ---
    const commitCtx = useCallback(
        () => ({
            kind: liveKindRef.current,
            headingLevel: headingLevelRef.current,
            listMarker: listMarkerRef.current,
        }),
        []
    );

    // --- Mirror: serialize DOM → markdown on every input, push to parent ---
    const syncMirror = useCallback(() => {
        const root = rootRef.current;
        if (root == null) return "";
        const md = serializeBlockDomToMarkdown(root, commitCtx());
        const caret = caretToMarkdownOffset(root, commitCtx()) ?? md.length;
        onInput(md, caret);
        return md;
    }, [commitCtx, onInput]);

    // --- Typing-trigger detection on input ---
    const detectTypingTrigger = useCallback(() => {
        const root = rootRef.current;
        if (root == null) return;

        const sel = window.getSelection();
        if (sel == null || sel.rangeCount === 0 || !root.contains(sel.anchorNode)) return;

        // Get text before caret on the first line.
        const range = sel.getRangeAt(0).cloneRange();
        range.selectNodeContents(root);
        range.setEnd(sel.anchorNode!, sel.anchorOffset);
        const beforeCaret = range.toString();
        const nlIdx = beforeCaret.indexOf("\n");
        const firstLine = nlIdx >= 0 ? beforeCaret.slice(0, nlIdx) : beforeCaret;

        const trigger = detectLiveTypingMarker(firstLine);
        if (trigger == null) return;

        // --- Live conversion ---
        // Strip the marker chars from the DOM text.
        const textNode = root.firstChild;
        if (textNode == null || textNode.nodeType !== 3) return;

        const fullText = textNode.textContent ?? "";
        if (!fullText.startsWith(firstLine)) return; // safety

        const markerLen = trigger.marker.length;
        const remainder = fullText.slice(markerLen);

        // Update DOM text to remove the marker.
        textNode.textContent = remainder;

        // Convert block kind.
        const newKind: WysiwygBlockKind =
            trigger.kind === "quote"
                ? "quote"
                : trigger.kind.startsWith("heading")
                  ? "h"
                  : trigger.kind === "bulleted" || trigger.kind === "numbered" || trigger.kind === "todo"
                    ? "list"
                    : liveKindRef.current;

        // For list conversion: wrap content in <ul> / <ol> or add checkbox.
        if (newKind === "list" && liveKindRef.current !== "list") {
            const isOrdered = trigger.kind === "numbered";
            const isTodo = trigger.kind === "todo";
            const marker = trigger.kind === "numbered" ? "1. " : trigger.kind === "todo" ? "" : trigger.marker;

            // Create a list element.
            const listEl = document.createElement(isOrdered ? "ol" : "ul");
            const li = document.createElement("li");
            if (isTodo) {
                const cb = document.createElement("input");
                cb.type = "checkbox";
                li.appendChild(cb);
            }
            li.appendChild(textNode.cloneNode(true));
            // Replace root content.
            root.innerHTML = "";
            listEl.appendChild(li);
            root.appendChild(listEl);

            // Style for WYSIWYG list.
            listEl.contentEditable = "true";
            (root as HTMLDivElement).removeAttribute("contentEditable");

            // Store marker.
            listMarkerRef.current = marker;

            // Re-focus: end of first text node.
            const finalText = li.lastChild as Text;
            if (finalText != null) {
                const sel2 = window.getSelection();
                if (sel2 != null) {
                    const r = document.createRange();
                    r.setStart(finalText, finalText.length);
                    r.collapse(true);
                    sel2.removeAllRanges();
                    sel2.addRange(r);
                }
            }
        } else if (newKind === "h" && liveKindRef.current !== "h") {
            // Heading: just re-style, no DOM surgery needed.
            // Heading level comes from the trigger marker.
            const level = trigger.kind.startsWith("heading")
                ? parseInt(trigger.kind.slice("heading".length), 10) || 1
                : 1;
            setHeadingLevel(level);
            headingLevelRef.current = level;
        } else if (newKind === "quote" && liveKindRef.current !== "quote") {
            // Quote: just re-style, the div stays as-is.
        }

        if (newKind !== liveKindRef.current) {
            setLiveKind(newKind);
            liveKindRef.current = newKind;
        }

        // Sync the mirror after DOM surgery.
        syncMirror();
    }, [syncMirror]);

    // --- Initial mount + block switch: seed the contentEditable ---
    // Uses initialHtml/blockKind as deps so switching from block A to block B
    // (same WysiwygEditor instance reused by React) correctly reseeds the DOM
    // instead of showing block A's stale content.
    useLayoutEffect(() => {
        const root = rootRef.current;
        if (root == null) return;
        initializedRef.current = true;
        // Keep liveKind in sync with the session's blockKind (editing A→B may
        // reuse the same instance; the parent also forces a key-remount as a
        // belt-and-braces guarantee, but this handles non-key reuse as well).
        setLiveKind(blockKind);
        liveKindRef.current = blockKind;
        setHeadingLevel(initialHeadingLevel);
        headingLevelRef.current = initialHeadingLevel;
        listMarkerRef.current = initialListMarker;
        root.innerHTML = initialHtml || (blockKind === "list" ? "<ul><li></li></ul>" : "");
        // F2：种子落地后立即规范化（防御外部/渲染器 HTML 里的非规范列表结构：
        // 嵌套 ul 直接挂在 ul 下会让序列化丢掉整棵子树）。
        normalizeListDom(root);
    }, [initialHtml, blockKind, initialHeadingLevel, initialListMarker]);

    // --- Inline-format closing (P3 F5) ---
    // 用户输入到闭合 marker（`**bold**` 光标在末尾）时，把配对转成对应行内元素（所见即所得）。
    // 最小侵入：仅在配对完整、同文本节点、非组合态、且转换成功时执行；任何异常（跨节点、
    // execCommand 不可用）都静默跳过，不打断输入。
    const applyClosedInlineFormatting = useCallback(() => {
        const root = rootRef.current;
        if (root == null || compositionActiveRef.current) {
            return;
        }
        const sel = window.getSelection();
        if (sel == null || sel.rangeCount === 0 || !root.contains(sel.anchorNode)) {
            return;
        }
        const range = sel.getRangeAt(0).cloneRange();
        range.selectNodeContents(root);
        range.setEnd(sel.anchorNode!, sel.anchorOffset);
        const beforeCaret = range.toString();
        const pair = detectClosedInlinePair(beforeCaret);
        if (pair == null) {
            return;
        }
        const anchor = sel.anchorNode;
        if (anchor == null) {
            return;
        }
        const caretOffset = sel.anchorOffset;
        const result = convertClosedInlineAtCaret(anchor, caretOffset, pair);
        if (result == null) {
            return; // 防御性跳过（anchor 非文本 / 配对不完整 / 跨节点不匹配）
        }
        const { el, parent } = result;
        // 光标移动到元素后：用父容器定位（不依赖 nextSibling——配对在段落末尾时
        // el.nextSibling 为 null，selection 会悬在已移除节点上，后续击键可能丢字）。
        // parent 由 helper 在 removeChild 前捕获返回（事后读 anchor.parentNode 为 null）。
        const sel2 = window.getSelection();
        if (sel2 != null) {
            const idx = Array.from(parent.childNodes).indexOf(el);
            const r = document.createRange();
            r.setStart(parent, Math.min(idx + 1, parent.childNodes.length));
            r.collapse(true);
            sel2.removeAllRanges();
            sel2.addRange(r);
        }
        syncMirror();
    }, [syncMirror]);

    // --- Input handler ---
    const handleInput = useCallback(() => {
        // IME 组合中（compositionstart..compositionend）：DOM 处于候选中间态，任何序列化/
        // DOM 手术都会打断输入法状态。跳过 detectTypingTrigger（live-kind 转换会改写 root
        // 文本）与 syncMirror（sentinelMarkdownCaret 会在组合文本节点上插/删哨兵并 normalize）。
        // compositionend 后再统一 sync 一次，draftText 即可拿到完整落盘文本。
        if (compositionActiveRef.current) {
            return;
        }
        // F2 结构规范化：原生 Enter（换行/新建 <li>）、Backspace（合并/删除项）、粘贴、以及
        // 浏览器其它默认编辑动作都只在 `input` 事件之后才产生最终 DOM。`input` 是最稳的钩子
        // （`beforeinput` 早于变更、`keyup` 漏掉非键盘路径），因此在这里统一把非规范列表结构
        // （嵌套 ul/ol 直接挂在 ul/ol 下）收敛回「只能挂在 li 之下」。否则下一次结构操作会基于
        // 坏结构继续劣化，且老序列化器会静默丢内容。幂等且无列表时几乎零开销。
        const rootEl = rootRef.current;
        if (rootEl != null) {
            normalizeListDom(rootEl);
        }
        detectTypingTrigger();
        applyClosedInlineFormatting();
        syncMirror();
    }, [detectTypingTrigger, applyClosedInlineFormatting, syncMirror]);

    // --- IME composition 生命周期（P3 F2）---
    const handleCompositionStart = useCallback(() => {
        compositionActiveRef.current = true;
    }, []);

    const handleCompositionEnd = useCallback(() => {
        compositionActiveRef.current = false;
        // 组合落盘：把最终文本同步给父层（draftText），并执行 typing-trigger 转换
        // （组合中可能已输入完整 marker 如 `# ` 后才结束组合——转换只该在落盘后发生一次）。
        detectTypingTrigger();
        applyClosedInlineFormatting();
        syncMirror();
    }, [detectTypingTrigger, applyClosedInlineFormatting, syncMirror]);

    // --- Blur ---
    const handleBlur = useCallback(
        (e: React.FocusEvent) => {
            // Don't commit if focus moves inside the overlay (e.g. clicking another cell/button).
            if (e.relatedTarget != null && rootRef.current?.contains(e.relatedTarget as Node)) return;
            // IME 组合未落盘时 blur：不提交中间态文本（会丢最后一个候选词）。
            // 通常 compositionend 先于 blur 发生（事件序列本身保证），此处仅作兜底：
            // 若仍处于组合中，跳过提交，等 compositionend 的 sync 把最终文本写入 draftText。
            if (compositionActiveRef.current) {
                return;
            }
            const md = serializeBlockDomToMarkdown(rootRef.current!, commitCtx());
            onBlur(md);
        },
        [commitCtx, onBlur]
    );

    // --- Imperative handle ---
    useImperativeHandle(
        ref,
        () => ({
            focus(offset?: number) {
                const root = rootRef.current;
                if (root == null) return;

                // For list blocks, focus the first text node inside the first <li>.
                if (liveKindRef.current === "list") {
                    const firstText = root.querySelector("li")?.textContent;
                    if (firstText != null && offset != null) {
                        // Place caret at rendered-text offset.
                        placeCaretByTextOffset(root, offset);
                    } else {
                        root.focus();
                    }
                    return;
                }

                if (offset != null && offset >= 0) {
                    placeCaretByTextOffset(root, offset);
                } else {
                    root.focus();
                }
            },

            getMarkdown() {
                return rootRef.current != null ? serializeBlockDomToMarkdown(rootRef.current, commitCtx()) : "";
            },

            getCaretMarkdown() {
                return rootRef.current != null ? (caretToMarkdownOffset(rootRef.current, commitCtx()) ?? 0) : 0;
            },

            getSelectionRange() {
                return rootRef.current != null
                    ? selectionToMarkdownRange(rootRef.current, commitCtx())
                    : null;
            },

            getText() {
                return rootRef.current?.textContent ?? "";
            },

            applyInlineStyle(style) {
                const root = rootRef.current;
                if (root == null) return;
                root.focus();
                switch (style) {
                    case "bold":
                        document.execCommand("bold", false);
                        break;
                    case "italic":
                        document.execCommand("italic", false);
                        break;
                    case "strike":
                        document.execCommand("strikeThrough", false);
                        break;
                    case "code": {
                        // Wrap selection in <code> tag. 选区跨非文本节点（如跨 <strong>）时
                        // surroundContents 会抛 InvalidStateError（P3 G12），catch 后回退到
                        // 原样（不崩溃，用户可重试或手动输入反引号）。
                        const sel = window.getSelection();
                        if (sel != null && !sel.isCollapsed) {
                            const range = sel.getRangeAt(0);
                            const code = document.createElement("code");
                            try {
                                range.surroundContents(code);
                            } catch {
                                // 跨节点选区无法整体包裹：忽略（保留 DOM 原样）。
                            }
                        }
                        break;
                    }
                }
                // Sync mirror after style change.
                syncMirror();
            },

            applyListIndent(dir) {
                const root = rootRef.current;
                if (root == null) return;
                root.focus();
                // 组合中不做（候选态下改 DOM 会扰乱输入法）。
                if (compositionActiveRef.current) {
                    return;
                }
                // F3 结构操作自持：不再用 `document.execCommand("indent"/"outdent")` —— 浏览器
                // indent 会产出「嵌套 ul 直接挂在 ul 下」的非规范结构，且序列化会丢掉整棵子树
                // （实测：Tab 后提交，源码少一项）。改为显式搬移 li：
                //   Tab      → 成为紧邻前一个兄弟 li 的子列表项（无前项则 no-op）
                //   Shift+Tab → 从父列表移出，插到「父 li」之后（顶层项则 no-op）
                const li = liFromSelection(root);
                if (li == null) {
                    return; // 光标不在列表项内
                }
                // F4：结构变更前用 <wbr> 锚住光标（搬移/规范化后 Range 会失效/漂移）。
                plantCaretAnchor(root);
                const changed = dir === 1 ? indentListItem(li) : outdentListItem(li);
                if (changed) {
                    // F2：自持操作产出规范结构，这里再防御性规范化一次（幂等）。
                    normalizeListDom(root);
                }
                // F4：按锚点重建 collapsed Range 并 focus（无论是否改动都要移除锚点）。
                focusByAnchor(root);
                syncMirror();
            },

            getActiveInlineStyles() {
                const styles = new Set<string>();
                if (document.queryCommandState("bold")) styles.add("bold");
                if (document.queryCommandState("italic")) styles.add("italic");
                if (document.queryCommandState("strikeThrough")) styles.add("strike");
                // Check for <code> in selection.
                const sel = window.getSelection();
                if (sel != null && sel.rangeCount > 0) {
                    const node = sel.anchorNode;
                    if (node != null) {
                        const el = node.nodeType === 1 ? (node as HTMLElement) : node.parentElement;
                        if (el?.closest("code")) styles.add("code");
                    }
                }
                return styles;
            },

            applyLiveKind(kind, level) {
                const root = rootRef.current;
                if (root == null) return;
                const newLevel = kind.startsWith("heading") ? (level ?? 1) : headingLevelRef.current;

                if (kind.startsWith("heading")) {
                    setLiveKind("h");
                    liveKindRef.current = "h";
                    setHeadingLevel(newLevel);
                    headingLevelRef.current = newLevel;
                } else if (kind === "bulleted" || kind === "numbered" || kind === "todo") {
                    // Convert to list: wrap content in <ul>/<ol><li>.
                    if (liveKindRef.current === "list") {
                        // Already a list — just update marker.
                        setLiveKind("list");
                        liveKindRef.current = "list";
                        if (kind === "numbered") {
                            listMarkerRef.current = "1.";
                        } else if (kind === "todo") {
                            listMarkerRef.current = "- ";
                        } else {
                            listMarkerRef.current = "- ";
                        }
                    } else {
                        // Convert div → list.
                        const isOrdered = kind === "numbered";
                        const isTodo = kind === "todo";
                        const text = root.textContent ?? "";
                        const listEl = document.createElement(isOrdered ? "ol" : "ul");
                        const li = document.createElement("li");
                        if (isTodo) {
                            const cb = document.createElement("input");
                            cb.type = "checkbox";
                            li.appendChild(cb);
                        }
                        li.appendChild(document.createTextNode(text));
                        listEl.appendChild(li);
                        root.innerHTML = "";
                        root.appendChild(listEl);
                        (root as HTMLElement).removeAttribute("contentEditable");
                        // 列表元素自己接管可编辑（root 退出 contenteditable 后，ul/ol 必须
                        // 显式开启，否则转换后继续输入无效——与打字触发路径 detectTypingTrigger
                        // 的 listEl.contentEditable = "true" 对称，P3 复核 P1-3）。
                        listEl.contentEditable = "true";

                        setLiveKind("list");
                        liveKindRef.current = "list";
                        listMarkerRef.current = isOrdered ? "1." : kind === "todo" ? "- " : "- ";
                    }
                } else if (kind === "quote") {
                    setLiveKind("quote");
                    liveKindRef.current = "quote";
                } else if (kind === "text") {
                    // Convert back to paragraph (from list/quote).
                    if (liveKindRef.current === "list") {
                        // Unwrap list to plain text.
                        const text = root.textContent ?? "";
                        root.innerHTML = "";
                        root.contentEditable = "true";
                        root.appendChild(document.createTextNode(text));
                    }
                    setLiveKind("p");
                    liveKindRef.current = "p";
                }

                syncMirror();
            },

            getLiveKind() {
                return liveKindRef.current;
            },
            getHeadingLevel() {
                return headingLevelRef.current;
            },

            deleteCaretLinePrefix() {
                const root = rootRef.current;
                if (root == null) return;
                const sel = window.getSelection();
                if (sel == null || sel.rangeCount === 0) return;
                const anchor = sel.anchorNode;
                if (anchor == null || !root.contains(anchor)) return;

                // Walk backward from the caret to find the current line start (or root start).
                // We need to delete from the line start up to the current caret position.
                // First, compute the text offset of the line start.
                const fullRange = document.createRange();
                fullRange.selectNodeContents(root);
                fullRange.setEnd(sel.anchorNode!, sel.anchorOffset);
                const beforeCaret = fullRange.toString();
                const nlIdx = beforeCaret.lastIndexOf("\n");
                const lineStart = nlIdx >= 0 ? nlIdx + 1 : 0;
                const deleteLen = beforeCaret.length - lineStart;
                if (deleteLen <= 0) return;

                // Walk text nodes to find the delete range [lineStart, caret). Then remove.
                const walkRange = document.createRange();
                let pos = 0;
                const textNodes: { node: Text; start: number; end: number }[] = [];
                const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
                let node: Node | null;
                while ((node = tw.nextNode()) != null) {
                    const len = (node.textContent ?? "").length;
                    textNodes.push({ node: node as Text, start: pos, end: pos + len });
                    pos += len;
                }
                // Find text node containing lineStart.
                let startNode: Text | null = null;
                let startOffset = 0;
                for (const tn of textNodes) {
                    if (tn.end > lineStart) {
                        startNode = tn.node;
                        startOffset = lineStart - tn.start;
                        break;
                    }
                }
                if (startNode == null) return;
                // Delete the range from lineStart to caret.
                walkRange.setStart(startNode, startOffset);
                walkRange.setEnd(sel.anchorNode!, sel.anchorOffset);
                walkRange.deleteContents();
                root.normalize();
            },

            insertTextAtCaret(text) {
                const root = rootRef.current;
                if (root == null) return;
                root.focus();
                const sel = window.getSelection();
                if (sel == null || sel.rangeCount === 0) {
                    // No selection: append at the end.
                    const r = document.createRange();
                    r.selectNodeContents(root);
                    r.collapse(false);
                    sel?.removeAllRanges();
                    sel?.addRange(r);
                }
                const sel2 = window.getSelection();
                if (sel2 == null || sel2.rangeCount === 0) return;
                const range = sel2.getRangeAt(0);
                range.deleteContents();
                const textNode = document.createTextNode(text);
                range.insertNode(textNode);
                // Move caret after the inserted text.
                const after = document.createRange();
                after.setStart(textNode, text.length);
                after.collapse(true);
                sel2.removeAllRanges();
                sel2.addRange(after);
                root.normalize();
                // 粘贴/emoji 插入后同步镜像（draftText 跟上），并触发 typing-trigger 转换。
                syncMirror();
            },

            deleteCharsBeforeCaret(count) {
                const root = rootRef.current;
                if (root == null || count <= 0) return;
                const sel = window.getSelection();
                if (sel == null || sel.rangeCount === 0 || !root.contains(sel.anchorNode)) return;
                const anchor = sel.anchorNode;
                const caretOffset = sel.anchorOffset;
                // 计算 caret 前的 DOM 文本总偏移（含当前文本节点内偏移）。
                const fullRange = document.createRange();
                fullRange.selectNodeContents(root);
                fullRange.setEnd(anchor!, caretOffset);
                const beforeCaret = fullRange.toString();
                if (beforeCaret.length < count) {
                    return; // 前缀不足：不动（触发前缀必然在 caret 前）
                }
                const delStart = beforeCaret.length - count;
                // 用文本节点坐标删除 [delStart, beforeCaret.length)。
                const walkRange = document.createRange();
                let pos = 0;
                const textNodes: { node: Text; start: number; end: number }[] = [];
                const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
                let node: Node | null;
                while ((node = tw.nextNode()) != null) {
                    const len = (node.textContent ?? "").length;
                    textNodes.push({ node: node as Text, start: pos, end: pos + len });
                    pos += len;
                }
                let startNode: Text | null = null;
                let startOffset = 0;
                for (const tn of textNodes) {
                    if (tn.end > delStart) {
                        startNode = tn.node;
                        startOffset = delStart - tn.start;
                        break;
                    }
                }
                if (startNode == null) return;
                walkRange.setStart(startNode, Math.max(0, startOffset));
                walkRange.setEnd(anchor!, caretOffset);
                walkRange.deleteContents();
                root.normalize();
                syncMirror();
            },
        }),
        [commitCtx, syncMirror]
    );

    // --- Selection reporting (P3 G4): WYSIWYG 下的选区 → markdown 空间范围，供 FloatingToolbar
    // 显示/锚定。document selectionchange 是全局的，但这里只在自己仍挂载且焦点在 root 内时上报。
    // IME 组合中不上报（选区可能处于候选中间态）。
    const selectionReportRef = useRef(onSelectionChange);
    selectionReportRef.current = onSelectionChange;
    useLayoutEffect(() => {
        const handleSelectionChange = () => {
            if (compositionActiveRef.current || rootRef.current == null) {
                return;
            }
            const sel = window.getSelection();
            const inside =
                sel != null &&
                sel.rangeCount > 0 &&
                rootRef.current.contains(sel.anchorNode) &&
                rootRef.current.contains(sel.focusNode);
            if (!inside) {
                selectionReportRef.current?.(null);
                return;
            }
            selectionReportRef.current?.(selectionToMarkdownRange(rootRef.current, commitCtx()));
        };
        document.addEventListener("selectionchange", handleSelectionChange);
        return () => document.removeEventListener("selectionchange", handleSelectionChange);
    }, [commitCtx]);

    // --- Render ---
    // A3 在位编辑：rootTag / rootClassName / rootAttrs 缺省时退化为既有行为
    // （固定 div + wysiwyg-* class），overlay 路径零影响。
    //
    // A3 隔离：`rootTagProp !== undefined` 就是「在位根」的唯一判据（overlay 不传它）。
    // 在位根必须与预览根**逐属性同构**，因此不能携带 overlay 专属标记：
    //  - data-block-kind="wysiwyg"：SCSS 里所有 [data-block-kind=…] 规则都限定在
    //    .inline-edit-overlay 下（那是 overlay 的作用域），对在位根是死属性，
    //    但它让根多出一个预览没有的属性 → 根同构对拍会红、也给未来选择器埋雷。
    //  - class：null/"" 表示预览根本就无 class，与「不传」语义不同。
    const Tag = (rootTagProp ?? "div") as any;
    const isInplaceRoot = rootTagProp !== undefined;
    const renderedClass =
        rootClassName === undefined ? cssClassForKind(liveKind, headingLevel) : rootClassName || undefined;
    const dataAttrs: Record<string, string> = dataAttrForKind(liveKind, headingLevel);
    const mergedRootAttrs: Record<string, string> = { ...rootAttrs };
    if (mergedRootAttrs["data-kind"] == null && dataAttrs["data-kind"] != null) {
        mergedRootAttrs["data-kind"] = dataAttrs["data-kind"];
    }

    return (
        <Tag
            ref={rootRef}
            className={renderedClass}
            {...(isInplaceRoot ? {} : { "data-block-kind": "wysiwyg" })}
            {...mergedRootAttrs}
            contentEditable="true"
            suppressContentEditableWarning
            // A3 隔离：**在位根不得挂任何内联样式**。
            //
            // `typography` 是 overlay 时代的第三条样式通道：把打开编辑那一刻的
            // getComputedStyle 快照逐条糊到编辑器根上（fontWeight/lineHeight/padding/…）。
            // 它是为「textarea 承载 markdown 源码」设计的——源码需要 pre-wrap 保留换行、
            // 需要从渲染块抄缩进才能对齐。
            //
            // 但在位根是 contentEditable，承载的是**渲染后的 HTML**，布局完全由
            // `.markdown .content` 下的预览样式决定。挂上快照 = 重新引入了第二套样式世界，
            // 实测已直接表现为 whiteSpace normal→pre-wrap 差异。
            // 零差异要 by construction，内联快照在位路径上必须为 0。
            style={isInplaceRoot ? undefined : { ...typography, whiteSpace: "pre-wrap" }}
            {...(isInplaceRoot ? {} : { "data-placeholder": placeholder })}
            onInput={handleInput}
            onBlur={handleBlur}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
        />
    );
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Place the caret at a rendered-text offset by walking text nodes.
 * Works for both plain and inline-marked content because it counts
 * the TEXT content of each node (ignoring tags/markers).
 */
