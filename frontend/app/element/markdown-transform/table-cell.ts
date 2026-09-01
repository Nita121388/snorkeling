// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Cell DOM → markdown serialization (M7: WYSIWYG cell editing). While a table cell is
 * contentEditable its DOM holds RENDERED inline content (e.g. <strong>, not `**`); on
 * commit the cell is serialized back to markdown source. Only a whitelist of inline tags
 * round-trips — everything else flattens to its text, which also makes pasted rich HTML
 * inert (no script/style survives).
 *
 * Line breaks inside a cell serialize as `<br>` (valid in GFM tables, rendered verbatim
 * by remark); `|` typed by the user is escaped to `\|`.
 */

/** Escape a plain-text run for placement inside a pipe-table cell. */
export function escapeTableCellText(text: string): string {
    return text.replace(/\|/g, "\\|").replace(/\r\n|\r|\n/g, "<br>");
}

function escapeCodeSpan(text: string): string {
    const runs = text.match(/`+/g) ?? [];
    const fence = "`".repeat(runs.reduce((m, r) => Math.max(m, r.length), 0) + 1);
    const needsPad = text.startsWith("`") || text.endsWith("`");
    const inner = needsPad ? ` ${text} ` : text;
    return `${fence}${inner}${fence}`;
}

function serializeChildren(el: Element): string {
    let out = "";
    for (const child of Array.from(el.childNodes)) {
        out += serializeNode(child);
    }
    return out;
}

/** Wrap inner unless empty, so deleting a bold run doesn't leave `****` ghost markup. */
function wrap(marker: string, inner: string): string {
    return inner === "" ? "" : `${marker}${inner}${marker}`;
}

const BLOCK_LIKE_SUFFIX = "<br>";

function serializeNode(node: ChildNode): string {
    if (node.nodeType === 3) {
        return escapeTableCellText(node.textContent ?? "");
    }
    if (node.nodeType !== 1) {
        return "";
    }
    const el = node as HTMLElement;
    const tag = el.tagName;
    switch (tag) {
        case "SCRIPT":
        case "STYLE":
            return "";
        case "BR":
            return BLOCK_LIKE_SUFFIX;
        case "STRONG":
        case "B":
            return wrap("**", serializeChildren(el));
        case "EM":
        case "I":
            return wrap("*", serializeChildren(el));
        case "DEL":
        case "S":
        case "STRIKE":
            return wrap("~~", serializeChildren(el));
        case "CODE":
            return escapeCodeSpan(el.textContent ?? "");
        case "A": {
            const inner = serializeChildren(el);
            const href = el.getAttribute("href") ?? "";
            if (inner === "") {
                return "";
            }
            return href === "" ? inner : `[${inner}](${href})`;
        }
        case "IMG": {
            const imgEl = el as HTMLImageElement;
            const src = imgEl.getAttribute("src") ?? "";
            if (src === "") {
                return "";
            }
            const alt = (imgEl.getAttribute("alt") ?? "").replace(/[[\]]/g, "");
            return `![${alt}](${src})`;
        }
        case "DIV":
        case "P":
        case "LI":
            // Block containers introduced by Enter inside contentEditable stand for a
            // line break; the trailing marker collapses with trailing/dup cleanup below.
            return serializeChildren(el) + BLOCK_LIKE_SUFFIX;
        case "UL":
        case "OL":
            return serializeChildren(el);
        default:
            // SPAN / FONT / MARK / KBD / unknown wrappers: unwrap, keep the content.
            return serializeChildren(el);
    }
}

/** Serialize a rendered table cell's DOM back to its markdown cell text (trimmed). */
export function tableCellDomToMarkdown(cell: HTMLElement): string {
    let out = serializeChildren(cell);
    // Enter inserts <div><br></div>-shaped splits; collapse break runs and drop trailing
    // breaks so a "press Enter then think better of it" gesture commits nothing.
    out = out.replace(/(?:<br>)+$/g, "");
    out = out.replace(/^(?:<br>)+/g, "");
    return out.trim();
}
