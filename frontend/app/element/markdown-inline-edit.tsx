// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { inlineEditingActiveAtom } from "@/app/view/preview/preview-shared-draft";
import { globalStore } from "@/store/jotaiStore";
import { useAtom } from "jotai";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Block kinds the inline editor knows how to open. M1 ships "p" and "h" only — both are
 * single source lines. li-summary / table / code / wave / mermaid arrive in later milestones
 * and will extend this union; refactor users of `beginEdit` accordingly.
 */
export type InlineEditBlockKind = "p" | "h";

export type InlineEditSession = {
    blockKind: InlineEditBlockKind;
    /** 1-based, inclusive, original text coordinate (NOT transformedText). */
    startLine: number;
    /** 1-based, inclusive. Equal to startLine for single-line blocks (p, h). */
    endLine: number;
    /** Original segment text captured when entering edit — used for cancel/Revert + initial draft. */
    initialContent: string;
    /** DOM element we anchored on; kept hidden (visibility:hidden) while textarea is mounted. */
    targetEl: HTMLElement;
};

export function resolveInlineEditTarget(
    viewport: HTMLElement,
    session: Pick<InlineEditSession, "blockKind" | "startLine" | "targetEl">
): HTMLElement | null {
    if (session.targetEl.isConnected && viewport.contains(session.targetEl)) {
        return session.targetEl;
    }
    const blockClass = session.blockKind === "p" ? "paragraph" : "heading";
    return viewport.querySelector<HTMLElement>(
        `.markdown-render-root .${blockClass}[data-source-line="${session.startLine}"]`
    );
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
    return [...before, ...replacement, ...after].join("\n");
}

type UseInlineEditArgs = {
    /** Full original markdown text — the same value ReactMarkdown renders (NOT transformedText). */
    fullText: string;
    /** Called with the new full text on every successful commit; never on cancel. */
    onCommit: (newFullText: string) => void;
    /** Lazily returns the OverlayScrollbars viewport element; called on every measure. */
    getViewportEl: () => HTMLElement | null;
    /**
     * Optional: stable identity so the hook can reset transient state if the parent re-mounts
     * (e.g. new file key). Not strictly required.
     */
    resetKey?: unknown;
};

export function useInlineEdit({ fullText, onCommit, getViewportEl, resetKey }: UseInlineEditArgs) {
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
            // Single-line blocks (M1: p, h). Multi-line slice will land with M2's table/li/code.
            const safeLine = Math.max(1, Math.trunc(line));
            const lines = fullText.split(/\r\n|\n/);
            if (safeLine > lines.length) {
                return;
            }
            const initialContent = lines[safeLine - 1];
            const session: InlineEditSession = {
                blockKind,
                startLine: safeLine,
                endLine: safeLine,
                initialContent,
                targetEl,
            };
            setEditSession(session);
            setDraftText(initialContent);
        },
        [fullText]
    );

    const commit = useCallback(() => {
        setEditSession((current) => {
            if (current == null) {
                return null;
            }
            if (draftText === current.initialContent) {
                // No-op commit: nothing to write. Don't touch the shared draft atom — keeps
                // the dirty flag honest.
                return null;
            }
            const newFull = replaceSourceRange(fullText, current.startLine, current.endLine, draftText);
            onCommit(newFull);
            return null;
        });
        setDraftText("");
    }, [draftText, fullText, onCommit]);

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
 * - Cmd/Ctrl+S → commit (do NOT preventDefault browser save — Wave runs a Cmd+S handler at
 *   the global level that triggers handleFileSave on this block; we only commit draft-to-atom
 *   here, then re-dispatch a real Cmd+S so the global handler fires after our commit)
 *   ⚠️ We do not call preventDefault on Cmd+S — letting it bubble lets Wave's save pipeline
 *      consume the same keystroke. Order is safe because React onKeyDown fires before
 *      window keydown listeners (capture-stage global handler can also re-derive).
 * - Cmd/Ctrl+Enter → commit
 * - plain blur (handled in onBlur, not here)
 */
export function makeInlineEditKeydown(opts: { commit: () => void; cancel: () => void }) {
    return (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Escape") {
            e.preventDefault();
            opts.cancel();
            return;
        }
        const isCmd = e.metaKey || e.ctrlKey;
        if (isCmd && (e.key === "s" || e.key === "S")) {
            // commit synchronously so the live ReactMarkdown re-renders with the new text
            // before Wave's save handler reads the draft atom.
            opts.commit();
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
