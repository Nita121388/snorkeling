// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Document emoji badge (方案 05 §2-3): small affordance at the note's top-right corner.
 * Shows the current frontmatter emoji; when unset it appears on container hover as a
 * faint "add" affordance. The picker itself (EmojiPicker, mode="document") is rendered
 * by markdown.tsx next to it; this component is just the badge button.
 */

import { useTranslation } from "react-i18next";

export interface DocEmojiHeaderProps {
    emoji: string | null;
    buttonRef: React.RefObject<HTMLButtonElement | null>;
    open: boolean;
    onToggle: () => void;
}

export function DocEmojiHeader({ emoji, buttonRef, open, onToggle }: DocEmojiHeaderProps) {
    const { t } = useTranslation("block-editor");
    return (
        <button
            ref={buttonRef}
            type="button"
            className={
                "markdown-doc-emoji-badge" + (emoji == null ? " is-empty" : "") + (open ? " is-open" : "")
            }
            title={
                emoji == null
                    ? t("block-editor:docEmoji.add")
                    : t("block-editor:docEmoji.change")
            }
            aria-label={t("block-editor:docEmoji.ariaLabel")}
            onClick={(e) => {
                e.stopPropagation();
                onToggle();
            }}
        >
            {emoji != null ? <span className="markdown-doc-emoji-char">{emoji}</span> : <span className="markdown-doc-emoji-add">☺+</span>}
        </button>
    );
}
