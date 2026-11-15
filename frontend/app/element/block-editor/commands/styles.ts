// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { InlineStyleSpec } from "../registry";

/** Built-in inline styles for the floating toolbar + ⌘ shortcuts (方案 03 §1).
 *  The apply/strip logic lives in markdown-transform/inline-style.ts; these are just
 *  display descriptors, so the toolbar can stay a dumb renderer. */
export function builtinInlineStyles(): InlineStyleSpec[] {
    return [
        { id: "bold", label: "Bold", labelKey: "block-editor:inlineStyle.bold", hint: "⌘B" },
        { id: "italic", label: "Italic", labelKey: "block-editor:inlineStyle.italic", hint: "⌘I" },
        { id: "strike", label: "Strikethrough", labelKey: "block-editor:inlineStyle.strike", hint: "⌘⇧X" },
        { id: "code", label: "Inline Code", labelKey: "block-editor:inlineStyle.code", hint: "⌘`" },
        { id: "link", label: "Link", labelKey: "block-editor:inlineStyle.link", hint: "⌘K" },
        { id: "kbd", label: "Kbd", labelKey: "block-editor:inlineStyle.kbd" },
    ];
}
