// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Cell DOM → markdown serialization (M7: WYSIWYG cell editing). While a table cell is
 * contentEditable its DOM holds RENDERED inline content (e.g. <strong>, not `**`); on
 * commit the cell is serialized back to markdown source. Only a whitelist of inline tags
 * round-trips — everything else flattens to its text, which also makes pasted rich HTML
 * inert (no script/style survives).
 *
 * The actual serialization lives in the shared module `dom-to-markdown.ts` (方案 08);
 * this file only supplies the cell-specific options (pipe escaping, `<br>` line breaks)
 * and keeps the public entry points used by the table editor.
 *
 * Line breaks inside a cell serialize as `<br>` (valid in GFM tables, rendered verbatim
 * by remark); `|` typed by the user is escaped to `\|`.
 */

import { serializeInlineChildren, escapeTableCellText } from "./dom-to-markdown";

export { escapeTableCellText };

/** Serialize a rendered table cell's DOM back to its markdown cell text (trimmed). */
export function tableCellDomToMarkdown(cell: HTMLElement): string {
    let out = serializeInlineChildren(cell, { escapePipe: true, brToken: "<br>" });
    // Enter inserts <div><br></div>-shaped splits; collapse break runs and drop trailing
    // breaks so a "press Enter then think better of it" gesture commits nothing.
    out = out.replace(/(?:<br>)+$/g, "");
    out = out.replace(/^(?:<br>)+/g, "");
    return out.trim();
}
