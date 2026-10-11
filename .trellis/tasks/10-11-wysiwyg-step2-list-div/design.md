# 设计：列表结构自持 + 规范化

## 交付切分（4 个独立 commit）

| # | 交付 | 文件 |
|---|---|---|
| F1 | 序列化兜底（游离子列表不得丢弃） | `markdown-transform/dom-to-markdown.ts` + test |
| F2 | `normalizeListDom` 规范化 + 挂到结构变更后 | `wysiwyg-editor.tsx`（新纯函数可放 `markdown-transform/list-dom.ts`）+ test |
| F3 | Tab/Shift+Tab 自持（去 execCommand） | `wysiwyg-editor.tsx` + test |
| F4 | `<wbr>` 光标锚定 | `wysiwyg-editor.tsx` + test |

F1 必须先做（它单独就能止血：即使结构非规范也不丢内容）。

---

## F1 序列化兜底

**现状**（`frontend/app/element/markdown-transform/dom-to-markdown.ts`，`serializeListDomToMarkdown`）：

```ts
const items = Array.from(listEl.children).filter((c) => c.tagName === "LI");
...
for (const child of Array.from(li.children)) {
    if (tag === "UL") emitList(child, depth + 1, false, 1);
    else if (tag === "OL") emitList(child, depth + 1, true, 1);
}
```

`children` 里若出现**不属于任何 `li`** 的 `UL/OL`（浏览器 `execCommand("indent")` 的真实产物），
它既不在 `items` 里、也不会被任何 `li` 的递归访问到 → **整棵子树静默丢弃**（实测：源码少一项）。

**改法**：改为按 `childNodes` 顺序遍历，遇到 `UL/OL` 时按「嵌套一层」输出到**当前已输出的最后一项之后**
（即 `depth + 1`）；若它出现在第一个 `li` 之前，则按 `depth`（同级）输出，保证内容不丢。
等价实现（保持现有 `emitList` 递归）：

```ts
const emitList = (listEl: Element, depth: number, isOrdered: boolean, counter: number) => {
    let emittedForCurrentItem = false;
    for (const child of Array.from(listEl.children)) {
        const tag = child.tagName;
        if (tag === "LI") {
            // …现有 per-item 输出（prefix + content + li 自己的嵌套子列表）…
            emittedForCurrentItem = true;
            continue;
        }
        if (tag === "UL" || tag === "OL") {
            // 游离子列表：浏览器 indent 产物。必须输出，不能丢。
            emitList(child, depth + (emittedForCurrentItem ? 1 : 0), tag === "OL", 1);
        }
    }
};
```

**必须新增单测**（复现本次事故）：
```ts
const el = makeEl("<ul><li>item A</li><li></li><li>inserteditem B</li><ul><li>item C</li></ul></ul>", "div");
expect(serializeListDomToMarkdown(el.querySelector("ul"), false, "-")).toBe(
    "- item A\n- \n- inserteditem B\n  - item C"
);
```

---

## F2 `normalizeListDom`

**目标契约**：`ul/ol` 的直接子元素只允许是 `li`。任何直接挂在列表下的 `ul/ol` 都是非规范结构。

**算法**（新增到 `markdown-transform/list-dom.ts`，纯函数、可在 jsdom 单测）：

```ts
/** 把非规范列表结构收敛为「嵌套列表只能挂在 li 之下」。返回是否发生了改动。 */
export function normalizeListDom(root: ParentNode): boolean {
    let changed = false;
    // 自底向上处理，保证内层先规范
    for (const list of Array.from(root.querySelectorAll("ul, ol")).reverse()) {
        for (const child of Array.from(list.children)) {
            const tag = child.tagName;
            if (tag !== "UL" && tag !== "OL") continue;
            // 游离（或错误嵌套）的子列表：并入紧邻的前一个 li
            const prev = child.previousElementSibling;
            const hostLi = prev && prev.tagName === "LI" ? prev
                : Array.from(list.children).filter((c) => c.tagName === "LI").pop(); // 退化：挂到最后一项
            if (hostLi != null) {
                hostLi.appendChild(child);
            } else {
                // 列表里一个 li 都没有：把子列表整体提升（内容绝不丢弃）
                list.parentElement?.insertBefore(child, list.nextSibling);
            }
            changed = true;
        }
    }
    return changed;
}
```

注意点：
- 用 `List.from(...).reverse()` 自底向上，避免搬移过程中 index 失效
- `previousElementSibling` 是「紧邻前一个元素」；因为我们要的正是规范语义（缩进项成为前一项的子项）
- 退化分支（列表内无 li）必须**提升而非删除**
- 幂等：`normalize(normalize(x)) === normalize(x)`（加断言测试）

**调用点**（`wysiwyg-editor.tsx`）：Tab/Shift+Tab（F3）、Enter（原生后）、Backspace（原生后）、
粘贴（`onPaste`）之后各调一次；列表编辑种子落地后也调一次（防御外部 HTML）。

---

## F3 Tab / Shift+Tab 自持

**现状**（`wysiwyg-editor.tsx` 的 `applyListIndent(dir)`）：`document.execCommand(dir === 1 ? "indent" : "outdent")`
—— 正是产出游离子列表、导致丢内容的根源。

**改法**（`applyListIndent` 内部改为显式操作，仍保留接口签名）：

```ts
applyListIndent(dir) {
    const root = rootRef.current;
    if (root == null || compositionActiveRef.current) return;
    root.focus();
    const li = closestLiFromSelection(root);        // 选区所在 li（无则 return）
    if (li == null) return;
    const list = li.parentElement;                  // ul/ol
    if (list == null) return;
    anchorCaret(li);                                // F4：插 <wbr>
    if (dir === 1) {
        // 缩进：成为「紧邻前一个兄弟 li」的子列表项
        const prev = previousLiSibling(li);
        if (prev != null) {
            let sub = Array.from(prev.children).find((c) => c.tagName === "UL" || c.tagName === "OL");
            if (sub == null) {
                sub = document.createElement(list.tagName);   // 与父列表同型（ul/ol 保持一致）
                prev.appendChild(sub);
            }
            sub.appendChild(li);
        }
    } else {
        // 降级：从父列表移出，插到「父 li」之后
        const parentLi = list.closest("li");
        if (parentLi != null) {
            parentLi.parentElement?.insertBefore(li, parentLi.nextSibling);
            // 父列表空了就删掉它，避免留下空 ul 变成多余空行
            if (list.children.length === 0) list.remove();
        }
    }
    normalizeListDom(root);
    restoreCaretFromAnchor(root);                   // F4
    syncMirror();
}
```

边界（必须有测试）：
- 第一项 Tab → 无前一个兄弟 li → no-op
- 顶层项 Shift+Tab → 父列表无父 li → no-op
- 缩进时若前一个兄弟**已有**子列表 → 追加到它，不新建
- 降级时父列表只剩这一个项 → 移出后删除空列表（否则源码会多出一个空行/空 ul）

**与序列化的一致性**：`serializeListDomToMarkdown` 每层用 2 空格缩进（`"  ".repeat(depth)`），
自持操作只改 DOM 嵌套，不改缩进字面量 → 源码缩进由序列化统一产出，保持一致。

---

## F4 `<wbr>` 光标锚定（移植思源 `focusByWbr` 语义）

**现状**：`applyListIndent` 直接 `root.focus()`（无参）→ 结构变更后光标位置不定；Enter/Backspace
由浏览器管，通常没事，但缩进/降级后经常丢。

**改法**：两个纯函数（放 `markdown-transform/list-dom.ts`，可单测）：

```ts
/** 在选区处插一个 <wbr> 作为锚点（返回锚点元素；无选区返回 null）。 */
export function plantCaretAnchor(root: HTMLElement): Element | null
/** 找到 <wbr>，按邻居文本节点建 collapsed Range、移除锚点、focus。 */
export function focusByAnchor(root: HTMLElement): boolean
```

`focusByAnchor` 的重解析规则（思源 `selection.ts:1069-1130` 的等价最小实现）：
1. 取第一个 `wbr`；若没有则 `false`
2. 找它的**前一个兄弟**：是文本节点 → `setStart(text, text.length)`；
   是元素 → 取其最后一个文本后代；没有前一个兄弟 → 取**后一个兄弟**的第一个文本后代
3. 移除 `wbr`，`sel.removeAllRanges(); sel.addRange(range); root.focus()`

**测试**：`plantCaretAnchor` 后 `focusByAnchor` 让选区回到原文本节点边界；
`wbr` 不得留在 DOM 里（变更后断言无 `wbr`）。

---

## 验证清单

```bash
npx vitest run frontend/app/element     # 全绿（基线 44 文件 / 611 用例）
npx tsc --noEmit                        # 无新增错误（基线 68）
```

沙箱实测（`.runcfg/scratch`，见 prd 的「沙箱」小节；**窗口必须可见**，否则 CDP 输入被丢弃）：
1. `- item C` 上 Tab → 提交 → 源码项数**不变**、item C 变为 `  - item C` 缩进项
2. Shift+Tab 变回顶层
3. 第一项 Tab / 顶层 Shift+Tab → 无变化
4. 结构操作后继续打字 → 字符进入被操作项（光标未丢）

## 回滚

每个交付一个 commit，可单独 revert。F1 优先级最高（单独即止血）。
