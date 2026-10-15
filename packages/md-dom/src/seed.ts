// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * 种子采集层：从**渲染好的块 DOM**里取出「编辑器应该看到的初始内容」。
 *
 * 这层是编辑引擎的入口。它要做三件事，每件都有过事故记录：
 *
 *   1. **只取正文，不取 chrome** —— emoji 按钮、折叠按钮、标题容器这类渲染器装饰
 *      必须剔除或降级，否则它们会漏进正文（`button` 走序列化的 unwrap 分支 → 里面的
 *      emoji 被当成标题文本，提交后与回写的前缀叠加、emoji 重复）。
 *   2. **把 `pre-wrap` 下会显形的空白去掉** —— 渲染态 `white-space: normal` 会折叠掉
 *      元素间空白，编辑器却继承 `pre-wrap`，于是那些 `\n` 突然占一整行（松散列表点进去
 *      变成双倍行距、块高翻倍）。必须在**字符串层**去掉：DOM 层已经来不及，因为
 *      `innerHTML` 重新解析时相邻文本节点会被合并，那个 `\n` 已并进 `"\nb"` 里。
 *   3. **空壳防线** —— 种子为空但源码并非空壳时，说明拿到的元素不是这个块的内容载体
 *      （引用块内的占位段、已被清空的元素）。此时**必须拒绝**（返回 null，调用方回落
 *      textarea），否则会以「合法空壳」覆盖掉本来有内容的块，且不可恢复。
 *
 * 本层**零 React、零宿主依赖**。唯一的宿主关注点（"WYSIWYG 这个 feature 开着吗"）
 * 通过 `isWysiwygEnabled` 注入 —— 包不该去猜宿主的开关存在哪里。
 */

import { isEmptyBlockShellDraft, type InlineEditBlockKind } from "./block-syntax";
import { canEditInPlaceLosslessly } from "./lossy";

/** 能用 **通用** WYSIWYG 编辑器（非专用编辑器）编辑的散文类块。 */
export type WysiwygEligibleKind = "p" | "h" | "list" | "quote" | "blank";

/** 通用 WYSIWYG 编辑器覆盖的 kind 集合（table / code 有各自的专用编辑器）。 */
export const WYSIWYG_KINDS: ReadonlySet<InlineEditBlockKind> = new Set<InlineEditBlockKind>([
    "p",
    "h",
    "list",
    "quote",
    "blank",
]);

/** 会被当作「块级」的标签：它们的存在意味着同级空白节点不是正文。 */
export const SEED_BLOCK_TAGS = new Set([
    "ADDRESS",
    "ARTICLE",
    "ASIDE",
    "BLOCKQUOTE",
    "DETAILS",
    "DIV",
    "DL",
    "FIELDSET",
    "FIGCAPTION",
    "FIGURE",
    "FOOTER",
    "FORM",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "HEADER",
    "HR",
    "LI",
    "MAIN",
    "NAV",
    "OL",
    "P",
    "PRE",
    "SECTION",
    "TABLE",
    "UL",
]);

/**
 * 去掉紧贴 `<br>` 的那一个换行。
 *
 * 渲染器在软换行前后会插 `\n`（`<p>a<br>\nb</p>`）。渲染态 `normal` 下它紧跟 `<br>`、
 * 不可见；编辑器却是 `pre-wrap`，于是它成了**第二个真实换行** —— 引用块提交后凭空多出
 * 一条裸 `>` 空行，把一行软换行内容拆成两个段落（实测于普通引用与无标题 callout）。
 *
 * 只动紧贴 `<br>` 的那一个换行；用户正文里的换行（不贴 `<br>`）一律不动。
 */
export function normalizeBreaksAroundNewlines(html: string): string {
    return html.replace(/(<br\s*\/?>)[ \t]*\r?\n/g, "$1").replace(/\r?\n[ \t]*(<br\s*\/?>)/g, "$1");
}

/**
 * 去掉「元素之间」的纯空白文本节点。
 *
 * F4 教训：早期版本额外要求空白必须夹在两个标签之间（`/>\s+</`），但单段引用的种子恰好是
 * `"\n<p>a</p>\n"` —— 头尾那个 `\n` 永远匹配不到，归一化后的编辑器于是多出一个空行
 * （提交时写出一条多余的裸 `>`）。现在任何非空种子都走一遍遍历；一次 template 解析可忽略，
 * 而没有块级兄弟时遍历本身是 no-op。
 */
export function stripInsignificantWhitespace(html: string): string {
    if (html === "") {
        return html;
    }
    const template = document.createElement("template");
    template.innerHTML = normalizeBreaksAroundNewlines(html);
    const walk = (parent: Node) => {
        const kids = Array.from(parent.childNodes);
        for (const child of kids) {
            if (child.nodeType === 1) {
                walk(child);
            }
        }
        if (!kids.some((n) => n.nodeType === 1 && SEED_BLOCK_TAGS.has((n as Element).tagName))) {
            return; // no block sibling → whitespace here is real inline content
        }
        for (const node of kids) {
            if (node.nodeType === 3 && (node.textContent ?? "").trim() === "") {
                node.remove();
            }
        }
    };
    walk(template.content);
    return template.innerHTML;
}

/**
 * **overlay 路径**的干净种子：callout 的编辑种子必须与「用户看到的正文」对齐，
 * 而不是渲染 DOM 原样。
 *
 * 两处差异：
 *   1) emoji `<button>` 必须移除。序列化器对未知/`button` 走 default 分支 unwrap 成文本 ——
 *      若留在种子里，按钮内的 emoji 会被当成标题文本泄漏进正文，提交后与回写的前缀叠加，
 *      emoji 重复。emoji 由调用方从源码首行回写。
 *   2) 标题段 `p.markdown-alert-title` 必须降为普通 `<p>`（只取 `.markdown-alert-title-text`
 *      的内容）。否则 `> [!NOTE] 标题` 的种子会变成 `> <p class="markdown-alert-title">…`，
 *      序列化后 class 被 unwrap（内容保留），但空标题会留下装饰性空段。降为 `<p>` 后：
 *      空标题 → `<p></p>` → 序列化成裸 `>`（首行位置语义不变）。
 */
export function calloutSeedHtml(el: HTMLElement): string {
    const clone = el.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("button.markdown-alert-emoji-btn").forEach((b) => b.remove());
    // NOTE: match by class only, not `p.…`. In the real app the title mdast `p` runs through
    // the registry `p` renderer, which emits `<div class="markdown-alert-title">` (className
    // overrides the default `paragraph`), so a tag-qualified `p.` selector misses it entirely.
    const title = clone.querySelector(".markdown-alert-title");
    if (title != null) {
        const textEl = title.querySelector(".markdown-alert-title-text");
        const p = document.createElement("p");
        p.innerHTML = textEl != null ? textEl.innerHTML : "";
        title.replaceWith(p);
    }
    return clone.innerHTML;
}

/**
 * **在位（A3）路径**的种子采集：**保留渲染器产出的全部结构**，只剔除供能性控件。
 *
 * 与 `calloutSeedHtml` 的关键区别（两者故意不同，**不要合并**）：
 * - overlay 路径：编辑面是另一个盒子（`.wysiwyg-editor.wysiwyg-quote`），自带边框/边距，
 *   所以必须把 callout 的 `.markdown-alert-title` 容器**拆成裸 `<p>`**，否则样式叠加两次。
 * - 在位路径：编辑面**就是渲染面本身**。任何「为了对齐而简化结构」的操作都会直接造成
 *   样式差异 —— 实测正是如此：种子拆掉 `.markdown-alert-title` 后，编辑态的文本元素退化成
 *   `p`（fontWeight 500 / lineHeight 22.4px），而预览是
 *   `span.markdown-alert-title-text`（650 / 20.3px）→ 两项未豁免差异。
 *
 * 所以这里只做一件事：删掉 **button 类的供能性控件**（emoji 按钮 / 折叠按钮）。
 * 它们是「编辑期不该有的交互」，但它们的**容器**是渲染器产出的结构，必须原样保留。
 */
export function captureInplaceSeedHtml(targetEl: HTMLElement): string {
    const clone = targetEl.cloneNode(true) as HTMLElement;
    clone
        .querySelectorAll(
            "button.markdown-alert-emoji-btn, button.heading-collapse-button, button.markdown-alert-toggle"
        )
        .forEach((b) => b.remove());
    return clone.innerHTML;
}

export type WysiwygSeedInfo = {
    html: string;
    headingLevel?: number;
    listMarker?: string;
    listIndent?: string;
};

/**
 * overlay 路径的种子采集：渲染 DOM → 干净种子 + 提交时需要的形态信息。
 *
 * 返回 `null` 表示**这个块不适合用 WYSIWYG 编辑**，调用方必须回落 textarea。
 * 三种拒绝理由都在下面逐条写明 —— 它们都是「宁可让用户看到原始标记，也不能丢内容」。
 *
 * `isWysiwygEnabled` 由宿主注入（默认放行）：本包不该知道宿主的 feature flag 存在哪里。
 */
export function captureWysiwygInfo(
    blockKind: InlineEditBlockKind,
    targetEl: HTMLElement,
    sourceText: string,
    opts?: { isWysiwygEnabled?: () => boolean }
): WysiwygSeedInfo | null {
    if (opts?.isWysiwygEnabled?.() === false || !WYSIWYG_KINDS.has(blockKind)) {
        return null;
    }
    const isCallout = targetEl.matches("calloutalert, .markdown-alert");
    const html = isCallout
        ? calloutSeedHtml(targetEl)
        : blockKind === "h"
          ? (targetEl.querySelector(".heading-title")?.innerHTML ?? targetEl.innerHTML)
          : blockKind === "list"
            ? targetEl.outerHTML // <ul>/<ol> outerHTML preserves list structure for the serializer
            : blockKind === "blank"
              ? ""
              : targetEl.innerHTML;
    const strippedHtml = stripInsignificantWhitespace(html);
    // 空编辑器根防线（step1 数据事故的前置条件，也是 step1b 解挂的门槛）。
    //
    // 种子为空、但源码里这个块**并非空壳**时，说明 `targetEl` 不是这个块的内容载体。
    // beginEdit 的 `el` 与 `blockKind` **不保证同源**：调用方用
    // `blockKindFromElement(prevEl)` 得到 kind，却把同一个 el 交给 beginEdit 当种子 ——
    // 引用块内的空白占位段（`>` 空行渲染成 .blank-spacer）、已被清空的元素都会走到这里。
    //
    // 危害链条：`""` 仍能通过调用方的 `wysiwygHtml != null` 判断 → 编辑器以
    // initialHtml="" 挂载 → `root.innerHTML = ""` → 失焦提交时 DOM 序列化成裸 `>`
    // （quote 的合法空壳），覆盖掉原本有内容的引用块，且不可恢复。
    //
    // 回落 textarea：它的种子取源码 `initialContent`，永远与块内容一致；最坏情况只是
    // 把 `>` 之类的标记符号暴露出来，代价远低于丢内容。
    if (strippedHtml === "" && !isEmptyBlockShellDraft(blockKind, sourceText)) {
        return null;
    }
    // 同一条防线的另一个形状：**html 非空、但一个文本都没有**。
    // 典型：callout 标题全是装饰元素、零文本。这种种子同样给出「看起来空」的编辑器根，
    // 提交时一样序列化成空壳；只看 html 是否为空是拦不住的。
    // 判据：种子文本为空而源码并非空壳 → 拒绝。
    // （前面 `strippedHtml === ""` 的检查被此条覆盖，保留只为把意图写清楚。）
    const seedProbe = document.createElement("template");
    seedProbe.innerHTML = strippedHtml;
    const seedText = (seedProbe.content.textContent ?? "").trim();
    if (seedText === "" && !isEmptyBlockShellDraft(blockKind, sourceText)) {
        return null;
    }
    // **往返有损的结构必须拒绝**，否则提交会把用户的源码改写掉（实测过）。
    // 判据用 md-dom 的单一真源（lossy.ts），不再这里手写正则 ——
    // 旧正则只查 `<img|<a`，**漏了 `<sup>`（脚注引用）**。
    // 检查对象是**待序列化的种子**（而非渲染根）：渲染面上被剥掉的 chrome 不算，
    // 拿渲染根判会误拒，让用户白丢原位编辑。
    if (!canEditInPlaceLosslessly(seedProbe.content)) {
        return null; // 有损 → 回落 textarea，让用户看到原始标记（宁可难看，不能丢内容）
    }
    // Heading level from rendered class is-N.
    let headingLevel: number | undefined;
    if (blockKind === "h") {
        const m = targetEl.className.match(/\bis-(\d)\b/);
        if (m != null) headingLevel = parseInt(m[1], 10);
    }
    // List marker from original source (preserve author's choice of - / * / 1. etc).
    let listMarker: string | undefined;
    // F3: the source line's leading indentation. Clicking an INNER list item promotes the
    // target to that inner <ul>, whose source lines are indented (`  - b`). The DOM
    // serializer always starts at depth 0, so without re-applying the outer indent the
    // committed draft is promoted to top level. Captured here, re-applied on commit.
    let listIndent: string | undefined;
    if (blockKind === "list") {
        const lines = sourceText.split(/\r?\n/);
        const first = lines[0] ?? "";
        const markerMatch = first.match(/^\s*([-*+]|\d{1,9}[.)])/);
        if (markerMatch != null) {
            listMarker = markerMatch[1];
        }
        listIndent = first.match(/^([ \t]*)/)?.[1] ?? "";
    }
    return { html: strippedHtml, headingLevel, listMarker, listIndent };
}
