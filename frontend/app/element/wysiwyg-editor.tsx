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
import { detectLiveTypingMarker, type BlockKind } from "./markdown-transform/block-type";
import { serializeBlockDomToMarkdown, type WysiwygBlockKind } from "./markdown-transform/dom-to-markdown";

// ---------------------------------------------------------------------------
// Public handle — consumed by markdown.tsx via ref.
// ---------------------------------------------------------------------------

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
};

// ---------------------------------------------------------------------------
// Sentinel helper: DOM-caret → markdown-offset (exact, marker-aware)
// ---------------------------------------------------------------------------

const SENTINEL = "\uE000";
const SENTINEL_START = "\uE001";
const SENTINEL_END = "\uE002";

/**
 * Insert a sentinel character at the current selection in `root`, serialize
 * the whole root, find the sentinel in the output, remove it, and return
 * the index — i.e. the exact markdown-space offset of the original caret.
 */
function sentinelMarkdownCaret(
    root: Element,
    ctx: {
        kind: WysiwygBlockKind;
        headingLevel?: number;
        listMarker?: string;
    }
): number | null {
    const sel = window.getSelection();
    if (sel == null || sel.rangeCount === 0 || !root.contains(sel.anchorNode)) {
        return null;
    }
    const range = sel.getRangeAt(0).cloneRange();
    const textNode = document.createTextNode(SENTINEL);
    range.insertNode(textNode);
    const md = serializeBlockDomToMarkdown(root, ctx);
    const idx = md.indexOf(SENTINEL);
    textNode.parentNode?.removeChild(textNode);
    root.normalize();
    // Merge any adjacent text nodes the insertion may have split.
    return idx >= 0 ? idx : null;
}

/**
 * DOM 选区 → markdown 空间的 `{start, end}` 偏移（P3 G4：让 FloatingToolbar 在 WYSIWYG
 * 下也能拿到选区）。与 sentinelMarkdownCaret 同法：选区两端各插一个哨兵，序列化后读出
 * 两个索引。与 caret 版不同：折叠选区返回 null（非选区 → 无工具栏）。
 */
function sentinelMarkdownSelection(
    root: Element,
    ctx: {
        kind: WysiwygBlockKind;
        headingLevel?: number;
        listMarker?: string;
    }
): { start: number; end: number } | null {
    const sel = window.getSelection();
    if (sel == null || sel.rangeCount === 0 || sel.isCollapsed || !root.contains(sel.anchorNode)) {
        return null;
    }
    const range = sel.getRangeAt(0);
    const startNode = document.createTextNode(SENTINEL_START);
    const endNode = document.createTextNode(SENTINEL_END);
    const rStart = range.cloneRange();
    rStart.collapse(true);
    rStart.insertNode(startNode);
    const rEnd = range.cloneRange();
    rEnd.collapse(false);
    rEnd.insertNode(endNode);
    const md = serializeBlockDomToMarkdown(root, ctx);
    const iStart = md.indexOf(SENTINEL_START);
    const iEnd = md.indexOf(SENTINEL_END);
    startNode.parentNode?.removeChild(startNode);
    endNode.parentNode?.removeChild(endNode);
    root.normalize();
    if (iStart < 0 || iEnd < 0) {
        return null;
    }
    return { start: Math.min(iStart, iEnd), end: Math.max(iStart, iEnd) };
}

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
        const caret = sentinelMarkdownCaret(root, commitCtx()) ?? md.length;
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
    }, [initialHtml, blockKind, initialHeadingLevel, initialListMarker]);

    // --- Input handler ---
    const handleInput = useCallback(() => {
        // IME 组合中（compositionstart..compositionend）：DOM 处于候选中间态，任何序列化/
        // DOM 手术都会打断输入法状态。跳过 detectTypingTrigger（live-kind 转换会改写 root
        // 文本）与 syncMirror（sentinelMarkdownCaret 会在组合文本节点上插/删哨兵并 normalize）。
        // compositionend 后再统一 sync 一次，draftText 即可拿到完整落盘文本。
        if (compositionActiveRef.current) {
            return;
        }
        detectTypingTrigger();
        syncMirror();
    }, [detectTypingTrigger, syncMirror]);

    // --- IME composition 生命周期（P3 F2）---
    const handleCompositionStart = useCallback(() => {
        compositionActiveRef.current = true;
    }, []);

    const handleCompositionEnd = useCallback(() => {
        compositionActiveRef.current = false;
        // 组合落盘：把最终文本同步给父层（draftText），并执行 typing-trigger 转换
        // （组合中可能已输入完整 marker 如 `# ` 后才结束组合——转换只该在落盘后发生一次）。
        detectTypingTrigger();
        syncMirror();
    }, [detectTypingTrigger, syncMirror]);

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

                if (offset != null && offset > 0) {
                    placeCaretByTextOffset(root, offset);
                } else {
                    root.focus();
                    // Place caret at end.
                    const sel = window.getSelection();
                    if (sel != null) {
                        const r = document.createRange();
                        r.selectNodeContents(root);
                        r.collapse(false);
                        sel.removeAllRanges();
                        sel.addRange(r);
                    }
                }
            },

            getMarkdown() {
                return rootRef.current != null ? serializeBlockDomToMarkdown(rootRef.current, commitCtx()) : "";
            },

            getCaretMarkdown() {
                return rootRef.current != null ? (sentinelMarkdownCaret(rootRef.current, commitCtx()) ?? 0) : 0;
            },

            getSelectionRange() {
                return rootRef.current != null
                    ? sentinelMarkdownSelection(rootRef.current, commitCtx())
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
            selectionReportRef.current?.(sentinelMarkdownSelection(rootRef.current, commitCtx()));
        };
        document.addEventListener("selectionchange", handleSelectionChange);
        return () => document.removeEventListener("selectionchange", handleSelectionChange);
    }, [commitCtx]);

    // --- Render ---
    const Tag = liveKind === "list" ? ("div" as const) : ("div" as const);

    return (
        <Tag
            ref={rootRef}
            className={cssClassForKind(liveKind, headingLevel)}
            data-block-kind="wysiwyg"
            {...dataAttrForKind(liveKind, headingLevel)}
            contentEditable="true"
            suppressContentEditableWarning
            style={{ ...typography, whiteSpace: "pre-wrap" }}
            data-placeholder={placeholder}
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
function placeCaretByTextOffset(root: HTMLElement, offset: number) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let pos = 0;
    let node: Node | null;
    while ((node = walker.nextNode()) != null) {
        const text = node.textContent ?? "";
        if (pos + text.length >= offset) {
            const range = document.createRange();
            range.setStart(node, Math.min(offset - pos, text.length));
            range.collapse(true);
            const sel = window.getSelection();
            if (sel != null) {
                sel.removeAllRanges();
                sel.addRange(range);
            }
            return;
        }
        pos += text.length;
    }
    // Offset past the end: collapse to end.
    const range = document.createRange();
    range.selectNodeContents(root);
    range.collapse(false);
    const sel = window.getSelection();
    if (sel != null) {
        sel.removeAllRanges();
        sel.addRange(range);
    }
}
