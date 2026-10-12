// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * 列表 DOM 结构工具（方案 10 step2：列表结构自持 + 规范化 + 光标锚定）。
 *
 * 背景：WYSIWYG 列表编辑此前依赖浏览器 `document.execCommand("indent")` / 原生 Enter，
 * 而浏览器的 `indent` 产出的是**非规范结构** —— 嵌套 `ul` 会直接挂在父 `ul` 下、不在任何
 * `li` 里（实测：`<ul><li>A</li><li>B</li><ul><li>C</li></ul></ul>`）。旧序列化器只认规范
 * 结构，于是整棵子树被静默丢弃（Tab 缩进后提交 → 源码少一项）。
 *
 * 处理分三层（对应 design F1/F2/F3/F4）：
 *   1. 序列化兜底（`dom-to-markdown.ts`）：非规范结构也必须输出 → 即使结构坏了也不丢内容；
 *   2. 结构规范化（本文件的 `normalizeListDom`）：把嵌套列表收敛到 `li` 之下；
 *   3. 结构操作自持（本文件的 `indentListItem` / `outdentListItem`）：Tab/Shift+Tab 显式搬
 *      移 `li`，不再让浏览器产出非规范结构；
 *   4. 光标锚定（本文件的 `plantCaretAnchor` / `focusByAnchor`）：结构变更前后用 `<wbr>`
 *      锚住光标位置。
 *
 * 本文件全部为纯 DOM 函数（不依赖 React），可在 jsdom 中直接单测。
 */

const LIST_TAGS = new Set(["UL", "OL"]);

function isListElement(el: Element | null | undefined): el is Element {
    return el != null && LIST_TAGS.has(el.tagName);
}

/** 列表里最后一个直接子 `li`（没有则 null）。 */
function lastLiOf(list: Element): HTMLElement | null {
    const lis = Array.from(list.children).filter((c) => c.tagName === "LI");
    const last = lis[lis.length - 1];
    return (last as HTMLElement | undefined) ?? null;
}

// ---------------------------------------------------------------------------
// F2 — 结构规范化
// ---------------------------------------------------------------------------

/**
 * 把非规范列表结构收敛为「嵌套列表只能挂在 `li` 之下」。返回是否发生了改动（幂等：
 * 第二次调用必定返回 false，DOM 结构也不再变化）。
 *
 * 算法（自底向上，保证内层先规范）：
 *   - 自底向上遍历所有 `ul`/`ol`；
 *   - 每个**直接**挂在列表下的 `ul`/`ol`（浏览器 `indent` 产物）都是非规范的：
 *     - 有紧邻的前一个 `li` → 并入它（追加为其子列表）；
 *     - 没有前一个 `li` 但列表里有 `li` → 并入最后一个 `li`（退化，但**内容绝不丢弃**）；
 *     - 列表里一个 `li` 都没有 → 把子列表整体提升到父级（按原顺序），并在提升后
 *       **删除已空的列表**（否则序列化器 `querySelector("ul, ol")` 会命中这个空列表，
 *       把刚提升的内容又丢掉）。
 *
 * 仅处理「明确非规范」的直接子列表；正常嵌套（在 `li` 内）不做任何搬运。
 */
export function normalizeListDom(root: ParentNode): boolean {
    let changed = false;
    // 自底向上：`querySelectorAll` 是文档序（外层在前），reverse 后内层先处理，
    // 搬移内层时不会让外层快照里的索引失效。
    const lists = Array.from(root.querySelectorAll("ul, ol")).reverse();
    for (const list of lists) {
        const orphans = Array.from(list.children).filter((c) => isListElement(c));
        if (orphans.length === 0) {
            continue;
        }
        let promoted = 0;
        // 退化提升时的插入锚点：始终插在「上一个提升项」之后，保持原有顺序。
        let insertionAnchor: ChildNode = list;
        for (const orphan of orphans) {
            const prev = orphan.previousElementSibling;
            const hostLi = prev != null && prev.tagName === "LI" ? (prev as HTMLElement) : lastLiOf(list);
            if (hostLi != null) {
                hostLi.appendChild(orphan);
                changed = true;
                continue;
            }
            const parent = list.parentElement;
            if (parent == null) {
                continue; // 列表本身就是 root：无处提升，保持原样（不谎报改动）
            }
            parent.insertBefore(orphan, insertionAnchor.nextSibling);
            insertionAnchor = orphan;
            promoted++;
            changed = true;
        }
        if (promoted > 0 && list.children.length === 0) {
            // 只删除「因提升而变空」的列表；本来就没有内容的空列表不属于本次搬运的产物。
            list.remove();
        }
    }
    return changed;
}

// ---------------------------------------------------------------------------
// F3 — 结构操作自持（Tab / Shift+Tab）
// ---------------------------------------------------------------------------

/** 选区所在的 `li`。无选区、选区不在 `root` 内或不在列表项内时返回 null。 */
export function liFromSelection(root: HTMLElement): HTMLLIElement | null {
    const sel = root.ownerDocument.defaultView?.getSelection() ?? null;
    if (sel == null || sel.rangeCount === 0) {
        return null;
    }
    const node = sel.anchorNode;
    if (node == null || !root.contains(node)) {
        return null;
    }
    const el = node.nodeType === 1 ? (node as Element) : node.parentElement;
    const li = el?.closest("li");
    if (li == null || !root.contains(li)) {
        return null;
    }
    return li as HTMLLIElement;
}

/** `li` 的直接父列表（`ul`/`ol`）；父级不是列表时返回 null。 */
function parentListOf(li: Element): Element | null {
    const parent = li.parentElement;
    return isListElement(parent) ? parent : null;
}

/**
 * Tab（缩进）：把 `li` 变成「紧邻前一个兄弟 `li`」的嵌套子列表项（自持结构操作，
 * 不再用 `document.execCommand("indent")` —— 后者会产出嵌套 ul 直接挂在 ul 下的非规范
 * 结构，导致序列化丢内容）。
 *
 * - 无父列表 / 无前一个兄弟 `li`（第一项）→ no-op；
 * - 前一个兄弟已有子列表 → 追加进它（不新建）；
 * - 否则新建与父列表同型的子列表挂在前一个兄弟下，保证缩进语义与序列化 2 空格/层一致。
 *
 * 返回是否发生改动。
 */
export function indentListItem(li: HTMLLIElement): boolean {
    const list = parentListOf(li);
    if (list == null) {
        return false;
    }
    const prev = li.previousElementSibling;
    if (prev == null || prev.tagName !== "LI") {
        return false; // 第一项：无处可缩进
    }
    let sub = Array.from(prev.children).find((c) => isListElement(c)) ?? null;
    if (sub == null) {
        sub = li.ownerDocument.createElement(list.tagName);
        prev.appendChild(sub);
    }
    sub.appendChild(li);
    return true;
}

/**
 * Shift+Tab（降级）：把 `li` 从父列表移出，插到「父 `li`」之后成为同级项。
 * 若 `li` 自己带子列表，子树随 `li` 一起移动。
 *
 * - 父级没有父 `li`（顶层项）→ no-op；
 * - 移出后父列表空了 → 删除该空列表（否则源码会多出一个空行 / 空 `ul`）。
 *
 * 返回是否发生改动。
 */
export function outdentListItem(li: HTMLLIElement): boolean {
    const list = parentListOf(li);
    if (list == null) {
        return false;
    }
    const parentLi = list.closest("li");
    if (parentLi == null) {
        return false; // 顶层项：无处可降级
    }
    const grandParent = parentLi.parentElement;
    if (grandParent == null) {
        return false;
    }
    grandParent.insertBefore(li, parentLi.nextSibling);
    if (list.children.length === 0) {
        list.remove();
    }
    return true;
}

// ---------------------------------------------------------------------------
// F4 — `<wbr>` 光标锚定（思源 focusByWbr 语义的最小实现）
// ---------------------------------------------------------------------------

function lastTextNodeIn(el: Element): Text | null {
    const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    let last: Text | null = null;
    while ((node = walker.nextNode()) != null) {
        last = node as Text;
    }
    return last;
}

function firstTextNodeIn(el: Element): Text | null {
    const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    return (walker.nextNode() as Text | null) ?? null;
}

/**
 * 在选区（折叠点）处插一个 `<wbr>` 作为锚点。结构变更（搬移 `li`、规范化）会把光标位置
 * 弄丢，先用 `<wbr>` 把位置钉在 DOM 里，变更后再用 `focusByAnchor` 解析回 Range。
 * 无选区 / 选区不在 `root` 内时返回 null。
 */
export function plantCaretAnchor(root: HTMLElement): Element | null {
    const sel = root.ownerDocument.defaultView?.getSelection() ?? null;
    if (sel == null || sel.rangeCount === 0) {
        return null;
    }
    const node = sel.anchorNode;
    if (node == null || !root.contains(node)) {
        return null;
    }
    const range = sel.getRangeAt(0).cloneRange();
    range.collapse(true);
    const wbr = root.ownerDocument.createElement("wbr");
    range.insertNode(wbr);
    return wbr;
}

/**
 * 找到 `root` 里第一个 `<wbr>`，按邻居节点重建一个折叠 Range、移除锚点并把选区/焦点放回去；
 * 返回是否找到了锚点。重解析规则（与思源 `selection.ts` focusByWbr 等价的最小实现）：
 *   1. 前一个兄弟是文本节点 → 光标在该文本末尾；
 *   2. 前一个兄弟是元素 → 取其最后一个文本后代的末尾；
 *   3. 没有可用的前一个兄弟 → 取后一个兄弟的第一个文本后代的头部；
 *   4. 都没有 → 回到 root 开头。
 * `<wbr>` 必须在解析后移除（不得残留在 DOM 里）。
 *
 * 注意：这里**不做** `root.normalize()`——`normalize` 会把相邻文本节点合并、使刚建的 Range
 * 的容器节点被移除（选区失效）；插入点拆分出的文本片段不影响序列化，下一次输入自然合并。
 */
export function focusByAnchor(root: HTMLElement): boolean {
    const wbr = root.querySelector("wbr");
    if (wbr == null) {
        return false;
    }
    const range = root.ownerDocument.createRange();
    // `Range.insertNode` 会拆分文本节点（offset 0 处会留下一个空文本节点），这里把空的/
    // 非元素的兄弟跳过，否则光标会落在空文本节点上（位置等价但会残留垃圾节点）。
    const usable = (n: ChildNode | null): boolean =>
        n != null && (n.nodeType === 1 || (n.textContent ?? "").length > 0);
    let prev: ChildNode | null = wbr.previousSibling;
    while (prev != null && !usable(prev)) {
        prev = prev.previousSibling;
    }
    let next: ChildNode | null = wbr.nextSibling;
    while (next != null && !usable(next)) {
        next = next.nextSibling;
    }
    let placed = false;
    if (prev != null && prev.nodeType === 3) {
        range.setStart(prev, (prev.textContent ?? "").length);
        placed = true;
    } else if (prev != null && prev.nodeType === 1) {
        const t = lastTextNodeIn(prev as Element);
        if (t != null) {
            range.setStart(t, (t.textContent ?? "").length);
            placed = true;
        }
    }
    if (!placed) {
        if (next != null && next.nodeType === 3) {
            range.setStart(next, 0);
            placed = true;
        } else if (next != null && next.nodeType === 1) {
            const t = firstTextNodeIn(next as Element);
            if (t != null) {
                range.setStart(t, 0);
                placed = true;
            }
        }
    }
    if (!placed) {
        range.setStart(root, 0);
    }
    range.collapse(true);
    wbr.parentNode?.removeChild(wbr);
    const sel = root.ownerDocument.defaultView?.getSelection() ?? null;
    if (sel != null) {
        sel.removeAllRanges();
        sel.addRange(range);
    }
    root.focus();
    return true;
}
