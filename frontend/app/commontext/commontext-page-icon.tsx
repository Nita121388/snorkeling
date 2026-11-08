// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Page icon slot for the Common Text detail pane (Notion-style page header).
 *
 * The emoji picker is the same component the markdown document header uses
 * (EmojiPicker, mode="document") so recents / search / aliases stay shared instead of
 * growing a second, drifting picker. This file only owns the badge + popover plumbing.
 */

import { EmojiPicker } from "@/app/element/block-editor/components/emoji-picker";
import {
    buildEmojiPickerItems,
    emojiPickerEntries,
    getLoadedEmojiCatalog,
    getRecentEmojis,
    loadEmojiCatalog,
    type EmojiCatalog,
} from "@/app/element/markdown-transform/emoji";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type PageIconSlotProps = {
    emoji: string;
    title: string;
    onChange: (emoji: string) => void;
};

export function PageIconSlot({ emoji, title, onChange }: PageIconSlotProps) {
    const buttonRef = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(false);
    const [catalog, setCatalog] = useState<EmojiCatalog | null>(() => getLoadedEmojiCatalog() ?? null);
    const [query, setQuery] = useState("");
    const [activeIndex, setActiveIndex] = useState(0);
    const [anchor, setAnchor] = useState({ top: 0, left: 0 });

    useEffect(() => {
        if (!open) return;
        if (getLoadedEmojiCatalog() == null) {
            void loadEmojiCatalog().then(setCatalog);
        }
    }, [open]);

    const items = useMemo(
        () => (catalog == null || !open ? [] : buildEmojiPickerItems(catalog, query, getRecentEmojis())),
        [catalog, open, query]
    );
    const pickables = useMemo(() => emojiPickerEntries(items), [items]);

    const toggle = useCallback(() => {
        if (open) {
            setOpen(false);
            return;
        }
        const rect = buttonRef.current?.getBoundingClientRect();
        if (rect == null) return;
        setQuery("");
        setActiveIndex(0);
        setAnchor({ top: rect.bottom + 6, left: Math.max(8, rect.left) });
        setOpen(true);
    }, [open]);

    const apply = useCallback(
        (next: string) => {
            setOpen(false);
            onChange(next);
        },
        [onChange]
    );

    return (
        <>
            <button
                ref={buttonRef}
                type="button"
                data-commontext-page-icon=""
                onClick={(e) => {
                    e.stopPropagation();
                    toggle();
                }}
                title={emoji === "" ? "Add a page icon" : "Change page icon"}
                aria-label="Page icon"
                className={
                    "flex h-8 w-8 items-center justify-center rounded-md border text-[18px] leading-none transition-colors cursor-pointer " +
                    (emoji === ""
                        ? "border-dashed border-border text-muted hover:border-accent/70 hover:text-secondary"
                        : "border-transparent hover:bg-surface-soft")
                }
            >
                {emoji === "" ? <i className="fa-regular fa-face-smile text-[13px]" /> : <span>{emoji}</span>}
            </button>
            {open && (
                <EmojiPicker
                    anchor={anchor}
                    placement="bottom"
                    mode="document"
                    catalog={catalog}
                    query={query}
                    onQueryChange={setQuery}
                    activeIndex={activeIndex}
                    onActiveChange={setActiveIndex}
                    onPick={(entry) => apply(entry.char)}
                    onClose={() => setOpen(false)}
                    allowRemove={emoji !== ""}
                    onRemove={() => apply("")}
                />
            )}
        </>
    );
}
