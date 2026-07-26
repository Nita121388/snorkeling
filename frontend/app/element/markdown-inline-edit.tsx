// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { inlineEditingActiveAtom } from "@/app/view/preview/preview-shared-draft";
import { globalStore } from "@/store/jotaiStore";
import { useAtom } from "jotai";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Block kinds the inline editor knows how to open. Each maps to a renderer-emitted block: the
 * block's DOM carries data-source-line + data-source-line-end so the editor can slice the
 * matching source range. Add a new kind in three places:
 *   1) here in the union,
 *   2) in markdown.tsx's dblclick handler (tag/class → blockKind branch),
 *   3) optional CSS in markdown.scss keyed on `.inline-edit-overlay[data-block-kind="..."]`
 *      if the textarea should match the rendered block's typography (e.g. `code` → monospace).
 */
export type InlineEditBlockKind = "p" | "h" | "list" | "table" | "code";

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
    const [draftText, setDraftText] = useState<string>("");
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
        if (!viewport || !target) {
            setOverlayRect(null);
            return;
        }
        const targetRect = target.getBoundingClientRect();
        const viewportRect = viewport.getBoundingClientRect();
        setOverlayRect({
            top: targetRect.top - viewportRect.top + viewport.scrollTop,
            left: targetRect.left - viewportRect.left + viewport.scrollLeft,
            width: targetRect.width,
            height: targetRect.height,
        });
    }, [editSession, getViewportEl]);

    useLayoutEffect(() => {
        if (editSession == null) {
            return;
        }
        const viewport = getViewportEl();
        if (viewport == null) {
            return;
        }
        const target = resolveInlineEditTarget(viewport, editSession);
        if (target == null) {
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
        measureOverlay();
    }, [editSession, measureOverlay]);

    // Re-measure on scroll / resize / dismiss. We attach scroll to the viewport element
    // (which is the OverlayScrollbars inner scrollable). Resize window covers container reflow.
    useEffect(() => {
        if (editSession == null) {
            return;
        }
        const viewport = getViewportEl();
        const onScroll = () => measureOverlay();
        const onResize = () => measureOverlay();
        viewport?.addEventListener("scroll", onScroll, { passive: true });
        window.addEventListener("resize", onResize);
        // Re-measure on next paint in case the latest layout pass shifted position.
        const raf = requestAnimationFrame(measureOverlay);
        return () => {
            viewport?.removeEventListener("scroll", onScroll);
            window.removeEventListener("resize", onResize);
            cancelAnimationFrame(raf);
        };
    }, [editSession, measureOverlay, getViewportEl]);

    useLayoutEffect(() => {
        const ta = textareaRef.current;
        if (ta == null || editSession == null || overlayRect == null || focusedSessionRef.current === editSession) {
            return;
        }
        focusedSessionRef.current = editSession;
        ta.focus();
        ta.setSelectionRange(0, ta.value.length);
    }, [editSession, overlayRect]);

    // Auto-grow textarea height to fit content.
    useLayoutEffect(() => {
        const ta = textareaRef.current;
        if (ta == null || editSession == null) {
            return;
        }
        ta.style.height = "auto";
        ta.style.height = `${ta.scrollHeight}px`;
    }, [draftText, editSession, overlayRect?.width]);

    const beginEdit = useCallback(
        (blockKind: InlineEditBlockKind, line: number, targetEl: HTMLElement) => {
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
            };
            setEditSession(session);
            setDraftText(initialContent);
        },
        [fullText]
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
        setEditSession(null);
        setDraftText("");
        if (draftText === current.initialContent) {
            // No-op commit: nothing to write. Don't touch the shared draft atom — keeps the dirty
            // flag honest.
            return;
        }
        const newFull = replaceSourceRange(fullText, current.startLine, current.endLine, draftText);
        onCommit(newFull);
    }, [editSession, draftText, fullText, onCommit]);

    const cancel = useCallback(() => {
        setEditSession(null);
        setDraftText("");
    }, []);

    return {
        editSession,
        draftText,
        setDraftText,
        beginEdit,
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
    onBlur: () => void;
};

export function InlineEditOverlay({
    overlayRect,
    blockKind,
    draftText,
    textareaRef,
    onTextChange,
    onKeyDown,
    onBlur,
}: InlineEditOverlayProps) {
    if (overlayRect == null || blockKind == null) {
        return null;
    }
    // code blocks in M1+ would switch font-family to monospace here; for p/h we keep the
    // surrounding paragraph font so typing feels continuous with reading.
    return (
        <div
            className="inline-edit-overlay"
            data-block-kind={blockKind}
            style={{
                position: "absolute",
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
                onBlur={onBlur}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
            />
        </div>
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
export function makeInlineEditKeydown(opts: { commit: () => void; cancel: () => void; save?: () => void }) {
    return (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Escape") {
            e.preventDefault();
            opts.cancel();
            return;
        }
        const isCmd = e.metaKey || e.ctrlKey;
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
