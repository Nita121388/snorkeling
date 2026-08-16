// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { inlineEditingActiveAtom } from "@/app/view/preview/preview-shared-draft";
import { globalStore } from "@/store/jotaiStore";
import { useAtom } from "jotai";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// ---------------------------------------------------------------------------
// Inline-edit debug log. Enable by setting `localStorage.snorkelingInlineEditDebug = "1"` in
// devtools then open a markdown preview and double-click a block. Every measure / state write /
// scroll listener hit / target-lost event is emitted to both console.info and a ring buffer
// on window.__inlineEditLog so the running trace can be copied out for analysis. Disable by
// clearing the localStorage key. Cheap when off — single key read + early return.
// ---------------------------------------------------------------------------

type InlineEditLogEntry = { t: number; seq: number; msg: string; details: Record<string, unknown> };

function isInlineEditDebugEnabled(): boolean {
    return typeof window !== "undefined" && (window.localStorage?.getItem("snorkelingInlineEditDebug") === "1");
}

const INLINE_EDIT_LOG_BUF: InlineEditLogEntry[] = [];
let INLINE_EDIT_LOG_SEQ = 0;

if (typeof window !== "undefined") {
    // Expose the ring buffer on window so a devtools console copy of `__inlineEditLog` yields
    // the post-mortem. Buffer caps at 500 entries (≈ ~30s of a hot flicker loop) and overwrites
    // oldest on overflow so memory is bounded.
    (window as any).__inlineEditLog = INLINE_EDIT_LOG_BUF;
    (window as any).__inlineEditLogClear = () => {
        INLINE_EDIT_LOG_BUF.length = 0;
        INLINE_EDIT_LOG_SEQ = 0;
    };
}

export function inlineEditDebug(msg: string, details: Record<string, unknown> = {}) {
    if (!isInlineEditDebugEnabled()) {
        return;
    }
    const entry: InlineEditLogEntry = {
        t: typeof performance !== "undefined" ? performance.now() : 0,
        seq: INLINE_EDIT_LOG_SEQ++,
        msg,
        details,
    };
    INLINE_EDIT_LOG_BUF.push(entry);
    if (INLINE_EDIT_LOG_BUF.length > 500) {
        INLINE_EDIT_LOG_BUF.shift();
    }
    console.info("[inline-edit]", msg, details);
}

/**
 * Block kinds the inline editor knows how to open. Each maps to a renderer-emitted block: the
 * block's DOM carries data-source-line + data-source-line-end so the editor can slice the
 * matching source range. Add a new kind in three places:
 *   1) here in the union,
 *   2) in markdown.tsx's dblclick handler (tag/class → blockKind branch),
 *   3) optional CSS in markdown.scss keyed on `.inline-edit-overlay[data-block-kind="..."]`
 *      if the textarea should match the rendered block's typography (e.g. `code` → monospace).
 */
export type InlineEditBlockKind = "p" | "h" | "list" | "table" | "code" | "blank" | "hr";

export type InlineEditSession = {
    blockKind: InlineEditBlockKind;
    /** 1-based, inclusive, original text coordinate (NOT transformedText). */
    startLine: number;
    /**
     * 1-based, inclusive. Equal to startLine for single-line blocks (h without trailing
     * soft-break). Paragraphs (and soft-broken headings) render one visual block across multiple
     * source lines once remarkSoftBreaks merges them — this endLine brackets that range so the
     * initial draft and the commit-replaced slice both cover the whole visual block, not just
     * its first line. Without it a paragraph like
     *   "line A\nline B" (one <p>, two source lines) would lose "line B" on edit open.
     */
    endLine: number;
    /** Original segment text captured when entering edit — used for cancel/Revert + initial draft. */
    initialContent: string;
    /** DOM element we anchored on; kept hidden (visibility:hidden) while textarea is mounted. */
    targetEl: HTMLElement;
    /**
     * Optional caret position (0-based char offset into the draft text). When present the
     * textarea caret lands here instead of select-all — the single-click-to-edit path maps
     * the click's clientX/Y to a draft offset so the cursor goes where the user clicked.
     */
    caretOffset?: number;
    /**
     * Insert mode: instead of replacing [startLine..endLine] on commit, insert the draft
     * as a NEW block just before ("before") or after ("after") the anchor line, separated
     * by a blank line so it renders as its own block. Used by the block-edge insert buttons.
     */
    insertMode?: "before" | "after";
    /**
     * Optional: called on Esc/cancel to REVERT the document to its pre-edit state. Used by
     * the "click insert / Enter split" flows, which COMMIT the new row immediately (so the
     * user sees it appear) and only keep an editor on top for typing — Esc discards the
     * whole insert instead of just closing the editor.
     */
    insertRevert?: () => void;
    /**
     * Placeholder-row session: the editor sits on a single blank row that was already
     * pre-inserted into the document (the immediate "click insert / Enter split" feedback
     * row). On commit the draft REPLACES that row and separator blanks are added/deduped
     * so the result is exactly one new block; on an empty commit (blur without typing) the
     * whole pre-insert is reverted via insertRevert so nothing is left behind.
     */
    placeholder?: boolean;
};

// Fallback selector used to re-locate a block within the viewport by start line when the
// initially-anchored element is gone (e.g. its list was re-rendered or replaced during edit).
// Keep it block-kind-agnostic — any renderer-emitted block carries data-source-line — so list /
// table / code blocks introduced after M1 resolve from the same path without a per-kind map.
function fallbackSelector(startLine: number): string {
    return `.markdown-render-root [data-source-line="${startLine}"]`;
}

export function resolveInlineEditTarget(
    viewport: HTMLElement,
    session: Pick<InlineEditSession, "blockKind" | "startLine" | "targetEl">
): HTMLElement | null {
    if (session.targetEl.isConnected && viewport.contains(session.targetEl)) {
        return session.targetEl;
    }
    return viewport.querySelector<HTMLElement>(fallbackSelector(session.startLine));
}

/**
 * Replace an inclusive [startLine..endLine] range (1-based, original-coordinate) inside `text`
 * with `newSegment`. Lines outside the range are preserved verbatim, including EOL style:
 * we split on /\r\n|\n/ but always join with "\n". CRLF inputs will lose CR.
 * For markdown source the existing files are saved by Wave with "\n" so this is fine in practice.
 *
 * If newSegment is the empty string, the range is deleted (no empty line left behind unless
 * newSegment itself contains empty lines — caller's responsibility).
 */
export function replaceSourceRange(
    text: string,
    startLine: number,
    endLine: number,
    newSegment: string
): string {
    const lines = text.split(/\r\n|\n/);
    const safeStart = Math.min(Math.max(1, Math.trunc(startLine)), lines.length || 1);
    const safeEnd = Math.max(safeStart, Math.min(Math.trunc(endLine), lines.length));
    const before = lines.slice(0, safeStart - 1);
    const after = lines.slice(safeEnd); // endLine is inclusive → slice from endLine (index endLine-1+1)
    const replacement = newSegment.length > 0 ? newSegment.split(/\r\n|\n/) : [];
    // Preserve the source file's dominant EOL. split swallowed every \r\n / \n, so re-join with
    // whichever style wins a simple count — without this, saving an Obsidian note that is entirely
    // CRLF would silently flatten every line to LF and flood the diff for a one-paragraph edit.
    // Mixed-EOL files resolve to the majority style; same heuristic most editors pick, and plenty
    // for the "edit one paragraph" path this function serves.
    const crlfCount = (text.match(/\r\n/g) || []).length;
    const lfCount = (text.match(/\n/g) || []).length;
    const eol = crlfCount > lfCount / 2 ? "\r\n" : "\n";
    return [...before, ...replacement, ...after].join(eol);
}

type UseInlineEditArgs = {
    /** Full original markdown text — the same value ReactMarkdown renders (NOT transformedText). */
    fullText: string;
    /** Called with the new full text on every successful commit; never on cancel. */
    onCommit: (newFullText: string) => void;
    /**
     * Optional: flush the committed draft to disk. Wired only by callers that own a model with a
     * handleFileSave (preview-mode pair). When present, ⌘/Ctrl+S inside the textarea commits the
     * draft then immediately runs this — replacing the old "let ⌘S bubble to Wave's save handler"
     * comment, which described a path that no longer exists in preview mode (no global keydown
     * is registered there).
     */
    onSave?: () => void;
    /** Lazily returns the OverlayScrollbars viewport element; called on every measure. */
    getViewportEl: () => HTMLElement | null;
    /**
     * Optional: stable identity so the hook can reset transient state if the parent re-mounts
     * (e.g. new file key). Not strictly required.
     */
    resetKey?: unknown;
};

export function useInlineEdit({ fullText, onCommit, onSave, getViewportEl, resetKey }: UseInlineEditArgs) {
    const [editSession, setEditSession] = useState<InlineEditSession | null>(null);
    const [draftText, setDraftTextState] = useState<string>("");
    // Wrap setText so each user keystroke / external draft write is observable in the debug
    // ring buffer at equal granularity with the layout-effect measurements. A bare useState
    // setter has no hook we can attach, so we route through this thunk instead.
    const setDraftText = useCallback((v: string) => {
        inlineEditDebug("setDraftText", { len: v.length });
        setDraftTextState(v);
    }, []);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    // The element rendered in the live markdown tree we mirror with the textarea. We keep a
    // React-side rect derived from the DOM element so we can reposition on scroll / resize;
    // we do NOT keep the element in state because reading getBoundingClientRect during render
    // breaks SSR and causes layout thrash.
    const [overlayRect, setOverlayRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
    const focusedSessionRef = useRef<InlineEditSession | null>(null);
    const [, setEditingFlag] = useAtom(inlineEditingActiveAtom);

    // Reset on file switch / unmount / external text rewrite that wipes our anchor.
    useEffect(() => {
        setEditSession(null);
        setDraftText("");
        setOverlayRect(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resetKey]);

    // Turn the global flag on/off in sync with editSession.
    useEffect(() => {
        const active = editSession != null;
        setEditingFlag(active);
        return () => active && setEditingFlag(false);
    }, [editSession, setEditingFlag]);

    const measureOverlay = useCallback(() => {
        const viewport = getViewportEl();
        const target = viewport && editSession ? resolveInlineEditTarget(viewport, editSession) : null;
        if (!viewport) {
            inlineEditDebug("measure: no viewport");
            setOverlayRect(null);
            return;
        }
        if (!target) {
            inlineEditDebug("measure: target lost (fallback miss or stale targetEl)", {
                startLine: editSession?.startLine,
                kind: editSession?.blockKind,
                scrollTop: viewport.scrollTop,
            });
            setOverlayRect(null);
            return;
        }
        const targetRect = target.getBoundingClientRect();
        // Overlay is rendered to a `position: fixed` host (a sibling of body via portal), so it
        // wants viewport-relative (screen) coordinates rather than content-absolute coordinates.
        // Content-absolute (`+ scrollTop`) was the source of a flicker loop:
        //   focus → selection auto-scrolls textarea into viewport → scrollTop jumps →
        //   scroll-listener → re-measure → next.top drifts (targetRect.top also moves with
        //   scrollTop, but by a DIFFERENT delta because the overlay's box added layout height to
        //   a child of the OSB viewport at a different position than where the selection lands)
        //   → setRect → textarea repositions → selection now off-screen again → scroll back …
        // With fixed + viewport-relative coords, scroll-events don't displace the overlay; the
        // textarea stays put where the user dblclicked and focus has nothing to scroll to.
        //
        // Width: anchor to the rendered target's left edge and span out to the markdown content
        // root's right edge — not to the target's own width. List/table targets are narrower than
        // the content area (list indent, table cell box), and an editor narrower than the
        // surrounding text breaks the "type where you read" feel. Spanning content-area-wide keeps
        // the editor visually continuous with the surrounding prose bar.
        const renderRoot = viewport.querySelector<HTMLElement>(".markdown-render-root");
        let width = targetRect.width;
        let left = targetRect.left;
        if (renderRoot != null) {
            const renderRect = renderRoot.getBoundingClientRect();
            // contentRect left=render.left,top=render.top; renderRect.right is content end.
            width = Math.max(targetRect.width, renderRect.right - targetRect.left);
            left = Math.min(targetRect.left, renderRect.left);
        }
        const next = {
            top: targetRect.top,
            left,
            width,
            height: targetRect.height,
        };
        // Skip the state write when the rect is unchanged so re-measure churn (scroll events,
        // RAF polls, child re-mounts) doesn't trigger a re-render → re-measure → re-render loop.
        // We compare by value on all four fields; sub-pixel jitter from getBoundingClientRect is
        // bounded by layout scale and below the threshold a user perceives as "flicker".
        let skipped = true;
        setOverlayRect((prev) => {
            if (
                prev != null &&
                prev.top === next.top &&
                prev.left === next.left &&
                prev.width === next.width &&
                prev.height === next.height
            ) {
                return prev;
            }
            skipped = false;
            return next;
        });
        inlineEditDebug(
            `measure scrollTop=${viewport.scrollTop.toFixed(2)} tRectTop=${targetRect.top.toFixed(2)} tRectLeft=${targetRect.left.toFixed(2)} tRectW=${targetRect.width.toFixed(2)} tRectH=${targetRect.height.toFixed(2)} next(t=${next.top.toFixed(2)},l=${next.left.toFixed(2)},w=${next.width.toFixed(2)},h=${next.height.toFixed(2)}) skipped=${skipped} kind=${editSession?.blockKind ?? "?"} line=${editSession?.startLine ?? "?"}`
        );
    }, [editSession, getViewportEl]);

    useLayoutEffect(() => {
        if (editSession == null) {
            return;
        }
        const viewport = getViewportEl();
        if (viewport == null) {
            inlineEditDebug("anchor-hide: no viewport");
            return;
        }
        const target = resolveInlineEditTarget(viewport, editSession);
        if (target == null) {
            inlineEditDebug("anchor-hide: target lost → clearing session", {
                kind: editSession.blockKind,
                startLine: editSession.startLine,
            });
            setEditSession(null);
            setDraftText("");
            setOverlayRect(null);
            return;
        }
        target.classList.add("inline-edit-hidden");
        return () => target.classList.remove("inline-edit-hidden");
    });

    useLayoutEffect(() => {
        if (editSession == null) {
            return;
        }
        inlineEditDebug("measure-effect fire", { kind: editSession.blockKind, startLine: editSession.startLine });
        measureOverlay();
    }, [editSession, measureOverlay]);

    // Re-measure on scroll / resize / dismiss. We attach scroll to the viewport element
    // (which is the OverlayScrollbars inner scrollable). Resize window covers container reflow.
    useEffect(() => {
        if (editSession == null) {
            return;
        }
        const viewport = getViewportEl();
        let scrollCalls = 0;
        const onScroll = () => {
            scrollCalls++;
            inlineEditDebug("scroll-listener", { scrollTop: viewport?.scrollTop, n: scrollCalls });
            measureOverlay();
        };
        const onResize = () => {
            inlineEditDebug("resize-listener");
            measureOverlay();
        };
        viewport?.addEventListener("scroll", onScroll, { passive: true });
        window.addEventListener("resize", onResize);
        // Re-measure on next paint in case the latest layout pass shifted position.
        inlineEditDebug("raf-arm");
        const raf = requestAnimationFrame(() => {
            inlineEditDebug("raf-fire");
            measureOverlay();
        });
        return () => {
            viewport?.removeEventListener("scroll", onScroll);
            window.removeEventListener("resize", onResize);
            cancelAnimationFrame(raf);
            inlineEditDebug("scroll-effect cleanup", { kind: editSession?.blockKind });
        };
    }, [editSession, measureOverlay, getViewportEl]);

    useLayoutEffect(() => {
        const ta = textareaRef.current;
        if (ta == null || editSession == null || overlayRect == null || focusedSessionRef.current === editSession) {
            return;
        }
        focusedSessionRef.current = editSession;
        inlineEditDebug("focus+select", { kind: editSession.blockKind, startLine: editSession.startLine });
        // preventScroll stops the browser from auto-scrolling the textarea into the viewport,
        // which on a tall block (list/table/code whose overlay exceeds the viewport height) sets
        // off a feedback loop: focus → auto-scroll → scroll-listener → re-measure → reposition →
        // new top is off-screen → focus rect auto-scrolls again. The textarea is positioned
        // absolutely over the block the user double-clicked; the scroll position the user picked
        // when dblclicking is the one we want to keep.
        ta.focus({ preventScroll: true });
        if (editSession.caretOffset != null) {
            const clamped = Math.max(0, Math.min(editSession.caretOffset, ta.value.length));
            ta.setSelectionRange(clamped, clamped);
        } else {
            // Dblclick (and any path that didn't provide a caret) keeps the select-all
            // behavior: it's the "edit this whole block" gesture.
            ta.setSelectionRange(0, ta.value.length);
        }
    }, [editSession, overlayRect]);

    // Auto-grow textarea height to fit content.
    useLayoutEffect(() => {
        const ta = textareaRef.current;
        if (ta == null || editSession == null) {
            return;
        }
        const beforeH = ta.style.height;
        ta.style.height = "auto";
        const scrollH = ta.scrollHeight;
        ta.style.height = `${scrollH}px`;
        inlineEditDebug("auto-grow", {
            beforeH,
            scrollH,
            clientH: ta.clientHeight,
            scrollWidth: ta.scrollWidth,
            clientWidth: ta.clientWidth,
            draftLen: draftText.length,
        });
    }, [draftText, editSession, overlayRect?.width]);

    const beginEdit = useCallback(
        (
            blockKind: InlineEditBlockKind,
            line: number,
            targetEl: HTMLElement,
            caretOffset?: number,
            insertRevert?: () => void,
            placeholder?: boolean
        ) => {
            const safeLine = Math.max(1, Math.trunc(line));
            const lines = fullText.split(/\r\n|\n/);
            if (safeLine > lines.length) {
                return;
            }
            // Multi-line visual blocks (soft-broken paragraphs/headings) carry an explicit
            // data-source-line-end so we slice the whole range. Headings without a soft break and
            // legacy renders without the end attr fall back to single-line — keeps the M1
            // single-line behavior intact for anything that hasn't been re-rendered.
            const endAttr = targetEl.dataset.sourceLineEnd;
            const endLineRaw = endAttr != null ? Number(endAttr) : safeLine;
            const endLine =
                Number.isFinite(endLineRaw) && endLineRaw >= safeLine
                    ? Math.min(Math.trunc(endLineRaw), lines.length)
                    : safeLine;
            const initialContent = lines.slice(safeLine - 1, endLine).join("\n");
            const session: InlineEditSession = {
                blockKind,
                startLine: safeLine,
                endLine,
                initialContent,
                targetEl,
                caretOffset,
                insertRevert,
                placeholder: placeholder || undefined,
            };
            inlineEditDebug("beginEdit", {
                kind: blockKind,
                startLine: safeLine,
                endLine,
                caretOffset,
                initialLen: initialContent.length,
                targetTag: targetEl.tagName,
                targetConnected: targetEl.isConnected,
                targetHasSourceLineEnd: targetEl.dataset.sourceLineEnd != null,
            });
            setEditSession(session);
            setDraftText(initialContent);
        },
        [fullText]
    );

    // Opens a blank editor that inserts a NEW block before/after the anchor block on commit.
    // The overlay anchors to the given element (the block whose edge the user hovered); the
    // draft starts empty and its committed text is spliced in as a fresh block with a blank
    // line separator (see commit's insertMode branch). startLine/endLine bracket the WHOLE
    // block (list/table/code/multi-line paragraph carry data-source-line-end): "before"
    // splices above startLine, "after" splices below endLine — otherwise inserting after a
    // list would tear it open mid-list.
    const beginInsertEdit = useCallback(
        (startLine: number, endLine: number, targetEl: HTMLElement, mode: "before" | "after") => {
            const safeStart = Math.max(1, Math.trunc(startLine));
            const safeEnd = Math.max(safeStart, Math.trunc(endLine));
            const session: InlineEditSession = {
                blockKind: "p",
                startLine: safeStart,
                endLine: safeEnd,
                initialContent: "",
                targetEl,
                insertMode: mode,
            };
            inlineEditDebug("beginInsertEdit", {
                startLine: safeStart,
                endLine: safeEnd,
                mode,
                targetTag: targetEl.tagName,
                targetConnected: targetEl.isConnected,
            });
            setEditSession(session);
            setDraftText("");
        },
        []
    );

    const commit = useCallback(() => {
        // Read editSession from closure (callback identity updates with session since it's in the
        // dep array). The previous implementation called onCommit *inside* the setEditSession
        // updater — that schedules an external jotai store write (globalStore.set(model.newFileContent))
        // from within a React state updater, which React does not let through cleanly: the
        // downstream async fileContentAtom subscribing to record.stateAtom misses the invalidate
        // and ReactMarkdown keeps rendering the pre-edit text until something else (a Save, a tab
        // blur) bumps the fileKey atom. Pulling the commit side effect out of the updater — and
        // closing over the current session — fixes the live-preview-after-blur refresh path.
        const current = editSession;
        if (current == null) {
            return;
        }
        inlineEditDebug("commit", {
            kind: current.blockKind,
            startLine: current.startLine,
            insertMode: current.insertMode,
            draftLen: draftText.length,
            initialLen: current.initialContent.length,
            changed: draftText !== current.initialContent,
        });
        setEditSession(null);
        setDraftText("");
        if (current.placeholder) {
            // Placeholder-row commit (click A/B insert or Enter split pre-inserted a single
            // blank row for us to type into). Typed something → replace the row and re-add
            // separator blanks as needed (commitPlaceholderBlock), netting exactly one new
            // block. Nothing typed → the pre-insert must not survive: revert the document
            // to its pre-insert state so the click leaves zero trace.
            if (draftText.trim().length === 0) {
                current.insertRevert?.();
                return;
            }
            onCommit(
                commitPlaceholderBlock(fullText, current.startLine, current.endLine, draftText)
            );
            return;
        }
        if (draftText === current.initialContent && current.insertMode == null) {
            // No-op commit: nothing to write. Don't touch the shared draft atom — keeps the dirty
            // flag honest. (Insert sessions always write: their initialContent is empty and a
            // non-empty draft is the whole point, an empty draft is skipped below.)
            return;
        }
        if (draftText.trim().length === 0 && current.insertMode != null) {
            // Inserted a blank line then committed nothing: drop the empty draft, no-op.
            return;
        }
        let newFull: string;
        if (current.insertMode != null) {
            // Insert the draft as a new block before/after the anchor line. Draft lines are
            // inserted verbatim (blank lines inside the draft stay blank); we bracket the block
            // with a blank line so it renders as its own paragraph.
            const lines = fullText.split(/\r\n|\n/);
            const draftLines = draftText.split(/\r\n|\n/);
            newFull = spliceInsertBlock(
                lines,
                current.startLine,
                current.endLine,
                current.insertMode,
                draftLines
            ).join("\n");
        } else {
            newFull = replaceSourceRange(fullText, current.startLine, current.endLine, draftText);
        }
        onCommit(newFull);
    }, [editSession, draftText, fullText, onCommit]);

    const cancel = useCallback(() => {
        // If this editor was opened by an immediate-insert flow (click A/B or Enter split),
        // the document already changed — Esc must revert the whole insert, not just close the
        // editor. Otherwise a plain cancel leaves the document untouched.
        editSession?.insertRevert?.();
        inlineEditDebug("cancel", { kind: editSession?.blockKind, startLine: editSession?.startLine });
        setEditSession(null);
        setDraftText("");
    }, [editSession]);

    return {
        editSession,
        draftText,
        setDraftText,
        beginEdit,
        beginInsertEdit,
        commit,
        cancel,
        textareaRef,
        overlayRect,
    };
}

type InlineEditOverlayProps = {
    overlayRect: { top: number; left: number; width: number; height: number } | null;
    blockKind: InlineEditBlockKind | null;
    draftText: string;
    textareaRef: React.RefObject<HTMLTextAreaElement | null>;
    onTextChange: (v: string) => void;
    onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
    onPaste?: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
    onBlur: () => void;
};

export function InlineEditOverlay({
    overlayRect,
    blockKind,
    draftText,
    textareaRef,
    onTextChange,
    onKeyDown,
    onPaste,
    onBlur,
}: InlineEditOverlayProps) {
    if (overlayRect == null || blockKind == null) {
        return null;
    }
    // code blocks in M1+ would switch font-family to monospace here; for p/h we keep the
    // surrounding paragraph font so typing feels continuous with reading.
    //
    // Render to document.body via portal: the overlay is `position: fixed` so it ignores the
    // OverlayScrollbars inner viewport's scrollTop. Rendering inside the OSB viewport (the old
    // approach) made the textarea a participant in OSB's scroll-content layout, which on tall
    // blocks triggered a focus → auto-scroll → re-measure → reposition loop. The portal frees
    // the overlay from that container's coordinate system; measureOverlay now writes viewport-
    // relative (screen) coordinates so `position: fixed` lands at the right pixel.
    return createPortal(
        <div
            className="inline-edit-overlay"
            data-block-kind={blockKind}
            style={{
                position: "fixed",
                top: `${overlayRect.top}px`,
                left: `${overlayRect.left}px`,
                width: `${overlayRect.width}px`,
                minHeight: `${overlayRect.height}px`,
            }}
            // Prevent the overlay from catching the markdown root's own dblclick/click handlers.
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
        >
            <textarea
                ref={textareaRef}
                className="inline-edit-textarea"
                value={draftText}
                rows={1}
                onChange={(e) => onTextChange(e.target.value)}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
                onBlur={onBlur}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
            />
        </div>,
        document.body
    );
}

/**
 * Shared keydown handler for the textarea. Returns nothing; the caller threads commit/cancel.
 *
 * - Esc → cancel (drop draft)
 * - Cmd/Ctrl+S → commit, then if an `onSave` was wired, call it (the preview-side caller feeds
 *   `model.handleFileSave` here). ⌘S must be `preventDefault`'d in preview mode because no
 *   global ⌘S handler runs there to consume the keystroke — leaving the default would let the
 *   browser try (and fail) to "Save Page". The old comment "let it bubble to Wave's save
 *   handler" describes a path that no longer exists in preview mode, so we drive the flush
 *   ourselves and stop the event.
 * - Cmd/Ctrl+Enter → commit
 * - plain blur (handled in onBlur, not here)
 */
export function makeInlineEditKeydown(opts: {
    commit: () => void;
    cancel: () => void;
    save?: () => void;
    /** Called on a bare Enter (no Shift/Cmd/Ctrl, not IME-composing) so the caller can split the block at the caret. */
    onSplitCaret?: () => void;
}) {
    return (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Escape") {
            e.preventDefault();
            opts.cancel();
            return;
        }
        const isCmd = e.metaKey || e.ctrlKey;
        // Split-on-Enter (note-app behavior): bare Enter ends the block, Shift+Enter keeps the
        // soft line break. Skip while IME is composing (Chinese/Japanese candidates send
        // Enter to pick a word) and when the caller didn't wire a split handler.
        if (e.key === "Enter" && !isCmd && !e.shiftKey && opts.onSplitCaret != null) {
            const native = e.nativeEvent as KeyboardEvent & { isComposing?: boolean };
            if (!native.isComposing) {
                e.preventDefault();
                opts.onSplitCaret();
                return;
            }
        }
        if (isCmd && (e.key === "s" || e.key === "S")) {
            // Commit synchronously so the draft atom carries the just-typed text before save runs.
            // If the parent wired `save`, flush it directly — preview-mode has no global ⌘S
            // listener, so bubbling would do nothing and the draft would sit unsaved.
            e.preventDefault();
            opts.commit();
            opts.save?.();
            return;
        }
        if (isCmd && e.key === "Enter") {
            e.preventDefault();
            opts.commit();
            return;
        }
    };
}

/** Convenience for tests or external integrations. */
export function isInlineEditingActive(): boolean {
    return globalStore.get(inlineEditingActiveAtom);
}

/**
 * Pure insert helper used by the insert-mode commit: splice `draftLines` into `lines` as a
 * new block before/after the anchor line (1-based), bracketed by a blank line so it renders
 * as its own block. Exported for tests.
 */
export function spliceInsertBlock(
    lines: string[],
    startLine: number,
    endLine: number,
    mode: "before" | "after",
    draftLines: string[]
): string[] {
    // Bracket the WHOLE anchor block, not just its first line: lists / tables / code blocks /
    // multi-line paragraphs span [startLine..endLine] (data-source-line-end), and "after" must
    // splice below endLine or the new block lands mid-block (e.g. tearing a list open between
    // its items). before → above startLine, after → below endLine.
    const startIdx = Math.max(0, Math.min(startLine - 1, lines.length));
    const endIdx = Math.max(0, Math.min(endLine - 1, lines.length));
    const block = mode === "before" ? [...draftLines, ""] : ["", ...draftLines];
    const next = lines.slice();
    next.splice(mode === "before" ? startIdx : endIdx + 1, 0, ...block);
    return next;
}

/**
 * Insert EXACTLY ONE blank row before/after the anchor block range, without any bracket
 * blank. Used by the block-edge insert buttons / Enter split to give the user an immediate
 * single-row editing target ("click → preview gains one line"). The eventual commit replaces
 * this row with the user's draft via commitPlaceholderBlock, which re-adds separator blanks
 * only as needed — so a single click nets exactly one new block, never stray blank rows.
 */
export function spliceBlankRow(
    lines: string[],
    startLine: number,
    endLine: number,
    mode: "before" | "after"
): string[] {
    const startIdx = Math.max(0, Math.min(startLine - 1, lines.length));
    const endIdx = Math.max(0, Math.min(endLine - 1, lines.length));
    const next = lines.slice();
    next.splice(mode === "before" ? startIdx : endIdx + 1, 0, "");
    return next;
}

/**
 * Finalize a placeholder-row edit: replace the pre-inserted blank row ([startLine..endLine])
 * with the user's draft, then guarantee the new block is separated from whatever surrounds it
 * by single blank lines — adding a blank on a side that lost its separator (the pre-insert
 * consumed it) and never duplicating one that still exists. Repeated inserts therefore
 * accumulate exactly one block each, with no stray blank runs.
 */
export function commitPlaceholderBlock(
    fullText: string,
    startLine: number,
    endLine: number,
    draftText: string
): string {
    const lines = fullText.split(/\r\n|\n/);
    const safeStart = Math.max(1, Math.min(Math.trunc(startLine), lines.length || 1));
    const safeEnd = Math.max(safeStart, Math.min(Math.trunc(endLine), lines.length));
    const draftLines = draftText.split(/\r\n|\n/);
    const out = [...lines.slice(0, safeStart - 1), ...draftLines, ...lines.slice(safeEnd)];
    let firstIdx = safeStart - 1; // first draft row's index in `out`
    let lastIdx = firstIdx + draftLines.length - 1; // …and its LAST row (multi-line drafts)
    // Front separator: draft starts with content directly under content → the blank that used
    // to separate them was consumed by the pre-insert, put one back.
    if (draftLines.length > 0 && out[firstIdx] !== "" && firstIdx > 0 && out[firstIdx - 1] !== "") {
        out.splice(firstIdx, 0, "");
        firstIdx++;
        lastIdx++;
    }
    // Rear separator: the draft's last row is content directly above content → add a blank.
    // Checked on the LAST draft row so multi-line drafts separate correctly past their body.
    if (draftLines.length > 0 && out[lastIdx] !== "" && lastIdx + 1 < out.length && out[lastIdx + 1] !== "") {
        out.splice(lastIdx + 1, 0, "");
    }
    return out.join("\n");
}

/**
 * Pure helper for "Enter at caret splits the block": keeps the BEFORE part in the anchor
 * block's source range and inserts the AFTER part as a new block right below it. Returns the
 * new full text plus the 1-based source line of the new block's CONTENT row (the second of
 * the two inserted lines — spliceInsertBlock brackets with a separator blank first) so the
 * follow-up editor focuses the row the user actually types into.
 *
 * Edge cases match the buttons:
 *  - caret at very end (after === "") → insert a blank row BELOW (cursor row = endLine + 2)
 *  - caret at very start (before === "") → insert a blank row ABOVE (cursor row = startLine)
 */
export function splitBlockAtCaretText(
    fullText: string,
    startLine: number,
    endLine: number,
    draftText: string,
    caretPos: number
): { text: string; newLine: number } {
    const before = draftText.slice(0, caretPos);
    const after = draftText.slice(caretPos);
    const lines = fullText.split(/\r\n|\n/);

    if (before === "") {
        // Caret at line start: the split row goes ABOVE, the current row keeps all its
        // content. Pre-insert exactly one blank row (not two) — the follow-up editor treats
        // it as a placeholder row, see commitPlaceholderBlock.
        const newFull = spliceBlankRow(lines, startLine, endLine, "before").join("\n");
        return { text: newFull, newLine: startLine };
    }
    if (after === "") {
        // Caret at line end: the split row goes BELOW. One blank row, same placeholder math.
        const newFull = spliceBlankRow(lines, startLine, endLine, "after").join("\n");
        return { text: newFull, newLine: endLine + 1 };
    }
    const afterBeforeCommit = replaceSourceRange(fullText, startLine, endLine, before);
    const midLines = afterBeforeCommit.split(/\r\n|\n/);
    const beforeEnd = startLine + before.split(/\r\n|\n/).length - 1;
    const newFull = spliceInsertBlock(midLines, startLine, beforeEnd, "after", after.split(/\r\n|\n/)).join("\n");
    return { text: newFull, newLine: beforeEnd + 2 };
}

/**
 * Pure helper for deleting a whole block [startLine..endLine] from the source text. Keeps the
 * document tidy: also removes one leading/trailing blank line around the block (the separator
 * lines) and collapses any accidental blank run at the junction to a single blank, so deleting
 * a paragraph doesn't leave three consecutive blank lines. Returns the new full text.
 */
export function deleteBlockRange(fullText: string, startLine: number, endLine: number): string {
    const lines = fullText.split(/\r\n|\n/);
    const safeStart = Math.max(1, Math.min(Math.trunc(startLine), lines.length));
    const safeEnd = Math.max(safeStart, Math.min(Math.trunc(endLine), lines.length));
    const before = lines.slice(0, safeStart - 1);
    const after = lines.slice(safeEnd);
    // The block is normally wrapped in blank separator lines: drop ONE of the two (keep the
    // other) so the surrounding blocks still have a single blank between them. If only one
    // side has a blank, keep it (it's the paragraph separator).
    if (before.length > 0 && before[before.length - 1] === "" && after.length > 0 && after[0] === "") {
        before.pop();
    }
    const merged = before.concat(after);
    // never leave a leading/trailing blank (e.g. deleting the very first block)
    while (merged.length > 0 && merged[0] === "") {
        merged.shift();
    }
    while (merged.length > 0 && merged[merged.length - 1] === "") {
        merged.pop();
    }
    return merged.join("\n");
}
