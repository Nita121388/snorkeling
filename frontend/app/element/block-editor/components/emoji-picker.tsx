// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
    buildEmojiPickerItems,
    emojiPickerEntries,
    getRecentEmojis,
    EMOJI_GROUP_LABELS,
    EMOJI_GROUP_ICONS,
    groupFirstPickableIndex,
    type EmojiCatalog,
    type EmojiEntry,
} from "../../markdown-transform/emoji";

export type EmojiPickerMode = "inline" | "document";

export interface EmojiPickerProps {
    anchor: { top: number; left: number };
    placement: "top" | "bottom";
    mode: EmojiPickerMode;
    catalog: EmojiCatalog;
    query: string;
    /** Document mode shows its own search box and routes edits through this. */
    onQueryChange?: (q: string) => void;
    activeIndex: number;
    onActiveChange: (index: number) => void;
    onPick: (emoji: EmojiEntry) => void;
    onClose: () => void;
    /** Document mode: "Remove emoji" affordance. */
    allowRemove?: boolean;
    onRemove?: () => void;
    /** Optional extra content rendered at the bottom of the popover (e.g. scope radio). */
    footer?: React.ReactNode;
    /**
     * Optional ref to the document-mode search input. Hosts that open the picker
     * from a terminal block need it: xterm re-claims focus right after the click
     * that opened the popover, so the host must be able to re-focus the input.
     */
    searchInputRef?: React.RefObject<HTMLInputElement | null>;
}

/**
 * Items come from buildEmojiPickerItems (markdown-transform/emoji.ts) so the component,
 * the inline editor's arrow-key nav and tests all walk the SAME flat list.
 */
type GridItem = ReturnType<typeof buildEmojiPickerItems>[number];

export function EmojiPicker({
    anchor,
    placement,
    mode,
    catalog,
    query,
    onQueryChange,
    activeIndex,
    onActiveChange,
    onPick,
    onClose,
    allowRemove,
    onRemove,
    footer,
    searchInputRef,
}: EmojiPickerProps) {
    const recents = useMemo(() => getRecentEmojis(), []);
    const items = useMemo(() => buildEmojiPickerItems(catalog, query, recents), [catalog, query, recents]);
    // Clickable (selectable) entries in order — headers are skipped by nav.
    const pickables = useMemo(() => emojiPickerEntries(items), [items]);
    const listRef = useRef<HTMLDivElement | null>(null);

    // --- Category tab bar state ---
    // Visible group ids (in order), excluding "recent" and search-filtered single-group results.
    const visibleGroups = useMemo(() => {
        const groups: number[] = [];
        for (const it of items) {
            if ("header" in it) {
                const g = parseInt(it.key.slice(2), 10);
                if (Number.isFinite(g) && EMOJI_GROUP_LABELS[g] != null && !groups.includes(g)) {
                    groups.push(g);
                }
            }
        }
        return groups;
    }, [items]);

    const groupFirstIdx = useMemo(() => groupFirstPickableIndex(items), [items]);

    // Track which group is currently most visible via IntersectionObserver.
    const [activeGroup, setActiveGroup] = useState<number | null>(visibleGroups[0] ?? null);
    const groupHeadersRef = useRef<Map<number, HTMLDivElement>>(new Map());

    // Register header DOM nodes so the observer can target them.
    const registerHeader = useCallback((group: number, el: HTMLDivElement | null) => {
        if (el != null) {
            groupHeadersRef.current.set(group, el);
        } else {
            groupHeadersRef.current.delete(group);
        }
    }, []);

    // IntersectionObserver: watches group header elements inside the scrollable list.
    useEffect(() => {
        const list = listRef.current;
        if (list == null || visibleGroups.length === 0) {
            return;
        }
        const headers = groupHeadersRef.current;
        if (headers.size === 0) {
            return;
        }
        let ticking = false;
        const observer = new IntersectionObserver(
            (entries) => {
                if (ticking) return;
                ticking = true;
                requestAnimationFrame(() => {
                    // Pick the topmost intersecting group header.
                    let bestGroup: number | null = null;
                    let bestTop = Infinity;
                    for (const entry of entries) {
                        if (entry.isIntersecting) {
                            for (const [g, el] of headers) {
                                if (el === entry.target) {
                                    const rect = el.getBoundingClientRect();
                                    if (rect.top < bestTop) {
                                        bestTop = rect.top;
                                        bestGroup = g;
                                    }
                                }
                            }
                        }
                    }
                    if (bestGroup != null) {
                        setActiveGroup(bestGroup);
                    }
                    ticking = false;
                });
            },
            { root: list, threshold: 0.1 }
        );
        for (const [, el] of headers) {
            observer.observe(el);
        }
        return () => observer.disconnect();
    }, [visibleGroups, items]);

    // Keep the active row visible while arrow-keying through.
    useEffect(() => {
        const list = listRef.current;
        const active = list?.querySelector<HTMLElement>(".is-active");
        active?.scrollIntoView({ block: "nearest" });
    }, [activeIndex]);

    /** Scroll to a group and activate its first emoji. */
    const scrollToGroup = useCallback(
        (group: number) => {
            const headerEl = groupHeadersRef.current.get(group);
            const list = listRef.current;
            if (headerEl != null && list != null) {
                // Manual scrollTop so the header lands at the very top of the scroll container.
                list.scrollTop = headerEl.offsetTop - list.offsetTop;
            }
            const firstIdx = groupFirstIdx.get(group);
            if (firstIdx != null) {
                onActiveChange(firstIdx);
            }
        },
        [groupFirstIdx, onActiveChange]
    );

    // Viewport-aware geometry. The old layout hard-coded `width: 320px` and let the
    // anchor's `left` through untouched, so opening the popover near the right edge
    // pushed it off-screen; the grid was also pinned to 8 columns, which overflowed
    // instead of reflowing on narrow windows.
    const [viewport, setViewport] = useState<{ w: number; h: number }>(() =>
        typeof window === "undefined" ? { w: 1024, h: 768 } : { w: window.innerWidth, h: window.innerHeight }
    );
    useEffect(() => {
        if (typeof window === "undefined") return;
        const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, []);
    const popoverWidth = Math.min(320, Math.max(220, viewport.w - 24));
    const popoverLeft = Math.min(Math.max(8, anchor.left), Math.max(8, viewport.w - popoverWidth - 8));
    const availableHeight =
        placement === "top" ? anchor.top - 8 : viewport.h - anchor.top - 8;

    // Never swallow mousedown for real form controls: preventing the default there is
    // what made the search box unfocusable (you could open the picker but not type).
    // Everything else still needs the guard so the editor/terminal keeps its selection.
    const handlePopoverMouseDown = (e: React.MouseEvent) => {
        const target = e.target as HTMLElement | null;
        if (target?.closest?.("input, textarea, select, label, button")) {
            e.stopPropagation();
            return;
        }
        e.preventDefault();
    };

    let pickIdx = -1;

    return createPortal(
        <div
            className={`markdown-emoji-picker placement-${placement} mode-${mode}`}
            style={{
                top: anchor.top,
                left: popoverLeft,
                width: popoverWidth,
                maxHeight: Math.max(160, availableHeight),
            }}
            onMouseDown={handlePopoverMouseDown}
            role="dialog"
            aria-label="Emoji picker"
        >
            {mode === "document" && (
                <div className="markdown-emoji-searchrow">
                    <input
                        ref={searchInputRef}
                        autoFocus
                        className="markdown-emoji-search"
                        placeholder="Search emoji…"
                        value={query}
                        onChange={(e) => onQueryChange?.(e.target.value)}
                        onKeyDown={(e) => {
                            // Document mode owns its own nav keys (inline mode's owner is the textarea).
                            if (e.key === "Escape") {
                                e.preventDefault();
                                onClose();
                            } else if (e.key === "Enter") {
                                e.preventDefault();
                                const target = pickables[Math.min(activeIndex, pickables.length - 1)];
                                if (target != null) {
                                    onPick(target);
                                }
                            } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                                e.preventDefault();
                                const delta = e.key === "ArrowDown" ? 1 : -1;
                                const next = (activeIndex + delta + pickables.length) % Math.max(1, pickables.length);
                                onActiveChange(next);
                            }
                        }}
                    />
                    <button
                        type="button"
                        className="markdown-emoji-remove"
                        onClick={onRemove}
                        title="Remove emoji"
                        disabled={!allowRemove}
                    >
                        <i className="fa-sharp fa-solid fa-trash-can"></i>
                    </button>
                </div>
            )}
            {/* Category tab bar — hidden during search (single group results) */}
            {query.trim() === "" && visibleGroups.length > 1 && (
                <div className="markdown-emoji-categories">
                    {visibleGroups.map((g) => (
                        <button
                            key={g}
                            type="button"
                            className={"markdown-emoji-cat-tab" + (activeGroup === g ? " is-active" : "")}
                            title={EMOJI_GROUP_LABELS[g]}
                            onClick={() => scrollToGroup(g)}
                        >
                            {EMOJI_GROUP_ICONS[g] ?? "📁"}
                        </button>
                    ))}
                </div>
            )}
            <div className="markdown-emoji-list" ref={listRef}>
                {items.length === 0 && <div className="markdown-emoji-empty">No emoji found</div>}
                {items.map((it) => {
                    if ("header" in it) {
                        const groupNum = parseInt(it.key.slice(2), 10);
                        const isGroupHeader = Number.isFinite(groupNum);
                        return (
                            <div
                                key={it.key}
                                className="markdown-emoji-group"
                                ref={
                                    isGroupHeader
                                        ? (el) => registerHeader(groupNum, el as HTMLDivElement | null)
                                        : undefined
                                }
                            >
                                {it.header}
                            </div>
                        );
                    }
                    pickIdx++;
                    const idx = pickIdx;
                    const entry = it.entry;
                    return (
                        <button
                            key={it.key}
                            type="button"
                            className={
                                "markdown-emoji-item" + (idx === activeIndex ? " is-active" : "")
                            }
                            title={entry.labelEn}
                            onMouseEnter={() => onActiveChange(idx)}
                            onClick={() => onPick(entry)}
                        >
                            {entry.char}
                        </button>
                    );
                })}
            </div>
            {footer != null ? <div className="markdown-emoji-footer">{footer}</div> : null}
        </div>,
        document.body
    );
}
