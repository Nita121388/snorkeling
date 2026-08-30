// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Floating toolbar (方案 03 §1): shown above the textarea selection while inline editing.
 * Layout: [block-type ▾] | B I S <> 🔗 kbd. Every item comes from the registries; the
 * component is a dumb renderer with local dropdown state for the block-type menu.
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import type { InlineStyleId } from "../../markdown-transform/inline-style";

export type ToolbarStyleItem = {
    id: InlineStyleId;
    label: string;
    hint?: string;
    active: boolean;
};

export type ToolbarBlockItem = {
    id: string;
    label: string;
    active: boolean;
    enabled: boolean;
};

export type FloatingToolbarProps = {
    /** Viewport (fixed) coordinates for the bar's TOP edge. */
    anchor: { top: number; left: number };
    blockLabel: string;
    blockItems: ToolbarBlockItem[];
    styles: ToolbarStyleItem[];
    onBlockType: (id: string) => void;
    onStyle: (id: InlineStyleId) => void;
};

/** Compact glyphs for the inline-style buttons (kept text-based to stay theme-proof). */
const STYLE_GLYPHS: Record<InlineStyleId, React.ReactNode> = {
    bold: <strong>B</strong>,
    italic: <em>I</em>,
    strike: <s>S</s>,
    code: <span className="mono">&lt;/&gt;</span>,
    link: <span>🔗</span>,
    kbd: <span className="mono">⌘</span>,
};

export function FloatingToolbar({ anchor, blockLabel, blockItems, styles, onBlockType, onStyle }: FloatingToolbarProps) {
    const [typeOpen, setTypeOpen] = useState(false);
    // preventDefault on mousedown: keep the textarea selection + focus while the user
    // clicks a toolbar button (blur would commit the session and swallow the gesture).
    const stopMouse = (e: React.MouseEvent) => e.preventDefault();
    return createPortal(
        <div className="markdown-floating-toolbar" style={{ top: anchor.top, left: anchor.left }} onMouseDown={stopMouse}>
            <div className="markdown-toolbar-blocktype">
                <button
                    type="button"
                    className={"markdown-toolbar-btn markdown-toolbar-blocktype-btn" + (typeOpen ? " is-open" : "")}
                    onClick={() => setTypeOpen((v) => !v)}
                    title="Turn into"
                >
                    {blockLabel} ▾
                </button>
                {typeOpen && (
                    <div className="markdown-toolbar-blocktype-menu" role="menu">
                        {blockItems.map((item) => (
                            <button
                                key={item.id}
                                type="button"
                                className={"markdown-toolbar-blocktype-item" + (item.active ? " is-active" : "")}
                                disabled={!item.enabled}
                                onClick={() => {
                                    setTypeOpen(false);
                                    onBlockType(item.id);
                                }}
                            >
                                {item.active ? "✓ " : ""}
                                {item.label}
                            </button>
                        ))}
                    </div>
                )}
            </div>
            <span className="markdown-toolbar-divider" />
            {styles.map((s) => (
                <button
                    key={s.id}
                    type="button"
                    className={"markdown-toolbar-btn" + (s.active ? " is-active" : "")}
                    title={`${s.label}${s.hint ? ` (${s.hint})` : ""}`}
                    onClick={() => onStyle(s.id)}
                >
                    {STYLE_GLYPHS[s.id]}
                </button>
            ))}
        </div>,
        document.body
    );
}
