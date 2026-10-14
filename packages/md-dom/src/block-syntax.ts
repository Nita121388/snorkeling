// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * 块语法层（`md-dom` 的纯字符串层）：源码切片 ↔ 编辑器初始正文，以及提交前的形态守卫。
 *
 * 为什么这层要独立成包（而不是留在宿主）：它是**编辑引擎与框架解耦**的关键一环。
 * 这些函数此前住在 `frontend/app/element/markdown-inline-edit.tsx` —— 那个文件同时含
 * `InlineEditOverlay` / `WysiwygEditor` 等 React 组件，于是「编辑引擎」与 React 被绑死在一个
 * 文件里，非 React 消费方（journal：纯 ESM、零框架、无打包器）无法取用。
 *
 * 本文件**零 React、零 DOM、零宿主依赖**：只吃字符串、吐字符串。`host-free-editor-pipeline.test.ts`
 * 已实证整条编辑链路（源码切片 → 种子 → 就地编辑 → 序列化 → 重定位/陈旧检测 → 写盘）
 * 可以在不渲染任何 React 组件的情况下跑通。
 *
 * 防漂移要点：`initialContentFor` 是**单一归一化入口** —— 打开编辑算 `initialContent` 与
 * commit 的陈旧检测都必须调它。两边各写一份（哪怕逻辑相同）迟早漂移：改了 code 围栏或 list
 * marker 处理而忘了另一侧，陈旧检测会把所有合法提交判成「内容不符」，变成“怎么都存不进去”的
 * 数据事故（或反过来放过真正的陈旧块）。
 */

import type { Block } from "@md/core/transform/tree";

/** 内联编辑器认识的块类型。 */
export type InlineEditBlockKind = "p" | "h" | "list" | "quote" | "table" | "code" | "blank" | "hr";

function stripCodeFence(source: string): string {
    const lines = source.split(/\r?\n/);
    if (lines.length < 2 || !/^\s{0,3}(`{3,}|~{3,})/.test(lines[0] ?? "")) return source;
    const marker = (lines[0].match(/^\s{0,3}(`{3,}|~{3,})/) ?? [])[1];
    if (marker == null || !new RegExp(`^\\s{0,3}${marker[0]}{${marker.length},}\\s*$`).test(lines.at(-1) ?? ""))
        return source;
    return lines.slice(1, -1).join("\n");
}

function stripListMarker(source: string): string {
    return source.replace(/^(\s*)(?:\d{1,9}[.)]|[-+*])\s+/, "$1");
}

/**
 * 单一归一化入口：把「源码切片」变成「编辑器里的初始正文」。
 *
 * - code：去掉 ``` / ~~~ 围栏（编辑器里只出现代码本体）；
 * - list：去掉行首 marker 与缩进（编辑器里是“内容”，marker 由提交时回写）；
 * - 其余（p/h/quote/table/blank/hr）：原样。
 */
export function initialContentFor(kind: InlineEditBlockKind, sourceSlice: string): string {
    return kind === "code"
        ? stripCodeFence(sourceSlice)
        : kind === "list"
          ? stripListMarker(sourceSlice)
          : sourceSlice;
}

/**
 * Does this markdown amount to the EMPTY SHELL of a quote?
 *
 * The quote serializer turns an empty editor root into a bare ">" (and a multi-block empty root
 * into a run of them). Such a draft is never a user's intent — it means the editor DOM was empty —
 * so committing it must never overwrite a quote that had content. Exported for tests.
 */
export function isEmptyQuoteShellDraft(markdown: string): boolean {
    if (markdown.trim() === "") {
        return false; // "" is a legitimately cleared prose block, not a quote shell
    }
    return markdown.split("\n").every((line) => {
        const trimmed = line.trim();
        return trimmed === ">" || trimmed === "";
    });
}

/** A list line that carries only its marker (optionally a task checkbox) and no content. */
const EMPTY_LIST_SHELL_LINE_RE = /^(?:[-+*]|\d{1,9}[.)])(?:[ \t]+\[[ xX]\])?[ \t]*$/;

/**
 * Is this markdown the EMPTY SHELL of the given block kind?
 *
 * The WYSIWYG editor serializes its DOM root, and an EMPTY root yields a different
 * "shell" per kind: `""` for p/blank/code/table/hr, `"###"` for a heading, `">"`
 * lines for a quote, and `""`/bare markers for a list. `commit()` uses this to tell
 * "the user genuinely cleared the block" from "the editor root never carried content"
 * (DOM serialization collapsed) — the latter must never be written over an existing
 * block. Exported for tests.
 */
export function isEmptyBlockShellDraft(kind: InlineEditBlockKind, markdown: string): boolean {
    if (kind === "quote") {
        return isEmptyQuoteShellDraft(markdown);
    }
    if (kind === "h") {
        // Serializer emits a bare run of `#` for an empty heading root (see
        // serializeBlockDomToMarkdown's h branch); a real title is `### text`.
        return /^#{1,6}$/.test(markdown.trim());
    }
    if (kind === "list") {
        if (markdown.trim() === "") {
            return true; // empty <ul>/<ol> → ""
        }
        return markdown
            .split("\n")
            .every((line) => line.trim() === "" || EMPTY_LIST_SHELL_LINE_RE.test(line.trim()));
    }
    // p / blank / code / table / hr: an empty editor root serializes to "".
    return markdown.trim() === "";
}

/**
 * F3: re-apply the source list's leading indentation to every non-empty line of a
 * serialized list draft. `indent` is the source first line's `^([ \t]*)` ("" at top
 * level), so a top-level list is untouched. Nested lines already carry the serializer's
 * own per-level indent, which is preserved relative to the added prefix.
 */
export function indentListDraft(markdown: string, indent: string): string {
    if (indent === "") {
        return markdown;
    }
    return markdown
        .split("\n")
        .map((line) => (line.trim() === "" ? line : `${indent}${line}`))
        .join("\n");
}

// R4 标记语义（与宿主的 applyCalloutEmoji 同源，不要另起一套）。
const CALLOUT_MARKER_RE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i;
const CALLOUT_LEADING_EMOJI_RE = /^(\p{Extended_Pictographic}(?:️|⃣)?)\s*/u;

/**
 * R4 捕获：从 callout 的源码首行提取「`[!TYPE]` 标记 + emoji 的原文」，**保大小写**。
 *
 * 编辑种子把标记/emoji 都摘掉了 —— 标记不是用户的“正文”，emoji 由专门的按钮管。
 * 提交时用这里捕获的原文回写，所以 `[!Note]` 不会被规范化成 `[!NOTE]`，emoji 也不会
 * 因为按钮被移除而丢。无标记的普通引用返回 `""` —— 调用方据此不写任何标记（R4 硬要求）。
 */
export function captureCalloutPrefix(firstSourceLine: string): string {
    const content = (firstSourceLine ?? "").replace(/^\s*>\s?/, "");
    const m = content.match(CALLOUT_MARKER_RE);
    const after = m ? content.slice(m[0].length) : content;
    const e = after.match(CALLOUT_LEADING_EMOJI_RE);
    return `${m ? m[0] : ""}${e ? e[0] : ""}`;
}

/**
 * R4 回写：把 captureCalloutPrefix 捕获的前缀插回草稿首行。
 *
 * 首行形态总是 `> ...`（或裸 `>`）。prefix 为 `""`（普通引用）时原样返回 —— 这是
 * 「普通引用不得凭空新增 `[!quote]`」的实现点。非引用首行（理论上不会出现）也不动。
 * 空首行（用户把标题整段删掉）写成 `> [!NOTE]`，不残留尾空格。
 */
export function applyCalloutPrefix(markdown: string, prefix: string): string {
    if (prefix === "") return markdown;
    const lines = markdown.split("\n");
    if (lines.length === 0) return markdown;
    const m = lines[0].match(/^(\s*>\s?)/);
    if (m == null) return markdown; // 不是引用行 → 不动
    const rest = lines[0].slice(m[1].length);
    if (rest.trim() === "") {
        // 空标题 / 空首行：不要留下 `> [!NOTE] ` 的尾空格（会被写盘）。
        lines[0] = `${m[1].trimEnd()} ${prefix.replace(/[ \t]+$/, "")}`;
    } else {
        lines[0] = `${m[1]}${prefix}${rest}`;
    }
    return lines.join("\n");
}

const ListIndentStep = 2; // markdown 列表嵌套用 2 空格缩进（与 serializeListDomToMarkdown 一致)

/**
 * 对 [startLine..endLine]（1-based, inclusive）的列表行做 Tab/Shift+Tab 缩进（P3 F9/G9）。
 * 只处理列表项 marker 行（`- ` / `1. ` / `- [ ] `，允许已有缩进），其余行（列表内续行）
 * 保持不动——markdown 的缩进层级由 marker 行的行首缩进决定。
 *
 * - dir=1（Tab）：每个 marker 行行首加 ListIndentStep 空格 → 嵌套加深。
 * - dir=-1（Shift+Tab）：每个 marker 行去掉最多 ListIndentStep 个行首空格 → 嵌套变浅；
 *   已在 0 缩进（顶层项）时不变。
 * 返回新全文（行数不变，仅缩进变化）。
 */
export function indentListRange(text: string, startLine: number, endLine: number, dir: 1 | -1): string {
    const lines = text.split(/\r?\n/);
    const safeStart = Math.min(Math.max(1, Math.trunc(startLine)), lines.length || 1);
    const safeEnd = Math.max(safeStart, Math.min(Math.trunc(endLine), lines.length));
    const ListItemLineRe = /^(\s*)([-+*]|\d{1,9}[.)])([ \t]+\[[ xX]\])?[ \t]+/;
    const next = lines.map((line, i) => {
        const oneBased = i + 1;
        if (oneBased < safeStart || oneBased > safeEnd) {
            return line;
        }
        const m = line.match(ListItemLineRe);
        if (m == null) {
            return line; // 非列表项行：不动
        }
        const indent = m[1] ?? "";
        if (dir === 1) {
            return `${indent}${" ".repeat(ListIndentStep)}${line.slice(indent.length)}`;
        }
        // dir === -1：去掉最多 ListIndentStep 个行首空格
        const remove = Math.min(indent.length, ListIndentStep);
        return line.slice(remove);
    });
    return next.join("\n");
}

/**
 * `initialContentFor` 的逆操作（列表）：把行首 marker 重新包回草稿。
 *
 * 与 `stripListMarker` 是一对，必须一起维护：打开编辑时剥掉 marker，提交时按**原文的**
 * marker（可能是 `1.` / `-` / `*` / `+`，带缩进）包回来，否则列表会从有序变无序或丢缩进。
 */
export function wrapListMarker(source: string, original: string): string {
    const match = original.match(/^(\s*)(\d{1,9}[.)]|[-+*])(\s+)/);
    if (match == null) return source;
    return `${match[1]}${match[2]}${match[3]}${source}`;
}

/**
 * `initialContentFor` 的逆操作（代码块）：把围栏重新包回代码草稿。
 *
 * 只在**原代码块确实有合法围栏对**时才包：open 行必须是 `\`\`\`` / `~~~` 开头，close 行必须是
 * 纯围栏（可选尾空格）。不合法就原样返回 —— 宁可不包，不可凭空造一对围栏（那会改变块类型）。
 */
export function wrapCodeFence(source: string, original: string): string {
    const lines = original.split(/\r?\n/);
    const opener = lines[0] ?? "```";
    const closer = lines.at(-1) ?? "```";
    if (!/^\s{0,3}(`{3,}|~{3,})/.test(opener) || !/^\s{0,3}(`{3,}|~{3,})\s*$/.test(closer)) return source;
    return `${opener}\n${source}\n${closer}`;
}

/**
 * wysiwyg 的 InlineEditBlockKind → 块模型 TreeBlockKind 映射。
 *
 * wysiwyg 侧 "p"/"h"/"blank" 不是树模型的合法 kind（树模型用 "text"/"headingN"），
 * 且控制器 replace-content 仅依赖块坐标（startLine/endLine），kind 只作数据模型语义；
 * 此处从 committedDraft（完整块 markdown）的 `#` 前缀可靠推断 heading 级别，
 * quote 直接映射，blank/p 归并为 text（空块语义）。
 */
export function inlineKindToTreeKind(kind: InlineEditBlockKind, content: string): Block["kind"] {
    switch (kind) {
        case "h": {
            const m = content.match(/^ {0,3}(#{1,6})(?:[ \t]+|$)/);
            return m ? (`heading${m[1].length}` as Block["kind"]) : "text";
        }
        case "quote":
            return "quote";
        case "list": {
            // 不区分 bulleted/numbered/todo，从 committedDraft（DOM 序列化产物，首行即含 marker）
            // 首行可靠推断具体 kind。todo 判定锚定 marker 后的 `[ xX]`（与 block-type 的
            // ListItemLineRe 语义一致，避免 `- see [x] note` 这类正文含 checkbox 文本误判为任务项）。
            const first = content.split("\n", 1)[0] ?? "";
            if (/^(\s*)(?:[-+*]|\d{1,9}[.)])([ \t]+\[[ xX]\])/.test(first)) return "todo";
            if (/^\s*\d{1,9}[.)]/.test(first)) return "numbered";
            return "bulleted";
        }
        default:
            // "p" → "text"；"blank" → "text"（空块语义）；其余不会走到此处
            return "text";
    }
}