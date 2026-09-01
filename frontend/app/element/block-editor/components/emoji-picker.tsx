// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import {
    buildEmojiPickerItems,
    emojiPickerEntries,
    getRecentEmojis,
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
}: EmojiPickerProps) {
    const recents = useMemo(() => getRecentEmojis(), []);
    const items = useMemo(() => buildEmojiPickerItems(catalog, query, recents), [catalog, query, recents]);
    // Clickable (selectable) entries in order — headers are skipped by nav.
    const pickables = useMemo(() => emojiPickerEntries(items), [items]);
    const listRef = useRef<HTMLDivElement | null>(null);

    // Keep the active row visible while arrow-keying through.
    useEffect(() => {
        const list = listRef.current;
        const active = list?.querySelector<HTMLElement>(".is-active");
        active?.scrollIntoView({ block: "nearest" });
    }, [activeIndex]);

    const stopMouse = (e: React.MouseEvent) => e.preventDefault();
    let pickIdx = -1;

    return createPortal(
        <div
            className={`markdown-emoji-picker placement-${placement} mode-${mode}`}
            style={{ top: anchor.top, left: anchor.left }}
            onMouseDown={stopMouse}
            role="dialog"
            aria-label="Emoji picker"
        >
            {mode === "document" && (
                <div className="markdown-emoji-searchrow">
                    <input
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
                    {allowRemove && (
                        <button type="button" className="markdown-emoji-remove" onClick={onRemove} title="Remove emoji">
                            Remove
                        </button>
                    )}
                </div>
            )}
            <div className="markdown-emoji-list" ref={listRef}>
                {items.length === 0 && <div className="markdown-emoji-empty">No emoji found</div>}
                {items.map((it) => {
                    if ("header" in it) {
                        return (
                            <div key={it.key} className="markdown-emoji-group">
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
        </div>,
        document.body
    );
}
