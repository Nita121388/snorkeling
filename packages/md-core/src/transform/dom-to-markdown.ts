// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * DOM → markdown serialization for WYSIWYG block editing (方案 08).
 *
 * The WYSIWYG editor edits RENDERED content (a contentEditable clone of the
 * rendered block), so on commit the DOM must be serialized back to markdown
 * source. This module is the single source of truth for that serialization:
 *
 *   - `serializeInlineChildren(el, opts)` — inline content (strong/em/del/code/a/
 *     img/br). Shared with the table-cell serializer (table-cell.ts delegates
 *     here with cell-specific escaping opts) so the two WYSIWYG surfaces never
 *     drift.
 *   - `serializeBlockDomToMarkdown(rootEl, ctx)` — block-level serialization for
 *     paragraph / heading / list / quote / blank. Re-emits the block markers
 *     (`#`, `- `, `1. `, `> `) that the rendered DOM does NOT contain.
 *
 * Only a whitelist of inline tags round-trips; everything else flattens to its
 * text, which also makes pasted rich HTML inert (no script/style survives).
 */

export interface InlineSerializeOpts {
    /** Escape `|` to `\|` (pipe-table cells only). Default false. */
    escapePipe?: boolean;
    /** What a `<br>` serializes to. Table cells use "<br>"; prose uses "\n". */
    brToken?: string;
}

const DEFAULT_INLINE_OPTS: Required<InlineSerializeOpts> = {
    escapePipe: false,
    brToken: "\n",
};

/** Escape a plain-text run for placement inside a pipe-table cell. */
export function escapeTableCellText(text: string): string {
    return text.replace(/\|/g, "\\|").replace(/\r\n|\r|\n/g, "<br>");
}

function escapeCodeSpan(text: string): string {
    const runs: string[] = text.match(/`+/g) ?? [];
    const fence = "`".repeat(runs.reduce((m, r) => Math.max(m, r.length), 0) + 1);
    const needsPad = text.startsWith("`") || text.endsWith("`");
    const inner = needsPad ? ` ${text} ` : text;
    return `${fence}${inner}${fence}`;
}

function escapeRun(text: string, opts: Required<InlineSerializeOpts>): string {
    if (!opts.escapePipe) {
        return text;
    }
    return escapeTableCellText(text);
}

function serializeChildren(el: Element, opts: Required<InlineSerializeOpts>): string {
    let out = "";
    const children = Array.from(el.childNodes);
    for (let i = 0; i < children.length; i++) {
        const child = children[i];
        // `<br>` 之后的行首空白在 HTML 里会被折叠掉（white-space: normal 行首去空白）。
        // remark 把软换行渲染成 `<br>\n`，于是「一个换行」在 DOM 里有两个信号。
        // 不剥掉就会数成两次换行 —— 实测事故：在位编辑 callout 后失焦提交，
        // 写盘源文件里凭空多出一行裸 `>`（引用块把空行渲染为 `>`），且不可逆。
        //
        // 只剥**紧随 br 之后**的空白：普通文本里的空格仍是内容。
        if (child.nodeType === 3) {
            let text = child.textContent ?? "";
            if (children[i - 1]?.nodeName === "BR") {
                text = text.replace(/^[ \t\r\n]+/, "");
            }
            out += escapeRun(text, opts);
            continue;
        }
        out += serializeNode(child, opts);
    }
    return out;
}

/** Wrap inner unless empty, so deleting a bold run doesn't leave `****` ghost markup. */
function wrap(marker: string, inner: string): string {
    return inner === "" ? "" : `${marker}${inner}${marker}`;
}

/**
 * 解析**原始** wiki 链接源码 `[[target#heading|label]]` 的三个部分。
 *
 * 与 `parseMarkdownWikiLink` 的关键区别：**不补 `.md`**、**不把 label 补成 target**。
 * 那两个“补全”对导航是对的（用户写 `[[note]]` 也能打开 note.md），但对**往返保真**是灾难：
 * `[[note]]` 会被还原成 `[[note.md]]` —— 语义相同，用户文件却被改写了。
 * 保真优先，所以这里只做语法拆分，不做任何规范化。
 *
 * 原文没写 label 时，渲染出来的可见文本等于 target，所以这里把 label 补成 target ——
 * 这样才能在序列化时正确识别「用户没改过链接文字」。
 */
function parseRawWikiLink(source: string): { target: string; label: string; heading?: string } | null {
    const inner = source.slice(2, -2).trim();
    if (inner === "") {
        return null;
    }
    const [targetAndHeading, labelPart] = inner.split("|", 2);
    const [targetPart, headingPart] = targetAndHeading.split("#", 2);
    const target = targetPart?.trim() ?? "";
    if (target === "") {
        return null;
    }
    const label = labelPart == null ? "" : labelPart.trim();
    return {
        target,
        label: label === "" ? target : label,
        heading: headingPart?.trim() || undefined,
    };
}


function serializeNode(node: ChildNode, opts: Required<InlineSerializeOpts>): string {
    if (node.nodeType === 3) {
        return escapeRun(node.textContent ?? "", opts);
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
            return opts.brToken;
        case "STRONG":
        case "B":
            return wrap("**", serializeChildren(el, opts));
        case "EM":
        case "I":
            return wrap("*", serializeChildren(el, opts));
        case "DEL":
        case "S":
        case "STRIKE":
            return wrap("~~", serializeChildren(el, opts));
        case "CODE":
            return escapeCodeSpan(el.textContent ?? "");
        case "A": {
            // wiki 链接优先用 remark 层挂上来的**原始源码**逐字节还原（见 markdown-file-refs.ts）。
            // href 不能反向重建：`[[note]]` 会被写成 `[[note.md]]` —— 语义同但**改写了用户文件**。
            //
            // 但 verbatim 有一条必须守住的边界：**只有当用户没改过链接文字时才逐字输出**。
            // 否则用户把显示名改成「别的」而 href 没变，verbatim 会把他们的修改**静默丢弃**。
            // 判定「改过没」= 当前 DOM 文本 ≠ 原始源码里的 label（下方解析）。
            const sourceMarkdown = el.getAttribute("data-source-markdown");
            if (sourceMarkdown != null && sourceMarkdown.startsWith("[[")) {
                const inner = serializeChildren(el, opts);
                const original = parseRawWikiLink(sourceMarkdown);
                if (original != null) {
                    if (inner === original.label) {
                        return sourceMarkdown; // 未动 → 逐字节保真
                    }
                    // 改了显示名：目标与锚点保持不变，只换 label（删空则退回无 label 形式）。
                    const targetPart =
                        original.heading != null && original.heading !== ""
                            ? `${original.target}#${original.heading}`
                            : original.target;
                    return inner.trim() === "" ? `[[${targetPart}]]` : `[[${targetPart}|${inner}]]`;
                }
            }
            const inner = serializeChildren(el, opts);
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
        case "INPUT": {
            // Task-list checkboxes are handled by the list serializer's prefix logic
            // (see serializeListDomToMarkdown), not the inline path. Non-checkbox
            // inputs (read-only chrome in the preview) have no markdown equivalent.
            return "";
        }
        case "DIV":
        case "P":
        case "LI":
        case "BLOCKQUOTE":
            // Block containers introduced by Enter inside contentEditable stand for a
            // line break; the trailing token collapses with trailing/dup cleanup below.
            return serializeChildren(el, opts) + opts.brToken;
        case "UL":
        case "OL":
            return serializeChildren(el, opts);
        default:
            // SPAN / FONT / MARK / KBD / unknown wrappers: unwrap, keep the content.
            return serializeChildren(el, opts);
    }
}

/**
 * Serialize the inline content of an element (no block markers). Used by the
 * table-cell serializer and by block serialization below.
 */
export function serializeInlineChildren(el: Element, opts?: InlineSerializeOpts): string {
    return serializeChildren(el, { ...DEFAULT_INLINE_OPTS, ...opts });
}

// ---------------------------------------------------------------------------
// Block-level serialization (WYSIWYG prose editing)
// ---------------------------------------------------------------------------

export type WysiwygBlockKind = "p" | "h" | "list" | "quote" | "blank";

export interface BlockDomCtx {
    kind: WysiwygBlockKind;
    /** Heading level 1-6 (kind === "h"). */
    headingLevel?: number;
    /**
     * Preserved original list marker: the bullet char ("-", "*", "+") for bulleted
     * lists, or the ordered counter head ("1.", "1)") for ordered lists. Emitted
     * verbatim so git diffs stay minimal (a `*` list stays `*`, a `1)` list stays
     * `1)`).
     */
    listMarker?: string;
}

/** Prefix written before a rendered heading's text (empty title → bare markers). */
function headingPrefix(level: number): string {
    return "#".repeat(Math.max(1, Math.min(6, level)));
}

/** Serialize a rendered list item's inline content, EXCLUDING nested lists. */
function serializeLiContent(li: HTMLElement, opts: Required<InlineSerializeOpts>): string {
    let out = "";
    for (const child of Array.from(li.childNodes)) {
        if (child.nodeType === 1) {
            const tag = (child as HTMLElement).tagName;
            if (tag === "UL" || tag === "OL") {
                continue; // nested lists are emitted as indented lines separately
            }
        }
        out += serializeNode(child, opts);
    }
    return out;
}

/**
 * Serialize a `<ul>`/`<ol>` element into markdown list lines. Nested lists indent
 * by two spaces per level. `ordered` and the marker style come from the ORIGINAL
 * source (preserved in the session) rather than the DOM — the DOM only knows it's
 * an ordered/unordered list, not which bullet char or counter style the author
 * chose.
 */
export function serializeListDomToMarkdown(rootEl: Element, ordered: boolean, marker: string): string {
    const opts: Required<InlineSerializeOpts> = { ...DEFAULT_INLINE_OPTS };
    const lines: string[] = [];

    const emitList = (listEl: Element, depth: number, isOrdered: boolean, counter: number) => {
        // F1: 按 `children` 顺序遍历（而不是先 filter 出 li），因为浏览器
        // `document.execCommand("indent")` 产出的嵌套列表会**直接挂在 ul/ol 下**、不在
        // 任何 li 里。老实现只遍历 `li`，这种子树既不在 items 里、也不会被任何 li 的递归
        // 访问到 → 整棵子树被静默丢弃（实测：Tab 缩进后提交，源码少一项）。
        let n = counter;
        let emittedItem = false;
        for (const child of Array.from(listEl.children)) {
            const tag = child.tagName;
            if (tag === "LI") {
                const li = child as HTMLElement;
                const indent = "  ".repeat(depth);
                const checkbox = li.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
                let prefix: string;
                if (isOrdered) {
                    prefix = `${n}. `;
                    n++;
                } else {
                    prefix = `${marker} `;
                }
                if (checkbox != null) {
                    prefix += checkbox.checked ? "[x] " : "[ ] ";
                }
                // Rendered task items carry a space between the checkbox and its text
                // ("<input> text") — strip it so the serialized line stays clean
                // "- [ ] text" instead of "- [ ]  text".
                const content = serializeLiContent(li, opts)
                    .replace(new RegExp(opts.brToken + "+$"), "")
                    .replace(/^\s+/, "");
                lines.push(indent + prefix + content);
                emittedItem = true;
                // Nested list: re-indent under this item. Ordered nested lists restart at 1.
                for (const nested of Array.from(li.children)) {
                    const nestedTag = nested.tagName;
                    if (nestedTag === "UL") {
                        emitList(nested, depth + 1, false, 1);
                    } else if (nestedTag === "OL") {
                        emitList(nested, depth + 1, true, 1);
                    }
                }
                continue;
            }
            if (tag === "UL" || tag === "OL") {
                // 游离（非规范）子列表：必须输出，绝不丢弃。缩进一层（跟随上一个已输出的项）；
                // 若它出现在第一个 li 之前（没有可寄宿的前项），按同级输出以免误缩进。
                emitList(child, depth + (emittedItem ? 1 : 0), tag === "OL", 1);
            }
        }
    };

    emitList(rootEl, 0, ordered, 1);
    return lines.join("\n");
}

/**
 * Serialize a block's contentEditable DOM back to markdown source. `rootEl` is the
 * editor's root element (a div for p/h/blank/quote, a `<ul>`/`<ol>` for lists).
 */
export function serializeBlockDomToMarkdown(rootEl: Element, ctx: BlockDomCtx): string {
    const opts: Required<InlineSerializeOpts> = { ...DEFAULT_INLINE_OPTS };
    if (ctx.kind === "list") {
        // The WYSIWYG editor root is a div; the rendered <ul>/<ol> lives inside.
        const listEl = rootEl.querySelector("ul, ol") ?? rootEl;
        const ordered = listEl.tagName === "OL" || listEl.getAttribute("data-ordered") === "true";
        const marker = ctx.listMarker ?? (ordered ? "1." : "-");
        return serializeListDomToMarkdown(listEl, ordered, marker);
    }
    if (ctx.kind === "h") {
        const level = ctx.headingLevel ?? 1;
        let inner = serializeInlineChildren(rootEl, opts);
        inner = inner.replace(new RegExp(opts.brToken + "+$"), "");
        const prefix = headingPrefix(level);
        return inner.length > 0 ? `${prefix} ${inner}` : prefix;
    }
    if (ctx.kind === "quote") {
        // A quote whose editor root holds SEVERAL block children (paragraphs produced by the
        // renderer, or <div>s the browser inserts on Enter) must re-emit the bare ">" separator
        // between them. Collapsing them into consecutive "> text" lines makes the re-parsed
        // source ONE paragraph with a soft break — which merges every body paragraph into the
        // callout title span / first quote line. That is a content change, not cosmetics.
        const blockChildren = Array.from(rootEl.children).filter(
            (child) => child.tagName === "P" || child.tagName === "DIV"
        );
        if (blockChildren.length > 1) {
            return blockChildren
                .map((child) => {
                    const blockInner = serializeInlineChildren(child, opts).replace(
                        new RegExp(opts.brToken + "+$"),
                        ""
                    );
                    return blockInner
                        .split(opts.brToken)
                        .map((line) => (line.length === 0 ? ">" : `> ${line}`))
                        .join("\n");
                })
                .join("\n>\n");
        }
        let inner = serializeInlineChildren(rootEl, opts);
        inner = inner.replace(new RegExp(opts.brToken + "+$"), "");
        inner = inner.replace(new RegExp(opts.brToken, "g"), "\n");
        // Blank lines inside a quote need a bare ">" to stay within the quote.
        return inner
            .split("\n")
            .map((line) => (line.length === 0 ? ">" : `> ${line}`))
            .join("\n");
    }
    // p / blank: plain inline content. Trailing breaks (Enter pressed once then
    // thought better of it) commit nothing.
    let inner = serializeInlineChildren(rootEl, opts);
    inner = inner.replace(new RegExp(opts.brToken + "+$"), "");
    return inner;
}

// ---------------------------------------------------------------------------
// Re-export the table-cell entry point so callers keep one import surface.
// ---------------------------------------------------------------------------

/** Serialize a rendered table cell's DOM back to its markdown cell text (trimmed). */
export function tableCellDomToMarkdown(cell: HTMLElement): string {
    let out = serializeInlineChildren(cell, { escapePipe: true, brToken: "<br>" });
    // Enter inserts <div><br></div>-shaped splits; collapse break runs and drop trailing
    // breaks so a "press Enter then think better of it" gesture commits nothing.
    out = out.replace(/(?:<br>)+$/g, "");
    out = out.replace(/^(?:<br>)+/g, "");
    return out.trim();
}
