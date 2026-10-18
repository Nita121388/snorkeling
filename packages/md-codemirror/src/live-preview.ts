// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Live Preview 装饰层（MVP）。
 *
 * 原则：
 * 1. **装饰永远派生自 CodeMirror 文档 + 语法树**，不能从 DOM 反向推断 Markdown；
 * 2. **不复制事实源**：隐藏语法标记、渲染 widget 只影响视图；doc 始终是完整 Markdown；
 * 3. **未知语法保持 source 可见**：本层只处理声明过的节点，其他一律原样显示；
 * 4. 装饰更新的成本 = 每轮被 `docChanged` 触发的语法树重算，**不碰 DOM 重建循环**。
 *
 * MVP 覆盖（PRD R2）：
 * - 标题：隐藏 `# `；
 * - 强调/粗体/删除线/行内 code：隐藏标记符，内容加 class 供消费方上样式；
 * - 列表 & task：隐藏 list marker，checkbox 替换为可点击 widget；
 * - 引用：隐藏 `> `；
 * - 普通链接：隐藏 `[` / `](…)` / `)`，label 可编辑并加链接样式；
 * - wiki link（`[[目标|别名]]`）：隐藏 `[[` / `|` / `]]`，label/目标主体可编辑；
 * - 脚注引用（`[^1]`）：隐藏 `[^` 与 `]`，编号主体可编辑并加脚注样式；
 * - 图片：整体替换为安全 image widget（加载失败显示占位并保留 source 可编辑路径）。
 *
 * 未覆盖（保持 source 可见）：表格、代码块、callout、嵌入、复杂块 —— 进入后续阶段。
 */

import {
    Decoration,
    EditorView,
    WidgetType,
    ViewPlugin,
    type DecorationSet,
} from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";

import type { MarkdownEditorHost } from "./types";

/** 普通链接与脚注引用的识别（`[链接](url)` / `[^1]`）。 */
const FOOTNOTE_REF_RE = /^\[\^\w+$/; // lezer 把 `[^1]` 解析成无 URL 的 Link；用开头字形识别
/** wiki link：`[[目标]]` / `[[目标|别名]]`，跳过 Obsidian embed `![[…]]`。 */
const WIKI_LINK_RE = /\[\[([^\[\]\n|]+?)(?:\|([^\[\]\n]*))?\]\]/g;

// ── 隐藏占位 widget（全局单例：所有「隐藏语法标记」共用）──────────────────────
/** replace decoration 不可省略 widget；空 widget = 视觉消失占位零宽。 */
class HiddenWidget extends WidgetType {
    eq(): boolean {
        return true;
    }
    toDOM(): HTMLElement {
        return document.createElement("span");
    }
    ignoreEvent(): boolean {
        return true;
    }
}
const HIDDEN = new HiddenWidget();

function hide(from: number, to: number): Decoration {
    return Decoration.replace({ widget: HIDDEN });
}

// ── 可点击 checkbox widget ────────────────────────────────────────────────
class CheckboxWidget extends WidgetType {
    constructor(
        private readonly checked: boolean,
        private readonly from: number,
        private readonly view: EditorView
    ) {
        super();
    }
    override eq(other: CheckboxWidget): boolean {
        return other.checked === this.checked && other.from === this.from;
    }
    override toDOM(): HTMLElement {
        const box = document.createElement("span");
        box.className = "cm-md-checkbox";
        box.setAttribute("role", "checkbox");
        box.setAttribute("aria-checked", String(this.checked));
        box.textContent = this.checked ? "☑" : "☐";
        box.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const { state } = this.view;
            const line = state.doc.lineAt(Math.min(this.from, state.doc.length));
            // 行内找到 `[x]`/`[ ]` 并翻转
            const re = /\[( |x|X)\]/;
            const m = re.exec(line.text);
            if (!m) return;
            const start = line.from + m.index;
            const checked = /^\[x\]$/i.test(m[0]);
            this.view.dispatch({
                changes: { from: start, to: start + 3, insert: checked ? "[ ]" : "[x]" },
                userEvent: "input",
            });
        });
        return box;
    }
    override ignoreEvent(): boolean {
        return false;
    }
}

// ── 图片 widget（安全渲染：加载失败 → 占位文案，点击发 image-action 事件）───
class ImageWidget extends WidgetType {
    constructor(
        private readonly src: string,
        private readonly alt: string,
        private readonly from: number,
        private readonly to: number,
        private readonly host: MarkdownEditorHost
    ) {
        super();
    }
    override eq(other: ImageWidget): boolean {
        return other.src === this.src && other.alt === this.alt && other.from === this.from;
    }
    override toDOM(): HTMLElement {
        const wrap = document.createElement("span");
        wrap.className = "cm-md-image";
        const resolved = this.host.resolveImageSrc ? this.host.resolveImageSrc(this.src, { from: this.from, to: this.to }) : this.src;
        const img = document.createElement("img");
        img.alt = this.alt || "";
        img.className = "cm-md-image-img";
        const failText = document.createElement("span");
        failText.className = "cm-md-image-fallback";
        // 原始源码保持可编辑路径：点击打开宿主动作（如切到 source）。
        wrap.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (this.host.onEvent) {
                this.host.onEvent({
                    type: "image-action",
                    src: this.src,
                    alt: this.alt || undefined,
                    from: this.from,
                    to: this.to,
                });
            }
        });
        if (resolved != null) {
            img.src = resolved;
            img.addEventListener("error", () => {
                failText.textContent = this.alt ? `![${this.alt}](${this.src})` : `![](${this.src})`;
                wrap.replaceChildren(failText);
            });
            wrap.appendChild(img);
        } else {
            failText.textContent = this.alt ? `![${this.alt}](${this.src})` : `![](${this.src})`;
            wrap.replaceChildren(failText);
        }
        return wrap;
    }
    override ignoreEvent(): boolean {
        return false;
    }
}

// ── 装饰构建 ────────────────────────────────────────────────────────────────
type WikiSpan = {
    from: number;
    to: number;
    /** 主体（label 或 target）可编辑区间。 */
    labelFrom: number;
    labelTo: number;
};

/** 全 doc 扫描 wiki link（消费方各项引用的 host 语法与 md-core 一致）。 */
function scanWikiLinks(state: import("@codemirror/state").EditorState): WikiSpan[] {
    const spans: WikiSpan[] = [];
    const text = state.doc.toString();
    WIKI_LINK_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = WIKI_LINK_RE.exec(text)) != null) {
        // 跳过 Obsidian embed：`![[…]]` 不是导航链接（与 md-core 一致）
        if (m.index > 0 && text[m.index - 1] === "!") {
            continue;
        }
        const full = m[0];
        const from = m.index;
        const to = from + full.length;
        const label = m[2] ?? m[1];
        const pipeIndex = full.indexOf("|");
        // label 起始：`[[` (2) 之后；若有 `|` 从 `|`+1 开始
        const labelFrom = from + 2 + (pipeIndex >= 0 ? pipeIndex + 1 - 2 : 0);
        spans.push({ from, to, labelFrom, labelTo: from + full.length - 2 });
    }
    return spans;
}

/** 构建当前 view 的装饰集。返回 null 表示「无装饰」（保持 source 可见）。 */
export function buildDecorations(view: EditorView, host: MarkdownEditorHost): DecorationSet {
    const range: ReturnType<Decoration["range"]>[] = [];
    const add = (from: number, to: number, deco: Decoration): void => {
        range.push(deco.range(from, to));
    };
    const tree = syntaxTree(view.state);
    const doc = view.state.doc;
    const wikiSpans = scanWikiLinks(view.state);

    const insideWiki = (from: number, to: number): boolean =>
        wikiSpans.some((w) => w.from <= from && to <= w.to);

    const walk = (node: SyntaxNode): void => {
        if (node == null) return;
        const name = node.type.name;
        const from = node.from;
        const to = node.to;

        // 被 wiki 段覆盖的节点：wiki 装饰独立处理，跳过（避免与 Link 分支重复/冲突）
        if (insideWiki(from, to)) {
            return;
        }

        switch (true) {
            case name.startsWith("ATXHeading") || name.startsWith("SetextHeading"): {
                for (let c = node.firstChild; c; c = c.nextSibling) {
                    if (c.type.name === "HeaderMark") {
                        add(c.from, c.to, hide(c.from, c.to));
                    }
                }
                return;
            }
            case name === "StrongEmphasis" || name === "Emphasis" || name === "Strikethrough": {
                const cls = name === "StrongEmphasis" ? "cm-md-strong" : name === "Emphasis" ? "cm-md-em" : "cm-md-strike";
                let first = -1;
                let last = -1;
                for (let c = node.firstChild; c; c = c.nextSibling) {
                    const cname = c.type.name;
                    if (cname === "EmphasisMark" || cname === "StrikethroughMark") {
                        add(c.from, c.to, hide(c.from, c.to));
                        if (first < 0) first = c.from;
                        last = c.to;
                    }
                }
                // 中间内容加样式 class（若还有内容）
                if (first >= 0 && last > first) {
                    add(first, last, Decoration.mark({ class: cls }));
                }
                return;
            }
            case name === "InlineCode": {
                for (let c = node.firstChild; c; c = c.nextSibling) {
                    if (c.type.name === "CodeMark") {
                        add(c.from, c.to, hide(c.from, c.to));
                    }
                }
                // 代码内容加样式
                const first = node.firstChild;
                const last = node.lastChild;
                if (first && last && first.from < last.to) {
                    add(first.from, last.to, Decoration.mark({ class: "cm-md-inline-code" }));
                }
                return;
            }
            case name === "BulletList" || name === "OrderedList": {
                // 列表整体保持结构；仅隐藏各 ListItem 的 ListMark
                for (let c = node.firstChild; c; c = c.nextSibling) {
                    walk(c);
                }
                return;
            }
            case name === "ListItem": {
                for (let c = node.firstChild; c; c = c.nextSibling) {
                    if (c.type.name === "ListMark") {
                        add(c.from, c.to, hide(c.from, c.to));
                    } else {
                        walk(c);
                    }
                }
                return;
            }
            case name === "Task": {
                for (let c = node.firstChild; c; c = c.nextSibling) {
                    if (c.type.name === "TaskMarker") {
                        const checked = /\[x\]/i.test(doc.sliceString(c.from, c.to));
                        add(c.from, c.to, Decoration.replace({ widget: new CheckboxWidget(checked, c.from, view) }));
                    }
                }
                return; // 任务内容文本原样显示
            }
            case name === "Blockquote": {
                for (let c = node.firstChild; c; c = c.nextSibling) {
                    if (c.type.name === "QuoteMark") {
                        add(c.from, c.to, hide(c.from, c.to));
                    } else if (c.type.name === "Paragraph" || c.type.name.startsWith("ATXHeading")) {
                        walk(c);
                    }
                }
                return;
            }
            case name === "Image": {
                // 图片整体替换为 widget；内部 LinkMark/URL 不单独装饰
                const srcNode = node.getChild("URL");
                const src = srcNode ? doc.sliceString(srcNode.from, srcNode.to) : "";
                // alt 是 `![` 之后、`]` 之前的原文文本（lezer 不建独立节点）
                const marks = node.getChildren("LinkMark");
                const altClose = marks.find((m) => m.from > node.from + 2 && doc.sliceString(m.from, m.to) === "]");
                const alt = altClose ? doc.sliceString(node.from + 2, altClose.from).trim() : "";
                add(from, to, Decoration.replace({ widget: new ImageWidget(src, alt, from, to, host) }));
                return;
            }
            case name === "Link": {
                const text = doc.sliceString(node.from, node.to);
                if (FOOTNOTE_REF_RE.test(text)) {
                    // 脚注引用：隐藏 `[^` 与 `]`，编号主体可编辑 + 样式
                    add(node.from, node.from + 2, hide(node.from, node.from + 2));
                    add(node.to - 1, node.to, hide(node.to - 1, node.to));
                    add(node.from + 2, node.to - 1, Decoration.mark({ class: "cm-md-footnote-ref" }));
                    return;
                }
                // 普通链接：隐藏 `[`、`](`、URL、`)`；label 保留可编辑 + 链接样式
                const marks = node.getChildren("LinkMark");
                const url = node.getChild("URL");
                // `[`（首个 LinkMark）
                const open = marks[0];
                if (open) {
                    add(open.from, open.to, hide(open.from, open.to));
                }
                // label = open 之后到 `](` 之前
                const labelStart = open ? open.to : node.from;
                let labelEnd = url ? url.from - 2 : node.to - 1; // 减去 `]` ~ `]`/`(`?
                if (url) {
                    // `](` 恰在 URL 前：hide [labelEnd, url.from) 中的 `](`，再 hide URL + `)`
                    const closeOpen = Math.max(labelEnd, node.from);
                    add(closeOpen, url.from, hide(closeOpen, url.from));
                    add(url.from, url.to, hide(url.from, url.to));
                    add(url.to, node.to, hide(url.to, node.to));
                }
                if (labelEnd > labelStart) {
                    add(labelStart, labelEnd, Decoration.mark({ class: "cm-md-link-label" }));
                }
                return;
            }
            default: {
                // 所有叶子/未知节点默认不装饰（保持 source 可见）；继续深入
                for (let c = node.firstChild; c; c = c.nextSibling) {
                    walk(c);
                }
            }
        }
    };

    // wiki link 装饰（独立于语法树）
    for (const w of wikiSpans) {
        // `[[` (2 字符) 与 `]]` (2 字符) 隐藏，主体可编辑 + wiki 样式
        add(w.from, w.from + 2, hide(w.from, w.from + 2));
        add(w.to - 2, w.to, hide(w.to - 2, w.to));
        if (w.labelTo > w.labelFrom) {
            add(w.labelFrom, w.labelTo, Decoration.mark({ class: "cm-md-wiki-link" }));
        }
    }

    walk(tree.topNode);
    return Decoration.set(range, true);
}

/** ViewPlugin：把装饰附加到 editor。mode 切换由 Compartment 控制。 */
export function livePreviewExtension(host: MarkdownEditorHost): ReturnType<typeof ViewPlugin.fromClass> {
    return ViewPlugin.fromClass(
        class {
            decorations: DecorationSet;
            constructor(view: EditorView) {
                this.decorations = buildDecorations(view, host);
            }
            update(update: { docChanged: boolean; view: EditorView }): void {
                if (update.docChanged) {
                    this.decorations = buildDecorations(update.view, host);
                }
            }
        },
        { decorations: (v) => v.decorations }
    );
}

/** 包内基础样式：消费方零配置也能看到合理效果；随需求可覆盖。 */
export function livePreviewBaseTheme(): ReturnType<typeof EditorView.theme> {
    return EditorView.theme({
        ".cm-md-strong": { fontWeight: "bold" },
        ".cm-md-em": { fontStyle: "italic" },
        ".cm-md-strike": { textDecoration: "line-through" },
        ".cm-md-inline-code": {
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            background: "rgba(127, 127, 127, 0.14)",
            borderRadius: "3px",
            padding: "0 2px",
        },
        ".cm-md-link-label": {
            color: "var(--link-color, #3b82f6)",
            textDecoration: "underline",
        },
        ".cm-md-wiki-link": {
            color: "var(--wiki-link-color, #7c3aed)",
        },
        ".cm-md-footnote-ref": {
            verticalAlign: "super",
            fontSize: "0.75em",
            color: "var(--footnote-color, #64748b)",
        },
        ".cm-md-checkbox": {
            cursor: "pointer",
            userSelect: "none",
            marginRight: "0.25em",
        },
        ".cm-md-image": { display: "inline-block", cursor: "pointer" },
        ".cm-md-image-img": {
            maxWidth: "min(480px, 100%)",
            verticalAlign: "middle",
            borderRadius: "4px",
        },
        ".cm-md-image-fallback": {
            color: "#b91c1c",
            border: "1px dashed #fca5a5",
            borderRadius: "4px",
            padding: "2px 6px",
            fontFamily: "ui-monospace, Menlo, monospace",
            fontSize: "0.9em",
        },
    });
}