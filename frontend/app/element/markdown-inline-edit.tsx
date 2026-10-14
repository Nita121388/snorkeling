// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { isBlockEditorFeatureEnabled } from "@/app/element/block-editor/flags";
import { rewriteDraftFirstLine } from "@md/core/transform/block-type";
import { inlineEditingActiveAtom } from "@/app/view/preview/preview-shared-draft";
import { globalStore } from "@/store/jotaiStore";
import { useAtom } from "jotai";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { editorController } from "@md/core/block-model/editor-controller-instance";
import type { EditorHistoryOp } from "./use-editor-history";
import type { Block } from "@md/core/transform/tree";
import type { CodeEditorHandle } from "./content-editable-code-editor";
import ContentEditableCodeEditor from "./content-editable-code-editor";
import { WysiwygEditor, type WysiwygEditorHandle } from "./wysiwyg-editor";
import {
    deleteBlockRange,
    moveBlockRange,
    replaceSourceRange,
    spliceInsertBlock,
    type MoveBlockResult,
} from "@md/core/transform/block-range";

// ---------------------------------------------------------------------------
// Re-export（md-core 抽离 P0 · C1）：4 个纯块区间函数已下沉到
// `markdown-transform/block-range.ts`（纯模块，零宿主依赖）。
// 对外 API（名称 + 签名 + 类型）逐字不变，因此 markdown.tsx / 测试等 21 个引用点
// 无需改动；`./markdown-inline-edit` 仍是这些符号的唯一公开入口。
// ---------------------------------------------------------------------------
export { deleteBlockRange, moveBlockRange, replaceSourceRange, spliceInsertBlock };
// ── A3/D2 · md-dom 物理抽包 ───────────────────────────────────────────────────
// md-dom 是框架无关的编辑引擎（零 React / 零宿主）。已经搬过去的四块：
//   block-syntax.ts  块语法层（源码切片归一化 / 空壳守卫 / callout 前缀 / 列表缩进 / kind 映射）
//   commit-prep.ts   提交前置（块身份重定位 + 陈旧检测）
//   seed.ts          种子采集（渲染 DOM → 编辑器初始内容）
// 本模块**继续 re-export**，所以宿主（markdown.tsx 等）与既有测试一个字节都不用改。
//
// 注：`export { type X } from` **不会**把 X 带进本模块作用域 ——
// 所以每个「既要再导出、又要在本文件里用」的符号都要**同时**写 import 与 export。
// 只写一个的话要么编译报错、要么运行时 ReferenceError（实测踩过，见 5d9c5437）。
export {
    applyCalloutPrefix,
    captureCalloutPrefix,
    indentListDraft,
    indentListRange,
    initialContentFor,
    inlineKindToTreeKind,
    isEmptyBlockShellDraft,
    isEmptyQuoteShellDraft,
    wrapCodeFence,
    wrapListMarker,
    type InlineEditBlockKind,
} from "@md/dom/block-syntax";
export {
    isStaleTargetBlock,
    MarkdownRenderRootSelector,
    prepareInlineEditCommit,
    relocateByBlockId,
    relocateByContent,
    type BlockEditTarget,
} from "@md/dom/commit-prep";
export {
    calloutSeedHtml,
    captureInplaceSeedHtml,
    captureWysiwygInfo,
    normalizeBreaksAroundNewlines,
    SEED_BLOCK_TAGS,
    stripInsignificantWhitespace,
    WYSIWYG_KINDS,
    type WysiwygEligibleKind,
    type WysiwygSeedInfo,
} from "@md/dom/seed";
export {
    fallbackSelector,
    isSelectingRange,
    resolveInlineEditTarget,
    type EditableHostTarget,
} from "@md/dom/edit-target";

import {
    applyCalloutPrefix,
    captureCalloutPrefix,
    indentListDraft,
    indentListRange,
    initialContentFor,
    inlineKindToTreeKind,
    isEmptyBlockShellDraft,
    isEmptyQuoteShellDraft,
    wrapCodeFence,
    wrapListMarker,
    type InlineEditBlockKind,
} from "@md/dom/block-syntax";
import { MarkdownRenderRootSelector, prepareInlineEditCommit, type CommitPreparation } from "@md/dom/commit-prep";
import { captureWysiwygInfo, type WysiwygEligibleKind } from "@md/dom/seed";
import { isSelectingRange, resolveInlineEditTarget } from "@md/dom/edit-target";

/**
 * 提交前置结果（宿主视角的具体化）：`CommitPreparation` 用泛型保住会话类型，
 * 所以这里只需把泛型参数填成宿主的 `InlineEditSession`，既有引用点就照旧可用。
 */
export type InlineEditCommitPreparation = CommitPreparation<InlineEditSession>;

export type { MoveBlockResult };

// ---------------------------------------------------------------------------
// Inline-edit debug log. Enable by setting `localStorage.snorkelingInlineEditDebug = "1"` in
// devtools then open a markdown preview and double-click a block. Every measure / state write /
// scroll listener hit / target-lost event is emitted to both console.info and a ring buffer
// on window.__inlineEditLog so the running trace can be copied out for analysis. Disable by
// clearing the localStorage key. Cheap when off — single key read + early return.
// ---------------------------------------------------------------------------

type InlineEditLogEntry = { t: number; seq: number; msg: string; details: Record<string, unknown> };

function isInlineEditDebugEnabled(): boolean {
    return typeof window !== "undefined" && window.localStorage?.getItem("snorkelingInlineEditDebug") === "1";
}

const INLINE_EDIT_LOG_BUF: InlineEditLogEntry[] = [];
let INLINE_EDIT_LOG_SEQ = 0;

if (typeof window !== "undefined") {
    // Expose the ring buffer on window so a devtools console copy of `__inlineEditLog` yields
    // the post-mortem. Buffer caps at 500 entries (≈ ~30s of a hot flicker loop) and overwrites
    // oldest on overflow so memory is bounded.
    (window as any).__inlineEditLog = INLINE_EDIT_LOG_BUF;
    (window as any).__inlineEditLogClear = () => {
        INLINE_EDIT_LOG_BUF.length = 0;
        INLINE_EDIT_LOG_SEQ = 0;
    };
}

export function inlineEditDebug(msg: string, details: Record<string, unknown> = {}) {
    if (!isInlineEditDebugEnabled()) {
        return;
    }
    const entry: InlineEditLogEntry = {
        t: typeof performance !== "undefined" ? performance.now() : 0,
        seq: INLINE_EDIT_LOG_SEQ++,
        msg,
        details,
    };
    INLINE_EDIT_LOG_BUF.push(entry);
    if (INLINE_EDIT_LOG_BUF.length > 500) {
        INLINE_EDIT_LOG_BUF.shift();
    }
    console.info("[inline-edit]", msg, details);
}

/**
 * 找到“真正承载文本”的那个元素，用它的 computed style 做快照。
 *
 * 直接拿块的根元素会漏掉差异，因为排版常在内层：
 * - `<pre>` 的文本在 `<code>`（行高/字号/颜色都定义在 code 上）→ 取 pre 会拿到错误的行高
 * - `<blockquote>` / `<td>` 的文本在内层 <p> / 自身，缩进与 padding 定义在外层
 * - `<li>` 例外：缩进在 li 自己身上，必须取 li，否则列表文本会左移
 */
function resolveTextElement(el: HTMLElement): HTMLElement {
    if (el.tagName === "PRE") {
        return el.querySelector("code") ?? el;
    }
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode()) != null) {
        if ((node.nodeValue ?? "").trim() !== "") {
            return (node.parentElement as HTMLElement) ?? el;
        }
    }
    return el;
}

/**
 * Snapshot the rendered block's typography so the editing textarea can inherit it. Read
 * once at edit-open; a stale snapshot is fine because the block's own style is static for
 * the session's lifetime (its CSS derives from the kind, not per-keystroke state).
 *
 * 除字体外还必须复制 **内边距**（决定文本起点）与 **折行行为**（决定换行位置）：
 * 少了 padding，引用/代码块/列表进入编辑时文字会水平错位；少了 overflow-wrap/word-break，
 * 长 URL/长单词的折行位置会和渲染态不一致。
 *
 * 注意 white-space **不复制**：textarea 必须保持 `pre-wrap` 才能保留源码里的多行与行内空格，
 * 渲染态的 `normal` 用在源码编辑上会把多行挤成一行。
 */
function captureBlockTypography(blockEl: HTMLElement): React.CSSProperties {
    const el = resolveTextElement(blockEl);
    const cs = getComputedStyle(el);
    // 内边距以「锚点块自身的 computed padding」为准，再补一层嵌套缩进。
    // 为什么不直接用文本元素的矩形差值：文本常是 inline 元素（pre > code），inline 的
    // getBoundingClientRect 是“文字墨迹”（高度 = 字体内容区，不含半行距），用它算右/下
    // 内边距会得到荒谬的值（实测右侧差出 300px）。只有“文本元素相对内容区起点的额外
    // 缩进”（嵌套 li / p 的 margin）才需要叠加，垂直方向同理只对 block 级文本叠加。
    const blockCs = getComputedStyle(blockEl);
    const blockRect = blockEl.getBoundingClientRect();
    const textRect = el.getBoundingClientRect();
    const px = (v: number) => (Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : 0);
    const num = (v: string) => parseFloat(v) || 0;
    const blockPadTop = num(blockCs.paddingTop);
    const blockPadRight = num(blockCs.paddingRight);
    const blockPadBottom = num(blockCs.paddingBottom);
    const blockPadLeft = num(blockCs.paddingLeft);
    // inline 文本（code/span）的 rect.top 已含半行距，垂直方向直接用块的 padding
    const isInlineText = cs.display.startsWith("inline");
    const extraLeft = Math.max(0, textRect.left - (blockRect.left + blockPadLeft));
    const topOffset = isInlineText ? blockPadTop : Math.max(0, textRect.top - blockRect.top);
    return {
        fontFamily: cs.fontFamily,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight as React.CSSProperties["fontWeight"],
        fontStyle: cs.fontStyle as React.CSSProperties["fontStyle"],
        lineHeight: cs.lineHeight,
        letterSpacing: cs.letterSpacing,
        // 文本起点与垂直位置：与渲染态逐像素对齐
        paddingTop: px(topOffset),
        paddingRight: px(blockPadRight),
        paddingBottom: px(blockPadBottom),
        paddingLeft: px(blockPadLeft + extraLeft),
        // 折行行为：与渲染态一致，长串/URL 才不会换到别的位置
        overflowWrap: cs.overflowWrap as React.CSSProperties["overflowWrap"],
        wordBreak: cs.wordBreak as React.CSSProperties["wordBreak"],
        lineBreak: cs.lineBreak as React.CSSProperties["lineBreak"],
        textIndent: cs.textIndent,
        wordSpacing: cs.wordSpacing,
        textAlign: cs.textAlign as React.CSSProperties["textAlign"],
        textTransform: cs.textTransform as React.CSSProperties["textTransform"],
        fontVariantLigatures: cs.fontVariantLigatures as React.CSSProperties["fontVariantLigatures"],
        // textarea 固有：显式写出，避免被主题/UA 样式改写
        whiteSpace: "pre-wrap",
    };
}


// Blocks that can participate in WYSIWYG contentEditable editing（方案 08）。
// Table and code have their own dedicated WYSIWYG editors (TableBlock /
// ContentEditableCodeEditor); these prose kinds get the generic WYSIWYG editor.
// A3/D2：类型与种子采集已搬到 `@md/dom/seed`（单一真源），本模块 re-export。

export type InlineEditSession = {
    blockKind: InlineEditBlockKind;
    /** 1-based, inclusive, original text coordinate (NOT transformedText). */
    startLine: number; /**
     * 1-based, inclusive. Equal to startLine for single-line blocks (h without trailing
     * soft-break). Paragraphs (and soft-broken headings) render one visual block across multiple
     * source lines once remarkSoftBreaks merges them — this endLine brackets that range so the
     * initial draft and the commit-replaced slice both cover the whole visual block, not just
     * its first line. Without it a paragraph like
     *   "line A\nline B" (one <p>, two source lines) would lose "line B" on edit open.
     */
    endLine: number;
    /** Original segment text captured when entering edit — used for cancel/Revert + initial draft. */
    initialContent: string;
    /**
     * step3 S2 块身份：锚点元素上的 `data-block-id`（remarkBlockIds 打的、内容寻址的稳定 id）。
     *
     * 注意：**id 是身份，不是坐标**。它不替代 startLine/endLine（行号仍是唯一的写盘坐标），
     * 而是用来：① 提交前重定位——别的提交让行号整体位移后仍能找回同一块并取到**当前**行号；
     * ② 陈旧检测的锚点（配合 initialContent 比对拒绝写错块）。元素上没有该属性时
     * （旧 DOM / 未覆盖的块型）为 undefined，此时自动退化为「不做重定位」，不阻断流程。
     */
    blockId?: string;
    /** DOM element we anchored on; kept hidden (visibility:hidden) while textarea is mounted. */
    targetEl: HTMLElement;
    /**
     * Typography snapshot of the rendered block (getComputedStyle at edit-open time). The
     * overlay textarea inherits these so typing looks pixel-identical to reading — no font
     * size/line-height jump when entering or leaving edit ("zero layout shift").
     */
    typography?: React.CSSProperties;
    /**
     * Optional caret position (0-based char offset into the draft text). When present the
     * textarea caret lands here instead of select-all — the single-click-to-edit path maps
     * the click's clientX/Y to a draft offset so the cursor goes where the user clicked.
     */
    caretOffset?: number;
    /**
     * Insert mode: instead of replacing [startLine..endLine] on commit, insert the draft
     * as a NEW block just before ("before") or after ("after") the anchor line, separated
     * by a blank line so it renders as its own block. Used by the block-edge insert buttons.
     */
    insertMode?: "before" | "after";
    /**
     * Optional: called on Esc/cancel to REVERT the document to its pre-edit state. Used by
     * the "click insert / Enter split" flows, which COMMIT the new row immediately (so the
     * user sees it appear) and only keep an editor on top for typing — Esc discards the
     * whole insert instead of just closing the editor.
     */
    insertRevert?: () => void;
    /**
     * WYSIWYG editing (方案 08): when set, the overlay renders the block's RENDERED HTML
     * in a contentEditable editor instead of a raw-markdown textarea. The editor mirrors
     * its serialized markdown into draftText on every input so the text-based command
     * machinery (slash palette, inline styles, Enter split) keeps working unchanged.
     */
    wysiwyg?: boolean;
    /**
     * Rendered HTML clone seeded into the WYSIWYG editor (no block markers: a heading
     * renders as its title text, a list as its <li>s, a quote as its inner content).
     * Captured from the anchored block's DOM at beginEdit time.
     */
    wysiwygHtml?: string;
    /** Heading level (1-6) for WYSIWYG heading blocks, read from the rendered class is-N. */
    wysiwygHeadingLevel?: number;
    /**
     * Preserved original list marker for WYSIWYG list blocks: the bullet char
     * ("-" | "*" | "+") or the ordered counter head ("1." | "1)"). Kept so commit
     * serialization re-emits the author's marker style, keeping git diffs minimal.
     */
    wysiwygListMarker?: string;
    /**
     * F3: leading whitespace of the list's first source line ("" at top level). Re-applied
     * to every non-empty line on commit so editing an INNER list doesn't promote it to top
     * level (the DOM serializer always starts at depth 0).
     */
    wysiwygListIndent?: string;
    /**
     * R4: callout `[!TYPE]` + emoji prefix captured from the SOURCE first line at beginEdit.
     * Present only for callout WYSIWYG sessions (handled by captureCalloutPrefix); on commit
     * applyCalloutPrefix writes it back so editing a title never drops the marker or emoji.
     * `""` means “plain quote, do not invent a marker”.
     */
    calloutPrefix?: string;
    /** R4: true when the anchored block is a callout/quote container (`calloutalert`). */
    isCallout?: boolean;
    /**
     * Placeholder-row session: the editor sits on a single blank row that was already
     * pre-inserted into the document (the immediate "click insert / Enter split" feedback
     * row). On commit the draft REPLACES that row and separator blanks are added/deduped
     * so the result is exactly one new block; on an empty commit (blur without typing) the
     * whole pre-insert is reverted via insertRevert so nothing is left behind.
     */
    placeholder?: boolean;
    /**
     * Inline-placeholder variant for plain <p> anchors: the pre-inserted row sits INSIDE
     * the paragraph (directly above/below its content), and on commit the draft replaces it
     * with NO separator blanks — the paragraph's original separator blanks still bracket
     * the whole paragraph, so the result is a soft-broken new line flush with the paragraph
     * (zero stray blank rows, unlike block-level inserts).
     */
    placeholderInline?: boolean;
    /**
     * Enter-split continuation placeholder: the document already carries committed content
     * from the same gesture (the line above this row). An empty commit (blur/Ctrl+S) must keep
     * the committed content instead of firing insertRevert — which would erase it, and then
     * Save would persist the erased text ("typed a line, Enter, Save → content disappears").
     */
    placeholderKeepOnEmpty?: boolean;
    /**
     * Dynamic placeholder text for slash command format selection. When present, this
     * overrides the default placeholderForBlockKind() value. Used by slash commands to
     * show format-specific hints like "Heading 1" while the user types.
     */
    dynamicPlaceholder?: string;
};



/**
 * Strip inter-element whitespace from a WYSIWYG seed.
 *
 * The rendered tree collapses whitespace (`white-space: normal`), but the editor inherits
 * `pre-wrap` from `[contenteditable]` — so a whitespace-only text node sitting between block
 * elements suddenly occupies a full line box. mdast-util-to-hast injects exactly such a `\n`
 * between the items of a LOOSE list, which made a loose list look double-spaced (and the block
 * grow ~2x) the moment it was clicked. The editor must not see them at all.
 *
 * 另一个同类来源（R1–R4 实测）：**紧邻 `<br>` 的换行**。渲染器在软换行前后会插 `\n`
 * （`<p>a<br>\nb</p>`）。渲染态 `normal` 下它紧跟 `<br>`、不可见；编辑器却是 `pre-wrap`，
 * 于是它成了**第二个真实换行** —— 引用块提交后凭空多出一条裸 `>` 空行，把一行软换行
 * 内容拆成两个段落（实测于普通引用与无标题 callout）。必须在**字符串层**去掉：
 * DOM 层已经来不及，因为 `innerHTML` 重新解析时相邻文本节点会被合并，
 * 那个 `\n` 已经并进 `"\nb"` 里、不再是一个可单独识别的空白节点。
 */


/**
 * step3 S3：commit() → 提交通道的附加参数。`blockOp` 是块级逆操作数据，
 * 由 markdown.tsx 的收敛点（handleInlineEditCommit）连同 undo 快照一起记账；
 * 它不改变任何现有行为，只为阶段 4 的块级结构操作准备精确逆操作。
 */
export type InlineEditCommitOptions = { blockOp?: EditorHistoryOp };

type UseInlineEditArgs = {
    fullText: string;
    /** Called with the new full text on every successful commit; never on cancel. */
    onCommit: (newFullText: string, opts?: InlineEditCommitOptions) => void;
    /**
     * Optional: flush the committed draft to disk. Wired only by callers that own a model with a
     * handleFileSave (preview-mode pair). When present, ⌘/Ctrl+S inside the textarea commits the
     * draft then immediately runs this — replacing the old "let ⌘S bubble to Wave's save handler"
     * comment, which described a path that no longer exists in preview mode (no global keydown
     * is registered there).
     */
    onSave?: () => void;
    /** Lazily returns the OverlayScrollbars viewport element; called on every measure. */
    getViewportEl: () => HTMLElement | null;
    /**
     * Optional: stable identity so the hook can reset transient state if the parent re-mounts
     * (e.g. new file key). Not strictly required.
     */
    resetKey?: unknown;
};

export function useInlineEdit({ fullText, onCommit, onSave, getViewportEl, resetKey }: UseInlineEditArgs): {
    editSession: InlineEditSession | null;
    draftText: string;
    setDraftText: (v: string) => void;
    beginEdit: (
        blockKind: InlineEditBlockKind,
        line: number,
        targetEl: HTMLElement,
        caretOffset?: number,
        insertRevert?: () => void,
        placeholder?: boolean | "inline",
        keepOnEmpty?: boolean
    ) => boolean;
    beginInsertEdit: (startLine: number, endLine: number, targetEl: HTMLElement, mode: "before" | "after") => void;
    commit: (content?: string) => void;
    cancel: () => void;
    /** Close the session WITHOUT committing or reverting: used by slash / toolbar command
     *  paths that already composed and committed their final text themselves. */
    dismiss: () => void;
    textareaRef: React.RefObject<HTMLTextAreaElement | null>;
    codeEditorRef: React.RefObject<CodeEditorHandle | null>;
    wysiwygRef: React.RefObject<WysiwygEditorHandle | null>;
    overlayRect: { top: number; left: number; width: number; height: number } | null;
} {
    const [editSession, setEditSession] = useState<InlineEditSession | null>(null);
    const [draftText, setDraftTextState] = useState<string>("");
    // Latest committed text, assigned during render. beginEdit/commit read THIS instead of the
    // render-closure `fullText`: the insert flows schedule beginEdit ~2 frames after a commit,
    // and the captured closure can still hold the pre-commit text (async atom round-trip),
    // which used to compute initialContent over the WRONG line range and duplicate content.
    const fullTextRef = useRef(fullText);
    fullTextRef.current = fullText;
    // Wrap setText so each user keystroke / external draft write is observable in the debug
    // ring buffer at equal granularity with the layout-effect measurements. A bare useState
    // setter has no hook we can attach, so we route through this thunk instead.
    const setDraftText = useCallback((v: string) => {
        inlineEditDebug("setDraftText", { len: v.length });
        setDraftTextState(v);
    }, []);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const codeEditorRef = useRef<CodeEditorHandle | null>(null);
    const wysiwygRef = useRef<WysiwygEditorHandle | null>(null);
    // The element rendered in the live markdown tree we mirror with the textarea. We keep a
    // React-side rect derived from the DOM element so we can reposition on scroll / resize;
    // we do NOT keep the element in state because reading getBoundingClientRect during render
    // breaks SSR and causes layout thrash.
    const [overlayRect, setOverlayRect] = useState<{ top: number; left: number; width: number; height: number } | null>(
        null
    );
    const focusedSessionRef = useRef<InlineEditSession | null>(null);
    const [, setEditingFlag] = useAtom(inlineEditingActiveAtom);

    // Reset on file switch / unmount / external text rewrite that wipes our anchor.
    useEffect(() => {
        setEditSession(null);
        setDraftText("");
        setOverlayRect(null);
    }, [resetKey]);

    // Turn the global flag on/off in sync with editSession.
    useEffect(() => {
        const active = editSession != null;
        setEditingFlag(active);
        return () => active && setEditingFlag(false);
    }, [editSession, setEditingFlag]);

    const measureOverlay = useCallback(() => {
        const viewport = getViewportEl();
        const target = viewport && editSession ? resolveInlineEditTarget(viewport, editSession) : null;
        if (!viewport) {
            inlineEditDebug("measure: no viewport");
            setOverlayRect(null);
            return;
        }
        if (!target) {
            inlineEditDebug("measure: target lost (fallback miss or stale targetEl)", {
                startLine: editSession?.startLine,
                kind: editSession?.blockKind,
                scrollTop: viewport.scrollTop,
            });
            setOverlayRect(null);
            // The anchor block no longer exists in the DOM (deleted, or replaced beyond what
            // the fallback selector can find). Keeping the session alive here would leave its
            // block stuck with .inline-edit-hidden and NO textarea over it — the user just
            // sees blank content ("typed a line, nothing renders") until they happen to press
            // Esc. Closing the session lets the anchor-hide layout effect's cleanup remove the
            // hidden class again.
            setEditSession(null);
            setDraftText("");
            return;
        }
        const targetRect = target.getBoundingClientRect();
        // Overlay is rendered to a `position: fixed` host (a sibling of body via portal), so it
        // wants viewport-relative (screen) coordinates rather than content-absolute coordinates.
        // Content-absolute (`+ scrollTop`) was the source of a flicker loop:
        //   focus → selection auto-scrolls textarea into viewport → scrollTop jumps →
        //   scroll-listener → re-measure → next.top drifts (targetRect.top also moves with
        //   scrollTop, but by a DIFFERENT delta because the overlay's box added layout height to
        //   a child of the OSB viewport at a different position than where the selection lands)
        //   → setRect → textarea repositions → selection now off-screen again → scroll back …
        // With fixed + viewport-relative coords, scroll-events don't displace the overlay; the
        // textarea stays put where the user dblclicked and focus has nothing to scroll to.
        //
        // Width: anchor to the rendered target's left edge and span out to the markdown content
        // root's right edge — not to the target's own width. List/table targets are narrower than
        // the content area (list indent, table cell box), and an editor narrower than the
        // surrounding text breaks the "type where you read" feel. Spanning content-area-wide keeps
        // the editor visually continuous with the surrounding prose bar.
        const renderRoot = viewport.querySelector<HTMLElement>(".markdown-render-root");
        let width = targetRect.width;
        // 左边缘始终锚在渲染块自己身上：以前取 min(target.left, render.left) 会把列表项/
        // 缩进块的编辑器整体左移，双击瞬间文字就水平跳一下。起点不变、只向右扩展即可。
        const left = targetRect.left;
        if (renderRoot != null) {
            const renderRect = renderRoot.getBoundingClientRect();
            // 只给“明显窄”的块（列表项、表格单元格）向右扩展到内容区右边缘，保留“打字
            // 连续”的手感；段落/标题/引用/代码块严格用渲染块宽度，宽度一变折行位置就变。
            const shouldExtend = editSession.blockKind === "list" && targetRect.width < renderRect.width * 0.6;
            if (shouldExtend) {
                width = renderRect.right - targetRect.left;
            }
        }
        const viewportRect = viewport.getBoundingClientRect();
        width = Math.max(0, Math.min(width, viewportRect.right - targetRect.left));
        const next = {
            top: targetRect.top,
            left,
            width,
            // NOTE (D2): this is the overlay's MIN height, not a fixed height. The rendered block's
            // box is the anchor, but the editor must grow with its content (list Enter adds items,
            // prose wraps) — the overlay renders `minHeight: height; height: auto` so nothing the
            // user types is clipped. The field name stays `height` to avoid a wide rename.
            height: targetRect.height,
        };
        // Skip the state write when the rect is unchanged so re-measure churn (scroll events,
        // RAF polls, child re-mounts) doesn't trigger a re-render → re-measure → re-render loop.
        // We compare by value on all four fields; sub-pixel jitter from getBoundingClientRect is
        // bounded by layout scale and below the threshold a user perceives as "flicker".
        let skipped = true;
        setOverlayRect((prev) => {
            if (
                prev != null &&
                prev.top === next.top &&
                prev.left === next.left &&
                prev.width === next.width &&
                prev.height === next.height
            ) {
                return prev;
            }
            skipped = false;
            return next;
        });
        inlineEditDebug(
            `measure scrollTop=${viewport.scrollTop.toFixed(2)} tRectTop=${targetRect.top.toFixed(2)} tRectLeft=${targetRect.left.toFixed(2)} tRectW=${targetRect.width.toFixed(2)} tRectH=${targetRect.height.toFixed(2)} next(t=${next.top.toFixed(2)},l=${next.left.toFixed(2)},w=${next.width.toFixed(2)},h=${next.height.toFixed(2)}) skipped=${skipped} kind=${editSession?.blockKind ?? "?"} line=${editSession?.startLine ?? "?"}`
        );
    }, [editSession, getViewportEl]);

    // Hiding the original list item can change ordered-list marker layout and move the target
    // during the same render. Measure once more after the portal overlay is mounted so list
    // editors do not retain the pre-hide rectangle.
    useLayoutEffect(() => {
        if (editSession == null || overlayRect == null) return;
        const raf = requestAnimationFrame(() => measureOverlay());
        return () => cancelAnimationFrame(raf);
    }, [editSession, overlayRect, measureOverlay]);

    useLayoutEffect(() => {
        if (editSession == null) {
            return;
        }
        const viewport = getViewportEl();
        if (viewport == null) {
            inlineEditDebug("anchor-hide: no viewport");
            return;
        }
        const target = resolveInlineEditTarget(viewport, editSession);
        if (target == null) {
            inlineEditDebug("anchor-hide: target lost → clearing session", {
                kind: editSession.blockKind,
                startLine: editSession.startLine,
            });
            setEditSession(null);
            setDraftText("");
            setOverlayRect(null);
            return;
        }
        // `inline-edit-active` rides along so the block keeps an affordance (accent stripe)
        // through the hidden-but-still-laid-out element.
        target.classList.add("inline-edit-hidden");
        target.classList.add("inline-edit-active");
        return () => {
            target.classList.remove("inline-edit-hidden");
            target.classList.remove("inline-edit-active");
        };
    });

    useLayoutEffect(() => {
        if (editSession == null) {
            return;
        }
        inlineEditDebug("measure-effect fire", { kind: editSession.blockKind, startLine: editSession.startLine });
        measureOverlay();
    }, [editSession, measureOverlay]);

    // Re-measure on scroll / resize / dismiss. We attach scroll to the viewport element
    // (which is the OverlayScrollbars inner scrollable). Resize window covers container reflow.
    useEffect(() => {
        if (editSession == null) {
            return;
        }
        const viewport = getViewportEl();
        let scrollCalls = 0;
        const onScroll = () => {
            scrollCalls++;
            inlineEditDebug("scroll-listener", { scrollTop: viewport?.scrollTop, n: scrollCalls });
            measureOverlay();
        };
        const onResize = () => {
            inlineEditDebug("resize-listener");
            measureOverlay();
        };
        viewport?.addEventListener("scroll", onScroll, { passive: true });
        window.addEventListener("resize", onResize);
        // Re-measure on next paint in case the latest layout pass shifted position.
        inlineEditDebug("raf-arm");
        const raf = requestAnimationFrame(() => {
            inlineEditDebug("raf-fire");
            measureOverlay();
        });
        return () => {
            viewport?.removeEventListener("scroll", onScroll);
            window.removeEventListener("resize", onResize);
            cancelAnimationFrame(raf);
            inlineEditDebug("scroll-effect cleanup", { kind: editSession?.blockKind });
        };
    }, [editSession, measureOverlay, getViewportEl]);

    useLayoutEffect(() => {
        const isCode = editSession?.blockKind === "code";
        const ta = textareaRef.current;
        if (
            (!isCode && ta == null) ||
            (isCode && codeEditorRef.current == null) ||
            editSession == null ||
            overlayRect == null ||
            focusedSessionRef.current === editSession
        ) {
            return;
        }
        focusedSessionRef.current = editSession;
        inlineEditDebug("focus+select", { kind: editSession.blockKind, startLine: editSession.startLine });
        if (isCode) {
            // Code blocks use contenteditable: caret at the clicked spot when known, else at end
            // (dblclick is the "edit this whole block" gesture; contenteditable select-all is
            // impractical — it would select across token spans).
            codeEditorRef.current?.focus(
                editSession.caretOffset != null ? { start: editSession.caretOffset } : undefined
            );
        } else if (ta != null) {
            // preventScroll stops the browser from auto-scrolling the textarea into the viewport,
            // which on a tall block (list/table/code whose overlay exceeds the viewport height) sets
            // off a feedback loop: focus → auto-scroll → scroll-listener → re-measure → reposition →
            // new top is off-screen → focus rect auto-scrolls again. The textarea is positioned
            // absolutely over the block the user double-clicked; the scroll position the user picked
            // when dblclicking is the one we want to keep.
            ta.focus({ preventScroll: true });
            if (editSession.caretOffset != null) {
                const clamped = Math.max(0, Math.min(editSession.caretOffset, ta.value.length));
                ta.setSelectionRange(clamped, clamped);
            } else {
                // Dblclick (and any path that didn't provide a caret) keeps the select-all
                // behavior: it's the "edit this whole block" gesture.
                ta.setSelectionRange(0, ta.value.length);
            }
        }
    }, [editSession, overlayRect]);

    // Auto-grow textarea height to fit content. Skips code blocks (contenteditor auto-resizes via CSS).
    useLayoutEffect(() => {
        if (editSession?.blockKind === "code") return;
        const taEl = textareaRef.current;
        if (taEl == null || editSession == null) {
            return;
        }
        const beforeH = taEl.style.height;
        taEl.style.height = "auto";
        const scrollH = taEl.scrollHeight;
        taEl.style.height = `${scrollH}px`;
        inlineEditDebug("auto-grow", {
            beforeH,
            scrollH,
            clientH: taEl.clientHeight,
            scrollWidth: taEl.scrollWidth,
            clientWidth: taEl.clientWidth,
            draftLen: draftText.length,
        });
    }, [draftText, editSession, overlayRect?.width]);

    const beginEdit = useCallback(
        (
            blockKind: InlineEditBlockKind,
            line: number,
            targetEl: HTMLElement,
            caretOffset?: number,
            insertRevert?: () => void,
            placeholder?: boolean | "inline",
            keepOnEmpty?: boolean
        ): boolean => {
            const safeLine = Math.max(1, Math.trunc(line));
            const lines = fullTextRef.current.split(/\r\n|\n/);
            if (safeLine > lines.length) {
                return false;
            }
            // Multi-line visual blocks (soft-broken paragraphs/headings) carry an explicit
            // data-source-line-end so we slice the whole range. Headings without a soft break and
            // legacy renders without the end attr fall back to single-line — keeps the M1
            // single-line behavior intact for anything that hasn't been re-rendered.
            const endAttr = targetEl.dataset.sourceLineEnd;
            const endLineRaw = endAttr != null ? Number(endAttr) : safeLine;
            const endLine =
                Number.isFinite(endLineRaw) && endLineRaw >= safeLine
                    ? Math.min(Math.trunc(endLineRaw), lines.length)
                    : safeLine;
            const sourceContent = lines.slice(safeLine - 1, endLine).join("\n");
            // 归一化入口收敛到 initialContentFor（与 commit 的陈旧检测同一个函数，防漂移）。
            const initialContent = initialContentFor(blockKind, sourceContent);
            // 种子采集已搬到 md-dom。**feature 开关由宿主注入** —— 包不该知道宿主的
            // flag 存在哪里（这是保持“零宿主依赖”的那条边界）。
            const wysiwygInfo = captureWysiwygInfo(blockKind, targetEl, initialContent, {
                isWysiwygEnabled: () => isBlockEditorFeatureEnabled("wysiwyg"),
            });
            // R4: capture the callout marker from the ORIGINAL source first line. Only for
            // WYSIWYG sessions — a textarea fallback commits the raw source verbatim (marker
            // already included), so applying a prefix there would duplicate it.
            const isCallout = targetEl.matches("calloutalert, .markdown-alert");
            const calloutPrefix =
                wysiwygInfo != null && isCallout
                    ? captureCalloutPrefix(lines[safeLine - 1] ?? "")
                    : undefined;
            const session: InlineEditSession = {
                blockKind,
                startLine: safeLine,
                endLine,
                initialContent,
                targetEl,
                // step3 S2：块身份从锚点元素上直接读（remarkBlockIds 打的 data-block-id）。
                // 没这个属性（旧 DOM / 未覆盖的块型）时 undefined，提交前自动跳过重定位。
                blockId: targetEl.dataset.blockId ?? undefined,
                typography: captureBlockTypography(targetEl),
                caretOffset,
                insertRevert,
                placeholder: placeholder === "inline" ? true : placeholder || undefined,
                placeholderInline: placeholder === "inline",
                placeholderKeepOnEmpty: keepOnEmpty || undefined,
                wysiwyg: wysiwygInfo != null,
                wysiwygHtml: wysiwygInfo?.html,
                wysiwygHeadingLevel: wysiwygInfo?.headingLevel,
                wysiwygListMarker: wysiwygInfo?.listMarker,
                wysiwygListIndent: wysiwygInfo?.listIndent,
                isCallout: isCallout || undefined,
                calloutPrefix,
            };
            inlineEditDebug("beginEdit", {
                kind: blockKind,
                startLine: safeLine,
                endLine,
                caretOffset,
                initialLen: initialContent.length,
                targetTag: targetEl.tagName,
                targetConnected: targetEl.isConnected,
                targetHasSourceLineEnd: targetEl.dataset.sourceLineEnd != null,
            });
            setEditSession(session);
            setDraftText(initialContent);
            return true;
        },
        []
    );

    // Opens a blank editor that inserts a NEW block before/after the anchor block on commit.
    // The overlay anchors to the given element (the block whose edge the user hovered); the
    // draft starts empty and its committed text is spliced in as a fresh block with a blank
    // line separator (see commit's insertMode branch). startLine/endLine bracket the WHOLE
    // block (list/table/code/multi-line paragraph carry data-source-line-end): "before"
    // splices above startLine, "after" splices below endLine — otherwise inserting after a
    // list would tear it open mid-list.
    const beginInsertEdit = useCallback(
        (startLine: number, endLine: number, targetEl: HTMLElement, mode: "before" | "after") => {
            const safeStart = Math.max(1, Math.trunc(startLine));
            const safeEnd = Math.max(safeStart, Math.trunc(endLine));
            const session: InlineEditSession = {
                blockKind: "p",
                startLine: safeStart,
                endLine: safeEnd,
                initialContent: "",
                targetEl,
                insertMode: mode,
            };
            inlineEditDebug("beginInsertEdit", {
                startLine: safeStart,
                endLine: safeEnd,
                mode,
                targetTag: targetEl.tagName,
                targetConnected: targetEl.isConnected,
            });
            setEditSession(session);
            setDraftText("");
        },
        []
    );

    const commit = useCallback(
        (content?: string) => {
            // Read editSession from closure (callback identity updates with session since it's in the
            // dep array). The previous implementation called onCommit *inside* the setEditSession
            // updater — that schedules an external jotai store write (globalStore.set(model.newFileContent))
            // from within a React state updater, which React does not let through cleanly: the
            // downstream async fileContentAtom subscribing to record.stateAtom misses the invalidate
            // and ReactMarkdown keeps rendering the pre-edit text until something else (a Save, a tab
            // blur) bumps the fileKey atom. Pulling the commit side effect out of the updater — and
            // closing over the current session — fixes the live-preview-after-blur refresh path.
            const session = editSession;
            if (session == null) {
                return;
            }
            inlineEditDebug("commit", {
                kind: session.blockKind,
                startLine: session.startLine,
                insertMode: session.insertMode,
                draftLen: draftText.length,
                initialLen: session.initialContent.length,
                changed: draftText !== session.initialContent,
            });
            setEditSession(null);
            setDraftText("");
            // ---------------------------------------------------------------------------
            // step3 S2：先按块身份重定位（命中则用**当前**行号，行号位移后仍写对位置），
            // 再做陈旧检测（当前源码切片与 initialContent 不符 → 中止，不写盘）。
            //
            // 位置：在**所有**写盘分支（空壳守卫 / placeholder / insertMode / 控制器 / replaceSourceRange）
            // 之前；空壳守卫继续在 placeholder 分支之前（step1 的 BLOCKER1 结论绝不能回退）。
            // 中止时只关掉编辑器（上面已做），不调 onCommit → 文本与磁盘均不变。
            // ---------------------------------------------------------------------------
            const root = getViewportEl()?.querySelector<HTMLElement>(MarkdownRenderRootSelector) ?? null;
            const prepared = prepareInlineEditCommit(session, fullTextRef.current, root);
            if (!prepared.ok) {
                inlineEditDebug("commit:stale-target-blocked", {
                    kind: session.blockKind,
                    blockId: session.blockId,
                    startLine: session.startLine,
                    endLine: session.endLine,
                });
                return;
            }
            const current = prepared.session;
            // 只在行号**真的**被纠正时记日志：relocated 为真只表示「解析到了范围」，
            // 大多数提交解析出来的就是捕获时那个范围，记下来只会把真正有用的信号淹掉。
            if (
                prepared.relocated &&
                (current.startLine !== session.startLine || current.endLine !== session.endLine)
            ) {
                inlineEditDebug("commit:relocated", {
                    blockId: current.blockId,
                    by: prepared.relocatedBy,
                    from: session.startLine,
                    to: current.startLine,
                    endLine: current.endLine,
                });
            }
            // step3 S3：块级逆操作记账（数据层，行为零变化）。
            // 用的是**重定位后**的 startLine/endLine（与真正写盘的范围一致），
            // before = 会话 initialContent（该块原文），after = 本块写盘后的内容。
            // 消费点：markdown.tsx 的提交通道把它连同 undo 快照一起入栈；
            // 阶段 4 的块级结构操作（移动/缩进/删除）才真正用它做逆操作。
            const commitOpts = (after: string): InlineEditCommitOptions => ({
                blockOp: {
                    blockId: current.blockId,
                    startLine: current.startLine,
                    endLine: current.endLine,
                    before: current.initialContent,
                    after,
                },
            });
            // 方案 02 §2.1 typing transform: a paragraph/blank editor whose first draft line
            // matches a typing pattern ("# ", "> ", "- [ ] ", fence, "| a |", incl. full-width
            // ＃／＞／＊／···) commits the CANONICAL rewritten line — the source stays clean
            // markdown and the block transforms on re-render, all inside this one commit.
            // Master switch off (方案 06 §5) → the draft commits verbatim, no transform.
            // For code blocks (contenteditable), draftText may be stale — the caller passes the
            // actual editor content via the `content` parameter.
            let committedDraft =
                content ??                (current.wysiwyg
                    ? // WYSIWYG：DOM 是事实源。组合中 syncMirror 被 compositionActiveRef 跳过 →
                      // draftText 可能滞后（组合前文本）；切块路径（pointerdown commit 无 content）
                      // 若用陈旧 draftText 会丢组合中未落盘的字符，且 compositionend 的 syncMirror
                      // 会串块覆写新会话的 draftText（P3 终审 P1）。故 content 缺失时优先从 DOM
                      // 序列化取当前完整文本（含组合中内容）。
                      (wysiwygRef.current?.getMarkdown() ?? draftText)
                    : (current.blockKind === "p" || current.blockKind === "blank") &&
                        isBlockEditorFeatureEnabled("blockeditor")
                      ? (rewriteDraftFirstLine(draftText) ?? draftText)
                      : draftText);
            // F3: the DOM serializer emits lists from depth 0, but the session may be an INNER
            // list (source lines indented). Re-apply the captured source indent to every
            // non-empty line so committing an inner list keeps it nested.
            if (current.blockKind === "list" && current.wysiwygListIndent) {
                committedDraft = indentListDraft(committedDraft, current.wysiwygListIndent);
            }
            // STRUCTURAL DATA-SAFETY GUARD (BLOCKER 1 + 2): if the DOM serialized to this
            // kind's empty-shell shape while the mirror draft still holds content, the editor
            // root never carried content (or serialization collapsed) — no branch below may
            // write that over an existing block.
            // Discriminator differs per kind, on purpose:
            //   - quote: the shell is a NON-EMPTY ">", and emptying a whole quote is a rare
            //     operation — so block whenever the draft collapsed to a shell and the mirror is
            //     not empty. Silent loss of a quote's body is unrecoverable, a blocked clear is
            //     only an annoyance (and the file's source editor can still delete it).
            //   - h / list / p: the shell (`###`, `- `, `""`) is exactly what a LEGITIMATE clear
            //     leaves behind, so both sides being a shell means "the user cleared it" and the
            //     commit must stand; only a mirror that still holds content while the DOM
            //     collapsed is the "seed never landed" signature.
            // Must run BEFORE the `placeholder` branch: a placeholder session can open an
            // EXISTING non-empty block (handleNavigateUp's merge), and an empty root there
            // used to commit `">"` over it.
            const domShell = isEmptyBlockShellDraft(current.blockKind, committedDraft);
            const mirrorShell = isEmptyBlockShellDraft(current.blockKind, draftText);
            const seedNeverLanded =
                current.blockKind === "quote"
                    ? draftText.trim() !== "" && domShell
                    : !mirrorShell && domShell;
            if (current.wysiwyg && seedNeverLanded) {
                inlineEditDebug("commit:empty-shell-blocked", {
                    kind: current.blockKind,
                    draft: committedDraft,
                });
                return;
            }
            if (current.placeholder) {
                // Placeholder-row commit (click A/B insert or Enter split pre-inserted a single
                // blank row for us to type into). Typed something → replace the row; block-level
                // inserts re-add separator blanks as needed (commitPlaceholderBlock, netting one
                // new block), inline <p> inserts just replace with NO blank (the paragraph's own
                // separator blanks still bracket it → a flush soft-broken new line). Nothing
                // typed → the pre-insert must not survive: revert the document to its pre-insert
                // state so the click leaves zero trace — UNLESS this is an Enter-split follow-up
                // row: the same gesture already committed real content above, and reverting here
                // would erase it so the next Save writes the erased text to disk ("typed a line,
                // Enter, then Save → content disappears").
                if (draftText.trim().length === 0) {
                    if (!current.placeholderKeepOnEmpty) {
                        current.insertRevert?.();
                    }
                    return;
                }
                // Placeholder sessions also cover "open an existing block" (handleNavigateUp's
                // merge-up flow opens the PREVIOUS non-empty block with placeholder=true). The
                // user typed nothing, so this must be a no-op — never rewrite that block.
                // Kept AFTER the empty-draft revert above: that branch owns rolling back a
                // pre-inserted row, so an early return here would leak the pre-insert.
                if (draftText === current.initialContent && current.initialContent.trim().length > 0) {
                    return;
                }
                onCommit(
                    current.placeholderInline
                        ? replaceSourceRange(fullTextRef.current, current.startLine, current.endLine, committedDraft)
                        : commitPlaceholderBlock(
                              fullTextRef.current,
                              current.startLine,
                              current.endLine,
                              committedDraft
                          ),
                    commitOpts(committedDraft)
                );
                return;
            }
            const unchangedDraft = draftText === current.initialContent;
            // SAFETY NET: a quote whose editor DOM is empty serializes to a lone ">" (or a run of
            // bare ">" lines). Writing that over a quote that HAD content deletes the user's text —
            // a failure mode with no recovery. Never treat an empty quote shell as an edit;
            // deleting a whole quote remains possible from the source editor.
            const isEmptyQuoteShell =
                current.wysiwyg &&
                current.blockKind === "quote" &&
                isEmptyQuoteShellDraft(committedDraft) &&
                current.initialContent.trim() !== "";
            if ((unchangedDraft || isEmptyQuoteShell) && current.insertMode == null) {
                // No-op commit: nothing to write. Don't touch the shared draft atom — keeps the dirty
                // flag honest. (Insert sessions always write: their initialContent is empty and a
                // non-empty draft is the whole point, an empty draft is skipped below.)
                return;
            }
            if (draftText.trim().length === 0 && current.insertMode != null) {
                // Inserted a blank line then committed nothing: drop the empty draft, no-op.
                return;
            }
            // R4: restore the callout marker + emoji on the first line. MUST run AFTER the
            // shell guards above — they recognize a bare ">" draft (the collapsed-root
            // signature); once the marker is written back, "> [!NOTE]" no longer looks like a
            // shell and the guard would wrongly let a destroyed quote through.
            if (current.calloutPrefix != null && current.calloutPrefix !== "") {
                committedDraft = applyCalloutPrefix(committedDraft, current.calloutPrefix);
            }
            let newFull: string;
            // 真正写入该块范围的文本（S3 的 op.after）——各分支实际的写盘内容，
            // 不是编辑器草稿：else 分支可能要补回 code 围栏 / list marker。
            let opAfter = committedDraft;
            if (current.insertMode != null) {
                // Insert the draft as a new block before/after the anchor line. Draft lines are
                // inserted verbatim (blank lines inside the draft stay blank); we bracket the block
                // with a blank line so it renders as its own paragraph.
                const lines = fullTextRef.current.split(/\r\n|\n/);
                const draftLines = committedDraft.split(/\r\n|\n/);
                newFull = spliceInsertBlock(
                    lines,
                    current.startLine,
                    current.endLine,
                    current.insertMode,
                    draftLines
                ).join("\n");
            } else if (
                // P2-B2/P2-B3：WYSIWYG prose + list（p/h/quote/blank/list）提交定位收敛到
                // 块模型控制器。drafted content 来自 DOM 反序列化（serializeBlockDomToMarkdown），
                // 已是完整块 markdown（h 带 #、quote 带 >、list 每行带 marker）；这里把「裸行号
                // replaceSourceRange」改为控制器 replace-content intent（块坐标 →
                // lineRangeToCharOffset → 文本变换），统一到块模型 + P1 undo 栈模式。
                // 行为与现状等价，textarea/list 之外的块不动。P2-B3 关键：list 的 committedDraft
                // 已含每行 marker，整体替换即正确（不再走 else 的 wrapListMarker 重复包 marker）。
                // 空内容提交（清空段落/列表）除外：replaceSourceRange 的空 segment 语义是「删除
                // 整行不留空行」，而控制器的字符范围替换会留下空行（见 editor-controller.test.ts
                // 空内容用例）——此处 committedDraft.length > 0 让空内容回落原 replaceSourceRange，
                // 保证清空段落 = 删除该行，与现状完全一致。
                current.wysiwyg &&
                committedDraft.length > 0 &&
                (current.blockKind === "p" ||
                    current.blockKind === "h" ||
                    current.blockKind === "quote" ||
                    current.blockKind === "blank" ||
                    current.blockKind === "list")
            ) {
                // 1-based 会话行号 → 0-based Block（控制器内部依赖块坐标，基于语义复刻 P2-B1）。
                const sl0 = current.startLine - 1;
                const el0 = current.endLine - 1;
                const block: Block = {
                    id: `prose:${sl0}:${el0}`,
                    kind: inlineKindToTreeKind(current.blockKind, committedDraft),
                    startLine: sl0,
                    endLine: el0,
                    depth: 0,
                    text: current.initialContent ?? "",
                    children: [],
                };
                const res = editorController.apply(
                    { type: "replace-content", block, content: committedDraft },
                    { text: fullTextRef.current }
                );
                if (res != null) {
                    onCommit(res.text, commitOpts(committedDraft));
                    return;
                }
                // 理论不失败（坐标合法即成功）；兜底 fallthrough 到原 replaceSourceRange。
                newFull = replaceSourceRange(
                    fullTextRef.current,
                    current.startLine,
                    current.endLine,
                    committedDraft
                );
            } else {
                const originalSource = fullTextRef.current
                    .split(/\r?\n/)
                    .slice(current.startLine - 1, current.endLine)
                    .join("\n");
                const sourceDraft =
                    current.blockKind === "code"
                        ? wrapCodeFence(committedDraft, originalSource)
                        : current.blockKind === "list"
                          ? wrapListMarker(committedDraft, originalSource)
                          : committedDraft;
                opAfter = sourceDraft;
                newFull = replaceSourceRange(fullTextRef.current, current.startLine, current.endLine, sourceDraft);
            }
            onCommit(newFull, commitOpts(opAfter));
        },
        [editSession, draftText, onCommit, getViewportEl]
    );

    const cancel = useCallback(() => {
        // If this editor was opened by an immediate-insert flow (click A/B or Enter split),
        // the document already changed — Esc must revert the whole insert, not just close the
        // editor. Otherwise a plain cancel leaves the document untouched.
        editSession?.insertRevert?.();
        inlineEditDebug("cancel", { kind: editSession?.blockKind, startLine: editSession?.startLine });
        setEditSession(null);
        setDraftText("");
    }, [editSession]);

    // Silent close: no commit, no insertRevert. Command flows (slash palette, toolbar
    // block switch) compute their final text themselves and commit once — afterwards the
    // session must simply go away.
    const dismiss = useCallback(() => {
        inlineEditDebug("dismiss", { kind: editSession?.blockKind, startLine: editSession?.startLine });
        setEditSession(null);
        setDraftText("");
    }, [editSession]);

    return {
        editSession,
        draftText,
        setDraftText,
        beginEdit,
        beginInsertEdit,
        commit,
        cancel,
        dismiss,
        textareaRef,
        codeEditorRef,
        wysiwygRef,
        overlayRect,
    };
}

type InlineEditOverlayProps = {
    overlayRect: { top: number; left: number; width: number; height: number } | null;
    blockKind: InlineEditBlockKind | null;
    typography?: React.CSSProperties;
    draftText: string;
    textareaRef: React.RefObject<HTMLTextAreaElement | null>;
    codeEditorRef: React.RefObject<CodeEditorHandle | null>;
    /** WYSIWYG editor handle (方案 08) — present when the session edits prose WYSIWYG. */
    wysiwygRef?: React.RefObject<WysiwygEditorHandle | null>;
    /** Rendered HTML seed for the WYSIWYG editor (no block markers). */
    wysiwygHtml?: string;
    /** Heading level (1-6) for WYSIWYG heading blocks. */
    wysiwygHeadingLevel?: number;
    /** Preserved original list marker for WYSIWYG list blocks. */
    wysiwygListMarker?: string;
    /**
     * Stable key for the current edit session (e.g. "kind|startLine"). Forcing a
     * remount when it changes guarantees the WysiwygEditor never displays a PREVIOUS
     * block's content: switching from block A to block B re-creates the editor so
     * its internal liveKind/headingLevel/DOM seed all reset to block B.
     */
    wysiwygSessionKey?: string;
    /**
     * F6: rendered-text offset the caret should land on when the WYSIWYG editor takes focus.
     * Set by the single-click-to-edit path (markdown.tsx maps the click point to an offset);
     * without it the editor focuses at the start/end, so clicking list item N dropped the
     * caret at the list head. `undefined` keeps the old focus-at-end behavior.
     */
    caretOffset?: number;
    onTextChange: (v: string, caret: number) => void;
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void;
    onPaste?: (e: React.ClipboardEvent<HTMLElement>) => void;
    onBlur: (content?: string) => void;
    /** Block-appropriate placeholder (方案 03 §2) — shown only while the draft is empty. */
    placeholder?: string;
    /** Caret activity (click/keyup/select) — drives slash-palette / toolbar tracking. */
    onCaretChange?: (caret: number, selEnd: number) => void;
    /**
     * Format prefix for slash command ghost placeholder. When draftText equals this prefix,
     * a gray ghost text is shown after the prefix to hint the user what format they chose.
     * E.g., formatPrefix="# " + ghostPlaceholder="Heading 1" shows "# Heading 1" with
     * "Heading 1" in gray.
     */
    formatPrefix?: string;
    /** Ghost placeholder text shown in gray after the format prefix. */
    ghostPlaceholder?: string;
    /** Override typography for the textarea when format prefix is active. */
    formatTypography?: React.CSSProperties;
    /** Code block being edited: language for the isomorphic top bar + syntax highlight. */
    codeLanguage?: string | null;
    /** Code block language change handler. */
    onApplyLanguage?: (lang: string | null) => void;
};

/**
 * 代码块编辑态顶栏。pre 被 inline-edit-hidden 后内部的 .codeblock-header 也跟着隐藏，
 * 所以在 overlay 里重建一个与预览态同构的顶栏（语言标签 + 复制/执行按钮），保持视觉一致。
 */
const CodeLanguages = [
    "text",
    "diff",
    "javascript",
    "typescript",
    "tsx",
    "python",
    "json",
    "html",
    "css",
    "bash",
    "shell",
    "go",
    "rust",
    "sql",
    "yaml",
    "markdown",
];

function CodeBlockEditHeader({
    language,
    onApplyLanguage,
}: {
    language?: string | null;
    onApplyLanguage?: (lang: string | null) => void;
}) {
    if (onApplyLanguage == null) return null;
    return (
        <div className="codeblock-header codeblock-edit-header" onMouseDown={(e) => e.stopPropagation()}>
            <select
                className="codeblock-lang-select"
                value={language ?? "text"}
                aria-label="Code language"
                onChange={(e) => onApplyLanguage(e.target.value === "text" ? null : e.target.value)}
            >
                {CodeLanguages.map((item) => (
                    <option key={item} value={item}>
                        {item}
                    </option>
                ))}
            </select>
        </div>
    );
}

export function InlineEditOverlay({
    overlayRect,
    blockKind,
    typography,
    draftText,
    textareaRef,
    codeEditorRef,
    onTextChange,
    onKeyDown,
    onPaste,
    onBlur,
    placeholder,
    onCaretChange,
    formatPrefix,
    ghostPlaceholder,
    formatTypography,
    codeLanguage,
    onApplyLanguage,
    wysiwygRef,
    wysiwygHtml,
    wysiwygHeadingLevel,
    wysiwygListMarker,
    wysiwygSessionKey,
    caretOffset,
}: InlineEditOverlayProps) {
    useLayoutEffect(() => {
        if (overlayRect == null || blockKind == null) {
            return;
        }
        const raf = requestAnimationFrame(() => {
            if (wysiwygRef?.current != null) {
                // F6: pass the click-derived offset through so a single click inside a list /
                // paragraph lands the caret where the user clicked. `focus(undefined)` keeps the
                // old focus-at-end behavior for dblclick / keyboard sessions.
                wysiwygRef.current.focus(caretOffset);
                return;
            }
            if (blockKind === "code") {
                codeEditorRef.current?.focus();
                return;
            }
            textareaRef.current?.focus({ preventScroll: true });
        });
        return () => cancelAnimationFrame(raf);
    }, [blockKind, overlayRect, wysiwygSessionKey, wysiwygRef, codeEditorRef, textareaRef, caretOffset]);

    if (overlayRect == null || blockKind == null) {
        return null;
    }
    // code blocks in M1+ would switch font-family to monospace here; for p/h we keep the
    // surrounding paragraph font so typing feels continuous with reading.
    //
    // Render to document.body via portal: the overlay is `position: fixed` so it ignores the
    // OverlayScrollbars inner viewport's scrollTop. Rendering inside the OSB viewport (the old
    // approach) made the textarea a participant in OSB's scroll-content layout, which on tall
    // blocks triggered a focus → auto-scroll → re-measure → reposition loop. The portal frees
    // the overlay from that container's coordinate system; measureOverlay now writes viewport-
    // relative (screen) coordinates so `position: fixed` lands at the right pixel.
    return createPortal(
        <div
            className="inline-edit-overlay"
            data-block-kind={wysiwygRef != null && wysiwygHtml != null ? "wysiwyg" : blockKind}
            style={{
                position: "fixed",
                top: `${overlayRect.top}px`,
                left: `${overlayRect.left}px`,
                width: `${overlayRect.width}px`,
                // Fixed height clipped growing content (D2). minHeight anchors the box to the
                // rendered block; height:auto lets it grow; maxHeight + overflowY keeps a very tall
                // editor inside the viewport while remaining scrollable.
                //
                // F5: `min-height` is applied BEFORE `max-height` in the CSS cascade, so a plain
                // block-height minHeight overrides maxHeight whenever the block is taller than the
                // viewport (bottom unreachable). Clamping minHeight by the SAME viewport bound keeps
                // min <= max: the editor is at least 160px but never pinned above the max-height.
                minHeight: `min(${overlayRect.height}px, max(160px, calc(100vh - ${overlayRect.top}px - 8px)))`,
                height: "auto",
                // `max()` matters: for a block whose top sits below the viewport the plain
                // `calc(100vh - top)` goes NEGATIVE, and a clamped-to-zero max-height pins the
                // editor back to the rendered block's height — recreating the clipping this
                // min/auto pair exists to fix. The floor keeps at least a few lines reachable.
                maxHeight: `max(160px, calc(100vh - ${overlayRect.top}px - 8px))`,
                overflowY: "auto",
                overflowX: "hidden",
                maxWidth: `${overlayRect.width}px`,
                boxSizing: "border-box",
            }}
            // Prevent the overlay from catching the markdown root's own dblclick/click handlers.
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
        >
            {blockKind === "code" ? (
                <pre
                    className="codeblock"
                    // Clicking the pre's padding zone (above/below the code) shouldn't drop focus;
                    // route it into the editable code instead. preventDefault keeps the caret
                    // from being destroyed by the mousedown default action.
                    onMouseDown={(e) => {
                        if (e.target === e.currentTarget) {
                            e.preventDefault();
                            codeEditorRef.current?.focus();
                        }
                    }}
                >
                    {/* 编辑态复用渲染态 DOM 结构：pre.codeblock > code.hljs(contenteditable) + 同构顶栏，
                        样式由 markdown.scss 的真源组合选择器
                        （.markdown .content / .inline-edit-overlay[data-block-kind="code"]）天然生效
                        → 进出编辑零跳变（此处不再持有镜像声明）。 */}
                    <ContentEditableCodeEditor
                        ref={codeEditorRef}
                        initialText={draftText}
                        language={codeLanguage}
                        onKeyDown={onKeyDown}
                        onInput={(text, caret) => onTextChange(text, caret)}
                        onBlur={() => onBlur(codeEditorRef.current?.getContent())}
                    />
                    <CodeBlockEditHeader language={codeLanguage} onApplyLanguage={onApplyLanguage} />
                </pre>
            ) : wysiwygRef != null && wysiwygHtml != null ? (
                <WysiwygEditor
                    key={wysiwygSessionKey ?? "wysiwyg"}
                    ref={wysiwygRef}
                    initialHtml={wysiwygHtml}
                    blockKind={blockKind as WysiwygEligibleKind}
                    headingLevel={wysiwygHeadingLevel}
                    listMarker={wysiwygListMarker}
                    typography={typography}
                    placeholder={placeholder}
                    onInput={(md, caretMd) => {
                        onTextChange(md, caretMd);
                        onCaretChange?.(caretMd, caretMd);
                    }}
                    onKeyDown={onKeyDown as (e: React.KeyboardEvent<HTMLElement>) => void}
                    onBlur={(content) => onBlur(content)}
                    onPaste={onPaste as ((e: React.ClipboardEvent<HTMLElement>) => void) | undefined}
                    onSelectionChange={(sel) => {
                        // WYSIWYG 选区 → overlay 的 onCaretChange(caret, selEnd)：折叠选区
                        // selEnd===caret → 父层不显示工具栏；非折叠 → sel={start,end}。
                        if (sel != null) {
                            onCaretChange?.(sel.start, sel.end);
                        } else {
                            const caret = wysiwygRef.current?.getCaretMarkdown() ?? 0;
                            onCaretChange?.(caret, caret);
                        }
                    }}
                />
            ) : (
                <>
                    <textarea
                        ref={textareaRef}
                        className="inline-edit-textarea"
                        style={{ ...typography, ...formatTypography }}
                        value={draftText}
                        rows={1}
                        placeholder={placeholder}
                        onChange={(e) => onTextChange(e.target.value, e.target.selectionStart)}
                        onKeyDown={onKeyDown as (e: React.KeyboardEvent<HTMLTextAreaElement>) => void}
                        onPaste={onPaste}
                        onBlur={() => onBlur()}
                        onSelect={(e) => {
                            const t = e.currentTarget;
                            onCaretChange?.(t.selectionStart, t.selectionEnd);
                        }}
                        onKeyUp={(e) => {
                            const t = e.currentTarget;
                            onCaretChange?.(t.selectionStart, t.selectionEnd);
                        }}
                        onClick={(e) => {
                            const t = e.currentTarget;
                            onCaretChange?.(t.selectionStart, t.selectionEnd);
                        }}
                        spellCheck={false}
                        autoCapitalize="off"
                        autoCorrect="off"
                    />
                    {/* Ghost placeholder: shows gray hint text after format prefix when draft is just the prefix */}
                    {formatPrefix != null && ghostPlaceholder != null && draftText === formatPrefix && (
                        <span
                            className="inline-edit-ghost-placeholder"
                            style={{
                                position: "absolute",
                                top: 0,
                                left: 0,
                                pointerEvents: "none",
                                whiteSpace: "pre",
                                ...typography,
                                ...formatTypography,
                                color: "transparent",
                            }}
                            aria-hidden="true"
                        >
                            {formatPrefix}
                            <span style={{ color: "var(--secondary-text-color)" }}>{ghostPlaceholder}</span>
                        </span>
                    )}
                </>
            )}
        </div>,
        document.body
    );
}

/**
 * Shared keydown handler for the textarea. Returns nothing; the caller threads commit/cancel.
 *
 * - Esc → cancel (drop draft)
 * - Cmd/Ctrl+S → commit, then if an `onSave` was wired, call it (the preview-side caller feeds
 *   `model.handleFileSave` here). ⌘S must be `preventDefault`'d in preview mode because no
 *   global ⌘S handler runs there to consume the keystroke — leaving the default would let the
 *   browser try (and fail) to "Save Page". The old comment "let it bubble to Wave's save
 *   handler" describes a path that no longer exists in preview mode, so we drive the flush
 *   ourselves and stop the event.
 * - Cmd/Ctrl+Enter → commit
 * - plain blur (handled in onBlur, not here)
 */
export function makeInlineEditKeydown(opts: {
    commit: () => void;
    cancel: () => void;
    save?: () => void;
    /** Called on a bare Enter (no Shift/Cmd/Ctrl, not IME-composing) so the caller can split the block at the caret. */
    onSplitCaret?: () => void;
    /** Called when Backspace/Delete is pressed on an EMPTY draft so the caller can merge the
     *  cursor up into the previous block (standard text-editor behavior on a blank line). */
    onNavigateUp?: () => void;
    /** When true, a bare Enter is left to the browser (no preventDefault, no split): used for
     *  WYSIWYG list sessions where the contentEditable owns list semantics (Enter creates a
     *  new <li> natively). IME-composing Enter still never splits (candidates consume it). */
    allowNativeEnter?: () => boolean;
    /** When true, an EMPTY-draft Backspace/Delete is left to the browser (no merge-up): used for
     *  WYSIWYG list sessions where the contentEditable owns list semantics (Backspace on an
     *  empty item merges/removes it natively). Without this, the shared keydown would call
     *  onNavigateUp → cancel and close the editor, leaving the empty item behind. */
    allowNativeBackspaceOnEmpty?: () => boolean;
    /** Called when ArrowUp is pressed with the caret at the block's FIRST line start (cross-block
     *  navigation, P3 F6/G8). */
    onNavigatePrev?: () => void;
    /** Called when ArrowDown is pressed with the caret at the block's LAST line end (cross-block
     *  navigation, P3 F6/G8). */
    onNavigateNext?: () => void;
    /** Current caret offset within the draft (textarea selectionStart / WYSIWYG markdown caret). */
    getCaretPos?: () => number;
    /** Total draft length in the same coordinate as getCaretPos. */
    getTextLen?: () => number;
    /** Called on Tab/Shift+Tab in a list session so the caller can indent/outdent (P3 F9/G9). */
    onIndentList?: (dir: 1 | -1) => void;
}) {
    return (e: React.KeyboardEvent<HTMLElement>) => {
        if (e.key === "Escape") {
            e.preventDefault();
            opts.cancel();
            return;
        }
        const isCmd = e.metaKey || e.ctrlKey;
        // Merge-up on a blank line: pressing Backspace (or Delete) while the draft is empty jumps
        // to the PREVIOUS block and opens its editor — the same way Backspace on a blank line in
        // any standard editor pulls the caret up into the line above. Skipped while IME is composing
        // (candidates consume the key) and when the caller didn't wire onNavigateUp. Non-empty drafts
        // keep the textarea's native Backspace/Delete so deleting characters is unaffected.
        if ((e.key === "Backspace" || e.key === "Delete") && !isCmd && !e.shiftKey && opts.onNavigateUp != null) {
            const ta = e.currentTarget;
            const native = e.nativeEvent as KeyboardEvent & { isComposing?: boolean };
            if (
                !native.isComposing &&
                ((ta as HTMLTextAreaElement).value ?? (ta as HTMLElement).textContent ?? "").length === 0
            ) {
                // WYSIWYG list: let the contentEditable handle Backspace natively (merge/remove the
                // empty item). Without this the shared keydown would call onNavigateUp → the caller
                // closes the editor, leaving a dangling empty item and losing focus.
                if (opts.allowNativeBackspaceOnEmpty != null && opts.allowNativeBackspaceOnEmpty()) {
                    return;
                }
                e.preventDefault();
                opts.onNavigateUp();
                return;
            }
        }
        // 跨块方向键导航（P3 F6/G8）：光标在块首时按 ↑ → 上一块；光标在块尾时按 ↓ → 下一块。
        // 组合中（输入法候选态）不拦截，让浏览器原生处理。仅当调用方 wire 了导航回调。
        // 惰性求值 caret/textLen：只在导航键时算（每次击键全量序列化有卡顿风险，P3 终审 P2-4）。
        const native = e.nativeEvent as KeyboardEvent & { isComposing?: boolean };
        if (!native.isComposing && (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "Tab")) {
            if (
                (e.key === "ArrowUp" || e.key === "ArrowDown") &&
                (opts.onNavigatePrev != null || opts.onNavigateNext != null)
            ) {
                const caretPos = opts.getCaretPos?.() ?? 0;
                const textLen = opts.getTextLen?.() ?? 0;
                if (e.key === "ArrowUp" && caretPos === 0 && opts.onNavigatePrev != null) {
                    e.preventDefault();
                    opts.onNavigatePrev();
                    return;
                }
                if (e.key === "ArrowDown" && caretPos >= textLen && opts.onNavigateNext != null) {
                    e.preventDefault();
                    opts.onNavigateNext();
                    return;
                }
            }
            // 列表 Tab/Shift+Tab 缩进（P3 F9/G9）：仅当调用方 wire 了 onIndentList。
            if (e.key === "Tab" && opts.onIndentList != null) {
                e.preventDefault();
                opts.onIndentList(e.shiftKey ? -1 : 1);
                return;
            }
        }
        // Split-on-Enter (note-app behavior): bare Enter ends the block, Shift+Enter keeps the
        // soft line break. Skip while IME is composing (Chinese/Japanese candidates send
        // Enter to pick a word) and when the caller didn't wire a split handler.
        if (e.key === "Enter" && !isCmd && !e.shiftKey && opts.onSplitCaret != null) {
            const native = e.nativeEvent as KeyboardEvent & { isComposing?: boolean };
            if (!native.isComposing) {
                // WYSIWYG list: the contentEditable owns list semantics (Enter creates a new
                // <li> natively). Leave the key to the browser instead of preventDefault+split,
                // otherwise the native list-item creation is swallowed and Enter is a dead key.
                if (opts.allowNativeEnter != null && opts.allowNativeEnter()) {
                    return;
                }
                e.preventDefault();
                opts.onSplitCaret();
                return;
            }
        }
        if (isCmd && (e.key === "s" || e.key === "S")) {
            // Commit synchronously so the draft atom carries the just-typed text before save runs.
            // Then flush it directly via the wired `save` callback. stopPropagation prevents the
            // event from reaching the global Cmd/Ctrl+S handler (keymodel saveFocusedPreviewDraft),
            // which would otherwise double-fire handleFileSave (harmless — it no-ops when the
            // draft is already cleared — but avoid the redundant write).
            e.preventDefault();
            e.stopPropagation();
            opts.commit();
            opts.save?.();
            return;
        }
        if (isCmd && e.key === "Enter") {
            e.preventDefault();
            opts.commit();
            return;
        }
    };
}

/** Convenience for tests or external integrations. */
export function isInlineEditingActive(): boolean {
    return globalStore.get(inlineEditingActiveAtom);
}

/**
 * Pure helper for Ctrl/Cmd + drag multi-block selection: given the anchor line the drag started
 * on and the [start..end] of the block currently under the pointer, return the contiguous
 * selection range [min, max]. Named so the (trivial) min/max merge has a tested contract and
 * the drag handler stays declarative.
 */
export function expandBlockSelection(
    anchorLine: number,
    crossedStart: number,
    crossedEnd: number
): { startLine: number; endLine: number } {
    return { startLine: Math.min(anchorLine, crossedStart), endLine: Math.max(anchorLine, crossedEnd) };
}

/**
 * Insert EXACTLY ONE blank row before/after the anchor block range, without any bracket
 * blank. Used by the block-edge insert buttons / Enter split to give the user an immediate
 * single-row editing target ("click → preview gains one line"). The eventual commit replaces
 * this row with the user's draft via commitPlaceholderBlock, which re-adds separator blanks
 * only as needed — so a single click nets exactly one new block, never stray blank rows.
 */
export function spliceBlankRow(
    lines: string[],
    startLine: number,
    endLine: number,
    mode: "before" | "after"
): string[] {
    const startIdx = Math.max(0, Math.min(startLine - 1, lines.length));
    const endIdx = Math.max(0, Math.min(endLine - 1, lines.length));
    const next = lines.slice();
    next.splice(mode === "before" ? startIdx : endIdx + 1, 0, "");
    return next;
}

/**
 * Finalize a placeholder-row edit: replace the pre-inserted blank row ([startLine..endLine])
 * with the user's draft, then guarantee the new block is separated from whatever surrounds it
 * by single blank lines — adding a blank on a side that lost its separator (the pre-insert
 * consumed it) and never duplicating one that still exists. Repeated inserts therefore
 * accumulate exactly one block each, with no stray blank runs.
 */
export function commitPlaceholderBlock(
    fullText: string,
    startLine: number,
    endLine: number,
    draftText: string
): string {
    const lines = fullText.split(/\r\n|\n/);
    const safeStart = Math.max(1, Math.min(Math.trunc(startLine), lines.length || 1));
    const safeEnd = Math.max(safeStart, Math.min(Math.trunc(endLine), lines.length));
    const draftLines = draftText.split(/\r\n|\n/);
    const out = [...lines.slice(0, safeStart - 1), ...draftLines, ...lines.slice(safeEnd)];
    let firstIdx = safeStart - 1; // first draft row's index in `out`
    let lastIdx = firstIdx + draftLines.length - 1; // …and its LAST row (multi-line drafts)
    // Front separator: draft starts with content directly under content → the blank that used
    // to separate them was consumed by the pre-insert, put one back.
    if (draftLines.length > 0 && out[firstIdx] !== "" && firstIdx > 0 && out[firstIdx - 1] !== "") {
        out.splice(firstIdx, 0, "");
        firstIdx++;
        lastIdx++;
    }
    // Rear separator: the draft's last row is content directly above content → add a blank.
    // Checked on the LAST draft row so multi-line drafts separate correctly past their body.
    if (draftLines.length > 0 && out[lastIdx] !== "" && lastIdx + 1 < out.length && out[lastIdx + 1] !== "") {
        out.splice(lastIdx + 1, 0, "");
    }
    return out.join("\n");
}

/**
 * Pure helper for the block-edge "+" buttons on a LIST ITEM: derive the pre-filled marker
 * text of the new sibling row from the hovered item's own source line.
 *   - "after" → next number (N+1); "before" → same number (source renumbering normalizes).
 *   - Bullet items keep their bullet; a line without any marker yields "" (plain row).
 */
export function makeListItemInsertMarker(itemSourceLine: string, placement: "before" | "after"): string {
    const ordered = itemSourceLine.match(/^(\s*)(\d+)([.)])\s+/);
    if (ordered != null) {
        const base = parseInt(ordered[2], 10);
        const num = placement === "after" ? base + 1 : base;
        return `${ordered[1]}${num}${ordered[3]} `;
    }
    const bullet = itemSourceLine.match(/^(\s*)([-+*])\s+/);
    if (bullet != null) {
        return `${bullet![1]}${bullet![2]} `;
    }
    return "";
}

/**
 * Pure helper for Enter inside a LIST block's draft (single item or whole list): splits the
 * draft at the caret into the current line and a NEW list line, returning the new draft plus
 * the new caret offset.
 *
 * Rules (fixes the "extra duplicated 1." bug):
 *   - Caret at line start + ordered marker → insert an empty sibling line ABOVE (same number;
 *     source renumbering fixes the sequence on commit). Never concatenates prefix+content,
 *     so nothing is duplicated.
 *   - Otherwise → split: text after the caret moves to a new line whose marker number is
 *     CURRENT+1 (real increment — the old code copied the current number verbatim, which made
 *     rendered numbering disagree with source).
 *   - Current line has no list marker (continuation text) → bare newline, no prefix invented.
 */
export function splitListItemDraft(draft: string, pos: number): { text: string; newPos: number } {
    const lineStart = draft.lastIndexOf("\n", pos) + 1;
    const nextBreak = draft.indexOf("\n", pos);
    const lineEnd = nextBreak === -1 ? draft.length : nextBreak;
    const line = draft.slice(lineStart, lineEnd);

    const ordered = line.match(/^(\s*)(\d+)([.)])\s+/);
    const bullet = ordered == null ? line.match(/^(\s*)([-+*])\s+/) : null;
    if (ordered == null && bullet == null) {
        // Continuation line without a marker: plain newline, cursor right after it.
        return { text: `${draft.slice(0, pos)}\n${draft.slice(pos)}`, newPos: pos + 1 };
    }

    const prefix = ordered ? `${ordered[1]}${ordered[2]}${ordered[3]} ` : `${bullet![1]}${bullet![2]} `;
    const incrementedPrefix = ordered ? `${ordered[1]}${parseInt(ordered[2], 10) + 1}${ordered[3]} ` : prefix;

    if (pos === lineStart) {
        // Line start: new empty sibling ABOVE, current line untouched (no content copy).
        return {
            text: `${draft.slice(0, lineStart)}${prefix}\n${draft.slice(lineStart)}`,
            newPos: lineStart + prefix.length,
        };
    }
    // Mid/end of line: tail becomes the next item with an incremented marker.
    return {
        text: `${draft.slice(0, pos)}\n${incrementedPrefix}${draft.slice(pos)}`,
        newPos: pos + 1 + incrementedPrefix.length,
    };
}

/**
 * Pure helper for "Enter at caret splits the block": keeps the BEFORE part in the anchor
 * block's source range and inserts the AFTER part as a new block right below it. Returns the
 * new full text plus the 1-based source line of the new block's CONTENT row (the second of
 * the two inserted lines — spliceInsertBlock brackets with a separator blank first) so the
 * follow-up editor focuses the row the user actually types into.
 *
 * Edge cases match the buttons:
 *  - caret at very end (after === "") → insert a blank row BELOW (cursor row = endLine + 2)
 *  - caret at very start (before === "") → insert a blank row ABOVE (cursor row = startLine)
 */
export function splitBlockAtCaretText(
    fullText: string,
    startLine: number,
    endLine: number,
    draftText: string,
    caretPos: number
): { text: string; newLine: number } {
    const before = draftText.slice(0, caretPos);
    const after = draftText.slice(caretPos);
    const lines = fullText.split(/\r\n|\n/);

    if (before === "") {
        // Caret at line start: the split row goes ABOVE, the current row keeps the
        // user's draft content. Write the draft into the block first, then insert a
        // single blank row above — the follow-up editor treats it as a placeholder
        // row, see commitPlaceholderBlock.
        const withDraft = replaceSourceRange(fullText, startLine, endLine, draftText);
        const midLines = withDraft.split(/\r\n|\n/);
        const newFull = spliceBlankRow(midLines, startLine, startLine, "before").join("\n");
        return { text: newFull, newLine: startLine };
    }
    if (after === "") {
        // Caret at line end: commit the typed draft into the block first, then hang
        // a blank row below for the follow-up placeholder editor. (Without the
        // replaceSourceRange call, the draft is silently discarded — the block keeps
        // its original text and the user sees their input vanish after pressing Enter.)
        const withDraft = replaceSourceRange(fullText, startLine, endLine, draftText);
        const midLines = withDraft.split(/\r\n|\n/);
        const draftEnd = startLine + draftText.split(/\r\n|\n/).length - 1;
        const newFull = spliceBlankRow(midLines, draftEnd, draftEnd, "after").join("\n");
        return { text: newFull, newLine: draftEnd + 1 };
    }
    const afterBeforeCommit = replaceSourceRange(fullText, startLine, endLine, before);
    const midLines = afterBeforeCommit.split(/\r\n|\n/);
    const beforeEnd = startLine + before.split(/\r\n|\n/).length - 1;
    const newFull = spliceInsertBlock(midLines, startLine, beforeEnd, "after", after.split(/\r\n|\n/)).join("\n");
    return { text: newFull, newLine: beforeEnd + 2 };
}

/**
 * Placeholder text for the inline-edit textarea (方案 03 §2). English-only per project
 * rule; keyed on the SESSION's block kind. Rendered natively by the textarea (shows only
 * while the draft is empty).
 */
export function placeholderForBlockKind(kind: InlineEditBlockKind | null | undefined): string {
    switch (kind) {
        case "p":
        case "blank":
            return "Type '/' for commands";
        case "list":
            return "List item";
        case "h":
            return "Heading";
        case "quote":
            return "Quote";
        case "code":
            return "Code";
        default:
            return "";
    }
}
