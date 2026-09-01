// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Slash command palette (方案 02 §2.3): anchored below the textarea caret line while
 * the user filters with the "/query". Presentational only — keyboard navigation lives
 * in the textarea keydown (markdown.tsx) so focus never leaves the editor. All items
 * come from the slash registry (already filtered); this component never hardcodes a list.
 */

import { createPortal } from "react-dom";
import type { SlashCommandSpec } from "../registry";

export type SlashPaletteProps = {
    /** Viewport (fixed) coordinates. */
    anchor: { top: number; left: number };
    placement: "top" | "bottom";
    items: SlashCommandSpec[];
    activeIndex: number;
    onHover: (index: number) => void;
    onPick: (cmd: SlashCommandSpec) => void;
};

export function SlashPalette({ anchor, placement, items, activeIndex, onHover, onPick }: SlashPaletteProps) {
    // mouseDown.preventDefault keeps the textarea blur from committing/closing the edit
    // session before the click lands — selection still happens via onClick afterwards.
    const stopMouse = (e: React.MouseEvent) => e.preventDefault();
    return createPortal(
        <div
            className={`markdown-slash-palette placement-${placement}`}
            style={{ top: anchor.top, left: anchor.left }}
            onMouseDown={stopMouse}
            role="listbox"
            aria-label="Slash commands"
        >
            {items.length === 0 ? (
                <div className="markdown-slash-empty">No matching commands</div>
            ) : (
                items.map((cmd, i) => (
                    <button
                        key={cmd.id}
                        type="button"
                        role="option"
                        aria-selected={i === activeIndex}
                        className={"markdown-slash-item" + (i === activeIndex ? " is-active" : "")}
                        onMouseEnter={() => onHover(i)}
                        onClick={() => onPick(cmd)}
                    >
                        <span className="markdown-slash-item-label">{cmd.label}</span>
                        {cmd.hint != null && <span className="markdown-slash-item-hint">{cmd.hint}</span>}
                    </button>
                ))
            )}
        </div>,
        document.body
    );
}
