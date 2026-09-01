// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// =============================================================================
// NOTE SURFACE — primary editing surface of the note system.
//
// This component renders markdown as rich HTML AND serves as the live, inline-
// editable note editor. It is NOT a generic markdown renderer and NOT the same
// layer as the source editor (preview-edit.tsx / Monaco), which edits raw
// markdown as code. Two paradigms edit the same file:
//   - Source editor  : raw text, code-style (Cmd+E toggle).
//   - Note surface   : rendered, WYSIWYG-ish, click/dblclick-to-edit inline.
//
// COORDINATE CONTRACT (read before touching edit logic):
//   Every editable block in the rendered tree carries `data-source-line`
//   (+ optional `data-source-line-end` for multi-line blocks). This attribute
//   IS the bridge between the DOM and the markdown source. All edits resolve a
//   block via [data-source-line] then rewrite source through the pure helpers
//   in markdown-inline-edit.tsx (replaceSourceRange / spliceInsertBlock /
//   commitPlaceholderBlock / splitBlockAtCaretText). Do NOT invent new ways to
//   locate blocks.
//
// EXTENSION POINTS (prefer reusing these over adding parallel top-level handlers):
//   - Block kinds   : InlineEditBlockKind union (markdown-inline-edit.tsx).
//   - Click gestures: handleInlineEditClick / DblClick / MouseDown.
//   - Edit session  : useInlineEdit (beginEdit / commit / cancel lifecycle).
//
// EDGE CASE — empty-space click: a click that resolves to NO [data-source-line]
// block (the blank area below the rendered content, or the left gutter) is a
// defined case, not an oversight. See handleInlineEditClick's empty-space
// branch (cursor falls to the last line so the user can keep writing).
// =============================================================================

import { CopyButton } from "@/app/element/copybutton";
import { ImageLightbox } from "@/app/element/image-lightbox";
import {
    computeCollapsedHiddenFlags,
    findCollapsedScrollPinIndex,
} from "@/app/element/markdown-collapse";
import {
    InlineEditOverlay,
    isSelectingRange,
    makeInlineEditKeydown,
    deleteBlockRange,
    placeholderForBlockKind,
    replaceSourceRange,
    spliceInsertBlock,
    splitBlockAtCaretText,
    inlineEditDebug,
    makeListItemInsertMarker,
    splitListItemDraft,
    moveBlockRange,
    expandBlockSelection,
    useInlineEdit,
    type InlineEditBlockKind,
} from "@/app/element/markdown-inline-edit";
import { MarkdownOutline, type MarkdownOutlineItem } from "@/app/element/markdown-outline";
import {
    getPreviousOrderedListContinuation,
    normalizeOrderedListNumbering,
    renumberOrderedListBlockAtLine,
    setOrderedListMarkerNumberAtLine,
} from "@/app/element/markdown-ordered-list";
import {
    replaceLinkInSource,
    wikiTargetFromHref,
    type LinkEditRequest,
} from "@/app/element/markdown-link-edit";
import { toggleTaskCheckboxAtLine } from "@/app/element/markdown-task-toggle";
import { applyTypingPatternAtLine, detectBlockKind, type BlockKind } from "@/app/element/markdown-transform/block-type";
import { detectInlineTrigger } from "@/app/element/markdown-transform/triggers";
import { applyInlineStyle, hasInlineStyle, type InlineStyleId } from "@/app/element/markdown-transform/inline-style";
import { setCodeBlockLanguage } from "@/app/element/markdown-transform/code-block";
import {
    caretToTableCoord,
    deleteTableColumn,
    deleteTableRow,
    getColumnAlign,
    insertTableColumn,
    insertTableRow,
    setColumnAlign,
} from "@/app/element/markdown-transform/table";
import {
    buildEmojiPickerItems,
    emojiPickerEntries,
    getLoadedEmojiCatalog,
    getRecentEmojis,
    loadEmojiCatalog,
    recordRecentEmoji,
    type EmojiCatalog,
    type EmojiEntry,
} from "@/app/element/markdown-transform/emoji";
import { getFrontmatterEmoji, setFrontmatterEmoji } from "@/app/element/markdown-transform/doc-meta";
import { ensureBuiltinBlockEditorCommands } from "@/app/element/block-editor/commands/builtin";
import {
    execSlashCommand,
    lineStartOffset,
    transformSessionBlock,
} from "@/app/element/block-editor/exec";
import {
    filterSlashCommands,
    isBlockActionEnabled,
    listBlockActions,
    listInlineStyles,
    listSlashCommands,
    normalizeSlashCommandResult,
    runBlockAction,
    type BlockCtx,
    type OpenPickerResult,
    type SlashCommandSpec,
    type TextReplaceResult,
} from "@/app/element/block-editor/registry";
import { SlashPalette } from "@/app/element/block-editor/components/slash-palette";
import { FloatingToolbar } from "@/app/element/block-editor/components/floating-toolbar";
import { EmojiPicker } from "@/app/element/block-editor/components/emoji-picker";
import { TableToolbar, type TableOp } from "@/app/element/block-editor/components/table-toolbar";
import { TableBlock, TableEditContext, type TableEditContextValue, type TableCellFocus } from "@/app/element/block-editor/components/table-block";
import { DocEmojiHeader } from "@/app/element/block-editor/components/doc-emoji-header";
import { isBlockEditorFeatureEnabled } from "@/app/element/block-editor/flags";
import {
    MarkdownContentBlockType,
    editImageSyntaxInFullText,
    parseImageSizeSuffix,
    removeImageSizeInLine,
    removeImageSyntaxInLine,
    replaceImageSrcInLine,
    resolveRemoteFile,
    resolveSrcSet,
    transformBlocks,
    updateImageSizeInLine,
} from "@/app/element/markdown-util";
import { makeRemarkPlugins } from "@/app/element/remark";
import remarkFrontmatterToWaveBlock from "@/app/element/remark/frontmatter-to-waveblock";
export { linkifyMarkdownFileReferences } from "@/app/element/remark";
import { getMarkdownHeadings } from "@/app/monaco/markdown-folding";
import { boundNumber, cn, useAtomValueSafe } from "@/util/util";
import clsx from "clsx";
import { atom, Atom, useAtomValue } from "jotai";
import { loadable } from "jotai/utils";
import ReactDOM from "react-dom";

// Stable no-op atom used when callers omit `textAtom` — keeps the `useAtomValue(loadable(...))`
// call unconditional so the Rules of Hooks remain satisfied below.
const NullStringAtom = atom<string | null>(null);
import { OverlayScrollbarsComponent, OverlayScrollbarsComponentRef } from "overlayscrollbars-react";
import {
    Children,
    cloneElement,
    createContext,
    isValidElement,
    useCallback,
    useContext,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import ReactMarkdown, { Components, defaultUrlTransform } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import { openLink } from "../store/global";
import { ContextMenuModel } from "../store/contextmenu";
import { RpcApi } from "../store/wshclientapi";
import { TabRpcClient } from "../store/wshrpcutil";
import { formatRemoteUri } from "@/util/waveutil";
import { arrayToBase64, stringToBase64 } from "@/util/util";
import {
    makeMarkdownWikiLinkHref,
    normalizeLinkedFilePath,
    openFileLinkInPreview,
    parseMarkdownFileLineReference,
    parseMarkdownWikiLink,
} from "../view/preview/file-link-navigation";
import { IconButton } from "./iconbutton";
import { buildCopyContextText } from "./selection-copy-overlay";
import "./markdown.scss";

// Block-editor (方案 06): register built-in capabilities (M1 Turn-into ▸, later slash /
// inline styles) into the L1.5 registry exactly once for this module instance.
ensureBuiltinBlockEditorCommands();

function isLiveScrollDebugEnabled(): boolean {
    return typeof window !== "undefined" && window.localStorage?.getItem("snorkelingLiveScrollDebug") === "1";
}

function liveScrollDebug(message: string, details: Record<string, unknown> = {}) {
    if (!isLiveScrollDebugEnabled()) {
        return;
    }
    console.info("[live-scroll]", message, details);
}

// Soft-breaks, file-refs, and blank-line spacers live in the remark/ directory
// (`frontend/app/element/remark/`) so new pipeline stages can be added without
// growing this file. `makeRemarkPlugins` assembles the full chain.

export function shouldOpenMarkdownLinkInNewBlock(event: Pick<React.MouseEvent, "ctrlKey" | "metaKey">): boolean {
    return event.ctrlKey || event.metaKey;
}

let mermaidInitialized = false;
let mermaidInstance: any = null;

const initializeMermaid = async () => {
    if (!mermaidInitialized) {
        const mermaid = await import("mermaid");
        mermaidInstance = mermaid.default;
        mermaidInstance.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" });
        mermaidInitialized = true;
    }
};

const Link = ({
    focusHeading,
    props,
    resolveOpts,
    onHoverIn,
    onHoverOut,
}: {
    props: React.AnchorHTMLAttributes<HTMLAnchorElement>;
    focusHeading: (href: string) => void;
    resolveOpts?: MarkdownResolveOpts;
    /** Hover-intent hooks for the link action tooltip (markup ⑥). Undefined = no tooltip. */
    onHoverIn?: (el: HTMLAnchorElement, nodeOffsets?: { start?: number; end?: number }) => void;
    onHoverOut?: () => void;
}) => {
    // Hast node position (offsets into the ORIGINAL source text) rides along with hover, so
    // the link editor can splice this exact span even when the block holds duplicate links.
    const nodePos = (props as any)?.node?.position;
    const nodeOffsets =
        nodePos?.start?.offset != null && nodePos?.end?.offset != null
            ? { start: nodePos.start.offset, end: nodePos.end.offset }
            : undefined;
    const onClick = (e: React.MouseEvent) => {
        const href = props.href ?? "";
        const forceNewBlock = shouldOpenMarkdownLinkInNewBlock(e);
        const onOpenPath = resolveOpts?.openLink
            ? (path: string, lineNumber: number | null) =>
                  resolveOpts.openLink(path, { lineNumber, forceNewBlock })
            : undefined;
        e.preventDefault();
        if (href.startsWith("#")) {
            focusHeading(href);
        } else {
            const wikiLink = parseMarkdownWikiLink(href);
            if (wikiLink != null) {
                void openFileLinkInPreview(wikiLink.target, {
                    connection: resolveOpts?.connName,
                    baseDir: resolveOpts?.baseDir,
                    openDirectoryIndex: true,
                    heading: wikiLink.heading,
                    onOpenPath,
                }).then((opened) => {
                    if (!opened) {
                        openLink(href);
                    }
                });
                return;
            }
            const fileReference = parseMarkdownFileLineReference(href);
            void openFileLinkInPreview(fileReference?.filePath ?? href, {
                connection: resolveOpts?.connName,
                baseDir: resolveOpts?.baseDir,
                openDirectoryIndex: true,
                lineNumber: fileReference?.lineNumber,
                onOpenPath,
            }).then((opened) => {
                if (!opened) {
                    openLink(href);
                }
            });
        }
    };
    return (
        <a
            href={props.href}
            title={typeof props.href === "string" ? props.href : undefined}
            onClick={onClick}
            className="text-accent hover:underline"
            onMouseEnter={
                onHoverIn != null ? (e) => onHoverIn(e.currentTarget, nodeOffsets) : undefined
            }
            onMouseLeave={onHoverOut}
        >
            {props.children}
        </a>
    );
};

const FilePathHrefProtocols = [
    ...(defaultSchema.protocols?.href ?? []),
    "file",
    ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
];

function markdownUrlTransform(value: string): string {
    if (value.startsWith("wave-wiki:")) {
        return value;
    }
    if (normalizeLinkedFilePath(value) != null) {
        return value;
    }
    return defaultUrlTransform(value);
}

function decodeHeadingFragment(fragment: string): string {
    try {
        return decodeURIComponent(fragment);
    } catch {
        return fragment;
    }
}

function getHeadingIdFromHref(idPrefix: string, href: string): string {
    return idPrefix + decodeHeadingFragment(href.slice(1));
}

const ScrollTargetTopOffset = 24;
const ScrollTargetTolerancePx = 3;
const ProgrammaticScrollIgnoreMs = 120;
const InitialScrollRevealFallbackMs = 150;
const ScrollTextMatchWindow = 4;
const BottomCompensationStepPx = 80;

function normalizeScrollTargetText(text: string): string {
    return text
        .replace(/^[\s#>*+\-.`~[\]()!]+/, "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}

function getElementTextForScrollMatch(elem: HTMLElement): string {
    return normalizeScrollTargetText(elem.textContent ?? "");
}

const InlineEditAutosaveDebounceMs = 1500;

const LinkTooltipSafeZonePadPx = 8;

/** True when (x, y) is inside `rect` expanded by `pad` px on every side. */
function pointInExpandedRect(x: number, y: number, rect: DOMRect, pad: number): boolean {
    return x >= rect.left - pad && x <= rect.right + pad && y >= rect.top - pad && y <= rect.bottom + pad;
}

function getSourceLine(props: any): number | undefined {
    const line = props?.node?.position?.start?.line;
    return Number.isInteger(line) && line > 0 ? line : undefined;
}

// End line of the source span. Multi-line blocks (paragraphs/soft-broken across several
// source lines) get end > start; single-line blocks have end === start. Falls back to the
// start line so callers that only want the start can ignore the end entirely.
function getSourceLineEnd(props: any): number | undefined {
    const start = getSourceLine(props);
    if (start == null) {
        return undefined;
    }
    const end = props?.node?.position?.end?.line;
    return Number.isInteger(end) && (end as number) >= start ? (end as number) : start;
}

// Emits both data-source-line (start) and, when distinct, data-source-line-end. The inline
// edit overlay reads the end attribute to slice multi-line paragraphs/headings back into a
// matching source range — without it a soft-broken paragraph collapses to its first line.
function sourceLineAttrs(sourceLine?: number, endLine?: number): Record<string, number> {
    if (sourceLine == null) {
        return {};
    }
    const attrs: Record<string, number> = { "data-source-line": sourceLine };
    if (endLine != null && endLine !== sourceLine) {
        attrs["data-source-line-end"] = endLine;
    }
    return attrs;
}

// Convenience: derive {data-source-line, [data-source-line-end]} from a rehype node's position
// in one call. Use this at every block element that participates in inline editing so the
// start+end pair stays consistent across p/h/ul/ol/li/table/pre — adding a new block kind is
// a one-line `srcLineAttrs(props)` spread, no need to remember the end-attr fallback.
function srcLineAttrs(props: any): Record<string, number> {
    return sourceLineAttrs(getSourceLine(props), getSourceLineEnd(props));
}

// Pure planner for the block-edge "+" buttons on a LIST ITEM (ordered "N." or bullet "-/*").
//
// List items must NOT use the generic blank-row insert: blank lines inside a list render as
// nothing (remark blank-line spacers are injected between top-level blocks only), so the
// follow-up inline editor could never anchor on them — every mid-list insert silently
// reverted ("+ button does nothing" bug). Instead we insert a REAL sibling marker row
// ("4. " / "- ") which renders as a genuine empty <li>, giving the editor a real anchor.
//
// Callers guarantee startLine is the <li>'s FIRST source line (el.dataset.sourceLine), so no
// upward scan is needed — we only measure how far the item extends downward so "below"
// lands after the WHOLE item (multi-line / soft-broken items), never mid-item.
// Returns null when the line has no list marker — caller falls back to the generic insert.
export function computeListInsertAnchor(
    text: string,
    startLine: number,
    mode: "before" | "after"
): { insertAtLine: number; prefillMarker: string } | null {
    const sourceLines = text.split(/\r\n|\n/);
    const markerLine = sourceLines[Math.max(0, Math.min(startLine - 1, sourceLines.length - 1))] ?? "";
    const markerMatch = markerLine.match(/^(\s*)(\d+[.)]|[-+*])(\s+)/);
    if (markerMatch == null) {
        return null;
    }
    const indent = markerMatch[1].length;
    // Item extends over following lines until a sibling/shallower marker, a heading, or
    // (after a blank run) shallower-or-equal content — mirrors makeOrderedListItem's rules.
    let endLine = startLine;
    let pendingBlank = false;
    for (let idx = startLine; idx < sourceLines.length; idx++) {
        const line = sourceLines[idx];
        if (line.trim() === "") {
            pendingBlank = true;
            continue;
        }
        if (/^#{1,6}\s+/.test(line.trimStart())) break;
        const leading = line.match(/^\s*/)?.[0].length ?? 0;
        if (/^(\s*)(\d+[.)]|[-+*])(\s+)/.test(line) && leading <= indent) break;
        if (pendingBlank && leading <= indent) break;
        pendingBlank = false;
        endLine = idx + 1;
    }
    // Marker derives from the ITEM'S OWN first line: a multi-line item's continuation rows
    // carry no marker, so anchoring on them yielded an empty prefill.
    return {
        insertAtLine: mode === "before" ? startLine : endLine + 1,
        prefillMarker: makeListItemInsertMarker(markerLine, mode),
    };
}

const OrderedListContext = createContext(false);

function getTextContent(children: React.ReactNode): string {
    if (typeof children === "string" || typeof children === "number") {
        return String(children);
    }
    if (Array.isArray(children)) {
        return children.map(getTextContent).join("");
    }
    if (isValidElement(children)) {
        return getTextContent((children.props as { children?: React.ReactNode }).children);
    }
    return "";
}

function isLineBreakNode(node: React.ReactNode): boolean {
    return isValidElement(node) && node.type === "br";
}

function isBlankTextNode(node: React.ReactNode): boolean {
    return typeof node === "string" && node.trim().length === 0;
}

function trimBlankTextNodes(children: React.ReactNode[]): React.ReactNode[] {
    let startIndex = 0;
    let endIndex = children.length;
    while (startIndex < endIndex && isBlankTextNode(children[startIndex])) {
        startIndex++;
    }
    while (endIndex > startIndex && isBlankTextNode(children[endIndex - 1])) {
        endIndex--;
    }
    return children.slice(startIndex, endIndex);
}

function cloneWithChildren(element: React.ReactElement, children: React.ReactNode[]): React.ReactElement {
    return cloneElement(
        element as React.ReactElement<{ children?: React.ReactNode }>,
        undefined,
        children.length === 1 ? children[0] : children
    );
}

function splitChildrenAtFirstBreak(children: React.ReactNode): {
    before: React.ReactNode[];
    after: React.ReactNode[];
} | null {
    const childArray = Children.toArray(children);
    const breakIndex = childArray.findIndex(isLineBreakNode);
    if (breakIndex < 0) {
        return null;
    }
    return {
        before: childArray.slice(0, breakIndex),
        after: childArray.slice(breakIndex + 1),
    };
}

export function splitOrderedListItemChildren(children: React.ReactNode): {
    summaryChildren: React.ReactNode[];
    bodyChildren: React.ReactNode[];
} {
    const childArray = trimBlankTextNodes(Children.toArray(children));
    if (childArray.length === 0) {
        return { summaryChildren: [], bodyChildren: [] };
    }

    // 紧凑列表（tight list）里 react-markdown 不会把 li 内容包成 <p>，
    // children 直接是 inline 序列 [text, code, text, ...]，可能夹杂 <br/>。
    // 我们对 children 数组本身直接按第一个 <br/> 切分：
    //   - 找到 br：br 之前是 summary，br 之后是 body（"soft break → 可折叠"语义）
    //   - 找不到 br：整段是 summary，没有 body（不要把"第一个 inline 节点之后"
    //     当成 body，那样会把紧跟 text 的 inline code 错误地切下去——见 repro）。
    // 对宽松列表（li 第一个孩子是 <p>），<p>.children 同样按这个规则切，
    // 因此先 unwrap paragraph 再 split，行为统一。
    //
    // 关键修复：br 之后的内容如果包含 <ul>/<ol> 等块级列表节点，
    // 它们会被 cloneWithChildren 错误地保留在 summary 中（因为它们
    // 出现在 br 之后、第一个非空文本之前）。这里在切分后、构建 summary
    // 之前，把 after 中开头的所有块级列表节点移到 body 头部，
    // 确保 summary 只包含内联文本。
    const firstChild = childArray[0];
    let inlineChildren: React.ReactNode[];
    let wrapper: React.ReactElement | null = null;
    if (isValidElement(firstChild) && firstChild.type === "p") {
        const paragraphChildren = Children.toArray((firstChild.props as { children?: React.ReactNode }).children);
        inlineChildren = paragraphChildren;
        wrapper = firstChild;
    } else {
        inlineChildren = childArray;
    }

    const breakIndex = inlineChildren.findIndex(isLineBreakNode);
    if (breakIndex < 0) {
        // 无 br：整段做 summary，无 body。tight list 的"shell `fork` 出..."
        // 不会被错误地从第一个 inline code 处切开。
        const summaryChildren = wrapper != null ? [cloneWithChildren(wrapper, inlineChildren)] : inlineChildren;
        return {
            summaryChildren: trimBlankTextNodes(summaryChildren),
            bodyChildren: [],
        };
    }

    const splitAfter = inlineChildren.slice(breakIndex + 1);
    const hasBody = splitAfter.some((child) => getTextContent(child).trim().length > 0);
    if (!hasBody) {
        // br 之后是空：整段做 summary。
        const summaryChildren = wrapper != null
            ? [cloneWithChildren(wrapper, inlineChildren.slice(0, breakIndex))]
            : inlineChildren.slice(0, breakIndex);
        return {
            summaryChildren: trimBlankTextNodes(summaryChildren),
            bodyChildren: [],
        };
    }

    const before = inlineChildren.slice(0, breakIndex);
    const after = inlineChildren.slice(breakIndex + 1);
    // Move any leading block-level list nodes from after into bodyHead.
    // These are <ul>/<ol> that were siblings of the <br/> and must not
    // end up in the summary (cloneWithChildren preserves them in summary).
    let bodyHead: React.ReactNode[] = [];
    let afterForSummary = after;
    while (afterForSummary.length > 0) {
        const node = afterForSummary[0];
        if (isValidElement(node) && (node.type === "ul" || node.type === "ol")) {
            bodyHead.push(afterForSummary.shift()!);
        } else {
            break;
        }
    }
    const summaryChildren = wrapper != null ? [cloneWithChildren(wrapper, before)] : before;
    // body 拼接规则：
    //   - loose list（wrapper != null）：inlineChildren = unwrap(<p>) 的内部 children，
    //     只覆盖第一个 <p> 里的内容；<li> 顶层兄弟（如子列表 <ul>）由 childArray.slice(1) 补回。
    //   - tight list（wrapper == null）：inlineChildren = childArray 本身，
    //     <br/> 之后的 after 已经包含所有顶层节点（含子列表 <ul>），再 concat(childArray.slice(1)) 会重复。
    const bodyBase = bodyHead.concat(
        wrapper != null ? [cloneWithChildren(wrapper, afterForSummary)] : afterForSummary
    );
    const bodyChildren = trimBlankTextNodes(
        wrapper != null ? bodyBase.concat(childArray.slice(1)) : bodyBase
    );
    return {
        summaryChildren: trimBlankTextNodes(summaryChildren),
        bodyChildren,
    };
}

function getOrderedListItemId(props: React.LiHTMLAttributes<HTMLLIElement>): string {
    const sourceLine = getSourceLine(props);
    if (sourceLine != null) {
        return String(sourceLine);
    }
    return getTextContent(props.children);
}

type HeadingProps = {
    props: React.HTMLAttributes<HTMLHeadingElement>;
    hnum: number;
    collapsed: boolean;
    onToggle: (headingId: string) => void;
};

const CollapsibleHeading = ({ props, hnum, collapsed, onToggle }: HeadingProps) => {
    const headingId = typeof props.id === "string" ? props.id : "";
    return (
        <div
            id={props.id}
            className={clsx("heading", `is-${hnum}`, { collapsed })}
            data-heading-level={hnum}
            data-heading-id={headingId}
            {...srcLineAttrs(props)}
        >
            <button
                type="button"
                className="heading-collapse-button"
                title={collapsed ? "Expand section" : "Collapse section"}
                aria-label={collapsed ? "Expand section" : "Collapse section"}
                onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (headingId) {
                        onToggle(headingId);
                    }
                }}
            >
                <i className={clsx("fa-sharp fa-solid", collapsed ? "fa-chevron-right" : "fa-chevron-down")} />
            </button>
            <span className="heading-title">{props.children}</span>
        </div>
    );
};

const MarkdownOrderedList = ({
    props,
    collapsible,
}: {
    props: React.OlHTMLAttributes<HTMLOListElement>;
    collapsible: boolean;
}) => (
    <OrderedListContext.Provider value={collapsible}>
        <ol {...props} {...srcLineAttrs(props)} />
    </OrderedListContext.Provider>
);

const MarkdownUnorderedList = (props: React.HTMLAttributes<HTMLUListElement>) => (
    <OrderedListContext.Provider value={false}>
        <ul {...props} {...srcLineAttrs(props)} />
    </OrderedListContext.Provider>
);

const CollapsibleOrderedListItem = ({
    props,
    collapsed,
    onToggle,
}: {
    props: React.LiHTMLAttributes<HTMLLIElement>;
    collapsed: boolean;
    onToggle: (itemId: string) => void;
}) => {
    const sourceLine = getSourceLine(props);
    const itemId = getOrderedListItemId(props);
    const { summaryChildren, bodyChildren } = splitOrderedListItemChildren(props.children);
    const canCollapse = bodyChildren.length > 0 && itemId.length > 0;
    if (!canCollapse) {
        return <li {...props} {...srcLineAttrs(props)} />;
    }
    return (
        <li
            {...props}
            {...srcLineAttrs(props)}
            className={clsx(props.className, "ordered-list-collapsible", { collapsed })}
        >
            <div className="ordered-list-summary-row">
                <button
                    type="button"
                    className="ordered-list-collapse-button"
                    title={collapsed ? "Expand list item" : "Collapse list item"}
                    aria-label={collapsed ? "Expand list item" : "Collapse list item"}
                    onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onToggle(itemId);
                    }}
                >
                    <i className={clsx("fa-sharp fa-solid", collapsed ? "fa-chevron-right" : "fa-chevron-down")} />
                </button>
                <div className="ordered-list-summary-content">{summaryChildren}</div>
            </div>
            {collapsed ? null : <div className="ordered-list-collapse-body">{bodyChildren}</div>}
        </li>
    );
};

// Dismiss-on-scroll link action tooltip. Measures its own width after mount, flips above the
// anchor when the bottom would overflow. Rendered via portal — styling lives at top level in
// markdown.scss (.markdown-link-tooltip).
type MarkdownLinkTooltipProps = {
    anchor: HTMLAnchorElement;
    onOpen: () => void;
    onEdit?: () => void;
    onMouseEnter: () => void;
    onMouseLeave: () => void;
    /** Optional external ref — the host uses it to compute the hover safe-zone rect. */
    rootRef?: React.RefObject<HTMLDivElement | null>;
};

function MarkdownLinkTooltip({ anchor, onOpen, onEdit, onMouseEnter, onMouseLeave, rootRef }: MarkdownLinkTooltipProps) {
    const innerRef = useRef<HTMLDivElement>(null);
    const wrapRef = rootRef ?? innerRef;
    const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
    const [copied, setCopied] = useState(false);
    const href = anchor.getAttribute("href") ?? "";

    useLayoutEffect(() => {
        const el = wrapRef.current;
        if (el == null) {
            return;
        }
        const rect = anchor.getBoundingClientRect();
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        let left = rect.left + rect.width / 2 - w / 2;
        left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
        let top = rect.bottom + 2;
        if (top + h > window.innerHeight - 8) {
            top = Math.max(8, rect.top - h - 2); // flip above
        }
        setPos({ top, left });
    }, [anchor]);

    const copyHref = () => {
        navigator.clipboard.writeText(href);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
    };

    return (
        <div
            ref={wrapRef}
            className="markdown-link-tooltip"
            style={{
                top: pos?.top ?? -9999,
                left: pos?.left ?? -9999,
                visibility: pos != null ? "visible" : "hidden",
            }}
            role="dialog"
            aria-label="Link actions"
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
        >
            <button type="button" onClick={onOpen} title="Open link" aria-label="Open link">
                <i className="fa-sharp fa-solid fa-arrow-up-right-from-square" />
            </button>
            {onEdit != null && (
                <button type="button" onClick={onEdit} title="Edit link" aria-label="Edit link">
                    <i className="fa-sharp fa-solid fa-pen" />
                </button>
            )}
            <button
                type="button"
                onClick={copyHref}
                title={copied ? "Copied" : "Copy link"}
                aria-label={copied ? "Link copied" : "Copy link"}
            >
                <i className={`fa-sharp fa-solid ${copied ? "fa-check" : "fa-copy"}`} />
            </button>
        </div>
    );
}

// Link edit form popover (feature ⑥ refinement). Two plain inputs — 显示文本 + 链接地址 — so
// users never touch `[label](url)` syntax. Wiki links (`[[target]]`) show a single 目标 field.
type MarkdownLinkEditorProps = {
    anchor: HTMLAnchorElement;
    mode: "markdown" | "wiki";
    initialLabel: string;
    initialUrl: string;
    onSave: (label: string, url: string) => void;
    onCancel: () => void;
};

function MarkdownLinkEditor({ anchor, mode, initialLabel, initialUrl, onSave, onCancel }: MarkdownLinkEditorProps) {
    const wrapRef = useRef<HTMLDivElement>(null);
    const firstInputRef = useRef<HTMLInputElement>(null);
    const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
    const [label, setLabel] = useState(initialLabel);
    const [url, setUrl] = useState(initialUrl);
    const isWiki = mode === "wiki";

    useLayoutEffect(() => {
        const el = wrapRef.current;
        if (el == null) {
            return;
        }
        const rect = anchor.getBoundingClientRect();
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        let left = rect.left + rect.width / 2 - w / 2;
        left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
        let top = rect.bottom + 2;
        if (top + h > window.innerHeight - 8) {
            top = Math.max(8, rect.top - h - 2); // flip above
        }
        setPos({ top, left });
    }, [anchor]);

    useEffect(() => {
        firstInputRef.current?.focus();
        firstInputRef.current?.select();
    }, []);

    const submit = () => {
        const nextUrl = url.trim();
        const nextLabel = label.trim();
        if (nextUrl === "" || (!isWiki && nextLabel === "")) {
            return; // empty form = treated as cancel, never write a broken link
        }
        onSave(nextLabel, nextUrl);
    };

    return (
        <div
            ref={wrapRef}
            className="markdown-link-editor"
            style={{
                top: pos?.top ?? -9999,
                left: pos?.left ?? -9999,
                visibility: pos != null ? "visible" : "hidden",
            }}
            role="dialog"
            aria-label="Edit link"
            // Keep the markdown root's click/dblclick handlers from firing while the form is up.
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
                if (e.key === "Escape") {
                    e.stopPropagation();
                    onCancel();
                } else if (e.key === "Enter") {
                    e.preventDefault();
                    e.stopPropagation();
                    submit();
                }
            }}
        >
            <div className="markdown-link-editor-header">
                <span>Edit link</span>
                <button type="button" className="markdown-link-editor-close" onClick={onCancel} aria-label="Close">
                    <i className="fa-sharp fa-solid fa-xmark" />
                </button>
            </div>
            {isWiki ? (
                <label className="markdown-link-editor-field">
                    <span>Target</span>
                    <input ref={firstInputRef} value={url} onChange={(e) => setUrl(e.target.value)} />
                </label>
            ) : (
                <>
                    <label className="markdown-link-editor-field">
                        <span>Text</span>
                        <input ref={firstInputRef} value={label} onChange={(e) => setLabel(e.target.value)} />
                    </label>
                    <label className="markdown-link-editor-field">
                        <span>URL</span>
                        <input value={url} onChange={(e) => setUrl(e.target.value)} />
                    </label>
                </>
            )}
            <div className="markdown-link-editor-actions">
                <button type="button" className="markdown-link-editor-save" onClick={submit}>
                    Save
                </button>
                <button type="button" className="markdown-link-editor-cancel" onClick={onCancel}>
                    Cancel
                </button>
            </div>
        </div>
    );
}

const MarkdownListItem = ({
    props,
    collapsed,
    onToggle,
}: {
    props: React.LiHTMLAttributes<HTMLLIElement>;
    collapsed: boolean;
    onToggle: (itemId: string) => void;
}) => {
    const orderedListCollapsible = useContext(OrderedListContext);
    if (orderedListCollapsible) {
        return <CollapsibleOrderedListItem props={props} collapsed={collapsed} onToggle={onToggle} />;
    }
    return <li {...props} {...srcLineAttrs(props)} />;
};

// Clickable task-list checkbox (Note surface). The parent <li> carries data-source-line;
// the click flips `[ ]` ⇄ `[x]` on exactly that source line via the caller's commit path —
// no editor session, no full-document re-serialization. Only mounted when the Markdown
// instance got onInlineEditCommit, so read-only contexts (vdom, AI panels) keep the default
// disabled checkbox.
const MarkdownTaskCheckbox = ({
    props,
    onToggle,
}: {
    props: React.InputHTMLAttributes<HTMLInputElement>;
    onToggle: (line: number) => void;
}) => {
    return (
        <input
            type="checkbox"
            checked={Boolean(props.checked)}
            readOnly
            className="markdown-task-checkbox"
            aria-label="Toggle task"
            onClick={(e) => {
                e.preventDefault(); // checkbox state derives from source text, not the DOM
                e.stopPropagation(); // don't bubble into the click-to-edit handler
                const li = (e.target as HTMLElement).closest("li[data-source-line]");
                const line = Number((li as HTMLElement | null)?.dataset?.sourceLine);
                if (Number.isFinite(line) && line > 0) {
                    onToggle(line);
                }
            }}
        />
    );
};

const CollapsibleTable = ({
    props,
    collapsed,
    onToggle,
}: {
    props: React.HTMLAttributes<HTMLTableElement>;
    collapsed: boolean;
    onToggle: () => void;
}) => {
    return (
        <div className={clsx("table-wrapper", { collapsed })} {...srcLineAttrs(props)}>
            <button
                type="button"
                className="table-collapse-button"
                title={collapsed ? "Expand table" : "Collapse table"}
                aria-label={collapsed ? "Expand table" : "Collapse table"}
                onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onToggle();
                }}
            >
                <i className={clsx("fa-sharp fa-solid", collapsed ? "fa-chevron-right" : "fa-chevron-down")} />
            </button>
            <table {...props} />
        </div>
    );
};

const Mermaid = ({ chart }: { chart: string }) => {
    const ref = useRef<HTMLDivElement>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const renderMermaid = async () => {
            try {
                setIsLoading(true);
                setError(null);

                await initializeMermaid();
                if (!ref.current || !mermaidInstance) {
                    return;
                }

                // Normalize the chart text
                const normalizedChart = chart
                    .replace(/<br\s*\/?>/gi, "\n") // Convert <br/> and <br> to newlines
                    .replace(/\r\n?/g, "\n") // Normalize \r \r\n to \n
                    .replace(/\n+$/, ""); // Remove final newline

                ref.current.removeAttribute("data-processed");
                ref.current.textContent = normalizedChart;
                // console.log("mermaid", normalizedChart);
                await mermaidInstance.run({ nodes: [ref.current] });
                setIsLoading(false);
            } catch (err) {
                console.error("Error rendering mermaid diagram:", err);
                setError(`Failed to render diagram: ${err.message || err}`);
                setIsLoading(false);
            }
        };

        renderMermaid();
    }, [chart]);

    useEffect(() => {
        if (!ref.current) return;

        if (error) {
            ref.current.textContent = `Error: ${error}`;
            ref.current.className = "mermaid error";
        } else if (isLoading) {
            ref.current.textContent = "Loading diagram...";
            ref.current.className = "mermaid";
        } else {
            ref.current.className = "mermaid";
        }
    }, [isLoading, error]);

    return <div className="mermaid" ref={ref} />;
};

const Code = ({ className = "", children }: { className?: string; children: React.ReactNode }) => {
    if (/\blanguage-mermaid\b/.test(className)) {
        const text = Array.isArray(children) ? children.join("") : String(children ?? "");
        return <Mermaid chart={text} />;
    }
    return <code className={className}>{children}</code>;
};

type CodeBlockProps = {
    children: React.ReactNode;
    onClickExecute?: (cmd: string) => void;
    sourceLine?: number;
    sourceLineEnd?: number;
    /** Detected fence language (from the <code> child's className); null when unset. */
    language?: string | null;
    /** When provided the language badge becomes an editable affordance (方案 04 §2). */
    onApplyLanguage?: (lang: string | null) => void;
};

const CodeBlock = ({ children, onClickExecute, sourceLine, sourceLineEnd, language, onApplyLanguage }: CodeBlockProps) => {
    const [editingLang, setEditingLang] = useState(false);
    const [langDraft, setLangDraft] = useState("");
    const getTextContent = (children: any): string => {
        if (typeof children === "string") {
            return children;
        } else if (Array.isArray(children)) {
            return children.map(getTextContent).join("");
        } else if (children.props && children.props.children) {
            return getTextContent(children.props.children);
        }
        return "";
    };

    const handleCopy = async (e: React.MouseEvent) => {
        let textToCopy = getTextContent(children);
        textToCopy = textToCopy.replace(/\n$/, ""); // remove trailing newline
        await navigator.clipboard.writeText(textToCopy);
    };

    const handleExecute = (e: React.MouseEvent) => {
        let textToCopy = getTextContent(children);
        textToCopy = textToCopy.replace(/\n$/, ""); // remove trailing newline
        if (onClickExecute) {
            onClickExecute(textToCopy);
            return;
        }
    };

    return (
        <pre className="codeblock" {...sourceLineAttrs(sourceLine, sourceLineEnd)}>
            {children}
            <div className="codeblock-actions">
                {/* Language badge (方案 04 §2): click → inline input → Enter applies via a
                    one-line fence rewrite (setCodeBlockLanguage), Esc/blur cancels. */}
                {editingLang ? (
                    <input
                        className="codeblock-lang-input"
                        autoFocus
                        value={langDraft}
                        placeholder="language"
                        onChange={(e) => setLangDraft(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                e.preventDefault();
                                onApplyLanguage?.(langDraft.trim() || null);
                                setEditingLang(false);
                            } else if (e.key === "Escape") {
                                e.preventDefault();
                                setEditingLang(false);
                            }
                        }}
                        onBlur={() => setEditingLang(false)}
                        onClick={(e) => e.stopPropagation()}
                    />
                ) : onApplyLanguage != null ? (
                    <button
                        type="button"
                        className="codeblock-lang-badge"
                        title="Set language"
                        onClick={(e) => {
                            e.stopPropagation();
                            setLangDraft(language ?? "");
                            setEditingLang(true);
                        }}
                    >
                        {language ?? "text"}
                    </button>
                ) : (
                    language != null && <span className="codeblock-lang-badge is-static">{language}</span>
                )}
                <CopyButton onClick={handleCopy} title="Copy" />
                {onClickExecute && (
                    <IconButton
                        decl={{
                            elemtype: "iconbutton",
                            icon: "regular@square-terminal",
                            click: handleExecute,
                        }}
                    />
                )}
            </div>
        </pre>
    );
};

const MarkdownAnchorSwitchDelayMs = 180;

const MarkdownSource = ({
    props,
    resolveOpts,
}: {
    props: React.HTMLAttributes<HTMLSourceElement> & {
        srcSet?: string;
        media?: string;
    };
    resolveOpts: MarkdownResolveOpts;
}) => {
    const [resolvedSrcSet, setResolvedSrcSet] = useState<string>(props.srcSet);
    const [resolving, setResolving] = useState<boolean>(true);

    useEffect(() => {
        const resolvePath = async () => {
            const resolved = await resolveSrcSet(props.srcSet, resolveOpts);
            setResolvedSrcSet(resolved);
            setResolving(false);
        };

        resolvePath();
    }, [props.srcSet]);

    if (resolving) {
        return null;
    }

    return <source srcSet={resolvedSrcSet} media={props.media} />;
};

interface WaveBlockProps {
    blockkey: string;
    blockmap: Map<string, MarkdownContentBlockType>;
    /** Optional: delegate rendering by block type (e.g. Obsidian properties card). */
    renderers?: Record<string, (block: MarkdownContentBlockType) => React.ReactNode>;
}

function WaveBlock(props: WaveBlockProps) {
    const { blockkey, blockmap, renderers } = props;
    const block = blockmap.get(blockkey);
    if (block == null) {
        return null;
    }
    const renderer = renderers?.[block.type];
    if (renderer) {
        return <>{renderer(block)}</>;
    }
    const sizeInKB = Math.round((block.content.length / 1024) * 10) / 10;
    const displayName = block.id.replace(/^"|"$/g, "");
    return (
        <div className="waveblock">
            <div className="wave-block-content">
                <div className="wave-block-icon">
                    <i className="fas fa-file-code"></i>
                </div>
                <div className="wave-block-info">
                    <span className="wave-block-filename">{displayName}</span>
                    <span className="wave-block-size">{sizeInKB} KB</span>
                </div>
            </div>
        </div>
    );
}

const MarkdownImg = ({
    props,
    resolveOpts,
    fullText,
    onInlineEditCommit,
}: {
    props: React.ImgHTMLAttributes<HTMLImageElement>;
    resolveOpts: MarkdownResolveOpts;
    // Source text + commit channel for edit operations ("edit path" / "delete image").
    // LivePreview omits onInlineEditCommit, so its images are view/copy only.
    fullText?: string;
    onInlineEditCommit?: (newFullText: string) => void;
}) => {
    const [resolvedSrc, setResolvedSrc] = useState<string>(props.src);
    const [resolvedSrcSet, setResolvedSrcSet] = useState<string>(props.srcSet);
    const [resolvedStr, setResolvedStr] = useState<string>(null);
    const [resolving, setResolving] = useState<boolean>(true);
    const [lightboxOpen, setLightboxOpen] = useState(false);
    const [pathInputOpen, setPathInputOpen] = useState(false);
    const [copied, setCopied] = useState(false);
    const [copiedFull, setCopiedFull] = useState(false);
    const [inputPos, setInputPos] = useState<{ top: number; left: number } | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const imgRef = useRef<HTMLImageElement | null>(null);
    const [newPath, setNewPath] = useState("");

    // --- Image resize state ---
    const { src: rawImgSrc, width: initWidth, height: initHeight } = parseImageSizeSuffix(props.src);
    const [imgWidth, setImgWidth] = useState<number | null>(initWidth);
    const [imgHeight, setImgHeight] = useState<number | null>(initHeight);
    const [isResizing, setIsResizing] = useState(false);
    const [showResizeHandle, setShowResizeHandle] = useState(false);
    const resizeRef = useRef<{
        startX: number;
        startY: number;
        origW: number;
        origH: number;
        maintainAspect: boolean;
        currentW: number;
        currentH: number;
    } | null>(null);
    const resizeTooltipRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (rawImgSrc.startsWith("data:image/")) {
            setResolving(false);
            setResolvedSrc(rawImgSrc);
            setResolvedStr(null);
            return;
        }
        if (resolveOpts == null) {
            setResolving(false);
            setResolvedSrc(null);
            setResolvedStr(`[img:${rawImgSrc}]`);
            return;
        }

        const resolveFn = async () => {
            const [resolvedSrc, resolvedSrcSet] = await Promise.all([
                resolveRemoteFile(rawImgSrc, resolveOpts),
                resolveSrcSet(props.srcSet, resolveOpts),
            ]);

            setResolvedSrc(resolvedSrc);
            setResolvedSrcSet(resolvedSrcSet);
            setResolvedStr(null);
            setResolving(false);
        };
        resolveFn();
    }, [rawImgSrc, props.srcSet]);

    // Sync size state when the source image path or size suffix changes (e.g., file reload,
    // undo, or another editor changing the size).
    useEffect(() => {
        const { width, height } = parseImageSizeSuffix(props.src);
        setImgWidth(width);
        setImgHeight(height);
    }, [props.src]);

    // Only real, loadable images participate in the lightbox / context menu. Placeholder
    // ([img:...]) and data-URI images are excluded from edit ops but data: URIs still zoom.
    const imageUsable = resolvedStr == null && resolvedSrc != null;
    // Edit ops need the source line (from the rehype node position) plus the commit channel.
    // rehype attaches the source position to the hast node; ImgHTMLAttributes doesn't
    // type it, so reach through a cast (mirrors getSourceLine's `props: any`).
    const nodePos = (props as any)?.node?.position;
    const sourceLine = nodePos?.start?.line;
    const sourceSrc = rawImgSrc;

    // Edit ops need the source line (from the rehype node position) plus the commit channel.
    // (data: URI images have no source line and are excluded from edit ops.)
    const canEdit = fullText != null && onInlineEditCommit != null && sourceLine != null;

    const openPathInput = () => {
        const rect = imgRef.current?.getBoundingClientRect();
        if (rect == null) {
            return;
        }
        setInputPos({ top: rect.bottom + 4, left: rect.left });
        setNewPath(sourceSrc);
        setPathInputOpen(true);
    };

    const commitPathEdit = () => {
        if (!canEdit || sourceLine == null) {
            return;
        }
        const newText = editImageSyntaxInFullText(fullText, sourceLine, (lineText) =>
            replaceImageSrcInLine(lineText, sourceSrc, newPath.trim())
        );
        if (newText != null) {
            onInlineEditCommit(newText);
        }
        setPathInputOpen(false);
    };

    const deleteImage = () => {
        if (!canEdit || sourceLine == null) {
            return;
        }
        const newText = editImageSyntaxInFullText(fullText, sourceLine, (lineText) => {
            const removed = removeImageSyntaxInLine(lineText, sourceSrc);
            if (removed == null) {
                return null;
            }
            // The image syntax was the only content on its line: drop the whole line so
            // the surrounding text closes up. Otherwise keep the line minus the fragment.
            return removed.isEmpty ? "" : removed.text;
        });
        if (newText != null) {
            // No confirmation dialog: the edit lands in the shared draft (newFileContent)
            // and is Revert-able until Save, same safety net as paragraph inline editing.
            onInlineEditCommit(newText);
        }
        setPathInputOpen(false);
    };

    const copyImagePath = async () => {
        await navigator.clipboard.writeText(sourceSrc ?? "");
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
    };

    const copyImageFullPath = async () => {
        let fullPath = sourceSrc ?? "";
        // Resolve relative paths to absolute using baseDir from resolveOpts.
        // Skip absolute paths (Unix / or Windows C:\\) and remote URLs (http/https).
        if (
            resolveOpts?.baseDir &&
            fullPath &&
            !fullPath.startsWith("/") &&
            !fullPath.match(/^[A-Z]:\\\\/i) &&
            !fullPath.startsWith("http://") &&
            !fullPath.startsWith("https://")
        ) {
            fullPath = `${resolveOpts.baseDir}/${fullPath}`;
        }
        await navigator.clipboard.writeText(fullPath);
        setCopiedFull(true);
        window.setTimeout(() => setCopiedFull(false), 1200);
    };

    // --- Image resize handlers ---
    const commitImageSize = useCallback(
        (width: number, height: number) => {
            if (!canEdit || sourceLine == null) {
                return;
            }
            const newText = editImageSyntaxInFullText(fullText, sourceLine, (lineText) =>
                updateImageSizeInLine(lineText, sourceSrc, width, height)
            );
            if (newText != null) {
                onInlineEditCommit(newText);
            }
        },
        [canEdit, sourceLine, fullText, sourceSrc, onInlineEditCommit]
    );

    const clearImageSize = useCallback(() => {
        if (!canEdit || sourceLine == null) {
            return;
        }
        const newText = editImageSyntaxInFullText(fullText, sourceLine, (lineText) =>
            removeImageSizeInLine(lineText, sourceSrc)
        );
        if (newText != null) {
            onInlineEditCommit(newText);
        }
        setImgWidth(null);
        setImgHeight(null);
    }, [canEdit, sourceLine, fullText, sourceSrc, onInlineEditCommit]);

    const handleResizeMouseDown = useCallback(
        (e: React.MouseEvent) => {
            if (!canEdit || !imgRef.current) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            const img = imgRef.current;
            const currentW = imgWidth ?? img.naturalWidth ?? img.offsetWidth;
            const currentH = imgHeight ?? img.naturalHeight ?? img.offsetHeight;
            resizeRef.current = {
                startX: e.clientX,
                startY: e.clientY,
                origW: currentW,
                origH: currentH,
                maintainAspect: e.shiftKey,
                currentW,
                currentH,
            };
            setIsResizing(true);

            const onMouseMove = (ev: MouseEvent) => {
                const ref = resizeRef.current;
                if (ref == null) {
                    return;
                }
                const dx = ev.clientX - ref.startX;
                const newW = Math.max(20, Math.round(ref.origW + dx));
                let newH: number;
                if (ref.maintainAspect && ref.origW > 0) {
                    newH = Math.max(20, Math.round((newW / ref.origW) * ref.origH));
                } else {
                    newH = ref.origH;
                }
                ref.currentW = newW;
                ref.currentH = newH;
                setImgWidth(newW);
                setImgHeight(newH);
            };

            const onMouseUp = () => {
                setIsResizing(false);
                const ref = resizeRef.current;
                resizeRef.current = null;
                window.removeEventListener("mousemove", onMouseMove);
                window.removeEventListener("mouseup", onMouseUp);
                // Commit the final size to the markdown source.
                if (ref != null && ref.currentW != null && ref.currentH != null) {
                    commitImageSize(ref.currentW, ref.currentH);
                }
            };

            window.addEventListener("mousemove", onMouseMove);
            window.addEventListener("mouseup", onMouseUp);
        },
        [canEdit, imgWidth, imgHeight, commitImageSize]
    );

    const handleImgClick = (e: React.MouseEvent) => {
        if (!imageUsable) {
            return;
        }
        // An image wrapped in a link ([![alt](img)](url)) keeps the link's navigation;
        // the lightbox is reachable via the context menu in that case.
        if ((e.target as HTMLElement).closest("a") != null) {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        setLightboxOpen(true);
    };

    const handleImgContextMenu = (e: React.MouseEvent) => {
        if (!imageUsable) {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        const menu: ContextMenuItem[] = [
            { label: "Zoom in", click: () => setLightboxOpen(true) },
            { label: "Copy image path", click: () => void copyImagePath() },
            { label: "Copy full image path", click: () => void copyImageFullPath() },
        ];
        if (canEdit) {
            menu.push({ type: "separator" });
            if (imgWidth != null) {
                menu.push({ label: "Reset image size", click: clearImageSize });
            }
            menu.push({ label: "Edit path", click: openPathInput });
            menu.push({ label: "Delete image", click: deleteImage });
        }
        ContextMenuModel.getInstance().showContextMenu(menu, e);
    };

    if (resolving) {
        return null;
    }
    if (resolvedStr != null) {
        return <span>{resolvedStr}</span>;
    }
    if (resolvedSrc != null) {
        const imgStyle: React.CSSProperties = {};
        if (imgWidth != null) {
            imgStyle.width = imgWidth;
        }
        if (imgHeight != null) {
            imgStyle.height = imgHeight;
        }
        const hasResize = canEdit;
        return (
            <>
                <span
                    className={cn(
                        "markdown-img-wrapper",
                        hasResize && "markdown-img-resizable",
                        isResizing && "resizing"
                    )}
                    onMouseEnter={() => hasResize && !isResizing && setShowResizeHandle(true)}
                    onMouseLeave={() => !isResizing && setShowResizeHandle(false)}
                >
                    <img
                        ref={imgRef}
                        {...props}
                        src={resolvedSrc}
                        srcSet={resolvedSrcSet}
                        className={cn(props.className, "markdown-img-clickable")}
                        style={imgStyle}
                        onClick={handleImgClick}
                        onContextMenu={handleImgContextMenu}
                    />
                    {hasResize && (showResizeHandle || isResizing) && (
                        <div
                            className="markdown-img-resize-handle"
                            onMouseDown={handleResizeMouseDown}
                            title="Drag to resize (Shift = proportional)"
                        />
                    )}
                    {hasResize && imgWidth != null && (
                        <div className="markdown-img-size-actions">
                            <span className="markdown-img-size-badge">
                                {imgWidth}×{imgHeight ?? "auto"}
                            </span>
                            <button
                                className="markdown-img-size-clear"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    clearImageSize();
                                }}
                                title="Reset to natural size"
                                type="button"
                            >
                                ×
                            </button>
                        </div>
                    )}
                </span>
                {copied && <span className="markdown-img-copied">Path copied</span>}
                {copiedFull && <span className="markdown-img-copied">Full path copied</span>}
                {lightboxOpen && <ImageLightbox src={resolvedSrc} alt={props.alt} onClose={() => setLightboxOpen(false)} />}
                {pathInputOpen && inputPos != null &&
                    ReactDOM.createPortal(
                        <div className="markdown-img-path-input" style={{ top: inputPos.top, left: inputPos.left }}>
                            <input
                                ref={inputRef}
                                autoFocus
                                value={newPath}
                                spellCheck={false}
                                placeholder="Image path"
                                onChange={(e) => setNewPath(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                        commitPathEdit();
                                    } else if (e.key === "Escape") {
                                        setPathInputOpen(false);
                                    }
                                }}
                                onBlur={() => setPathInputOpen(false)}
                            />
                        </div>,
                        document.body
                    )}
            </>
        );
    }
    return <span>[img]</span>;
};

// === Markdown component + inline-edit logic (render helpers are above) =================

type MarkdownProps = {
    text?: string;
    textAtom?: Atom<string> | Atom<Promise<string>>;
    showTocAtom?: Atom<boolean>;
    style?: React.CSSProperties;
    className?: string;
    contentClassName?: string;
    onClickExecute?: (cmd: string) => void;
    resolveOpts?: MarkdownResolveOpts;
    scrollable?: boolean;
    rehype?: boolean;
    fontSizeOverride?: number;
    fixedFontSizeOverride?: number;
    scrollTargetLine?: number | null;
    scrollTargetText?: string | null;
    scrollTargetSourceState?: MarkdownScrollSourceState | null;
    scrollTargetBehavior?: ScrollBehavior;
    hideUntilInitialScroll?: boolean;
    onInitialScrollReady?: () => void;
    onUserScrollSourceLine?: (line: number) => void;
    collapsibleOrderedLists?: boolean;
    copyContextPath?: string;
    /**
     * Stable prefix for rehype-slug heading ids. When two Markdown instances render the same
     * md file, ids collide; when the *same* block is unmounted/remounted (tab switch) a random
     * prefix makes the persisted collapsedSet unmatchable. Pass a blockId+path-derived prefix
     * from preview-markdown so collapse state survives remount. Omit for one-shot renderers
     * (vdom, input modal) which keep the random default.
     */
    idPrefix?: string;
    /**
     * Controlled heading-collapse set (element ids). When provided, the Markdown instance seeds
     * its local state from this and reports each change back via onCollapsedHeadingsChange, so
     * the caller can persist across remounts. When omitted, the instance owns its own state.
     */
    collapsedHeadings?: Set<string>;
    onCollapsedHeadingsChange?: (next: Set<string>) => void;
    collapsedOrderedListItems?: Set<string>;
    onCollapsedOrderedListItemsChange?: (next: Set<string>) => void;
    collapsedTables?: Set<string>;
    onCollapsedTablesChange?: (next: Set<string>) => void;
    /**
     * Restore a saved viewport scrollTop (px) on mount, after scrollHeight stabilizes. Caller persists
     * live changes via onScrollTopChange so the value survives BlockInner remount on tab switch.
     * Honored only when no scrollTargetLine jump is pending (searchline meta takes precedence).
     */
    savedScrollTop?: number;
    onScrollTopChange?: (scrollTop: number) => void;
    /**
     * Invoked with the full new markdown text when the user commits an inline edit on a
     * paragraph or heading (dblclick → textarea → blur/Cmd+S/Cmd+Enter). The caller owns
     * "really save to disk" — this only stages the new text into the shared draft so the
     * existing Save/Revert flow picks it up. Omit to disable inline editing entirely.
     */
    onInlineEditCommit?: (newFullText: string) => void;
    /**
     * Optional: flush the staged inline-edit draft to disk. Triggered only when the user presses
     * ⌘/Ctrl+S inside the inline-edit textarea (after `onInlineEditCommit` has already written the
     * draft to the shared atom). Preview-mode callers wire `model.handleFileSave` here because no
     * global ⌘S listener runs in that view, so bubbling the keystroke would otherwise save nothing.
     */
    onInlineEditSave?: () => void;
    /**
     * When true, every successful inline-edit commit schedules a debounced flush-to-disk
     * (~1.5s trailing edge) through onInlineEditSave. Requires onInlineEditSave; without
     * it this flag is a no-op. Checkbox toggles always flush immediately themselves.
     */
    inlineEditAutosave?: boolean;
    /**
     * Optional: replace the frontmatter region [startLine..endLine] (1-based, inclusive) at the
     * mdast level with a waveblock node keyed by `blockKey`, and register that key in the content
     * block map with the given YAML text. The raw text and its line numbers are untouched, so
     * inline-edit coordinates stay valid and a commit never loses the frontmatter. Pair with
     * `waveBlockRenderers` to render the region as a custom component (e.g. Obsidian properties).
     */
    frontmatterBlock?: {
        startLine: number;
        endLine: number;
        yamlText: string;
        blockKey: string;
    } | null;
    /**
     * Optional: delegate content-block (waveblock) rendering by block.type. When a block matches,
     * the custom component renders instead of the default file-card.
     */
    waveBlockRenderers?: Record<string, (block: MarkdownContentBlockType) => React.ReactNode>;
};

type MarkdownScrollSourceState = {
    sequence: number;
    origin: "editor" | "preview" | "none";
    previewControlUntil: number;
    bottomScrollIntent: boolean;
    direction: "up" | "down" | "none";
    isAtBottom: boolean;
};

const Markdown = ({
    text,
    textAtom,
    showTocAtom,
    style,
    className,
    contentClassName,
    resolveOpts,
    fontSizeOverride,
    fixedFontSizeOverride,
    scrollTargetLine,
    scrollTargetText,
    scrollTargetSourceState,
    scrollTargetBehavior = "smooth",
    hideUntilInitialScroll = false,
    onInitialScrollReady,
    onUserScrollSourceLine,
    collapsibleOrderedLists = false,
    copyContextPath,
    onInlineEditCommit,
    inlineEditAutosave,
    onInlineEditSave,
    scrollable = true,
    rehype = true,
    onClickExecute,
    idPrefix: idPrefixProp,
    collapsedHeadings: collapsedHeadingsProp,
    onCollapsedHeadingsChange,
    collapsedOrderedListItems: collapsedOrderedListItemsProp,
    onCollapsedOrderedListItemsChange,
    collapsedTables: collapsedTablesProp,
    onCollapsedTablesChange,
    savedScrollTop,
    onScrollTopChange,
    frontmatterBlock,
    waveBlockRenderers,
}: MarkdownProps) => {
    // `fileContentAtom` is an async atom (Atom<Promise<string>>). On invalidation `useAtomValue`
    // throws the pending Promise → without a Suspense boundary above, ReactMarkdown's subtree
    // unmounts for one frame and the user sees "loading flash" then re-mount + scroll jump. Wrap
    // the atom in `loadable(...)` so the throw becomes a plain {state, data, error} object we can
    // read synchronously, and on the pending frame restream the last resolved string from a ref
    // so the ReactMarkdown DOM tree stays mounted and only the textarea's commit lands without a
    // blink. Writing the ref during render is fine here — assignment is idempotent (same string
    // each re-render) and free of side effects external to this hook.
    const textAtomLoadable = useAtomValue(loadable(textAtom ?? NullStringAtom));
    const lastResolvedTextRef = useRef<string | null>(null);
    let textAtomValue: string | undefined;
    if (textAtomLoadable != null) {
        if (textAtomLoadable.state === "hasData") {
            lastResolvedTextRef.current = textAtomLoadable.data;
            textAtomValue = textAtomLoadable.data;
        } else if (textAtomLoadable.state === "loading") {
            // pending: keep the ReactMarkdown subtree mounted on the previous content rather than
            // rendering empty — that's the frame that caused the loading-flash symptom on Save.
            textAtomValue = lastResolvedTextRef.current ?? undefined;
        } else {
            // hasError — fall through to the prop fallback so caller surfaces the error path.
            textAtomValue = undefined;
        }
    }
    const showToc = useAtomValueSafe(showTocAtom) ?? false;
    const contentsOsRef = useRef<OverlayScrollbarsComponentRef>(null);
    const programmaticScrollUntilRef = useRef(0);
    const lastAppliedScrollTargetRef = useRef<{ line: number; text: string } | null>(null);
    const lastViewportScrollTopRef = useRef(0);
    const previousTransformedTextRef = useRef<string | null>(null);
    const savedScrollTopAppliedRef = useRef(false);
    const scrollTopWriteRafRef = useRef<number | null>(null);
    // 上次应用到 DOM 的 collapsedHeadings 引用：用户 toggle 时 Set 引用变化，据此区分
    // 「真正的折叠/展开切换」（需要钉住阅读位置）与「remount/文本变化后的重新同步」
    // （只重新应用 class，不动滚动位置——后者由 transformedText 恢复逻辑负责）。
    const collapsedHeadingsPrevRef = useRef<Set<string> | null>(null);
    const [initialScrollReadyKey, setInitialScrollReadyKey] = useState<string | null>(null);
    const [focusedHeadingId, setFocusedHeadingId] = useState<string>(null);
    // Controlled seeding: when a caller persists collapse across remounts it passes a snapshot
    // captured at unmount as the initial here, plus an onChange callback to write back live.
    const [collapsedHeadings, setCollapsedHeadings] = useState<Set<string>>(
        () => collapsedHeadingsProp ?? new Set()
    );
    const [collapsedOrderedListItems, setCollapsedOrderedListItems] = useState<Set<string>>(
        () => collapsedOrderedListItemsProp ?? new Set()
    );
    const [collapsedTables, setCollapsedTables] = useState<Set<string>>(
        () => collapsedTablesProp ?? new Set()
    );

    // Ensure uniqueness of ids between MD preview instances. When the caller supplies a stable
    // idPrefix (blockId+path-derived) the persisted collapsedHeadings Set stays matchable across
    // remount; otherwise fall back to a per-instance random prefix.
    const [idPrefix] = useState<string>(() => idPrefixProp ?? crypto.randomUUID());

    text = textAtomValue ?? text ?? "";
    // useMemo 稳定 transformedOutput/contentBlocksMap 引用：鼠标移动（handleRootMouseOver →
    // setInsertAnchor）、滚动（measureInsertAnchor → setInsertPos）等无关重渲染不改变 text，
    // memo 命中后下游 waveblock 委托引用稳定，React 保留波块子树实例，块内组件 state
    // （ObsidianPropertiesCard 折叠/编辑）不随重渲染丢失。frontmatter 注册随 transform 一起
    // memo：blockKey ↔ yamlText 幂等，内容不变时引用不变。
    const transformedOutput = useMemo(() => {
        const output = transformBlocks(text);
        if (frontmatterBlock) {
            // 注册 frontmatter 内容块：后续 remark 插件把 mdast 层 frontmatter 节点替换成
            // waveblock 占位（blockkey 指向该条目）。type 固定 "obsidian-props"
            // （waveBlockRenderers 字典键）。
            output.blocks.set(frontmatterBlock.blockKey, {
                type: "obsidian-props",
                id: frontmatterBlock.blockKey,
                content: frontmatterBlock.yamlText,
            });
        }
        return output;
    }, [text, frontmatterBlock]);
    const transformedText = transformedOutput.content;
    const contentBlocksMap = transformedOutput.blocks;

    const getViewportEl = useCallback((): HTMLElement | null => {
        const inst = contentsOsRef.current?.osInstance();
        if (!inst) {
            return null;
        }
        return inst.elements().viewport;
    }, []);

    // Ref bridge: the commit funnel needs the ACTIVE edit session (to decide list renumbering),
    // but useInlineEdit needs onCommit — a declaration cycle. The stable callback delegates to
    // an impl ref assigned right after the hook returns; the impl closes over the current
    // inlineEdit.editSession each render.
    const handleInlineEditCommitImplRef = useRef<(newFullText: string, opts?: { renumberOrderedListFromLine?: number }) => void>(
        () => {}
    );
    const handleInlineEditCommit = useCallback(
        (newFullText: string, opts?: { renumberOrderedListFromLine?: number }) => {
            handleInlineEditCommitImplRef.current(newFullText, opts);
        },
        []
    );

    // === Autosave (feature ②) ===============================================================
    // Trailing-edge debounce: each block commit (⌘Enter / blur) re-arms a 1.5s timer that
    // flushes the staged draft to disk via onInlineEditSave. Refs keep the latest flag/save fn
    // so the teardown flush can run without re-subscribing anything.
    const inlineEditAutosaveTimerRef = useRef<number | null>(null);
    const inlineEditAutosaveRef = useRef(inlineEditAutosave);
    inlineEditAutosaveRef.current = inlineEditAutosave;
    const onInlineEditSaveRef = useRef(onInlineEditSave);
    onInlineEditSaveRef.current = onInlineEditSave;

    const scheduleInlineEditAutosave = useCallback(() => {
        if (!inlineEditAutosaveRef.current || onInlineEditSaveRef.current == null) {
            return;
        }
        if (inlineEditAutosaveTimerRef.current != null) {
            window.clearTimeout(inlineEditAutosaveTimerRef.current);
        }
        inlineEditAutosaveTimerRef.current = window.setTimeout(() => {
            inlineEditAutosaveTimerRef.current = null;
            onInlineEditSaveRef.current?.();
        }, InlineEditAutosaveDebounceMs);
    }, []);

    // Unmount flush: a pending autosave must not silently drop the user's last commit when the
    // block/tab unmounts inside the 1.5s window.
    useEffect(() => {
        return () => {
            if (inlineEditAutosaveTimerRef.current != null) {
                window.clearTimeout(inlineEditAutosaveTimerRef.current);
                inlineEditAutosaveTimerRef.current = null;
                onInlineEditSaveRef.current?.();
            }
        };
    }, []);

    // One-shot per mount (fires as soon as real content arrives): renumber every ordered list
    // so the source digits match what CommonMark renders — the renderer always displays
    // 1,2,3… silently even when the file says 5,5,5. Idempotent: after the first fix the text
    // is canonical and remounts no-op. Gated on inline editing being enabled (edit contexts).
    const didNormalizeListNumberingRef = useRef(false);
    useEffect(() => {
        if (didNormalizeListNumberingRef.current || onInlineEditCommit == null || text === "") {
            return;
        }
        didNormalizeListNumberingRef.current = true;
        const normalized = normalizeOrderedListNumbering(text);
        if (normalized != null) {
            handleInlineEditCommit(normalized.text);
        }
    }, [text, onInlineEditCommit, handleInlineEditCommit]);

    const inlineEdit = useInlineEdit({
        fullText: text,
        onCommit: handleInlineEditCommit,
        getViewportEl,
        resetKey: onInlineEditCommit,
    });

    handleInlineEditCommitImplRef.current = (newFullText, opts) => {
        if (!onInlineEditCommit) {
            return;
        }
        let nextText = newFullText;
        // After ANY inline edit, if the edited line resolves inside (or adjacent to) an ordered
        // list block, renumber that block so SOURCE numbering matches what remark renders
        // (CommonMark silently renumbers, leaving stale wrong numbers like 1,2,2 in the file).
        // Scoped to one block + fence-aware; a no-op for edits outside any list.
        const renumberAnchorLine =
            opts?.renumberOrderedListFromLine ?? inlineEdit.editSession?.startLine ?? null;
        if (renumberAnchorLine != null) {
            nextText = renumberOrderedListBlockAtLine(nextText, renumberAnchorLine)?.text ?? nextText;
        }
        onInlineEditCommit(nextText);
        scheduleInlineEditAutosave();
    };

    // Task-list checkbox click: flip `[ ]` <=> `[x]` on the one source line via the same
    // commit funnel (renumber-safe), then flush to disk immediately — a toggle is a single
    // atomic gesture, waiting for ⌘S/autosave would make "click to check" feel broken.
    const handleTaskCheckboxToggle = useCallback(
        (line: number) => {
            const next = toggleTaskCheckboxAtLine(text, line);
            if (next == null) {
                return;
            }
            handleInlineEditCommit(next);
            onInlineEditSave?.();
        },
        [text, handleInlineEditCommit, onInlineEditSave]
    );

    // === Ordered-list group-start chip (split-lists) ========================================
    // Chip "Keep / Continue / Restart" actions rewrite exactly one source line — render then
    // re-derives from the new text, so source and display can never drift.
    const handleGroupStartChange = useCallback(
        (line: number, newNumber: number) => {
            const next = setOrderedListMarkerNumberAtLine(text, line, newNumber);
            if (next != null) {
                handleInlineEditCommit(next.text);
            }
        },
        [text, handleInlineEditCommit]
    );
    const resolveGroupContinuation = useCallback((line: number) => getPreviousOrderedListContinuation(text, line), [text]);

    // === TableBlock context: stable commit channel for WYSIWYG cell editing ==========
    // getFullText reads from a ref so it's always fresh even across remounts.
    const textRef = useRef(text);
    textRef.current = text;
    const pendingCellFocusRef = useRef<TableCellFocus | null>(null);
    const tableEditContext = useMemo<TableEditContextValue>(() => ({
        getFullText: () => textRef.current,
        commitFullText: handleInlineEditCommit,
        pendingFocusRef: pendingCellFocusRef,
    }), [handleInlineEditCommit]);

    // === Inline-edit: target resolution + click/dblclick handlers =======================

    // Shared target resolution for dblclick- and click-to-edit. Walks the click target up
    // to its enclosing [data-source-line] block, promoting <LI> to its parent <OL>/<UL> so the
    // editor owns the whole list (M2 ships list-as-block, not listitem-as-block), then maps the
    // element's tag/class to one of the InlineEditBlockKind values the editor knows how to slice.
    //
    // Returns null when the click didn't land on a block the editor supports — caller returns and
    // native behavior (selection, link navigation, heading toggle) takes over. Also returns null
    // for a heading currently in the `collapsed` state: a folded heading should expand on click
    // rather than open the editor, mirroring the dblclick path's long-standing guard.
    const resolveEditTargetFromEl = useCallback(
        (el: HTMLElement | null): { target: HTMLElement; line: number; blockKind: InlineEditBlockKind } | null => {
            // Images are read-only in the preview: clicking zooms, right-click opens the
            // image menu. Never let a click/dblclick on an <img> fall through to paragraph
            // inline editing — that used to pop the editor over the whole paragraph.
            if (el?.closest("img") != null) {
                return null;
            }
            let target = el?.closest<HTMLElement>("[data-source-line]");
            if (target == null) {
                return null;
            }
            if (target.tagName === "LI") {
                // Per-item granularity (Obsidian-style): clicking one item edits THAT item's
                // source lines. Only items with nested sublists promote to the whole list, so
                // the editor never tears a nested list open.
                if (target.querySelector("ol, ul") != null) {
                    const parentList = target.parentElement?.closest<HTMLElement>("[data-source-line]");
                    if (parentList != null && (parentList.tagName === "OL" || parentList.tagName === "UL")) {
                        target = parentList;
                    }
                }
            }
            const lineAttr = target.dataset.sourceLine;
            if (lineAttr == null) {
                return null;
            }
            const line = Number(lineAttr);
            if (!Number.isFinite(line) || line < 1) {
                return null;
            }
            const tag = target.tagName;
            let blockKind: InlineEditBlockKind | null = null;
            // Spacers render through the same `p` component as paragraphs but carry the
            // `blank-spacer` class (see remark/blank-line-spacers). A blank line is not prose —
            // editing it should target the blank source line(s), not open a paragraph textarea.
            if (target.classList.contains("blank-spacer")) {
                blockKind = "blank";
            } else if (tag === "HR") {
                blockKind = "hr";
            } else if (tag === "P" || target.classList.contains("paragraph")) {
                blockKind = "p";
            } else if (
                tag === "H1" ||
                tag === "H2" ||
                tag === "H3" ||
                tag === "H4" ||
                tag === "H5" ||
                tag === "H6" ||
                // CollapsibleHeading renders as <div class="heading is-N"> rather than <hN>;
                // match by class so click-to-edit works for the headings the user actually sees.
                target.classList.contains("heading")
            ) {
                blockKind = "h";
            } else if (tag === "OL" || tag === "UL" || tag === "LI") {
                blockKind = "list";
            } else if (tag === "TABLE" || target.classList.contains("table-wrapper")) {
                // When tablecell flag is ON, cell clicks are handled by TableBlock's own
                // mousedown→contentEditable path. Returning here would open the raw textarea.
                if (isBlockEditorFeatureEnabled("tablecell")) {
                    return null;
                }
                blockKind = "table";
            } else if (tag === "PRE" || target.classList.contains("codeblock")) {
                blockKind = "code";
            } else {
                // Block kind not yet supported by inline editing. Plain click/dblclick → native
                // selection for now; add a branch above to enable a new kind.
                return null;
            }
            // Don't intercept on a heading that is currently collapsed. CollapsibleHeading
            // expresses state via the `collapsed` class (no aria-expanded on the div), so a
            // click on a folded heading should expand it, not open the editor. For raw <hN>
            // tags (non-collapsible render path) there's no collapsed class, so this check is a
            // no-op and the editor opens normally.
            if (blockKind === "h" && target.classList.contains("collapsed")) {
                return null;
            }
            return { target, line, blockKind };
        },
        []
    );

    // Event-shaped wrapper so the click/dblclick handlers keep their signature.
    const resolveEditTargetFromEvent = useCallback(
        (e: React.MouseEvent<HTMLDivElement>): { target: HTMLElement; line: number; blockKind: InlineEditBlockKind } | null =>
            resolveEditTargetFromEl(e.target as HTMLElement | null),
        [resolveEditTargetFromEl]
    );

    // === Link hover tooltip (feature ⑥) =====================================================
    // 300ms hover intent before showing. Dismissal is NOT a race-the-gap timer anymore: once
    // visible we watch pointermove and only close when the cursor leaves a padded safe zone =
    // (anchor rect ∪ tooltip rect) + LinkTooltipSafeZonePadPx on every side. The pointer can
    // cross the anchor↔tooltip gap as slowly as it likes — inside the zone nothing closes.
    // Opted into only when inline editing is enabled so read-only panels (vdom) keep plain links.
    const [linkTooltipAnchor, setLinkTooltipAnchor] = useState<HTMLAnchorElement | null>(null);
    const linkTooltipAnchorRef = useRef<HTMLAnchorElement | null>(null);
    const linkTooltipShowTimerRef = useRef<number | null>(null);
    const linkTooltipElRef = useRef<HTMLDivElement | null>(null);
    const linkTooltipWatchHandlerRef = useRef<((e: PointerEvent) => void) | null>(null);
    // Hast node offsets per hovered anchor, so the link editor can splice the exact span.
    const linkNodeOffsetsRef = useRef(new WeakMap<HTMLAnchorElement, { start?: number; end?: number }>());

    const stopLinkTooltipSafeZoneWatch = useCallback(() => {
        if (linkTooltipWatchHandlerRef.current != null) {
            window.removeEventListener("pointermove", linkTooltipWatchHandlerRef.current);
            linkTooltipWatchHandlerRef.current = null;
        }
    }, []);

    const closeLinkTooltip = useCallback(() => {
        if (linkTooltipShowTimerRef.current != null) {
            window.clearTimeout(linkTooltipShowTimerRef.current);
            linkTooltipShowTimerRef.current = null;
        }
        stopLinkTooltipSafeZoneWatch();
        setLinkTooltipAnchor(null);
    }, [stopLinkTooltipSafeZoneWatch]);

    const startLinkTooltipSafeZoneWatch = useCallback(() => {
        stopLinkTooltipSafeZoneWatch();
        const onMove = (e: PointerEvent) => {
            const anchor = linkTooltipAnchorRef.current;
            if (anchor == null) {
                stopLinkTooltipSafeZoneWatch();
                return;
            }
            if (pointInExpandedRect(e.clientX, e.clientY, anchor.getBoundingClientRect(), LinkTooltipSafeZonePadPx)) {
                return; // still on/near the link itself
            }
            const tooltipEl = linkTooltipElRef.current;
            if (
                tooltipEl != null &&
                pointInExpandedRect(e.clientX, e.clientY, tooltipEl.getBoundingClientRect(), LinkTooltipSafeZonePadPx)
            ) {
                return; // on/near the tooltip
            }
            stopLinkTooltipSafeZoneWatch();
            setLinkTooltipAnchor(null);
        };
        linkTooltipWatchHandlerRef.current = onMove;
        window.addEventListener("pointermove", onMove, { passive: true });
    }, [stopLinkTooltipSafeZoneWatch]);

    const handleLinkHoverIn = useCallback(
        (el: HTMLAnchorElement, nodeOffsets?: { start?: number; end?: number }) => {
            if (nodeOffsets != null) {
                linkNodeOffsetsRef.current.set(el, nodeOffsets);
            }
            stopLinkTooltipSafeZoneWatch();
            if (linkTooltipShowTimerRef.current == null) {
                linkTooltipShowTimerRef.current = window.setTimeout(() => {
                    linkTooltipShowTimerRef.current = null;
                    setLinkTooltipAnchor(el);
                }, 300);
            }
            // Tooltip already floating over another link → swap anchors immediately, no delay.
            setLinkTooltipAnchor((prev) => (prev != null && prev !== el ? el : prev));
        },
        [stopLinkTooltipSafeZoneWatch]
    );

    const handleLinkHoverOut = useCallback(() => {
        // Hover intent not yet satisfied → nothing to hide, just cancel the pending show.
        if (linkTooltipShowTimerRef.current != null) {
            window.clearTimeout(linkTooltipShowTimerRef.current);
            linkTooltipShowTimerRef.current = null;
        }
        if (linkTooltipAnchorRef.current != null) {
            startLinkTooltipSafeZoneWatch();
        }
    }, [startLinkTooltipSafeZoneWatch]);

    // Mirror the anchor state into a ref so pointermove handlers read the live value.
    useEffect(() => {
        linkTooltipAnchorRef.current = linkTooltipAnchor;
    }, [linkTooltipAnchor]);

    // Scrolling collapses the tooltip (anchor's rect becomes stale).
    useEffect(() => {
        if (linkTooltipAnchor == null) {
            return;
        }
        const onAnyScroll = () => closeLinkTooltip();
        window.addEventListener("scroll", onAnyScroll, { capture: true, passive: true });
        return () => window.removeEventListener("scroll", onAnyScroll, { capture: true });
    }, [linkTooltipAnchor, closeLinkTooltip]);

    // === Link edit form (feature ⑥ refinement) ==============================================
    // Instead of dropping the user into a source textarea, the tooltip's 编辑 opens a small
    // form with 显示名 + 链接地址 (or a single 目标 field for [[wiki]] links). The rewrite is
    // an exact-span splice of `[label](url)` / `[[target]]` — the user never sees markdown.
    const [linkEditTarget, setLinkEditTarget] = useState<(LinkEditRequest & { anchor: HTMLAnchorElement }) | null>(null);

    const openLinkEditor = useCallback(
        (el: HTMLAnchorElement) => {
            const href = el.getAttribute("href") ?? "";
            const isWiki = href.startsWith("wave-wiki:");
            const offsets = linkNodeOffsetsRef.current.get(el);
            const blockEl = el.closest<HTMLElement>("[data-source-line]");
            const blockStartLine = Number(blockEl?.dataset?.sourceLine);
            const blockEndLine = Number(blockEl?.dataset?.sourceLineEnd);
            setLinkEditTarget({
                anchor: el,
                mode: isWiki ? "wiki" : "markdown",
                href: isWiki ? wikiTargetFromHref(href, href) : href,
                label: el.textContent ?? "",
                startOffset: offsets?.start,
                endOffset: offsets?.end,
                blockStartLine: Number.isFinite(blockStartLine) && blockStartLine > 0 ? blockStartLine : undefined,
                blockEndLine:
                    Number.isFinite(blockEndLine) && blockEndLine >= blockStartLine ? blockEndLine : undefined,
            });
        },
        [ ]
    );

    const applyLinkEdit = useCallback(
        (target: LinkEditRequest, newLabel: string, newUrl: string) => {
            const next = replaceLinkInSource(text, target, newLabel, newUrl);
            if (next == null) {
                return;
            }
            // The generic commit funnel handles renumbering + autosave scheduling.
            handleInlineEditCommit(next);
        },
        [text, handleInlineEditCommit]
    );

    const handleInlineEditDblClick = useCallback(
        (e: React.MouseEvent<HTMLDivElement>) => {
            // Only intercept when inline editing has been opted in by the parent
            // (onInlineEditCommit wired). Without that, dblclick should fall through to
            // native text selection behavior.
            if (!onInlineEditCommit) {
                return;
            }
            // Capture phase: ensure we get one shot before any renderer's own dblclick toggles
            // (e.g. CollapsibleHeading would fold/unfold on dblclick otherwise).
            const resolved = resolveEditTargetFromEvent(e);
            if (resolved == null) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            inlineEdit.beginEdit(resolved.blockKind, resolved.line, resolved.target);
        },
        [inlineEdit, onInlineEditCommit, resolveEditTargetFromEvent]
    );

    // Records the selection string present at mousedown time so the click handler can tell
    // whether the mousedown→mouseup cycle produced NEW selection (drag-select) or just
    // preserved/cleared pre-existing selection (pure click intent). Set from a capture-phase
    // mousedown on the render root so it's in place before any mousemove-driven selection
    // changes the global selection.
    const mousedownSelectionRef = useRef<string>("");

    // Maps the click's clientX/Y to a character offset within the clicked block's rendered
    // text. Uses Chromium's caretRangeFromPoint (the renderer is Electron), then walks the
    // block's text nodes to turn the per-text-node offset into a block-absolute offset.
    // Returns null when the hit is outside the block's text (blank edge, no caret API) —
    // callers then fall back to select-all / line-start.
    const computeRenderedOffset = (clientX: number, clientY: number, block: HTMLElement): number | null => {
        if (typeof document.caretRangeFromPoint !== "function") {
            return null;
        }
        const range = document.caretRangeFromPoint(clientX, clientY);
        if (range == null) {
            return null;
        }
        const container = range.startContainer;
        if (container == null || !block.contains(container as Node)) {
            return null;
        }
        let offset = range.startOffset;
        const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node != null && node !== container) {
            offset += (node as Text).data.length;
            node = walker.nextNode();
        }
        return node != null ? offset : null;
    };

    // ponytail: the rendered offset is used directly as a draft (source) offset. It is exact
    // for plain text and soft-wrapped lines (\n renders 1:1 as a space), and off by the length
    // of inline markdown markers (**bold**, [link](...), `code`) on styled lines — the caret
    // lands nearby and the user nudges it. Upgrade path: map through the markdown AST so
    // rendered offset → source offset is exact.
    const beginEditAtPoint = (e: React.MouseEvent, resolved: { target: HTMLElement; line: number; blockKind: InlineEditBlockKind }) => {
        const caret = computeRenderedOffset(e.clientX, e.clientY, resolved.target);
        inlineEdit.beginEdit(resolved.blockKind, resolved.line, resolved.target, caret ?? undefined);
    };

    // Single-click entry path. Differs from dblclick in two ways:
    //   1. Bound on bubble phase (onClick, not onClickCapture) so <Link>'s onClick and the
    //      CollapsibleHeading chevron button's onClick (which calls stopPropagation) get first
    //      crack. We additionally bail when e.defaultPrevented is true (the Link handler calls
    //      preventDefault to route the href through WaveTerm's openFileLinkInPreview/openLink)
    //      and when the click landed inside an <a>/<button> — defensive in case a future
    //      component forgets to call preventDefault.
    //   2. Suppresses drag-select gestures: a click that arrived after the user dragged to
    //      select text (so the global selection grew during this mousedown cycle) must NOT
    //      enter edit, or every "select a phrase" gesture would also pop the editor. We
    //      compare the live selection length against the mousedown-captured baseline; growth
    //      during the press cycle = drag intent, skip.
    const handleInlineEditClick = useCallback(
        (e: React.MouseEvent<HTMLDivElement>) => {
            if (!onInlineEditCommit) {
                return;
            }
            // Already editing — let the overlay/textarea own clicks while a session is open
            // (e.g. clicking another block while the textarea is focused commits on blur first).
            if (inlineEdit.editSession != null) {
                return;
            }
            if (e.button !== 0) {
                return;
            }
            // A child element already consumed this click (Link navigation, button activation).
            if (e.defaultPrevented) {
                return;
            }
            // Defensive: even without defaultPrevented, never enter edit when the press landed
            // on an interactive element. Headings' chevron button calls stopPropagation so its
            // clicks never reach here, but <a> only calls preventDefault — belt-and-braces.
            const interactive = (e.target as HTMLElement | null)?.closest<HTMLElement>("a, button, .heading-collapse-button, input, textarea, [contenteditable]");
            if (interactive != null) {
                return;
            }
            // Drag-select suppression. Baseline was captured at mousedown (capture phase,
            // before any selectionchange fired). If the live selection is now longer, the
            // user dragged to select — keep native selection, don't open the editor.
            const curSel = typeof window !== "undefined" ? (window.getSelection()?.toString() ?? "") : "";
            if (curSel.length > mousedownSelectionRef.current.length) {
                return;
            }
            // Belt-and-braces on top of the length heuristic: an active Range selection means
            // a real selection gesture is (or just was) in progress — even one whose text is
            // empty (collapsed-node selects, drag still settling). Click-to-edit must never
            // hijack it, or a "select a phrase" gesture pops the editor instead.
            const liveSel = typeof window !== "undefined" ? window.getSelection() : null;
            if (isSelectingRange(liveSel)) {
                return;
            }
            const resolved = resolveEditTargetFromEvent(e);
            if (resolved == null) {
                // Click landed on empty space (not on any [data-source-line] block). Only treat
                // it as "continue writing at the end" when it is the TRAILING blank area — below
                // the last rendered block and inside the content's horizontal extent. Gaps
                // between blocks and side gutters are no-ops (don't jump the caret to the end).
                // The insert-then-edit flow mirrors handleInsertClick("after").
                const viewport = getViewportEl();
                const root = viewport?.querySelector<HTMLElement>(".markdown-render-root");
                if (root == null) {
                    return;
                }
                let lastEl: HTMLElement | null = null;
                let lastLine = -1;
                root.querySelectorAll<HTMLElement>("[data-source-line]").forEach((el) => {
                    const line = Number(el.dataset.sourceLine);
                    if (Number.isFinite(line) && line > lastLine) {
                        lastLine = line;
                        lastEl = el;
                    }
                });
                if (lastEl == null) {
                    return;
                }
                const rootRect = root.getBoundingClientRect();
                const lastRect = lastEl.getBoundingClientRect();
                // Only the TRAILING blank area counts as "continue at the end": below the last
                // block AND inside the content's horizontal extent. Gaps between blocks and side
                // gutters are no-ops so the caret never jumps to the end unexpectedly.
                const isTrailingBlank =
                    e.clientY > lastRect.bottom &&
                    e.clientX >= rootRect.left &&
                    e.clientX <= rootRect.right;
                if (!isTrailingBlank) {
                    return;
                }
                const startLine = lastLine;
                const endLineRaw = lastEl.dataset.sourceLineEnd != null ? Number(lastEl.dataset.sourceLineEnd) : startLine;
                const endLine = Number.isFinite(endLineRaw) && endLineRaw >= startLine ? endLineRaw : startLine;
                const isParagraph = lastEl.tagName === "P" || lastEl.classList.contains("paragraph");
                const isBlankSpacer = lastEl.classList.contains("blank-spacer");
                const isListItem = lastEl.tagName === "LI";
                const inlineMode = (isParagraph && !isBlankSpacer) || isListItem;
                const originalText = text;
                const sourceLines = text.split(/\r\n|\n/);
                const listItemAnchor = isListItem ? computeListInsertAnchor(text, startLine, "after") : null;
                let insertAtLine: number;
                let prefillMarker: string | undefined;
                if (listItemAnchor != null) {
                    insertAtLine = listItemAnchor.insertAtLine;
                    prefillMarker = listItemAnchor.prefillMarker || undefined;
                } else {
                    insertAtLine = endLine + 1;
                }
                const insertIdx = Math.max(0, Math.min(insertAtLine - 1, sourceLines.length));
                const spliced = [...sourceLines];
                spliced.splice(insertIdx, 0, prefillMarker ?? "");
                e.preventDefault();
                e.stopPropagation();
                handleInlineEditCommit(spliced.join("\n"));
                focusEditedLine(insertAtLine, () => handleInlineEditCommit(originalText), inlineMode ? "inline" : true, prefillMarker);
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            // Single click = edit at the clicked position (caret lands where the user
            // clicked). Dblclick still select-alls via beginEdit without a caret — the two
            // gestures complement each other.
            beginEditAtPoint(e, resolved);
        },
        [inlineEdit, onInlineEditCommit, resolveEditTargetFromEvent, beginEditAtPoint, getViewportEl, text, handleInlineEditCommit]
    );

    // === Block grip / insert / drag-reorder / selection ==================================

    // --- Block anchor resolvers (lifted above handleInlineEditMouseDown so the Ctrl/Cmd +
    // drag-select handler can reference them without a use-before-declaration error) ----
    // Resolves the rendered block element for a given source line (used to anchor inserts,
    // menus, and selection ranges).
    const resolveInsertAnchorEl = useCallback(
        (line: number): HTMLElement | null => {
            const viewport = getViewportEl();
            if (viewport == null) {
                return null;
            }
            return viewport.querySelector<HTMLElement>(`.markdown-render-root [data-source-line="${line}"]`);
        },
        [getViewportEl]
    );

    // Resolve the BLOCK-level anchor for an insert/menu action: same lookup as
    // resolveInsertAnchorEl. Per-item granularity: a hovered <LI> stays itself unless it has
    // nested sublists — then promote to the parent <OL>/<UL> so insert/copy/delete never tear
    // a nested list open. Mirrors resolveEditTargetFromEvent.
    const resolveBlockAnchorEl = useCallback(
        (line: number): HTMLElement | null => {
            const el = resolveInsertAnchorEl(line);
            if (el == null || el.tagName !== "LI") {
                return el;
            }
            if (el.querySelector("ol, ul") == null) {
                return el;
            }
            const parentList = el.parentElement?.closest<HTMLElement>("ol, ul");
            return parentList != null && parentList.dataset.sourceLine != null ? parentList : el;
        },
        [resolveInsertAnchorEl]
    );

    const handleInlineEditMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        if (e.button !== 0) {
            return;
        }
        mousedownSelectionRef.current = typeof window !== "undefined" ? (window.getSelection()?.toString() ?? "") : "";

        // Ctrl/Cmd + drag → select a RANGE of blocks. This must NOT start a native text selection,
        // so we preventDefault and own the gesture. Plain (no-modifier) drags fall through to the
        // browser's native text selection untouched. Disabled while the inline editor is open.
        if ((e.ctrlKey || e.metaKey) && inlineEdit.editSession == null) {
            const target = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-source-line]:not(img)");
            if (target == null) {
                return; // not pressed on a block (e.g. padding / gutter) → let default happen
            }
            const blockEl = resolveBlockAnchorEl(Number(target.dataset.sourceLine)) ?? target;
            if (blockEl == null) {
                return;
            }
            const bs = Number(blockEl.dataset.sourceLine);
            const be = blockEl.dataset.sourceLineEnd != null ? Number(blockEl.dataset.sourceLineEnd) : bs;
            e.preventDefault();
            setSelectedBlock(null); // single-select highlight yields to the range select
            setSelectedRange({ startLine: bs, endLine: be });
            const anchorLine = bs;
            const onMove = (ev: MouseEvent) => {
                if (!(ev.ctrlKey || ev.metaKey)) {
                    cleanup();
                    return;
                }
                const el = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest?.(
                    "[data-source-line]"
                ) as HTMLElement | null;
                if (el == null) {
                    return; // pointer over a gap / gutter → keep the current range
                }
                const cur = resolveBlockAnchorEl(Number(el.dataset.sourceLine)) ?? el;
                if (cur == null) {
                    return;
                }
                const cbs = Number(cur.dataset.sourceLine);
                const cbe = cur.dataset.sourceLineEnd != null ? Number(cur.dataset.sourceLineEnd) : cbs;
                setSelectedRange(expandBlockSelection(anchorLine, cbs, cbe));
            };
            const onUp = () => cleanup();
            const cleanup = () => {
                window.removeEventListener("mousemove", onMove);
                window.removeEventListener("mouseup", onUp);
            };
            window.addEventListener("mousemove", onMove);
            window.addEventListener("mouseup", onUp);
        }
    }, [inlineEdit.editSession, resolveBlockAnchorEl]);

    // ---- Block-edge insert buttons --------------------------------------------------
    // Hovering an editable block shows a small ↑/↓ pair at its left edge; clicking one
    // opens a blank inline editor that inserts a new block before/after (see
    // useInlineEdit.beginInsertEdit). Tracked here because the buttons must follow the
    // block as the user scrolls.
    //
    // We store ONLY the source line, not the element: any re-render of the Markdown subtree
    // (hover state, ReactMarkdown plugin identity churn) replaces the block's DOM node, so a
    // cached element goes stale and its isConnected flips false. Re-resolve the element from
    // [data-source-line] at measure/click time (same fallback pattern as inline editing).
    const [insertAnchor, setInsertAnchor] = useState<{ line: number } | null>(null);
    const [insertPos, setInsertPos] = useState<{ top: number; left: number } | null>(null);

    // Buttons are portal'd to body (outside the block DOM), so moving the pointer from the
    // block onto a button fires the block's mouseout. Keep the buttons alive for a short
    // grace window after the pointer leaves, and cancel it while the pointer is over them —
    // same pattern as FlyoutMenu's hover close.
    const hideInsertTimerRef = useRef<number | null>(null);
    const scheduleHideInsert = useCallback(() => {
        if (hideInsertTimerRef.current != null) {
            window.clearTimeout(hideInsertTimerRef.current);
        }
        hideInsertTimerRef.current = window.setTimeout(() => {
            setInsertAnchor(null);
            setInsertPos(null);
            setGripOpen(false);
        }, 400);
    }, []);
    const cancelHideInsert = useCallback(() => {
        if (hideInsertTimerRef.current != null) {
            window.clearTimeout(hideInsertTimerRef.current);
            hideInsertTimerRef.current = null;
        }
    }, []);

    // A/B insert actions visibility. They are independent portal'd buttons mounted whenever
    // the block grip is (insertPos != null) but visually hidden until the pointer is over the
    // grip C or the actions themselves. Same 400ms grace pattern, on a separate timer so that
    // moving C → A/B (through the gap between them) keeps them alive.
    const [gripOpen, setGripOpen] = useState(false);
    const hideGripTimerRef = useRef<number | null>(null);
    const scheduleHideGrip = useCallback(() => {
        if (hideGripTimerRef.current != null) {
            window.clearTimeout(hideGripTimerRef.current);
        }
        hideGripTimerRef.current = window.setTimeout(() => {
            setGripOpen(false);
        }, 400);
    }, []);
    const cancelHideGrip = useCallback(() => {
        if (hideGripTimerRef.current != null) {
            window.clearTimeout(hideGripTimerRef.current);
            hideGripTimerRef.current = null;
        }
    }, []);
    // Shared enter/leave handlers for C, A and B: hovering any of them keeps the block anchor
    // alive (cancelHideInsert, in case the pointer is crossing from the block) and reveals A/B.
    // While the pointer is on the action column, the anchor is FROZEN — moving across adjacent
    // list items must never re-anchor (the +/- buttons sit right at item boundaries, so an
    // instant switch made them impossible to click).
    // Hover-intent: switching the anchor to a DIFFERENT block requires the pointer to dwell on
    // it briefly (see MarkdownAnchorSwitchDelayMs). Fast transit (e.g. beelining from item text
    // toward a + button across the neighbouring item) must not yank the buttons away mid-move.
    const pendingAnchorSwitchRef = useRef<number | null>(null);
    const cancelPendingAnchorSwitch = useCallback(() => {
        if (pendingAnchorSwitchRef.current != null) {
            window.clearTimeout(pendingAnchorSwitchRef.current);
            pendingAnchorSwitchRef.current = null;
        }
    }, []);
    const pointerOnGripActionsRef = useRef(false);
    const handleGripEnter = useCallback(() => {
        cancelHideInsert();
        cancelHideGrip();
        cancelPendingAnchorSwitch();
        // Freeze the anchor while the pointer is genuinely over the action column. Released on
        // mouseleave (handleGripLeave) or as soon as a click commits an action, so a click that
        // opens the editor doesn't leave the lock stuck true and silently block every later hover.
        pointerOnGripActionsRef.current = true;
        setGripOpen(true);
    }, [cancelHideInsert, cancelHideGrip, cancelPendingAnchorSwitch]);
    const handleGripLeave = useCallback(() => {
        pointerOnGripActionsRef.current = false;
        scheduleHideGrip();
    }, [scheduleHideGrip]);

    // --- Block selection (click the four-dot grip) --------------------------------
    // Clicking the grip C marks its block as selected (a highlight overlay + right-click
    // menu with Copy / Duplicate / Delete. Block-scoped, driven by start/end line of the
    // hovered block, and resolved live so it follows re-renders.
    const [selectedBlock, setSelectedBlock] = useState<{ line: number; rect: { top: number; left: number; width: number; height: number } } | null>(null);
    // live DOM ref for the selected block element, re-resolved from [data-source-line] so the
    // highlight overlay tracks re-renders / line edits.
    const selectedLineRef = useRef<number | null>(null);
    selectedLineRef.current = selectedBlock?.line ?? null;

    // --- Block drag-and-drop reorder -------------------------------------------------
    // dragSourceRef holds the block range being dragged (set on dragstart, cleared on dragend/
    // drop). It lives in a ref (not state) so starting a drag doesn't churn the render. dropTarget
    // is state because the drop indicator line must re-render as the pointer moves between blocks.
    const dragSourceRef = useRef<{ startLine: number; endLine: number } | null>(null);
    const [dropTarget, setDropTarget] = useState<{ line: number; mode: "before" | "after"; rect: { top: number; left: number; width: number } } | null>(null);

    // --- Ctrl/Cmd + drag multi-block selection ----------------------------------------
    // A CONTIGUOUS range of source lines [startLine..endLine] the user selected by Ctrl/Cmd-
    // dragging across blocks. Parallel to `selectedBlock` (single), and mutually exclusive:
    // starting a range select clears the single selection and vice-versa. selectedRangeRect is
    // the spanning highlight box (top of the first block → bottom of the last), re-measured on
    // scroll/resize so it tracks re-renders.
    const [selectedRange, setSelectedRange] = useState<{ startLine: number; endLine: number } | null>(null);
    const selectedRangeRef = useRef<{ startLine: number; endLine: number } | null>(null);
    selectedRangeRef.current = selectedRange;
    const [selectedRangeRect, setSelectedRangeRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);

    // Measure the currently selected block element (re-resolving from its line) so the
    // highlight overlay follows re-renders and scrolls. Kept in step with insertAnchor's own
    // scroll/resize watcher below.
    const measureSelectedBlock = useCallback(() => {
        const line = selectedLineRef.current;
        if (line == null) {
            return;
        }
        const viewport = getViewportEl();
        const el = viewport && viewport.querySelector<HTMLElement>(`.markdown-render-root [data-source-line="${line}"]`);
        if (el == null) {
            setSelectedBlock(null); // block no longer exists (deleted / file changed)
            return;
        }
        const rect = el.getBoundingClientRect();
        setSelectedBlock((prev) => {
            if (
                prev != null &&
                prev.line === line &&
                prev.rect.top === rect.top &&
                prev.rect.left === rect.left &&
                prev.rect.width === rect.width &&
                prev.rect.height === rect.height
            ) {
                return prev; // unchanged — avoid re-render churn
            }
            return { line, rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height } };
        });
    }, [getViewportEl]);

    // Re-measure the selection on scroll/resize/after-commit so the overlay hugs the block.
    useEffect(() => {
        if (selectedBlock == null) {
            return;
        }
        const viewport = getViewportEl();
        measureSelectedBlock();
        const onScrollOrResize = () => requestAnimationFrame(measureSelectedBlock);
        viewport?.addEventListener("scroll", onScrollOrResize, { passive: true });
        window.addEventListener("resize", onScrollOrResize);
        return () => {
            viewport?.removeEventListener("scroll", onScrollOrResize);
            window.removeEventListener("resize", onScrollOrResize);
        };
    }, [selectedBlock, getViewportEl, measureSelectedBlock]);

    // Resolve the rendered block element whose source range contains `line` (handles multi-line
    // blocks whose data-source-line-end exceeds their start). Used to span the selection highlight
    // from the first block's top to the last block's bottom.
    const findBlockElement = useCallback(
        (line: number): HTMLElement | null => {
            const viewport = getViewportEl();
            const root = viewport?.querySelector<HTMLElement>(".markdown-render-root");
            if (root == null) return null;
            const exact = root.querySelector<HTMLElement>(`[data-source-line="${line}"]`);
            if (exact != null) return exact;
            let found: HTMLElement | null = null;
            root.querySelectorAll<HTMLElement>("[data-source-line]").forEach((el) => {
                const s = Number(el.dataset.sourceLine);
                const e = el.dataset.sourceLineEnd != null ? Number(el.dataset.sourceLineEnd) : s;
                if (Number.isFinite(s) && line >= s && line <= e) found = el;
            });
            return found;
        },
        [getViewportEl]
    );

    // Measure the spanning highlight box for the current selection range. Re-resolves the first
    // and last blocks from their lines so it follows re-renders / line edits, and stores the box.
    const measureSelectedRange = useCallback(() => {
        const sel = selectedRangeRef.current;
        if (sel == null) {
            setSelectedRangeRect(null);
            return;
        }
        const startEl = findBlockElement(sel.startLine);
        const endEl = findBlockElement(sel.endLine);
        if (startEl == null || endEl == null) {
            setSelectedRangeRect(null);
            return;
        }
        const sRect = startEl.getBoundingClientRect();
        const eRect = endEl.getBoundingClientRect();
        const left = Math.min(sRect.left, eRect.left);
        const width = Math.max(sRect.right, eRect.right) - left;
        setSelectedRangeRect({ top: sRect.top, left, width, height: eRect.bottom - sRect.top });
    }, [findBlockElement]);

    // Re-measure the selection range box on scroll/resize/selection change.
    useEffect(() => {
        if (selectedRange == null) {
            setSelectedRangeRect(null);
            return;
        }
        measureSelectedRange();
        const viewport = getViewportEl();
        const onScrollOrResize = () => requestAnimationFrame(measureSelectedRange);
        viewport?.addEventListener("scroll", onScrollOrResize, { passive: true });
        window.addEventListener("resize", onScrollOrResize);
        return () => {
            viewport?.removeEventListener("scroll", onScrollOrResize);
            window.removeEventListener("resize", onScrollOrResize);
        };
    }, [selectedRange, getViewportEl, measureSelectedRange]);

    // Escape clears any block selection (unless the inline editor is open — it owns Escape).
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape" && (selectedLineRef.current != null || selectedRangeRef.current != null) && inlineEdit.editSession == null) {
                setSelectedBlock(null);
                setSelectedRange(null);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [inlineEdit.editSession]);

    // Helper: wait for the markdown preview to re-render after a commit, then open a blank
    // editor at `newLine` (used by handleInsertClick and handleEnterSplit). The revert callback
    // is forwarded so Esc can undo the whole insert.
    //
    // The committed text reaches ReactMarkdown through an async atom, so the re-render carrying
    // the pre-inserted row can land later than two rAFs. Anchoring on the STALE DOM used to
    // resolve [data-source-line=N] to the whole <ol> and made beginEdit slice the entire list
    // as the placeholder draft — the source of duplicated items after clicking insert. So:
    // retry for a few frames, never anchor on a list element, and retry when beginEdit bails
    // (its latest-text check rejects rows that don't exist yet).
    const focusEditedLine = useCallback(
        (newLine: number, revert?: () => void, placeholder?: boolean | "inline", prefill?: string, keepOnEmpty?: boolean, blockKind: InlineEditBlockKind = "p", caretOffset?: number) => {
            let attempts = 0;
            // Safety net for exhausted retries: the caller committed an insert/split but we
            // could never open its follow-up editor (re-render landed too late, viewport gone,
            // …). Leaving the PREVIOUS session running here is what produced "pressed Enter and
            // it all went blank": the stale session keeps its block .inline-edit-hidden with no
            // textarea over it, and further typing lands in a draft bound to the WRONG line
            // range (glued text, duplicated rows). Instead: undo the whole insert via the
            // caller-wired revert, then close whatever session remains — worst case the gesture
            // is a visible no-op the user can safely retry.
            const giveUp = () => {
                inlineEditDebug("focusEditedLine: retries exhausted — closing stale session", {
                    newLine,
                    attempts,
                    hasRevert: revert != null,
                });
                revert?.();
                inlineEdit.cancel();
            };
            const tryOpen = () => {
                attempts++;
                const viewport = getViewportEl();
                const el =
                    viewport?.querySelector<HTMLElement>(
                        `.markdown-render-root [data-source-line="${newLine}"]`
                    ) ?? null;
                if (el == null || el.closest("img") != null) {
                    if (attempts < 10) requestAnimationFrame(tryOpen);
                    else giveUp();
                    return;
                }
                // A list element claiming the target row means the DOM is still the pre-insert
                // render — keep waiting instead of anchoring the wrong range. EXCEPTION: list
                // inserts (prefill set) intentionally create a real sibling "N. " row that
                // renders as an empty <li> — that li IS the correct anchor, waiting would
                // exhaust retries and revert the whole insert ("+ does nothing" bug).
                if (
                    (placeholder ?? false) &&
                    prefill == null &&
                    (el.tagName === "OL" || el.tagName === "UL" || el.tagName === "LI")
                ) {
                    if (attempts < 10) requestAnimationFrame(tryOpen);
                    else giveUp();
                    return;
                }
                const opened = inlineEdit.beginEdit(
                    blockKind,
                    newLine,
                    el,
                    caretOffset ?? (prefill != null ? prefill.length : 0),
                    revert,
                    placeholder,
                    keepOnEmpty
                );
                if (!opened && attempts < 10) {
                    requestAnimationFrame(tryOpen);
                    return;
                }
                if (!opened) {
                    giveUp();
                    return;
                }
                if (opened && prefill != null) {
                    // New list-item rows come pre-filled with their marker (e.g. "3. ") so the
                    // user types straight into a real list item instead of a plain paragraph.
                    inlineEdit.setDraftText(prefill);
                }
            };
            requestAnimationFrame(() => requestAnimationFrame(tryOpen));
        },
        [getViewportEl, inlineEdit]
    );

    // --- Enter / split-at-caret ---------------------------------------------------
    // Handles the user pressing bare Enter while editing a block (paragraph, blank row,
    // or list). Paragraphs split into two blocks (front stays, back becomes a new block
    // with its own editor); lists add a new list item without closing the editor.
    // - Shift+Enter stays the native soft line break (no split).
    // - Code / table / heading blocks fall through to the default behavior (line break).
    const handleEnterSplit = useCallback(() => {
        const session = inlineEdit.editSession;
        const ta = inlineEdit.textareaRef.current;
        if (session == null || ta == null) {
            return;
        }
        const pos = ta.selectionStart;
        const draft = inlineEdit.draftText;

        // --- List: add a new item within the same list (same editor stays open) -----------
        if (session.blockKind === "list") {
            // Pure helper fixes two bugs: the marker number now INCREMENTS (+1) instead of
            // copying the current number verbatim, and a caret at line start inserts an empty
            // sibling above instead of concatenating prefix+content (which duplicated items).
            const { text: newDraft, newPos } = splitListItemDraft(draft, pos);
            inlineEdit.setDraftText(newDraft);
            // schedule after the render so setSelectionRange sticks
            requestAnimationFrame(() => {
                ta.selectionStart = newPos;
                ta.selectionEnd = newPos;
            });
            return;
        }

        // --- Paragraph / blank row: split into two blocks ---------------------------------
        if (session.blockKind === "p" || session.blockKind === "blank") {
            const { text: newFull, newLine } = splitBlockAtCaretText(
                text,
                session.startLine,
                session.endLine,
                draft,
                pos
            );
            // 打字变换 (方案 02 §2.1): the committed FRONT half may be a typing pattern
            // ("# ", "> ", "- [ ] ", fence, "| a |", incl. full-width variants). Rewrite it
            // in the SAME commit so the block transforms on re-render; lineDelta keeps the
            // follow-up editor anchored to the true new row when lines were added (e.g. the
            // fence auto-close).
            const typed = isBlockEditorFeatureEnabled("blockeditor") ? applyTypingPatternAtLine(newFull, session.startLine) : null;
            const finalText = typed?.text ?? newFull;
            const targetLine = newLine + (typed?.lineDelta ?? 0);
            const revert = () => {
                handleInlineEditCommit(text); // restore the document to what it was before the split
            };
            handleInlineEditCommit(finalText);
            // The split pre-inserted a single placeholder row. An empty follow-up commit (blur /
            // Ctrl+S) must keep the line we just committed — NOT revert the whole insert back to
            // before the split, or the next Save would persist the rollback and the typed line
            // would vanish. Pass keepOnEmpty so commit() closes the session without reverting.
            focusEditedLine(targetLine, revert, true, undefined, true);
            return;
        }

        // --- Code / heading: insert a real newline at the caret ----------------------------
        // These blocks don't "split into two blocks" on Enter, but users still expect Enter to
        // add a line (multi-line code; heading -> heading + following line). The keydown handler
        // above already preventDefaults the Enter before invoking this, so the browser's native
        // newline never fires — we must insert "\n" here, or Enter is a silent no-op (the old
        // "fall through to native newline" comment was wrong; that was the bug behind "some
        // lines don't support Enter").
        if (session.blockKind === "code" || session.blockKind === "h") {
            const newDraft = draft.slice(0, pos) + "\n" + draft.slice(pos);
            inlineEdit.setDraftText(newDraft);
            const newPos = pos + 1;
            requestAnimationFrame(() => {
                ta.selectionStart = newPos;
                ta.selectionEnd = newPos;
            });
            return;
        }

        // --- Table / hr: no meaningful inline newline — leave Enter as a no-op. -------------
        return;
    }, [inlineEdit, text, handleInlineEditCommit, focusEditedLine]);

    // --- Navigate up from an emptied line ------------------------------------------------
    // Standard text-editor behavior: Backspace (or Delete) on a blank line pulls the caret up into
    // the PREVIOUS block. We close the emptied editor and open the previous rendered block instead.
    // Lists are excluded from the delete step: a list edits as one multi-line block, so
    // deleteBlockRange would remove the whole list — lists keep their grip-menu delete + Enter-to-
    // add-item UX, and for an emptied list session we just cancel (drop the editor, list survives).
    const getPreviousBlockLine = useCallback(
        (startLine: number): number | null => {
            const viewport = getViewportEl();
            const root = viewport?.querySelector<HTMLElement>(".markdown-render-root");
            if (root == null) return null;
            // Largest rendered block start line strictly before `startLine`. Blank separator lines
            // carry no data-source-line, so they're skipped — we always land on a real block.
            let prev: number | null = null;
            root.querySelectorAll<HTMLElement>("[data-source-line]").forEach((b) => {
                const line = Number(b.dataset.sourceLine);
                if (Number.isFinite(line) && line < startLine && (prev == null || line > prev)) {
                    prev = line;
                }
            });
            return prev;
        },
        [getViewportEl]
    );

    const blockKindFromElement = (el: HTMLElement | null): InlineEditBlockKind => {
        if (el == null) return "p";
        switch (el.tagName) {
            case "H1":
            case "H2":
            case "H3":
            case "H4":
            case "H5":
            case "H6":
                return "h";
            case "PRE":
            case "CODE":
                return "code";
            case "TABLE":
                return "table";
            case "HR":
                return "hr";
            case "OL":
            case "UL":
            case "LI":
                return "list";
            default:
                return "p";
        }
    };

    const handleNavigateUp = useCallback(() => {
        const session = inlineEdit.editSession;
        if (session == null) {
            return;
        }
        // Lists: never delete the whole list — just close the editor.
        if (session.blockKind === "list") {
            inlineEdit.cancel();
            return;
        }
        const prevLine = getPreviousBlockLine(session.startLine);
        if (prevLine == null) {
            // Topmost block: nowhere to merge into — close the editor, leaving the cleared line.
            inlineEdit.commit();
            return;
        }
        // Remove the emptied block (collapsing its separator blanks) and open the previous block.
        const newFull = deleteBlockRange(text, session.startLine, session.endLine);
        const revert = () => handleInlineEditCommit(text);
        handleInlineEditCommit(newFull);
        const viewport = getViewportEl();
        const prevEl = viewport?.querySelector<HTMLElement>(
            `.markdown-render-root [data-source-line="${prevLine}"]`
        );
        focusEditedLine(prevLine, revert, true, undefined, undefined, blockKindFromElement(prevEl));
    }, [inlineEdit, text, handleInlineEditCommit, focusEditedLine, getPreviousBlockLine, getViewportEl]);

    // --- Paste image → save to assets/ + insert ![..](assets/..) + render ----------------------
    // Mirrors Obsidian: pasting an image while editing a block saves it to a sibling `assets`
    // directory (created on demand) and inserts a markdown image reference at the caret. The
    // image FILE is written to disk immediately (independent of the md save flow); only the
    // markdown line goes through the shared draft (so Save/Revert still apply to the text).
    // Pure-text pastes are untouched (handler returns undefined → native paste proceeds).
    const handleEditorPaste = useCallback(
        async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
            const session = inlineEdit.editSession;
            const ta = inlineEdit.textareaRef.current;
            const baseDir = resolveOpts?.baseDir;
            if (session == null || ta == null || baseDir == null) {
                return; // not editing / no file dir to write into → native paste
            }
            // Find an image item in the clipboard (png/jpg/gif/webp). If none, fall through.
            const items = Array.from(e.clipboardData?.items ?? []);
            const imageItem = items.find((it) => it.kind === "file" && it.type.startsWith("image/"));
            if (imageItem == null || e.clipboardData.files == null || e.clipboardData.files.length === 0) {
                return;
            }
            const blob = e.clipboardData.files[0];
            if (!blob.type.startsWith("image/")) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();

            const ext = blob.type === "image/jpeg" ? "jpg" : blob.type.replace("image/", "").split("+")[0] || "png";
            const date = new Date();
            const pad = (n: number) => String(n).padStart(2, "0");
            const stamp =
                `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
                `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
            const rand = Math.floor(Math.random() * 900 + 100);
            const fileName = `image-${stamp}-${rand}.${ext}`;
            const relPath = `assets/${fileName}`;

            try {
                // 1) ensure the sibling assets/ directory exists
                const baseUri = formatRemoteUri(baseDir, resolveOpts?.connName ?? "local");
                await RpcApi.FileMkdirCommand(TabRpcClient, {
                    info: { path: `${baseUri}/assets`, mimetype: "directory" },
                });
                // 2) write the image bytes
                const buf = await blob.arrayBuffer();
                const data64 = arrayToBase64(new Uint8Array(buf));
                await RpcApi.FileWriteCommand(TabRpcClient, {
                    info: { path: `${baseUri}/${relPath}`, mimetype: blob.type },
                    data64,
                });
            } catch (err) {
                console.error("[markdown] paste-image write failed", err);
                return;
            }

            // 3) insert `![图片](assets/xxx.png)` at the caret and commit
            const caretPos = ta.selectionStart;
            const draft = inlineEdit.draftText;
            const imgMarkdown = `![图片](${relPath})`;
            const newDraft = draft.slice(0, caretPos) + imgMarkdown + draft.slice(caretPos);
            const newFull = replaceSourceRange(text, session.startLine, session.endLine, newDraft);
            handleInlineEditCommit(newFull);
        },
        [inlineEdit, resolveOpts, text, handleInlineEditCommit]
    );

    // --- Grip menu: click the 4-dot grip → select the block + popup (copy / copy context / duplicate / delete)
    // Resolves the current anchor block's [start..end] source range, shows a selection
    // highlight overlay over it, and opens a native context menu. Block-scoped operations are
    // applied to the markdown source via the same range helpers the editor uses.
    const handleGripMenuClick = useCallback(
        (e: React.MouseEvent) => {
            // Releasing the hover-lock here too: opening the menu counts as leaving the grip hover.
            pointerOnGripActionsRef.current = false;
            cancelPendingAnchorSwitch();
            const anchor = insertAnchorRef.current;
            if (anchor == null) {
                return;
            }
            // Whole-block granularity: an LI hover resolves to its parent list (same promotion
            // as the insert path), so copy/duplicate/delete never split a nested list open.
            const el = resolveBlockAnchorEl(anchor.line);
            if (el == null) {
                return;
            }
            const startLineRaw = Number(el.dataset.sourceLine);
            if (!Number.isFinite(startLineRaw) || startLineRaw < 1) {
                return;
            }
            const endLineRaw = el.dataset.sourceLineEnd != null ? Number(el.dataset.sourceLineEnd) : startLineRaw;
            const endLine = Number.isFinite(endLineRaw) && endLineRaw >= startLineRaw ? endLineRaw : startLineRaw;
            e.preventDefault();
            e.stopPropagation();

            const lines = text.split(/\r\n|\n/);
            const blockSource = lines.slice(startLineRaw - 1, endLine).join("\n");

            // Live-highlight: set the overlay now; measureSelectedBlock re-anchors after render if needed.
            const rect = el.getBoundingClientRect();
            setSelectedRange(null); // single-select highlight yields to the range select
            setSelectedBlock({
                line: startLineRaw,
                rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
            });

            const copyBlock = async () => {
                await navigator.clipboard.writeText(blockSource);
            };
            // Copy Context reuses the app-wide convention (path:line + markdown-fenced block
            // source) so the block can be pasted into an AI prompt with its location. Falls
            // back to "(unknown-path)" when the preview has no file path (e.g. unsaved buffer).
            const copyContext = async () => {
                await navigator.clipboard.writeText(
                    buildCopyContextText(copyContextPath || "(unknown-path)", startLineRaw, blockSource)
                );
            };
            // Split-list group numbering: hose on blank-separated ordered groups the block-grip
            // menu shows a strategy submenu; each pick rewrites exactly one source line.
            const isSplitListGroup = el.tagName === "OL" && (el as HTMLElement).dataset.splitGroup === "true";
            const currentGroupStart = Number(el.getAttribute("start") ?? "1") || 1;
            const setGroupNumber = (n: number) => {
                if (n === currentGroupStart) return;
                handleGroupStartChange(startLineRaw, n);
            };
            const continuation = isSplitListGroup ? resolveGroupContinuation(startLineRaw) : null;
            const numberingSubmenu: ContextMenuItem[] | null = isSplitListGroup
                ? [
                      ...(continuation != null
                          ? [
                                {
                                    label: `Continue from previous (${continuation})`,
                                    type: "checkbox" as const,
                                    checked: currentGroupStart === continuation,
                                    click: () => setGroupNumber(continuation),
                                },
                            ]
                          : []),
                      {
                          label: `Keep ${currentGroupStart}`,
                          type: "checkbox" as const,
                          checked: true,
                          click: () => {},
                      },
                      {
                          label: "Restart from 1",
                          type: "checkbox" as const,
                          checked: currentGroupStart === 1,
                          click: () => setGroupNumber(1),
                      },
                  ]
                : null;
            // Per-item ops on a list change the sibling count — renumber the containing list
            // block so source numbering stays consistent with what renders.
            const isListItemBlock = el.tagName === "LI" || el.tagName === "OL" || el.tagName === "UL";
            const renumberOpts = isListItemBlock ? { renumberOrderedListFromLine: startLineRaw } : undefined;

            // Block-editor M1 (方案 02 §2.2): "Turn into ▸" submenu from the block-action
            // registry. The current kind is checked, code blocks disable the entire submenu,
            // tables allow only row-level conversion back to text, and nested list items show
            // same-family conversions only (方案 02 §2.4).
            const anchorLineText = lines[startLineRaw - 1] ?? "";
            const anchorBlockKind = detectBlockKind(lines, startLineRaw);
            let turnIntoMenuItem: ContextMenuItem | null = null;
            if (anchorBlockKind != null && isBlockEditorFeatureEnabled("turninto")) {
                const ctx: BlockCtx = {
                    text,
                    line: startLineRaw,
                    endLine,
                    kind: anchorBlockKind,
                    nested: /^\s+(?:[-+*]|\d+[.)])\s/.test(anchorLineText),
                };
                const items: ContextMenuItem[] = listBlockActions().map((action) => {
                    const checked = action.targetKind === anchorBlockKind;
                    const enabled = !checked && isBlockActionEnabled(action, ctx);
                    return {
                        label: action.label,
                        type: "checkbox" as const,
                        checked,
                        enabled,
                        click: () => {
                            const next = runBlockAction(action, ctx);
                            if (next == null || next.text === text) {
                                return;
                            }
                            handleInlineEditCommit(next.text, renumberOpts);
                        },
                    };
                });
                if (items.length > 0) {
                    turnIntoMenuItem = {
                        label: "Turn into",
                        type: "submenu",
                        submenu: items,
                        enabled: anchorBlockKind !== "code",
                    };
                }
            }

            const duplicateBlock = () => {
                const newFull = spliceInsertBlock(lines, startLineRaw, endLine, "after", blockSource.split(/\r\n|\n/)).join("\n");
                handleInlineEditCommit(newFull, renumberOpts);
            };
            const deleteBlock = () => {
                const newFull = deleteBlockRange(text, startLineRaw, endLine);
                handleInlineEditCommit(newFull, renumberOpts);
                setSelectedBlock(null);
            };

            const menu: ContextMenuItem[] = [
                { label: "复制", click: () => void copyBlock() },
                { label: "Copy Context", click: () => void copyContext() },
                { label: "复制为副本", click: duplicateBlock },
                ...(turnIntoMenuItem != null ? ([{ type: "separator" }, turnIntoMenuItem] as ContextMenuItem[]) : []),
                ...(numberingSubmenu != null
                    ? ([
                          { type: "separator" },
                          { label: "List numbering", type: "submenu", submenu: numberingSubmenu },
                      ] as ContextMenuItem[])
                    : []),
                { type: "separator" },
                { label: "删除", click: deleteBlock },
            ];
            ContextMenuModel.getInstance().showContextMenu(menu, e, {
                onClose: () => {
                    setSelectedBlock(null);
                    setSelectedRange(null);
                },
            });
        },
        [resolveBlockAnchorEl, text, handleInlineEditCommit, copyContextPath, pointerOnGripActionsRef, cancelPendingAnchorSwitch, handleGroupStartChange, resolveGroupContinuation]
    );

    // --- Block drag-and-drop handlers ---------------------------------------------------
    // The 4-dot grip is the drag handle (Notion/Obsidian style): hover reveals it, press and
    // drag to reorder. Clicking it still opens the block menu — HTML5 DnD and click are mutually
    // exclusive (a drag that moves never fires click). Dragging is disabled while the inline
    // editor is open (the grip only renders then anyway) and when no block is hovered.
    const resolveDragBlock = (hoveredLine: number): HTMLElement | null => {
        // Whole-block granularity, identical to the grip menu: an LI hover resolves to its parent
        // list so the whole list moves as one block.
        return resolveBlockAnchorEl(hoveredLine);
    };

    const handleBlockDragStart = useCallback(
        (e: React.DragEvent<HTMLDivElement>) => {
            const anchor = insertAnchorRef.current;
            if (anchor == null || inlineEdit.editSession != null) {
                e.preventDefault();
                return;
            }
            // Prefer the active multi-block selection (Ctrl/Cmd + drag select): dragging any block's
            // grip moves the WHOLE range. Fall back to the hovered single block when nothing is
            // selected, so single-block reorder still works as before.
            const range = selectedRangeRef.current;
            let start: number;
            let end: number;
            if (range != null) {
                start = range.startLine;
                end = range.endLine;
            } else {
                const el = resolveDragBlock(anchor.line);
                if (el == null) {
                    e.preventDefault();
                    return;
                }
                start = Number(el.dataset.sourceLine);
                const endRaw = el.dataset.sourceLineEnd != null ? Number(el.dataset.sourceLineEnd) : start;
                end = Number.isFinite(endRaw) && endRaw >= start ? endRaw : start;
            }
            dragSourceRef.current = { startLine: start, endLine: end };
            e.dataTransfer.effectAllowed = "move";
            // Firefox requires data to be set for a drag to actually start.
            e.dataTransfer.setData("text/plain", `${start}-${end}`);
            // Highlight what's moving: the whole selection range, or the single hovered block.
            setSelectedBlock(null);
            setSelectedRange({ startLine: start, endLine: end });
        },
        [inlineEdit, resolveBlockAnchorEl, selectedRangeRef]
    );

    const handleBlockDragEnd = useCallback(() => {
        dragSourceRef.current = null;
        setDropTarget(null);
    }, []);

    const handleBlockDragOver = useCallback(
        (e: React.DragEvent<HTMLDivElement>) => {
            const src = dragSourceRef.current;
            if (src == null) {
                return; // not a block drag in progress
            }
            const hovered = (e.target as HTMLElement).closest("[data-source-line]") as HTMLElement | null;
            if (hovered == null) {
                setDropTarget(null);
                return;
            }
            const blockEl = resolveDragBlock(Number(hovered.dataset.sourceLine)) ?? hovered;
            const line = Number(blockEl.dataset.sourceLine);
            // Dropping onto the source block itself is a no-op (can't move a block onto itself).
            if (line >= src.startLine && line <= src.endLine) {
                setDropTarget(null);
                return;
            }
            const rect = blockEl.getBoundingClientRect();
            const mid = rect.top + rect.height / 2;
            const mode: "before" | "after" = e.clientY < mid ? "before" : "after";
            e.preventDefault(); // mark the element as a valid drop target
            e.dataTransfer.dropEffect = "move";
            setDropTarget({
                line,
                mode,
                rect: { top: mode === "before" ? rect.top : rect.bottom, left: rect.left, width: rect.width },
            });
        },
        [resolveBlockAnchorEl]
    );

    const handleBlockDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        // Only clear when the pointer truly leaves the markdown root (relatedTarget is outside it),
        // not when it passes over child blocks (which fire dragleave/dragenter spuriously).
        const related = e.relatedTarget as Node | null;
        const root = e.currentTarget.querySelector(".markdown-render-root");
        if (related == null || root == null || !root.contains(related)) {
            setDropTarget(null);
        }
    }, []);

    const handleBlockDrop = useCallback(
        (e: React.DragEvent<HTMLDivElement>) => {
            const src = dragSourceRef.current;
            dragSourceRef.current = null;
            setDropTarget(null);
            if (src == null) {
                return;
            }
            const hovered = (e.target as HTMLElement).closest("[data-source-line]") as HTMLElement | null;
            if (hovered == null) {
                return;
            }
            const blockEl = resolveDragBlock(Number(hovered.dataset.sourceLine)) ?? hovered;
            const tgtLine = Number(blockEl.dataset.sourceLine);
            if (tgtLine >= src.startLine && tgtLine <= src.endLine) {
                return; // dropped on self
            }
            const rect = blockEl.getBoundingClientRect();
            const mid = rect.top + rect.height / 2;
            const mode: "before" | "after" = e.clientY < mid ? "before" : "after";
            e.preventDefault();
            // src is the full dragged range (a multi-block selection, or a single block). moveBlockRange
            // already handles a contiguous [srcStart..srcEnd], so dragging N selected blocks is free.
            const { text: movedText, newStartLine } = moveBlockRange(text, src.startLine, src.endLine, tgtLine, mode);
            if (movedText === text) {
                return; // no-op (defensive)
            }
            // Renumber based on the MOVED content (source block), not the drop target — so an ordered
            // list block keeps consecutive numbers after the move.
            const srcEl = resolveDragBlock(src.startLine);
            const isSourceList = srcEl != null && (srcEl.tagName === "LI" || srcEl.tagName === "OL" || srcEl.tagName === "UL");
            const renumberOpts = isSourceList ? { renumberOrderedListFromLine: newStartLine } : undefined;
            handleInlineEditCommit(movedText, renumberOpts);
            // Re-select the moved block(s) so the highlight follows them to the new position. The commit
            // re-renders through an async atom, so resolve the element after a couple of frames.
            const movedHeight = src.endLine - src.startLine;
            const reselectStart = newStartLine;
            const reselectEnd = newStartLine + movedHeight;
            let attempts = 0;
            const retry = () => {
                attempts++;
                const viewport = getViewportEl();
                const el = viewport?.querySelector<HTMLElement>(
                    `.markdown-render-root [data-source-line="${reselectStart}"]`
                );
                if (el != null) {
                    setSelectedBlock(null);
                    setSelectedRange({ startLine: reselectStart, endLine: reselectEnd });
                } else if (attempts < 10) {
                    requestAnimationFrame(retry);
                }
            };
            requestAnimationFrame(() => requestAnimationFrame(retry));
        },
        [text, resolveBlockAnchorEl, handleInlineEditCommit, getViewportEl]
    );

    const measureInsertAnchor = useCallback(() => {
        const anchor = insertAnchorRef.current;
        if (anchor == null) {
            setInsertPos(null);
            return;
        }
        const el = resolveInsertAnchorEl(anchor.line);
        if (el == null) {
            setInsertPos(null);
            return;
        }
        const rect = el.getBoundingClientRect();
        // X axis: for a list item (<li>) the bullet marker is rendered OUTSIDE the item's box
        // (list-style-position: outside), so anchoring off the <li> puts the grip's right edge
        // right on the bullet — worse when the markdown font size is enlarged (the 26px offset
        // is fixed while the marker widens). Anchor X to the parent <ul>/<ol> instead: the whole
        // list shares one grip column a fixed distance left of the bullet column, so it never
        // overlaps the marker regardless of font size. (Vertical anchor still uses the <li>'s
        // first line via rect.top.)
        let xAnchorLeft = rect.left;
        if (el.tagName === "LI") {
            const listEl = el.parentElement?.closest<HTMLElement>("ol, ul");
            if (listEl != null) {
                xAnchorLeft = listEl.getBoundingClientRect().left;
            }
        }
        // Grip sits in the gutter left of the block, anchored to the block's TOP-LEFT (like
        // Notion's handle): insertPos.top is the anchor center for translate(-50%, -50%), so
        // rect.top + 8 centers the 16px grip on the block's top edge (half above, half beside
        // the first line). NOT the vertical middle — centering on tall blocks (lists, code,
        // multi-line paragraphs) floated the grip mid-block, looking detached from the hovered
        // row. The insert actions (A/B) are placed relative to the same anchor in the JSX.
        // Clamp to viewport for far-left blocks (content has ~15px padding).
        // ponytail: the block's hovered row can be deep in a list (LI) while data-source-line
        // resolves to the UL — the grip then anchors to the list's top-left, acceptable.
        setInsertPos({ top: rect.top + 8, left: Math.max(xAnchorLeft - 26, 8) });
    }, [resolveInsertAnchorEl]);
    const insertAnchorRef = useRef<{ line: number } | null>(null);
    insertAnchorRef.current = insertAnchor;

    // Hover tracking on the render root: resolve the nearest [data-source-line] block,
    // skipping images (they own their click/right-click) and blocks we can't edit.
    const handleRootMouseOver = useCallback(
        (e: React.MouseEvent<HTMLDivElement>) => {
            if (!onInlineEditCommit) {
                return;
            }
            // Our own grip portal elements live on body: when React mounts/re-mounts them
            // under a stationary pointer, the browser fires a synthetic mouseover on them
            // (topmost element changed) whose target is not inside a [data-source-line] block.
            // Clearing the anchor there would unmount the grip → pointer over the block again
            // → re-mount → synthetic mouseover → … an every-frame flicker loop (the grip
            // visually jumps). Hovering C/A/B is a continuation of the same hover intent —
            // ignore and keep the anchor.
            if (
                e.target instanceof HTMLElement &&
                e.target.closest(".markdown-block-grip-dots, .markdown-block-grip-action") != null
            ) {
                return;
            }
            // During an inline edit: skip only when hovering the edited block itself (it's
            // visibility:hidden under the overlay anyway) — all OTHER blocks keep tracking
            // their hover anchor so the block grip / insert buttons stay usable mid-edit.
            if (inlineEdit.editSession != null) {
                const hovered = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-source-line]");
                if (
                    hovered != null &&
                    (hovered.classList.contains("inline-edit-hidden") || hovered.closest(".inline-edit-overlay") != null)
                ) {
                    return;
                }
            }
            // tablecell ON: suppress block grip on tables (handled by TableBlock's own handles).
            if (isBlockEditorFeatureEnabled("tablecell") && (e.target as HTMLElement)?.closest(".table-wrapper") != null) {
                setInsertAnchor(null);
                return;
            }
            const target = (e.target as HTMLElement | null)?.closest<HTMLElement>(
                "[data-source-line]:not(img)"
            );
            if (target == null || target.closest("img") != null) {
                // Non-block target (padding, gutter, spacers). Deliberately do NOT clear the
                // anchor here: the pointer moving from the block text toward the gutter grip
                // crosses the block's left boundary first, and a synchronous clear would
                // unmount the grip before the pointer reaches it. Leaving the block entirely
                // is handled by the OSB mouseleave → scheduleHideInsert's 400ms grace.
                return;
            }
            const lineAttr = target.dataset.sourceLine;
            if (lineAttr == null) {
                setInsertAnchor(null);
                return;
            }
            cancelHideInsert();
            // Action column (grip dots / +/- buttons): freeze the anchor entirely — never
            // switch blocks while the user is reaching for or holding the buttons.
            if ((e.target as HTMLElement | null)?.closest(".markdown-block-grip-dots, .markdown-block-grip-action") != null) {
                cancelPendingAnchorSwitch();
                return;
            }
            if (pointerOnGripActionsRef.current) {
                return;
            }
            const hoverLine = Number(lineAttr);
            // Clear any active block selection when hovering a block.
            setSelectedBlock(null);
            if (insertAnchorRef.current?.line === hoverLine) {
                cancelPendingAnchorSwitch();
                return;
            }
            // Different block: dwell briefly before re-anchoring so fast transit across a
            // neighbouring item doesn't yank the buttons away mid-move.
            cancelPendingAnchorSwitch();
            pendingAnchorSwitchRef.current = window.setTimeout(() => {
                pendingAnchorSwitchRef.current = null;
                setInsertAnchor({ line: hoverLine });
            }, MarkdownAnchorSwitchDelayMs);
        },
        [cancelHideInsert, cancelPendingAnchorSwitch, inlineEdit.editSession, onInlineEditCommit]
    );

    // Measure AFTER the anchor state has been committed to a render (so insertAnchorRef is
    // current) — measuring inside the mouseover handler races the render and reads a stale
    // ref, which left the buttons hidden forever. Synchronous call (no rAF): the effect runs
    // post-commit, DOM is up to date, and getBoundingClientRect forces the layout we need;
    // rAF would additionally stall in a background/occluded window where rAF is paused.
    useEffect(() => {
        if (insertAnchor == null) {
            setInsertPos(null);
            return;
        }
        measureInsertAnchor();
    }, [insertAnchor, measureInsertAnchor]);

    const handleRootMouseLeave = useCallback(() => {
        cancelPendingAnchorSwitch();
        scheduleHideInsert();
    }, [cancelPendingAnchorSwitch, scheduleHideInsert]);

    // Re-position the insert buttons while scrolling / resizing so they track the block.
    useEffect(() => {
        if (insertAnchor == null) {
            return;
        }
        const viewport = getViewportEl();
        const onScrollOrResize = () => requestAnimationFrame(measureInsertAnchor);
        viewport?.addEventListener("scroll", onScrollOrResize, { passive: true });
        window.addEventListener("resize", onScrollOrResize);
        return () => {
            viewport?.removeEventListener("scroll", onScrollOrResize);
            window.removeEventListener("resize", onScrollOrResize);
        };
    }, [getViewportEl, insertAnchor, measureInsertAnchor]);

    const handleInsertClick = useCallback(
        (mode: "before" | "after") => {
            // Clicking a grip action ends the hover-lock AND cancels any in-flight anchor switch,
            // so the buttons (showing the just-edited row) don't get stuck hidden and another
            // block's pending switch can't fire late and yank them away.
            pointerOnGripActionsRef.current = false;
            cancelPendingAnchorSwitch();
            const anchor = insertAnchorRef.current;
            if (anchor == null) {
                return;
            }
            cancelPendingAnchorSwitch();
            // Whole-block granularity: an LI hover resolves to its parent list so inserting
            // below a nested item lands after the WHOLE list, never mid-level.
            const el = resolveBlockAnchorEl(anchor.line);
            if (el == null) {
                return;
            }
            // Bracket the WHOLE block: multi-line blocks (lists, tables, code, soft-broken
            // paragraphs) carry data-source-line-end; "after" must splice below endLine or it
            // tears the block open (new row lands mid-list). Falls back to the start line for
            // legacy renders without the end attribute.
            const startLine = Number(el.dataset.sourceLine);
            const endLineRaw = el.dataset.sourceLineEnd != null ? Number(el.dataset.sourceLineEnd) : startLine;
            const endLine = Number.isFinite(endLineRaw) && endLineRaw >= startLine ? endLineRaw : startLine;

            // Inline-mode anchor: a plain paragraph (NOT a blank spacer) gets a soft-broken new
            // line flush inside the paragraph (no stray separator blank — the paragraph's own
            // surrounding blanks already bracket it). Every other block keeps the block-level
            // insert (a separated independent block), because pushing a new row inside a
            // heading / list / table / code / quote / hr would tear its structure.
            const isParagraph = el.tagName === "P" || el.classList.contains("paragraph");
            const isBlankSpacer = el.classList.contains("blank-spacer");
            // List items insert as REAL list items: the new row comes pre-filled with the
            // sibling marker (e.g. "3. ") and commits flush (no separator blanks — blanks
            // would split the list in two).
            const isListItem = el.tagName === "LI";
            const inlineMode = (isParagraph && !isBlankSpacer) || isListItem;

            // Insert a SINGLE blank row into the document immediately (so the preview visibly
            // gains one line the moment the user clicks), remember the pre-edit text for
            // Esc/empty-commit revert, and open a blank editor on that row. The final commit
            // replaces the row with the draft — inline paragraphs replace with no separator
            // blanks (flush new line), block-level anchors re-add separators as needed — so
            // one click nets exactly one new row/block, with no stray blanks left behind.
            const originalText = text;
            const sourceLines = text.split(/\r\n|\n/);

            // List items get a REAL sibling marker row ("4. " / "- ") instead of a blank line:
            // blank rows inside a list render as nothing (remark spacers are top-level only),
            // so the follow-up editor could never anchor and every mid-list insert silently
            // reverted ("+ does nothing on middle items" bug). The marker row renders as an
            // actual empty <li> the editor can own; typing fills it, commit renumbers via the
            // usual list path.
            const listItemAnchor = isListItem ? computeListInsertAnchor(text, startLine, mode) : null;
            let insertAtLine: number;
            let prefillMarker: string | undefined;
            if (listItemAnchor != null) {
                insertAtLine = listItemAnchor.insertAtLine;
                prefillMarker = listItemAnchor.prefillMarker || undefined;
            } else {
                insertAtLine = mode === "before" ? startLine : endLine + 1;
            }
            const insertIdx = Math.max(0, Math.min(insertAtLine - 1, sourceLines.length));
            const spliced = [...sourceLines];
            spliced.splice(insertIdx, 0, prefillMarker ?? "");
            handleInlineEditCommit(spliced.join("\n"));
            focusEditedLine(insertAtLine, () => handleInlineEditCommit(originalText), inlineMode ? "inline" : true, prefillMarker);

            setInsertAnchor(null);
            setInsertPos(null);
            setGripOpen(false);
        },
        [pointerOnGripActionsRef, cancelPendingAnchorSwitch, handleInlineEditCommit, resolveBlockAnchorEl, text, focusEditedLine]
    );

    const inlineEditKeyDown = useMemo(
        () =>
            makeInlineEditKeydown({
                commit: inlineEdit.commit,
                cancel: inlineEdit.cancel,
                save: onInlineEditSave,
                onSplitCaret: handleEnterSplit,
                onNavigateUp: handleNavigateUp,
            }),
        [inlineEdit.commit, inlineEdit.cancel, onInlineEditSave, handleEnterSplit, handleNavigateUp]
    );

    // === Block editor M2: slash palette + floating toolbar + inline-style shortcuts ===
    // === Block editor M3: emoji picker (":" trigger, lazy emojibase catalog) ==========
    // Detection is trigger-layer based (全/半角等价); every command executes through
    // block-editor/exec.ts so ONE gesture = ONE handleInlineEditCommit diff.
    const [slashState, setSlashState] = useState<{ query: string; triggerStart: number; activeIndex: number } | null>(null);
    const [emojiState, setEmojiState] = useState<{ query: string; triggerStart: number; activeIndex: number } | null>(null);
    const [emojiCatalog, setEmojiCatalog] = useState<EmojiCatalog | null>(() => getLoadedEmojiCatalog());
    const [inlineSelection, setInlineSelection] = useState<{ start: number; end: number } | null>(null);
    const editSessionKind = inlineEdit.editSession?.blockKind ?? null;

    // Emoji picker opened via `/emoji` slash command (separate from the ":" inline trigger).
    // This state tracks whether the picker is open, its anchor position, and search state.
    const [slashEmojiState, setSlashEmojiState] = useState<{
        open: boolean;
        anchor: { top: number; left: number } | null;
        query: string;
        activeIndex: number;
        catalog: EmojiCatalog | null;
    }>({ open: false, anchor: null, query: "", activeIndex: 0, catalog: null });

    // Any session teardown closes the transient block-editor UI with it.
    useEffect(() => {
        if (editSessionKind == null) {
            setSlashState(null);
            setEmojiState(null);
            setInlineSelection(null);
            setSlashEmojiState((s) => (s.open ? { ...s, open: false } : s));
        }
    }, [editSessionKind]);

    const trackEditorTriggers = useCallback(
        (draft: string, caret: number) => {
            // Neither ":" nor "/" triggers inside code or table cells (方案 02 §2.4 / 05 §0).
            if (editSessionKind === "code" || editSessionKind === "table") {
                setSlashState(null);
                setEmojiState(null);
                return;
            }
            const trig = detectInlineTrigger(draft, caret);
            if (trig != null && trig.command === "slash" && isBlockEditorFeatureEnabled("slash")) {
                setSlashState((prev) =>
                    prev != null && prev.triggerStart === trig.triggerStart
                        ? { ...prev, query: trig.query }
                        : { query: trig.query, triggerStart: trig.triggerStart, activeIndex: 0 }
                );
                setEmojiState(null);
                return;
            }
            if (trig != null && trig.command === "emoji" && isBlockEditorFeatureEnabled("emoji")) {
                // Lazy-load the ~500KB catalog exactly once per app run, on FIRST trigger.
                if (getLoadedEmojiCatalog() == null) {
                    void loadEmojiCatalog().then(setEmojiCatalog);
                }
                setEmojiState((prev) =>
                    prev != null && prev.triggerStart === trig.triggerStart
                        ? { ...prev, query: trig.query }
                        : { query: trig.query, triggerStart: trig.triggerStart, activeIndex: 0 }
                );
                setSlashState(null);
                return;
            }
            setSlashState(null);
            setEmojiState(null);
        },
        [editSessionKind]
    );

    const slashCtx = useMemo<BlockCtx | null>(() => {
        const session = inlineEdit.editSession;
        if (slashState == null || session == null) {
            return null;
        }
        const lines = text.split(/\r\n|\n/);
        return {
            text,
            line: session.startLine,
            endLine: session.endLine,
            kind: detectBlockKind(lines, session.startLine) ?? "text",
        };
    }, [slashState, inlineEdit.editSession, text]);

    const slashItems = useMemo(() => {
        if (slashCtx == null || slashState == null) {
            return [];
        }
        return filterSlashCommands(listSlashCommands(slashCtx), slashState.query);
    }, [slashCtx, slashState]);

    // Palette anchors on the trigger line inside the overlay textarea: approximate the row
    // offset via the session typography (line-height from the rendered block snapshot).
    const slashAnchor = useMemo(() => {
        const rect = inlineEdit.overlayRect;
        if (slashState == null || rect == null) {
            return null;
        }
        const typo = inlineEdit.editSession?.typography;
        const lhRaw = parseFloat(String(typo?.lineHeight ?? ""));
        const fsRaw = parseFloat(String(typo?.fontSize ?? ""));
        const lineHeight = Number.isFinite(lhRaw) && lhRaw > 4 ? lhRaw : (Number.isFinite(fsRaw) ? fsRaw : 14) * 1.5;
        const triggerRow = inlineEdit.draftText.slice(0, slashState.triggerStart).split("\n").length - 1;
        const approxHeight = Math.min(340, slashItems.length * 30 + 12);
        let top = rect.top + (triggerRow + 1) * lineHeight + 4;
        let placement: "top" | "bottom" = "bottom";
        if (top + approxHeight > window.innerHeight && rect.top > approxHeight) {
            top = rect.top + triggerRow * lineHeight - 4;
            placement = "top";
        }
        return { anchor: { top, left: rect.left + 16 }, placement };
    }, [slashState, inlineEdit.overlayRect, inlineEdit.draftText, inlineEdit.editSession, slashItems.length]);

    const blockKindForFocus = useCallback((kind: BlockKind): InlineEditBlockKind => {
        if (kind.startsWith("heading")) {
            return "h";
        }
        if (kind === "code") {
            return "code";
        }
        if (kind === "bulleted" || kind === "numbered" || kind === "todo") {
            return "list";
        }
        if (kind === "table") {
            return "table";
        }
        return "p";
    }, []);

    // Re-open the inline editor on a block after a command committed its transform, caret
    // landing where the command asked (absolute offset → relative to the block line).
    const refocusCommittedBlock = useCallback(
        (nextText: string, focusLine: number, caret?: number) => {
            const lines = nextText.split(/\r\n|\n/);
            const kind = detectBlockKind(lines, focusLine);
            if (kind == null) {
                return;
            }
            const relCaret = caret != null ? Math.max(0, caret - lineStartOffset(nextText, focusLine)) : undefined;
            focusEditedLine(focusLine, undefined, false, undefined, undefined, blockKindForFocus(kind), relCaret);
        },
        [focusEditedLine, blockKindForFocus]
    );

    // --- Slash-originated emoji picker: opened when a slash command returns `type: "open-picker"`. ---
    const handleSlashPickerOpen = useCallback(
        (picker: OpenPickerResult) => {
            if (picker.pickerType !== "emoji") {
                return; // only emoji picker supported for now
            }
            // Lazy-load the catalog if not yet loaded.
            if (getLoadedEmojiCatalog() == null) {
                void loadEmojiCatalog().then((cat) => {
                    setSlashEmojiState((s) => ({ ...s, catalog: cat }));
                });
            }
            // Anchor the picker at the current caret position in the overlay textarea.
            const rect = inlineEdit.overlayRect;
            const typo = inlineEdit.editSession?.typography;
            const lhRaw = parseFloat(String(typo?.lineHeight ?? ""));
            const fsRaw = parseFloat(String(typo?.fontSize ?? ""));
            const lineHeight = Number.isFinite(lhRaw) && lhRaw > 4 ? lhRaw : (Number.isFinite(fsRaw) ? fsRaw : 14) * 1.5;
            const caret = inlineEdit.textareaRef.current?.selectionStart ?? inlineEdit.draftText.length;
            const caretRow = inlineEdit.draftText.slice(0, caret).split("\n").length - 1;
            const approxHeight = 300;
            let top = rect != null ? rect.top + (caretRow + 1) * lineHeight + 4 : 200;
            let placement: "top" | "bottom" = "bottom";
            if (rect != null && top + approxHeight > window.innerHeight && rect.top > approxHeight) {
                top = rect.top + caretRow * lineHeight - 4;
                placement = "top";
            }
            const anchor = { top, left: (rect?.left ?? 100) + 16 };
            setSlashEmojiState((s) => ({
                ...s,
                open: true,
                anchor,
                query: "",
                activeIndex: 0,
                catalog: s.catalog ?? getLoadedEmojiCatalog(),
            }));
        },
        [inlineEdit]
    );

    const handleSlashPick = useCallback(
        (cmd: SlashCommandSpec) => {
            const session = inlineEdit.editSession;
            if (session == null || slashState == null) {
                return;
            }
            const caret = inlineEdit.textareaRef.current?.selectionStart ?? inlineEdit.draftText.length;
            const result = execSlashCommand(
                text,
                { session, draftText: inlineEdit.draftText, triggerStart: slashState.triggerStart, caret },
                cmd
            );
            setSlashState(null);
            if (result == null) {
                return;
            }
            // Picker dispatch: result.type === "open-picker" / "composite" opens a picker
            // instead of mutating the document. One branch, easy to extend (file, date, …).
            if (result.type === "open-picker" || result.type === "composite") {
                const pickerPart = result.type === "open-picker" ? result : result.openPicker;
                if (pickerPart != null) {
                    handleSlashPickerOpen(pickerPart as OpenPickerResult);
                    // Composite may also carry a text replacement — commit it first.
                    if (result.type === "composite" && result.textReplace != null) {
                        const tr = result.textReplace as TextReplaceResult & { text: string };
                        handleInlineEditCommit(
                            tr.text,
                            session.blockKind === "list" ? { renumberOrderedListFromLine: session.startLine } : undefined
                        );
                        // Don't dismiss yet; the picker will overlay for the next keystroke.
                    }
                }
                return;
            }
            // Common case: text-replace
            handleInlineEditCommit(
                result.text,
                session.blockKind === "list" ? { renumberOrderedListFromLine: session.startLine } : undefined
            );
            inlineEdit.dismiss();
            if (result.focusLine != null) {
                refocusCommittedBlock(result.text, result.focusLine, result.caret);
            }
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [inlineEdit, slashState, text, handleInlineEditCommit, refocusCommittedBlock]
    );

    const handleSessionBlockTransform = useCallback(
        (to: BlockKind) => {
            const session = inlineEdit.editSession;
            if (session == null) {
                return;
            }
            const result = transformSessionBlock(text, session, inlineEdit.draftText, to);
            if (result == null) {
                return;
            }
            handleInlineEditCommit(
                result.text,
                session.blockKind === "list" ? { renumberOrderedListFromLine: session.startLine } : undefined
            );
            inlineEdit.dismiss();
            if (result.focusLine != null) {
                refocusCommittedBlock(result.text, result.focusLine, result.caret);
            }
        },
        [inlineEdit, text, handleInlineEditCommit, refocusCommittedBlock]
    );

    const handleInlineStyle = useCallback(
        (style: InlineStyleId) => {
            const ta = inlineEdit.textareaRef.current;
            if (ta == null || inlineEdit.editSession == null) {
                return;
            }
            const next = applyInlineStyle(inlineEdit.draftText, ta.selectionStart, ta.selectionEnd, style);
            if (next == null) {
                return;
            }
            inlineEdit.setDraftText(next.text);
            setInlineSelection({ start: next.start, end: next.end });
            requestAnimationFrame(() => {
                const el = inlineEdit.textareaRef.current;
                if (el != null) {
                    el.focus({ preventScroll: true });
                    el.setSelectionRange(next.start, next.end);
                }
            });
        },
        [inlineEdit]
    );

    // === Emoji picker (M3): ":" trigger in the same textarea. Shares the slash
    // positioning math; Enter/Arrows/Esc handled in handleEditorKeyDown. ==============
    const emojiItems = useMemo(() => {
        if (emojiState == null || emojiCatalog == null) {
            return [];
        }
        return buildEmojiPickerItems(emojiCatalog, emojiState.query, []);
    }, [emojiState, emojiCatalog]);

    const emojiPickables = useMemo(() => emojiPickerEntries(emojiItems), [emojiItems]);

    const emojiAnchor = useMemo(() => {
        const rect = inlineEdit.overlayRect;
        if (emojiState == null || rect == null) {
            return null;
        }
        const typo = inlineEdit.editSession?.typography;
        const lhRaw = parseFloat(String(typo?.lineHeight ?? ""));
        const fsRaw = parseFloat(String(typo?.fontSize ?? ""));
        const lineHeight = Number.isFinite(lhRaw) && lhRaw > 4 ? lhRaw : (Number.isFinite(fsRaw) ? fsRaw : 14) * 1.5;
        const triggerRow = inlineEdit.draftText.slice(0, emojiState.triggerStart).split("\n").length - 1;
        const approxHeight = 300;
        let top = rect.top + (triggerRow + 1) * lineHeight + 4;
        let placement: "top" | "bottom" = "bottom";
        if (top + approxHeight > window.innerHeight && rect.top > approxHeight) {
            top = rect.top + triggerRow * lineHeight - 4;
            placement = "top";
        }
        return { anchor: { top, left: rect.left + 16 }, placement };
    }, [emojiState, inlineEdit.overlayRect, inlineEdit.draftText, inlineEdit.editSession]);

    const handleEmojiPick = useCallback(
        (entry: EmojiEntry) => {
            const ta = inlineEdit.textareaRef.current;
            if (emojiState == null) {
                return;
            }
            // Replace ":query" (trigger char .. caret) with the emoji, caret after it.
            const draft = inlineEdit.draftText;
            const caret = ta?.selectionStart ?? emojiState.triggerStart + 1 + emojiState.query.length;
            const next = draft.slice(0, emojiState.triggerStart) + entry.char + draft.slice(caret);
            const nextCaret = emojiState.triggerStart + entry.char.length;
            inlineEdit.setDraftText(next);
            recordRecentEmoji(entry.char);
            setEmojiState(null);
            requestAnimationFrame(() => {
                const el = inlineEdit.textareaRef.current;
                if (el != null) {
                    el.focus({ preventScroll: true });
                    el.setSelectionRange(nextCaret, nextCaret);
                }
            });
        },
        [emojiState, inlineEdit]
    );

    // === Slash-originated emoji picker: items, pick handler, keyboard nav ==========
    const slashEmojiItems = useMemo(() => {
        if (!slashEmojiState.open || slashEmojiState.catalog == null) {
            return [];
        }
        return buildEmojiPickerItems(slashEmojiState.catalog, slashEmojiState.query, getRecentEmojis());
    }, [slashEmojiState.open, slashEmojiState.catalog, slashEmojiState.query]);

    const slashEmojiPickables = useMemo(() => emojiPickerEntries(slashEmojiItems), [slashEmojiItems]);

    const handleSlashEmojiPick = useCallback(
        (entry: EmojiEntry) => {
            const ta = inlineEdit.textareaRef.current;
            if (!slashEmojiState.open || ta == null) {
                return;
            }
            // Insert the emoji at the current caret position (no trigger text to strip).
            const draft = inlineEdit.draftText;
            const cursorPos = ta.selectionStart;
            const next = draft.slice(0, cursorPos) + entry.char + draft.slice(cursorPos);
            const nextCaret = cursorPos + entry.char.length;
            inlineEdit.setDraftText(next);
            recordRecentEmoji(entry.char);
            setSlashEmojiState((s) => ({ ...s, open: false, query: "", activeIndex: 0 }));
            requestAnimationFrame(() => {
                if (ta != null) {
                    ta.focus({ preventScroll: true });
                    ta.setSelectionRange(nextCaret, nextCaret);
                }
            });
        },
        [slashEmojiState.open, inlineEdit]
    );

    const handleSlashEmojiClose = useCallback(() => {
        setSlashEmojiState((s) => ({ ...s, open: false, query: "", activeIndex: 0 }));
        // Return focus to the editor.
        requestAnimationFrame(() => {
            const el = inlineEdit.textareaRef.current;
            if (el != null) {
                el.focus({ preventScroll: true });
            }
        });
    }, [inlineEdit]);

    // === Block editor M4: table toolbar (方案 04 §1). Caret→(row,col) mapping drives
    // which row/column the ops touch; ops rewrite the DRAFT and commit on blur like any
    // other table edit (single commit channel, undo-friendly).
    const [tableCaret, setTableCaret] = useState<{ row: number; col: number } | null>(null);
    useEffect(() => {
        if (editSessionKind !== "table") {
            setTableCaret(null);
        }
    }, [editSessionKind]);

    const handleTableOp = useCallback(
        (op: TableOp) => {
            const ta = inlineEdit.textareaRef.current;
            if (ta == null || tableCaret == null) {
                return;
            }
            const draft = inlineEdit.draftText;
            const rowLine = tableCaret.row + 1;
            let next: string | null = null;
            switch (op.type) {
                case "insert-row":
                    next = insertTableRow(draft, rowLine);
                    break;
                case "delete-row":
                    next = deleteTableRow(draft, rowLine);
                    break;
                case "insert-col":
                    next = insertTableColumn(draft, rowLine, tableCaret.col, op.side);
                    break;
                case "delete-col":
                    next = deleteTableColumn(draft, rowLine, tableCaret.col);
                    break;
                case "align":
                    next = setColumnAlign(draft, rowLine, tableCaret.col, op.align);
                    break;
            }
            if (next == null || next === draft) {
                return;
            }
            inlineEdit.setDraftText(next);
            requestAnimationFrame(() => {
                const el = inlineEdit.textareaRef.current;
                if (el != null) {
                    el.focus({ preventScroll: true });
                }
            });
        },
        [inlineEdit, tableCaret]
    );

    const tableCaretAlign =
        tableCaret != null && editSessionKind === "table"
            ? getColumnAlign(inlineEdit.draftText, tableCaret.row + 1, tableCaret.col)
            : null;

    // === Block editor M5: document emoji (方案 05 §2) — frontmatter `emoji:` read from
    // the live text; writes go through the same single-commit funnel + autosave. =====
    const [docEmojiOpen, setDocEmojiOpen] = useState(false);
    const [docEmojiAnchor, setDocEmojiAnchor] = useState<{ top: number; left: number } | null>(null);
    const [docEmojiQuery, setDocEmojiQuery] = useState("");
    const [docEmojiActive, setDocEmojiActive] = useState(0);
    const docEmojiBadgeRef = useRef<HTMLButtonElement | null>(null);
    const docEmoji = useMemo(() => (isBlockEditorFeatureEnabled("docemoji") ? getFrontmatterEmoji(text) : null), [text]);

    const toggleDocEmojiPicker = useCallback(() => {
        if (docEmojiOpen) {
            setDocEmojiOpen(false);
            return;
        }
        const rect = docEmojiBadgeRef.current?.getBoundingClientRect();
        if (rect == null) {
            return;
        }
        if (getLoadedEmojiCatalog() == null) {
            void loadEmojiCatalog().then(setEmojiCatalog);
        }
        setDocEmojiQuery("");
        setDocEmojiActive(0);
        setDocEmojiAnchor({ top: rect.bottom + 6, left: Math.max(8, rect.right - 320) });
        setDocEmojiOpen(true);
    }, [docEmojiOpen]);

    const docEmojiItems = useMemo(
        () => (emojiCatalog == null || !docEmojiOpen ? [] : buildEmojiPickerItems(emojiCatalog, docEmojiQuery, getRecentEmojis())),
        [emojiCatalog, docEmojiOpen, docEmojiQuery]
    );
    const docEmojiPickables = useMemo(() => emojiPickerEntries(docEmojiItems), [docEmojiItems]);

    const applyDocEmoji = useCallback(
        (emoji: string | null) => {
            const next = setFrontmatterEmoji(text, emoji);
            setDocEmojiOpen(false);
            if (next !== text) {
                handleInlineEditCommit(next);
            }
        },
        [text, handleInlineEditCommit]
    );


    const handleEditorKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
            // Palette navigation swallows the keys before the edit keymap sees them.
            if (slashState != null && slashItems.length > 0) {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    setSlashState((s) =>
                        s == null
                            ? s
                            : {
                                  ...s,
                                  activeIndex:
                                      (s.activeIndex + (e.key === "ArrowDown" ? 1 : -1) + slashItems.length) %
                                      slashItems.length,
                              }
                    );
                    return;
                }
                if (e.key === "Enter") {
                    e.preventDefault();
                    const item = slashItems[slashState.activeIndex] ?? slashItems[0];
                    if (item != null) {
                        handleSlashPick(item);
                    }
                    return;
                }
            }
            if (slashState != null && e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setSlashState(null);
                return;
            }
            // Emoji picker nav — same shape as the slash palette.
            if (emojiState != null && emojiPickables.length > 0) {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    setEmojiState((s) =>
                        s == null
                            ? s
                            : {
                                  ...s,
                                  activeIndex:
                                      (s.activeIndex + (e.key === "ArrowDown" ? 1 : -1) + emojiPickables.length) %
                                      emojiPickables.length,
                              }
                    );
                    return;
                }
                if (e.key === "Enter") {
                    e.preventDefault();
                    const entry = emojiPickables[Math.min(emojiState.activeIndex, emojiPickables.length - 1)];
                    if (entry != null) {
                        handleEmojiPick(entry);
                    }
                    return;
                }
            }
            if (emojiState != null && e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setEmojiState(null);
                return;
            }
            // Slash-originated emoji picker: same nav shape as the inline emoji picker.
            if (slashEmojiState.open && slashEmojiPickables.length > 0) {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    setSlashEmojiState((s) => ({
                        ...s,
                        activeIndex:
                            (s.activeIndex + (e.key === "ArrowDown" ? 1 : -1) + slashEmojiPickables.length) %
                            slashEmojiPickables.length,
                    }));
                    return;
                }
                if (e.key === "Enter") {
                    e.preventDefault();
                    const entry = slashEmojiPickables[Math.min(slashEmojiState.activeIndex, slashEmojiPickables.length - 1)];
                    if (entry != null) {
                        handleSlashEmojiPick(entry);
                    }
                    return;
                }
            }
            if (slashEmojiState.open && e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                handleSlashEmojiClose();
                return;
            }
            const isMod = e.metaKey || e.ctrlKey;
            if (isMod && !e.altKey) {
                const sessKind = inlineEdit.editSession?.blockKind;
                const key = e.key.toLowerCase();
                // Inline styles (not inside code sessions — a code fork isn't prose).
                if (sessKind !== "code") {
                    if (!e.shiftKey && (key === "b" || key === "i" || key === "k")) {
                        e.preventDefault();
                        handleInlineStyle(key === "b" ? "bold" : key === "i" ? "italic" : "link");
                        return;
                    }
                    if (e.shiftKey && key === "x") {
                        e.preventDefault();
                        handleInlineStyle("strike");
                        return;
                    }
                    if (!e.shiftKey && e.key === "`") {
                        e.preventDefault();
                        handleInlineStyle("code");
                        return;
                    }
                }
                // Block-type transforms: ⌘0 text, ⌘1..6 headings, ⌘⇧7/8/9 numbered/bulleted/todo.
                if (sessKind != null && sessKind !== "code" && sessKind !== "table") {
                    const digitMap: Record<string, BlockKind> =
                        e.shiftKey
                            ? { Digit7: "numbered", Digit8: "bulleted", Digit9: "todo" }
                            : {
                                  Digit0: "text",
                                  Digit1: "heading1",
                                  Digit2: "heading2",
                                  Digit3: "heading3",
                                  Digit4: "heading4",
                                  Digit5: "heading5",
                                  Digit6: "heading6",
                              };
                    const to = digitMap[e.code];
                    if (to != null) {
                        e.preventDefault();
                        e.stopPropagation();
                        handleSessionBlockTransform(to);
                        return;
                    }
                }
            }
            inlineEditKeyDown(e);
        },
        [slashState, slashItems, handleSlashPick, emojiState, emojiPickables, handleEmojiPick, slashEmojiState, slashEmojiPickables, handleSlashEmojiPick, handleSlashEmojiClose, handleInlineStyle, handleSessionBlockTransform, inlineEdit, inlineEditKeyDown]
    );

    const toolbarAnchor = useMemo(() => {
        const rect = inlineEdit.overlayRect;
        if (rect == null) {
            return null;
        }
        let top = rect.top - 38;
        if (top < 8) {
            top = rect.top + rect.height + 6;
        }
        const left = Math.max(8, Math.min(window.innerWidth - 340, rect.left + rect.width / 2 - 170));
        return { top, left };
    }, [inlineEdit.overlayRect]);


    const toolbarBlockItems = useMemo(() => {
        const session = inlineEdit.editSession;
        if (session == null) {
            return [];
        }
        const lines = text.split(/\r\n|\n/);
        const kind = detectBlockKind(lines, session.startLine);
        const ctx: BlockCtx = {
            text,
            line: session.startLine,
            endLine: session.endLine,
            kind: kind ?? "text",
            nested: /^\s+(?:[-+*]|\d+[.)])\s/.test(lines[session.startLine - 1] ?? ""),
        };
        return listBlockActions().map((a) => ({
            id: a.id,
            label: a.label,
            active: a.targetKind === ctx.kind,
            enabled: a.targetKind !== ctx.kind && isBlockActionEnabled(a, ctx),
        }));
    }, [inlineEdit.editSession, text]);

    const currentBlockLabel = useMemo(() => {
        const active = toolbarBlockItems.find((i) => i.active);
        return active?.label ?? "Text";
    }, [toolbarBlockItems]);

    const normalizedScrollTargetText = useMemo(
        () => normalizeScrollTargetText(scrollTargetText ?? ""),
        [scrollTargetText]
    );

    // 折叠标题的「内容隐藏」走命令式 `.collapsed-hidden`：标题自己的 chevron/collapsed class
    // 是声明式（React 渲染派生），而正文的隐藏是渲染后补在 DOM 上的。若 ReactMarkdown 子树
    // 发生 remount（DOM 重建）而 collapsedHeadings/transformedText 都没变，旧 effect 就不会
    // 重跑 → 新 DOM 上 `.collapsed-hidden` 丢失 → 标题显示「已折叠（chevron→Expand）」但内容
    // 仍展开 → 折叠与展开样式不匹配。因此这里必须「每次提交后都同步」（useLayoutEffect 无
    // deps）：无论 remount 还是状态变化，render 提交后立即重算，且发生在 paint 前（无闪跳）。
    // === Scroll / collapse visibility sync ==============================================

    const updateCollapsedHeadingVisibility = () => {
        if (!contentsOsRef.current?.osInstance()) {
            return;
        }
        const { viewport } = contentsOsRef.current.osInstance().elements();
        const root = viewport.querySelector(".markdown-render-root");
        if (root == null) {
            return;
        }
        const flags = computeCollapsedHiddenFlags(
            Array.from(root.children, (elem) => {
                const elemEl = elem as HTMLElement;
                const headingLevelValue = Number(elemEl.dataset.headingLevel);
                return {
                    level: Number.isFinite(headingLevelValue) && headingLevelValue > 0 ? headingLevelValue : null,
                    id: elemEl.dataset.headingId ?? null,
                };
            }),
            collapsedHeadings
        );
        // 用户实际 toggle 折叠/展开时（collapsedHeadings 引用变化）钉住阅读位置：折叠用
        // display:none 移除章节高度，Chromium 的滚动锚定算法会挑错锚点（跳到文档顶/底）
        // 或在锚点被隐藏后强制钳制。这里选一个「折叠后仍可见、且位于视口顶部附近」的块，
        // 应用 class 前后测量其顶部位移，反向补偿 scrollTop，让阅读内容原地不动。
        const isUserToggle =
            collapsedHeadingsPrevRef.current != null && collapsedHeadingsPrevRef.current !== collapsedHeadings;
        const viewportTop = viewport.getBoundingClientRect().top;
        let pinIndex: number | null = null;
        let pinOldTop = 0;
        if (isUserToggle) {
            const preToggleBottoms = Array.from(root.children, (elem) =>
                (elem as HTMLElement).getBoundingClientRect().bottom
            );
            pinIndex = findCollapsedScrollPinIndex(flags, preToggleBottoms, viewportTop);
            if (pinIndex != null) {
                pinOldTop = (root.children[pinIndex] as HTMLElement).getBoundingClientRect().top;
            }
        }
        Array.from(root.children).forEach((elem, i) => {
            (elem as HTMLElement).classList.toggle("collapsed-hidden", flags[i]);
        });
        if (isUserToggle && pinIndex != null) {
            const pinNewTop = (root.children[pinIndex] as HTMLElement).getBoundingClientRect().top;
            const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
            viewport.scrollTop = Math.max(0, Math.min(viewport.scrollTop + (pinNewTop - pinOldTop), maxScrollTop));
        }
        collapsedHeadingsPrevRef.current = collapsedHeadings;
    };

    // 每次提交后同步（无 deps 数组）：见 updateCollapsedHeadingVisibility 注释——折叠可见性
    // 不能只在 collapsedHeadings/transformedText 变化时修补，remount 后必须无条件重算。
    useLayoutEffect(() => {
        updateCollapsedHeadingVisibility();
    });

    useLayoutEffect(() => {
        const instance = contentsOsRef.current?.osInstance();
        if (!instance) {
            previousTransformedTextRef.current = transformedText;
            return;
        }
        const { viewport } = instance.elements();
        const previousTransformedText = previousTransformedTextRef.current;
        if (previousTransformedText != null && previousTransformedText !== transformedText) {
            // OverlayScrollbars resets scrollTop during ReactMarkdown's child re-mount for one
            // visible frame — the user sees a flash to the top before we set it back. Mask that
            // frame: hide the viewport's contents for the layout pass, snap scrollTop to the
            // user's live ref position, then reveal on the next animation frame once layout has
            // stabilized. visibility:hidden (vs display:none) keeps the box geometry intact so the
            // restore scrollTop value lands on the right row, the OS only skips painting the glow.
            // Mask exactly one frame while we snap scrollTop back. The reveal must NEVER ride
            // on rAF alone: on a hidden/occluded window (background Electron window, minimized,
            // fully covered by another window) rAF callbacks never run, so the viewport stayed
            // visibility:hidden forever — the whole preview went blank after any inline edit
            // ("typed a line, nothing renders" bug). A timeout fallback guarantees recovery on
            // hidden pages (timers still fire, throttled to ≥1s), and restoring "" instead of
            // the captured prevVisibility avoids re-applying a "hidden" value that an earlier
            // interrupted cycle left behind (one stuck cycle used to poison all later ones).
            // This effect is the only writer of inline visibility on the viewport, so "" is
            // always the correct visible state.
            viewport.style.visibility = "hidden";
            viewport.scrollTop = lastViewportScrollTopRef.current;
            const revealViewport = () => {
                viewport.style.visibility = "";
            };
            requestAnimationFrame(revealViewport);
            setTimeout(revealViewport, 120);
            liveScrollDebug("restore preview scroll after content update", {
                restoredScrollTop: lastViewportScrollTopRef.current,
            });
        }
        previousTransformedTextRef.current = transformedText;
    }, [transformedText]);

    useEffect(() => {
        if (!hideUntilInitialScroll) {
            setInitialScrollReadyKey(transformedText);
            onInitialScrollReady?.();
            return;
        }
        const timer = window.setTimeout(() => {
            setInitialScrollReadyKey((readyKey) => {
                if (readyKey == null) {
                    onInitialScrollReady?.();
                    return transformedText;
                }
                return readyKey;
            });
        }, InitialScrollRevealFallbackMs);
        return () => window.clearTimeout(timer);
    }, [hideUntilInitialScroll, onInitialScrollReady, transformedText]);

    const shouldHideForInitialScroll = hideUntilInitialScroll && initialScrollReadyKey !== transformedText;

    // useCallback 稳定 toggle 函数：它们被 markdownComponents 的 h1-h6/li/table 组件捕获，
    // 若每次渲染都是新引用，components useMemo 每次失效 → 整树 remount → 拖选中的选中态
    // 被销毁。依赖仅是可选 onChange 回调（preview 侧已 useCallback 稳定）。
    const toggleHeadingCollapse = useCallback(
        (headingId: string) => {
            setCollapsedHeadings((prev) => {
                const next = new Set(prev);
                if (next.has(headingId)) {
                    next.delete(headingId);
                } else {
                    next.add(headingId);
                }
                onCollapsedHeadingsChange?.(next);
                return next;
            });
        },
        [onCollapsedHeadingsChange]
    );

    const toggleOrderedListItemCollapse = useCallback(
        (itemId: string) => {
            setCollapsedOrderedListItems((prev) => {
                const next = new Set(prev);
                if (next.has(itemId)) {
                    next.delete(itemId);
                } else {
                    next.add(itemId);
                }
                onCollapsedOrderedListItemsChange?.(next);
                return next;
            });
        },
        [onCollapsedOrderedListItemsChange]
    );

    const toggleTableCollapse = useCallback(
        (tableKey: string) => {
            setCollapsedTables((prev) => {
                const next = new Set(prev);
                if (next.has(tableKey)) {
                    next.delete(tableKey);
                } else {
                    next.add(tableKey);
                }
                onCollapsedTablesChange?.(next);
                return next;
            });
        },
        [onCollapsedTablesChange]
    );

    const focusHeading = useCallback(
        (href: string) => {
            const headingId = getHeadingIdFromHref(idPrefix, href);
            setCollapsedHeadings((prev) => {
                if (!prev.has(headingId)) {
                    return prev;
                }
                const next = new Set(prev);
                next.delete(headingId);
                return next;
            });
            setFocusedHeadingId(headingId);
        },
        // 稳定引用：被 markdownComponents 的 a 组件捕获，若每次渲染都是新函数，components
        // useMemo 每次失效 → 整树 remount → 拖选中的选中态被销毁。idPrefix 稳定（useState
        // 初始值），此回调在渲染间引用不变。
        [idPrefix]
    );

    const focusHeadingLine = (lineNumber: number) => {
        const instance = contentsOsRef.current?.osInstance();
        if (!instance) {
            return;
        }
        const { viewport } = instance.elements();
        const heading = viewport.querySelector<HTMLElement>(
            `.markdown-render-root .heading[data-source-line="${lineNumber}"]`
        );
        if (!heading) {
            return;
        }
        const headingId = heading.dataset.headingId;
        if (headingId) {
            setCollapsedHeadings((prev) => {
                if (!prev.has(headingId)) {
                    return prev;
                }
                const next = new Set(prev);
                next.delete(headingId);
                return next;
            });
        }
        const headingBoundingRect = heading.getBoundingClientRect();
        const viewportBoundingRect = viewport.getBoundingClientRect();
        const headingTop = headingBoundingRect.top - viewportBoundingRect.top;
        viewport.scrollBy({ top: headingTop });
    };

    useEffect(() => {
        if (focusedHeadingId && contentsOsRef.current && contentsOsRef.current.osInstance()) {
            const { viewport } = contentsOsRef.current.osInstance().elements();
            const heading = document.getElementById(focusedHeadingId);
            if (heading) {
                const headingBoundingRect = heading.getBoundingClientRect();
                const viewportBoundingRect = viewport.getBoundingClientRect();
                const headingTop = headingBoundingRect.top - viewportBoundingRect.top;
                viewport.scrollBy({ top: headingTop });
            }
        }
    }, [focusedHeadingId]);

    const applyScrollTarget = (trigger: string) => {
        if (scrollTargetLine == null || !contentsOsRef.current?.osInstance()) {
            lastAppliedScrollTargetRef.current = null;
            liveScrollDebug("skip preview scroll: no target or no instance", {
                trigger,
                hasTarget: scrollTargetLine != null,
                hasInstance: !!contentsOsRef.current?.osInstance(),
            });
            return;
        }
        const { viewport } = contentsOsRef.current.osInstance().elements();
        if (scrollTargetSourceState?.origin === "preview" && Date.now() < scrollTargetSourceState.previewControlUntil) {
            liveScrollDebug("skip preview scroll: preview owns scroll", {
                trigger,
                scrollTargetLine,
                sourceSequence: scrollTargetSourceState.sequence,
                previewControlUntil: scrollTargetSourceState.previewControlUntil,
            });
            setInitialScrollReadyKey(transformedText);
            onInitialScrollReady?.();
            return;
        }
        const previewRemainingPx = Math.max(0, viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop);
        const bottomCompensationPx =
            scrollTargetSourceState?.bottomScrollIntent &&
            scrollTargetSourceState.isAtBottom &&
            scrollTargetSourceState.direction === "down" &&
            previewRemainingPx > ScrollTargetTolerancePx
                ? Math.min(BottomCompensationStepPx, previewRemainingPx)
                : 0;
        const lastAppliedTarget = lastAppliedScrollTargetRef.current;
        if (lastAppliedTarget?.line === scrollTargetLine && lastAppliedTarget.text === transformedText) {
            if (bottomCompensationPx <= 0) {
                liveScrollDebug("skip preview scroll: duplicate target", { trigger, scrollTargetLine });
                setInitialScrollReadyKey(transformedText);
                onInitialScrollReady?.();
                return;
            }
            programmaticScrollUntilRef.current = Date.now() + ProgrammaticScrollIgnoreMs;
            liveScrollDebug("apply preview bottom compensation", {
                trigger,
                scrollTargetLine,
                bottomCompensationPx,
                previewRemainingPx,
                sourceSequence: scrollTargetSourceState?.sequence,
                previousScrollTop: viewport.scrollTop,
            });
            viewport.scrollBy({ top: bottomCompensationPx, behavior: scrollTargetBehavior });
            lastViewportScrollTopRef.current = viewport.scrollTop;
            setInitialScrollReadyKey(transformedText);
            onInitialScrollReady?.();
            return;
        }
        const lineElems = Array.from(viewport.querySelectorAll<HTMLElement>("[data-source-line]"));
        if (lineElems.length === 0) {
            liveScrollDebug("skip preview scroll: no source line elements", { trigger, scrollTargetLine });
            return;
        }
        let targetElem: HTMLElement | null = null;
        let targetElemIndex = -1;
        for (const elem of lineElems) {
            const elemIndex = lineElems.indexOf(elem);
            const elemLine = Number(elem.dataset.sourceLine);
            if (!Number.isFinite(elemLine)) {
                continue;
            }
            if (elemLine <= scrollTargetLine) {
                targetElem = elem;
                targetElemIndex = elemIndex;
                continue;
            }
            if (targetElem == null) {
                targetElem = elem;
                targetElemIndex = elemIndex;
            }
            break;
        }
        if (targetElem == null) {
            targetElem = lineElems[lineElems.length - 1];
            targetElemIndex = lineElems.length - 1;
        }
        let textMatched = false;
        if (normalizedScrollTargetText.length >= 3 && targetElemIndex >= 0) {
            const startIndex = Math.max(0, targetElemIndex - ScrollTextMatchWindow);
            const endIndex = Math.min(lineElems.length - 1, targetElemIndex + ScrollTextMatchWindow);
            for (let index = startIndex; index <= endIndex; index++) {
                const elem = lineElems[index];
                const elemText = getElementTextForScrollMatch(elem);
                if (elemText.length < 3) {
                    continue;
                }
                if (elemText.includes(normalizedScrollTargetText) || normalizedScrollTargetText.includes(elemText)) {
                    targetElem = elem;
                    targetElemIndex = index;
                    textMatched = true;
                    break;
                }
            }
        }
        const targetSourceLine = Number(targetElem.dataset.sourceLine);
        const targetBoundingRect = targetElem.getBoundingClientRect();
        const viewportBoundingRect = viewport.getBoundingClientRect();
        const targetTop = targetBoundingRect.top - viewportBoundingRect.top;
        const isAlreadyNearTarget = Math.abs(targetTop - ScrollTargetTopOffset) <= ScrollTargetTolerancePx;
        if (isAlreadyNearTarget && bottomCompensationPx <= 0) {
            lastAppliedScrollTargetRef.current = { line: scrollTargetLine, text: transformedText };
            liveScrollDebug("skip preview scroll: already near target", {
                trigger,
                scrollTargetLine,
                scrollTargetText,
                textMatched,
                targetSourceLine,
                targetTop,
            });
            setInitialScrollReadyKey(transformedText);
            onInitialScrollReady?.();
            return;
        }
        programmaticScrollUntilRef.current = Date.now() + ProgrammaticScrollIgnoreMs;
        const scrollDelta = (isAlreadyNearTarget ? 0 : targetTop - ScrollTargetTopOffset) + bottomCompensationPx;
        liveScrollDebug("apply preview scroll", {
            trigger,
            scrollTargetLine,
            scrollTargetText,
            textMatched,
            targetSourceLine,
            targetTop,
            delta: scrollDelta,
            behavior: scrollTargetBehavior,
            bottomCompensationPx,
            previewRemainingPx,
            sourceSequence: scrollTargetSourceState?.sequence,
            previousScrollTop: viewport.scrollTop,
        });
        viewport.scrollBy({ top: scrollDelta, behavior: scrollTargetBehavior });
        lastViewportScrollTopRef.current = viewport.scrollTop;
        lastAppliedScrollTargetRef.current = { line: scrollTargetLine, text: transformedText };
        setInitialScrollReadyKey(transformedText);
        onInitialScrollReady?.();
    };

    useEffect(() => {
        applyScrollTarget("effect");
    }, [
        normalizedScrollTargetText,
        scrollTargetBehavior,
        scrollTargetLine,
        scrollTargetSourceState?.sequence,
        transformedText,
    ]);

    // Restore the caller's savedScrollTop once per mount, after the ReactMarkdown subtree has
    // produced content (so scrollHeight reflects the file). Skipped when scrollTargetLine is set —
    // a "preview:searchline" jump from block.meta takes precedence (mirrors the editor viewState
    // vs revealSearchTargetLine precedence in preview-edit.tsx). Two rAF passes handle the common
    // case where images/mermaid still inflate scrollHeight on the first frame.
    useEffect(() => {
        if (savedScrollTopAppliedRef.current) {
            return;
        }
        if (savedScrollTop == null || !Number.isFinite(savedScrollTop) || savedScrollTop <= 0) {
            return;
        }
        if (scrollTargetLine != null && Number.isFinite(scrollTargetLine)) {
            savedScrollTopAppliedRef.current = true;
            return;
        }
        const instance = contentsOsRef.current?.osInstance();
        const viewport = instance?.elements().viewport;
        if (!viewport || !transformedText) {
            return;
        }
        if (viewport.scrollHeight <= viewport.clientHeight) {
            return; // wait for content to populate
        }
        viewport.scrollTop = savedScrollTop;
        programmaticScrollUntilRef.current = Date.now() + ProgrammaticScrollIgnoreMs;
        savedScrollTopAppliedRef.current = true;
        // Re-apply on the next two frames in case scrollHeight grows after images/code settle.
        const raf1 = requestAnimationFrame(() => {
            const inst = contentsOsRef.current?.osInstance();
            const vp = inst?.elements().viewport;
            if (vp) {
                vp.scrollTop = savedScrollTop;
                programmaticScrollUntilRef.current = Date.now() + ProgrammaticScrollIgnoreMs;
            }
        });
        const raf2 = requestAnimationFrame(() => {
            const inst = contentsOsRef.current?.osInstance();
            const vp = inst?.elements().viewport;
            if (vp) {
                vp.scrollTop = savedScrollTop;
                programmaticScrollUntilRef.current = Date.now() + ProgrammaticScrollIgnoreMs;
            }
        });
        return () => {
            cancelAnimationFrame(raf1);
            cancelAnimationFrame(raf2);
        };
    }, [savedScrollTop, scrollTargetLine, transformedText]);

    // Cancel any pending scrollTop write-back on unmount.
    useEffect(() => {
        return () => {
            if (scrollTopWriteRafRef.current != null) {
                cancelAnimationFrame(scrollTopWriteRafRef.current);
                scrollTopWriteRafRef.current = null;
            }
        };
    }, []);

    const handleMarkdownScroll = () => {
        // Always sync the live scrollTop into the ref, even when we're going to bail below. The ref
        // is the restore-ancla for the useLayoutEffect that runs after `transformedText` changes
        // (line 963 → viewport.scrollTop = lastViewportScrollTopRef.current on a content update).
        // Without this line, in preview mode (where onUserScrollSourceLine is null) the ref would
        // stay at its initial 0 — so any save / inline-edit commit that flips transformedText
        // yanks the viewport back to the top of the file. Hijacking early-return here is the
        // smallest patch: the user-visible scroll position stays live across edits + saves.
        const instance = contentsOsRef.current?.osInstance();
        if (instance) {
            const { viewport } = instance.elements();
            lastViewportScrollTopRef.current = viewport.scrollTop;
        }
        if (Date.now() < programmaticScrollUntilRef.current) {
            return;
        }
        if (onScrollTopChange != null && instance) {
            const { viewport } = instance.elements();
            // Debounce on rAF so a flinging trackpad doesn't write on every pixel.
            if (scrollTopWriteRafRef.current != null) {
                cancelAnimationFrame(scrollTopWriteRafRef.current);
            }
            const st = viewport.scrollTop;
            scrollTopWriteRafRef.current = requestAnimationFrame(() => {
                scrollTopWriteRafRef.current = null;
                onScrollTopChange(st);
            });
        }
        if (onUserScrollSourceLine == null) {
            return;
        }
        if (!instance) {
            return;
        }
        const { viewport } = instance.elements();
        const viewportBoundingRect = viewport.getBoundingClientRect();
        const lineElems = Array.from(viewport.querySelectorAll<HTMLElement>("[data-source-line]"));
        if (lineElems.length === 0) {
            return;
        }
        let targetLine: number | null = null;
        let smallestDistance = Number.POSITIVE_INFINITY;
        for (const elem of lineElems) {
            const elemLine = Number(elem.dataset.sourceLine);
            if (!Number.isFinite(elemLine)) {
                continue;
            }
            const elemTop = elem.getBoundingClientRect().top - viewportBoundingRect.top;
            const distance = Math.abs(elemTop - ScrollTargetTopOffset);
            if (elemTop <= ScrollTargetTopOffset) {
                targetLine = elemLine;
                continue;
            }
            if (targetLine == null && distance < smallestDistance) {
                targetLine = elemLine;
                smallestDistance = distance;
            }
            break;
        }
        if (targetLine == null) {
            const lastElem = lineElems[lineElems.length - 1];
            const elemLine = Number(lastElem.dataset.sourceLine);
            targetLine = Number.isFinite(elemLine) ? elemLine : null;
        }
        if (targetLine != null) {
            onUserScrollSourceLine(targetLine);
        }
    };

    // === ReactMarkdown component map + JSX render =========================================

    // useMemo 稳定整张 components 映射（根治「拖选文本时选中态被销毁」）：
    // 若 a/p/h1-h6/…/pre/mermaidblock 每次渲染都重建（内联箭头函数），元素 type 引用每次
    // 不同 → React 判定组件类型变化 → 卸载重挂整个 block 子树 → 浏览器销毁挂在其上的
    // SelectionRange → 鼠标拖选「一选中就取消」；2aafe0d2 修过的 waveblock remount 丢
    // state 也会复发（见 1359 行注释「hover 重渲染会替换块的 DOM 节点」）。memo 命中条件：
    // 依赖除 collapsed 集合（变化时本来就要重渲染）外均为 useCallback/useMemo 稳定引用，
    // 鼠标移动（insertAnchor）/滚动（insertPos）等无关重渲染不再重建组件 → DOM 保留 →
    // 选中态与折叠态一并保住。
    const markdownComponents = useMemo<Partial<Components>>(() => {
        const getTextContent = (children: any): string => {
            if (typeof children === "string") {
                return children;
            } else if (Array.isArray(children)) {
                return children.map(getTextContent).join("");
            } else if (children && typeof children === "object" && children.props && children.props.children) {
                return getTextContent(children.props.children);
            }
            return String(children || "");
        };
        const components: Partial<Components> = {
            a: (props: React.HTMLAttributes<HTMLAnchorElement>) => (
                <Link
                    props={props}
                    focusHeading={focusHeading}
                    resolveOpts={resolveOpts}
                    onHoverIn={onInlineEditCommit != null ? handleLinkHoverIn : undefined}
                    onHoverOut={onInlineEditCommit != null ? handleLinkHoverOut : undefined}
                />
            ),
            p: (props: React.HTMLAttributes<HTMLParagraphElement>) => (
                <div className="paragraph" {...props} {...srcLineAttrs(props)} />
            ),
            h1: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
                <CollapsibleHeading
                    props={props}
                    hnum={1}
                    collapsed={collapsedHeadings.has(String(props.id))}
                    onToggle={toggleHeadingCollapse}
                />
            ),
            h2: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
                <CollapsibleHeading
                    props={props}
                    hnum={2}
                    collapsed={collapsedHeadings.has(String(props.id))}
                    onToggle={toggleHeadingCollapse}
                />
            ),
            h3: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
                <CollapsibleHeading
                    props={props}
                    hnum={3}
                    collapsed={collapsedHeadings.has(String(props.id))}
                    onToggle={toggleHeadingCollapse}
                />
            ),
            h4: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
                <CollapsibleHeading
                    props={props}
                    hnum={4}
                    collapsed={collapsedHeadings.has(String(props.id))}
                    onToggle={toggleHeadingCollapse}
                />
            ),
            h5: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
                <CollapsibleHeading
                    props={props}
                    hnum={5}
                    collapsed={collapsedHeadings.has(String(props.id))}
                    onToggle={toggleHeadingCollapse}
                />
            ),
            h6: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
                <CollapsibleHeading
                    props={props}
                    hnum={6}
                    collapsed={collapsedHeadings.has(String(props.id))}
                    onToggle={toggleHeadingCollapse}
                />
            ),
            hr: (props: React.HTMLAttributes<HTMLHRElement>) => (
                <hr {...props} {...srcLineAttrs(props)} />
            ),
            table: (props: React.HTMLAttributes<HTMLTableElement>) => (
                isBlockEditorFeatureEnabled("tablecell") ? (
                    <TableBlock
                        props={props}
                        collapsed={collapsedTables.has(String(getSourceLine(props)))}
                        onToggle={() => toggleTableCollapse(String(getSourceLine(props)))}
                    />
                ) : (
                    <CollapsibleTable
                        props={props}
                        collapsed={collapsedTables.has(String(getSourceLine(props)))}
                        onToggle={() => toggleTableCollapse(String(getSourceLine(props)))}
                    />
                )
            ),
            ol: (props: React.OlHTMLAttributes<HTMLOListElement>) => (
                <MarkdownOrderedList props={props} collapsible={collapsibleOrderedLists} />
            ),
            ul: MarkdownUnorderedList,
            li: (props: React.HTMLAttributes<HTMLLIElement>) => (
                <MarkdownListItem
                    props={props}
                    collapsed={collapsedOrderedListItems.has(getOrderedListItemId(props))}
                    onToggle={toggleOrderedListItemCollapse}
                />
            ),
            img: (props: React.HTMLAttributes<HTMLImageElement>) => (
                <MarkdownImg
                    props={props}
                    resolveOpts={resolveOpts}
                    fullText={text}
                    onInlineEditCommit={handleInlineEditCommit}
                />
            ),
            source: (props: React.HTMLAttributes<HTMLSourceElement>) => (
                <MarkdownSource props={props} resolveOpts={resolveOpts} />
            ),
            code: Code,
            pre: (props: React.HTMLAttributes<HTMLPreElement>) => {
                const langMatch = (props.children as any)?.props?.className?.match(/language-([\w+#.-]+)/);
                const lang: string | null = langMatch?.[1] ?? null;
                const srcLine = getSourceLine(props);
                return (
                    <CodeBlock
                        children={props.children}
                        onClickExecute={onClickExecute}
                        sourceLine={srcLine}
                        sourceLineEnd={getSourceLineEnd(props)}
                        language={lang}
                        onApplyLanguage={
                            onInlineEditCommit != null && srcLine != null && isBlockEditorFeatureEnabled("codelang")
                                ? (nextLang) => {
                                      const next = setCodeBlockLanguage(text, srcLine, nextLang);
                                      if (next != null) {
                                          handleInlineEditCommit(next);
                                      }
                                  }
                                : undefined
                        }
                    />
                );
            },
        };
        // Non-standard tags (waveblock, mermaidblock) are bracket-assigned to avoid TS
        // excess-property checks on the literal — the original code used this exact pattern
        // before the useMemo refactor.
        components["waveblock"] = (props: any) => (
            <WaveBlock {...props} blockmap={contentBlocksMap} renderers={waveBlockRenderers} />
        );
        components["mermaidblock"] = (props: any) => {
            const chartText = getTextContent(props.children);
            return <Mermaid chart={chartText} />;
        };
        // Clickable task checkboxes only exist when the caller opted into inline editing;
        // otherwise keep react-markdown's default disabled <input>.
        if (onInlineEditCommit != null) {
            components["input"] = (props: any) => (
                <MarkdownTaskCheckbox props={props} onToggle={handleTaskCheckboxToggle} />
            );
        }
        return components;
    }, [
        focusHeading,
        resolveOpts,
        collapsedHeadings,
        toggleHeadingCollapse,
        collapsedTables,
        toggleTableCollapse,
        collapsibleOrderedLists,
        collapsedOrderedListItems,
        toggleOrderedListItemCollapse,
        onClickExecute,
        text,
        handleInlineEditCommit,
        onInlineEditCommit,
        handleTaskCheckboxToggle,
        handleLinkHoverIn,
        handleLinkHoverOut,
        contentBlocksMap,
        waveBlockRenderers,
    ]);

    const tocItems = useMemo<MarkdownOutlineItem[]>(
        () =>
            getMarkdownHeadings(transformedText).map((heading, index) => ({
                id: `${heading.lineNumber}-${index}`,
                label: heading.text,
                level: heading.level,
                lineNumber: heading.lineNumber,
            })),
        [transformedText]
    );

    const handleSelectTocItem = (item: MarkdownOutlineItem) => {
        if (item.lineNumber != null) {
            focusHeadingLine(item.lineNumber);
        }
    };

    // Memoized plugin stacks: a new array every render defeats the memoized render tree below
    // (unified treats new plugin identities as a fresh pipeline → full re-parse per render).
    // Both stacks only depend on parse-affecting inputs; the inline-edit textarea typing never
    // touches them, so editing a block re-renders Markdown without re-parsing the document.
    const rehypePlugins = useMemo(() => {
        if (!rehype) {
            return null;
        }
        return [
            rehypeRaw,
            rehypeHighlight,
            (): any =>
                rehypeSanitize({
                    ...defaultSchema,
                    attributes: {
                        ...defaultSchema.attributes,
                        p: [
                            // blank-line-spacers plugin emits spacer paragraphs tagged with
                            // className=["paragraph","blank-spacer"] + dataSpacerLines +
                            // dataEmptySpacer. defaultSchema has no `p` entry so sanitize
                            // would strip these and the .paragraph.blank-spacer CSS sizing
                            // rules would never match.
                            //
                            // hast property names are camelCased (hastscript normalises
                            // kebab `data-spacer-lines` -> `dataSpacerLines`); a regex like
                            // /^data./ would also work, but pinning the exact names keeps
                            // the surface tight.
                            ["className", "paragraph", "blank-spacer"],
                            "dataSpacerLines",
                            "dataEmptySpacer",
                        ],
                        span: [
                            ...(defaultSchema.attributes?.span || []),
                            // Allow all class names starting with `hljs-`.
                            ["className", /^hljs-./],
                            ["srcset"],
                            ["media"],
                            ["type"],
                            // Alternatively, to allow only certain class names:
                            // ['className', 'hljs-number', 'hljs-title', 'hljs-variable']
                        ],
                        waveblock: [["blockkey"]],
                        // remarkLooseListSpacing tags loose lists with data-loose so CSS can
                        // restore the blank-line spacing between items.
                        ol: [...(defaultSchema.attributes?.ol || []), "dataLoose", "start", "dataSplitGroup"],
                        ul: [...(defaultSchema.attributes?.ul || []), "dataLoose"],
                    },
                    protocols: {
                        ...defaultSchema.protocols,
                        href: [...FilePathHrefProtocols, "wave-wiki"],
                    },
                    tagNames: [
                        ...(defaultSchema.tagNames || []),
                        "span",
                        "waveblock",
                        "picture",
                        "source",
                        "mermaidblock",
                    ],
                }),
            (): any => rehypeSlug({ prefix: idPrefix }),
        ];
    }, [rehype, idPrefix]);
    const remarkPlugins: any = useMemo(() => {
        const plugins = makeRemarkPlugins({
            contentBlocksMap,
        });
        if (frontmatterBlock) {
            // 必须 push 插件+参数元组（ReactMarkdown 的 PluggableList 约定），
            // 不能 push 调用结果：unified 会把函数当插件以无参调用，transformer 的
            // tree 参数会变成 undefined → 运行时崩溃。
            plugins.push([
                remarkFrontmatterToWaveBlock,
                {
                    startLine: frontmatterBlock.startLine,
                    endLine: frontmatterBlock.endLine,
                    blockKey: frontmatterBlock.blockKey,
                },
            ]);
        }
        return plugins;
    }, [contentBlocksMap, frontmatterBlock]);

    // Memoized render tree: as long as the source text and every parse-affecting input stayed
    // stable, re-render is skipped entirely — React sees the same element object and bails out
    // of reconciling the subtree. This is what keeps hover strokes (insert anchor state),
    // scroll sync, and in-textarea typing from re-parsing N-thousand lines on every frame.
    const scrollableMarkdownTree = useMemo(
        () => (
            <ReactMarkdown
                remarkPlugins={remarkPlugins}
                rehypePlugins={rehypePlugins}
                components={markdownComponents}
                urlTransform={markdownUrlTransform}
                className="markdown-render-root"
            >
                {transformedText}
            </ReactMarkdown>
        ),
        [remarkPlugins, rehypePlugins, markdownComponents, transformedText]
    );
    const nonScrollableMarkdownTree = useMemo(
        () => (
            <ReactMarkdown
                remarkPlugins={remarkPlugins}
                rehypePlugins={rehypePlugins}
                components={markdownComponents}
                urlTransform={markdownUrlTransform}
            >
                {transformedText}
            </ReactMarkdown>
        ),
        [remarkPlugins, rehypePlugins, markdownComponents, transformedText]
    );

    const mergedStyle = { ...style };
    if (fontSizeOverride != null) {
        mergedStyle["--markdown-font-size"] = `${boundNumber(fontSizeOverride, 6, 64)}px`;
    }
    if (fixedFontSizeOverride != null) {
        mergedStyle["--markdown-fixed-font-size"] = `${boundNumber(fixedFontSizeOverride, 6, 64)}px`;
    }
    return (
        <TableEditContext.Provider value={tableEditContext}>
        <div
            className={clsx("markdown", className, onInlineEditCommit != null && "markdown-editable")}
            style={mergedStyle}
            data-copy-context-path={copyContextPath || undefined}
        >
            {docEmojiOpen && docEmojiAnchor != null && emojiCatalog != null && (
                <>
                    <div className="markdown-emoji-backdrop" onMouseDown={() => setDocEmojiOpen(false)} />
                    <EmojiPicker
                        anchor={docEmojiAnchor}
                        placement="bottom"
                        mode="document"
                        catalog={emojiCatalog}
                        query={docEmojiQuery}
                        onQueryChange={(q) => {
                            setDocEmojiQuery(q);
                            setDocEmojiActive(0);
                        }}
                        activeIndex={Math.min(docEmojiActive, Math.max(0, docEmojiPickables.length - 1))}
                        onActiveChange={setDocEmojiActive}
                        onPick={(entry) => {
                            recordRecentEmoji(entry.char);
                            applyDocEmoji(entry.char);
                        }}
                        onClose={() => setDocEmojiOpen(false)}
                        allowRemove={docEmoji != null}
                        onRemove={() => applyDocEmoji(null)}
                    />
                </>
            )}
            {scrollable ? (
                <OverlayScrollbarsComponent
                    ref={contentsOsRef}
                    className={cn("content", contentClassName, shouldHideForInitialScroll && "invisible")}
                    options={{ scrollbars: { autoHide: "leave" } }}
                    events={{
                        initialized: () =>
                            requestAnimationFrame(() => {
                                applyScrollTarget("initialized");
                                // OSB 挂载前（osInstance 未 ready）的渲染里折叠可见性无从落脚，
                                // 这里补一次强制同步，堵住「首次打开折叠内容不隐藏」的边界。
                                updateCollapsedHeadingVisibility();
                            }),
                        scroll: handleMarkdownScroll,
                    }}
                    // Capture-phase dblclick so we beat CollapsibleHeading's own dblclick toggle
                    // and any native selection side effects. The handler no-ops unless the
                    // parent wired onInlineEditCommit (i.e. opt-in to inline editing).
                    onDoubleClickCapture={handleInlineEditDblClick}
                    // Mousedown (capture) records the pre-press selection so the bubble-phase
                    // click handler can tell drag-select from pure click.
                    onMouseDownCapture={handleInlineEditMouseDown}
                    // Bubble-phase click — single-click-to-edit. Runs after <Link> and chevron
                    // button onClick, so e.defaultPrevented / e.target.closest(...) guard
                    // interactive children, and a grown live selection guards drag-select.
                    onClick={handleInlineEditClick}
                    onMouseOver={handleRootMouseOver}
                    onMouseLeave={handleRootMouseLeave}
                    onDragOver={handleBlockDragOver}
                    onDragLeave={handleBlockDragLeave}
                    onDrop={handleBlockDrop}
                >
                    {onInlineEditCommit != null && isBlockEditorFeatureEnabled("docemoji") && (
                        <DocEmojiHeader
                            emoji={docEmoji}
                            buttonRef={docEmojiBadgeRef}
                            open={docEmojiOpen}
                            onToggle={toggleDocEmojiPicker}
                        />
                    )}
                    {scrollableMarkdownTree}
                    {onInlineEditCommit != null && linkTooltipAnchor != null &&
                        ReactDOM.createPortal(
                            <MarkdownLinkTooltip
                                anchor={linkTooltipAnchor}
                                onOpen={() => {
                                    const el = linkTooltipAnchor;
                                    closeLinkTooltip();
                                    // Reuse the anchor's own click path → identical behavior to a
                                    // plain user click (in-preview navigation for internal links,
                                    // browser open for externals).
                                    el.click();
                                }}
                                onEdit={() => {
                                    const el = linkTooltipAnchor;
                                    closeLinkTooltip();
                                    openLinkEditor(el);
                                }}
                                rootRef={linkTooltipElRef}
                                onMouseEnter={stopLinkTooltipSafeZoneWatch}
                                onMouseLeave={startLinkTooltipSafeZoneWatch}
                            />,
                            document.body
                        )}
                    {onInlineEditCommit != null && linkEditTarget != null &&
                        ReactDOM.createPortal(
                            <MarkdownLinkEditor
                                anchor={linkEditTarget.anchor}
                                mode={linkEditTarget.mode}
                                initialLabel={linkEditTarget.label}
                                initialUrl={linkEditTarget.href}
                                onSave={(label, url) => {
                                    const target = linkEditTarget;
                                    setLinkEditTarget(null);
                                    applyLinkEdit(target, label, url);
                                }}
                                onCancel={() => setLinkEditTarget(null)}
                            />,
                            document.body
                        )}
                    {onInlineEditCommit && (
                        <InlineEditOverlay
                            overlayRect={inlineEdit.overlayRect}
                            blockKind={inlineEdit.editSession?.blockKind ?? null}
                            typography={inlineEdit.editSession?.typography}
                            draftText={inlineEdit.draftText}
                            textareaRef={inlineEdit.textareaRef}
                            onTextChange={(v, caret) => {
                                inlineEdit.setDraftText(v);
                                trackEditorTriggers(v, caret);
                            }}
                            onKeyDown={handleEditorKeyDown}
                            onPaste={handleEditorPaste}
                            onBlur={inlineEdit.commit}
                            placeholder={placeholderForBlockKind(inlineEdit.editSession?.blockKind)}
                            onCaretChange={(caret, selEnd) => {
                                trackEditorTriggers(inlineEdit.draftText, caret);
                                setInlineSelection(selEnd > caret ? { start: caret, end: selEnd } : null);
                                if (editSessionKind === "table") {
                                    setTableCaret(caretToTableCoord(inlineEdit.draftText, caret));
                                }
                            }}
                        />
                    )}
                    {slashState != null && slashAnchor != null && inlineEdit.editSession != null && (
                        <SlashPalette
                            anchor={slashAnchor.anchor}
                            placement={slashAnchor.placement}
                            items={slashItems}
                            activeIndex={Math.min(slashState.activeIndex, Math.max(0, slashItems.length - 1))}
                            onHover={(i) => setSlashState((s) => (s == null ? s : { ...s, activeIndex: i }))}
                            onPick={handleSlashPick}
                        />
                    )}
                    {emojiState != null && emojiAnchor != null && emojiCatalog != null && inlineEdit.editSession != null && (
                        <EmojiPicker
                            anchor={emojiAnchor.anchor}
                            placement={emojiAnchor.placement}
                            mode="inline"
                            catalog={emojiCatalog}
                            query={emojiState.query}
                            activeIndex={Math.min(emojiState.activeIndex, Math.max(0, emojiPickables.length - 1))}
                            onActiveChange={(i) => setEmojiState((s) => (s == null ? s : { ...s, activeIndex: i }))}
                            onPick={handleEmojiPick}
                            onClose={() => setEmojiState(null)}
                        />
                    )}
                    {slashEmojiState.open && slashEmojiState.anchor != null && slashEmojiState.catalog != null && inlineEdit.editSession != null && (
                        <EmojiPicker
                            anchor={slashEmojiState.anchor}
                            placement="bottom"
                            mode="inline"
                            catalog={slashEmojiState.catalog}
                            query={slashEmojiState.query}
                            activeIndex={Math.min(slashEmojiState.activeIndex, Math.max(0, slashEmojiPickables.length - 1))}
                            onQueryChange={(q) => setSlashEmojiState((s) => ({ ...s, query: q, activeIndex: 0 }))}
                            onActiveChange={(i) => setSlashEmojiState((s) => ({ ...s, activeIndex: i }))}
                            onPick={handleSlashEmojiPick}
                            onClose={handleSlashEmojiClose}
                        />
                    )}
                    {editSessionKind === "table" && toolbarAnchor != null && isBlockEditorFeatureEnabled("table") && (
                        <TableToolbar
                            anchor={toolbarAnchor}
                            contextValid={tableCaret != null}
                            currentAlign={tableCaretAlign}
                            onOp={handleTableOp}
                        />
                    )}
                    {inlineSelection != null &&
                        inlineEdit.editSession != null &&
                        inlineEdit.editSession.blockKind !== "code" &&
                        isBlockEditorFeatureEnabled("toolbar") &&
                        toolbarAnchor != null && (
                            <FloatingToolbar
                                anchor={toolbarAnchor}
                                blockLabel={currentBlockLabel}
                                blockItems={toolbarBlockItems}
                                styles={listInlineStyles().map((s) => ({
                                    id: s.id as InlineStyleId,
                                    label: s.label,
                                    hint: s.hint,
                                    active: hasInlineStyle(
                                        inlineEdit.draftText,
                                        inlineSelection.start,
                                        inlineSelection.end,
                                        s.id as InlineStyleId
                                    ),
                                }))}
                                onBlockType={(id) => {
                                    const action = listBlockActions().find((a) => a.id === id);
                                    if (action?.targetKind != null) {
                                        handleSessionBlockTransform(action.targetKind);
                                    }
                                }}
                                onStyle={handleInlineStyle}
                            />
                        )}
                    {onInlineEditCommit && selectedBlock != null && inlineEdit.editSession == null &&
                        ReactDOM.createPortal(
                            <div
                                className="markdown-block-selected"
                                style={{
                                    top: selectedBlock.rect.top,
                                    left: selectedBlock.rect.left,
                                    width: selectedBlock.rect.width,
                                    height: selectedBlock.rect.height,
                                }}
                            />,
                            document.body
                        )}
                    {onInlineEditCommit && selectedRange != null && selectedRangeRect != null && inlineEdit.editSession == null &&
                        ReactDOM.createPortal(
                            <div
                                className="markdown-block-selected markdown-block-range-selected"
                                style={{
                                    top: selectedRangeRect.top,
                                    left: selectedRangeRect.left,
                                    width: selectedRangeRect.width,
                                    height: selectedRangeRect.height,
                                }}
                            />,
                            document.body
                        )}
                    {onInlineEditCommit && insertPos != null &&
                        ReactDOM.createPortal(
                            <>
                                {/* C: 4-dot grip — gutter left of the block, top-left. Click selects the block + opens the block menu;
                                    press and drag reorders the block (handleBlockDragStart). */}
                                <div
                                    className="markdown-block-grip-dots"
                                    style={{ top: insertPos.top, left: insertPos.left }}
                                    draggable
                                    onMouseEnter={handleGripEnter}
                                    onMouseLeave={handleGripLeave}
                                    onClick={handleGripMenuClick}
                                    onDragStart={handleBlockDragStart}
                                    onDragEnd={handleBlockDragEnd}
                                    role="button"
                                    aria-label="Block actions — drag to reorder"
                                    title="Block actions — drag to reorder"
                                >
                                    <i className="markdown-block-grip-dot" aria-hidden="true" />
                                    <i className="markdown-block-grip-dot" aria-hidden="true" />
                                    <i className="markdown-block-grip-dot" aria-hidden="true" />
                                    <i className="markdown-block-grip-dot" aria-hidden="true" />
                                </div>
                                {/* A: insert above — same column, just above the grip. */}
                                <button
                                    className={
                                        "markdown-block-grip-action" +
                                        (gripOpen ? "" : " markdown-block-grip-action-hidden")
                                    }
                                    title="Insert block above"
                                    aria-label="Insert block above"
                                    style={{ top: insertPos.top - 33, left: insertPos.left }}
                                    onMouseEnter={handleGripEnter}
                                    onMouseLeave={handleGripLeave}
                                    onClick={() => handleInsertClick("before")}
                                >
                                    <i className="fa-sharp fa-solid fa-plus" />
                                </button>
                                {/* B: insert below — same column, just below the grip. */}
                                <button
                                    className={
                                        "markdown-block-grip-action" +
                                        (gripOpen ? "" : " markdown-block-grip-action-hidden")
                                    }
                                    title="Insert block below"
                                    aria-label="Insert block below"
                                    style={{ top: insertPos.top + 15, left: insertPos.left }}
                                    onMouseEnter={handleGripEnter}
                                    onMouseLeave={handleGripLeave}
                                    onClick={() => handleInsertClick("after")}
                                >
                                    <i className="fa-sharp fa-solid fa-plus" />
                                </button>
                            </>,
                            document.body
                        )}
                    {dropTarget != null && inlineEdit.editSession == null &&
                        ReactDOM.createPortal(
                            <div
                                className="markdown-block-drop-indicator"
                                style={{ top: dropTarget.rect.top, left: dropTarget.rect.left, width: dropTarget.rect.width }}
                            />,
                            document.body
                        )}
                </OverlayScrollbarsComponent>
            ) : (
                <div className={cn("content non-scrollable", contentClassName)}>
                    {onInlineEditCommit != null && isBlockEditorFeatureEnabled("docemoji") && (
                        <DocEmojiHeader
                            emoji={docEmoji}
                            buttonRef={docEmojiBadgeRef}
                            open={docEmojiOpen}
                            onToggle={toggleDocEmojiPicker}
                        />
                    )}
                    {nonScrollableMarkdownTree}
                </div>
            )}
            {showToc && (
                <div className="toc">
                    <MarkdownOutline
                        items={tocItems}
                        placement="sidebar"
                        resizeAxes={{ width: true }}
                        resizeStorageKey="snorkeling.markdownOutline.preview.size"
                        onSelectItem={handleSelectTocItem}
                    />
                </div>
            )}
        </div>
        </TableEditContext.Provider>
    );
};

export { Markdown };