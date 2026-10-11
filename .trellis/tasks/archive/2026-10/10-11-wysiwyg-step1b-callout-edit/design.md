# 设计：callout 一等块 + 原地 WYSIWYG 编辑

## 前置条件 #1 已满足（2026-10-11）

「编辑器根为空 → 提交裸 `>` 覆盖整段引用」的**运行时触发条件已定位到代码级并修掉**，
提交 `9e8489b8`（空编辑器根防线）+ 4 个回归测试。

**机制**：空根的充要条件是 `captureWysiwygInfo` 对一个**源码有内容**的会话返回空种子。
`beginEdit` 的 `targetEl` 与 `blockKind` **不保证同源**（`focusEditedLine` 用
`blockKindFromElement(prevEl)` 分类、却把同一个 el 交给 `beginEdit` 当种子）。而 `""`
能通过调用方的 `wysiwygHtml != null` 判断 → `WysiwygEditor` 以 `initialHtml=""` 挂载 →
`root.innerHTML = ""` → 失焦提交把 DOM 序列化出的裸 `>` 写到那个块上。

**现在有两道防线**：
1. `captureWysiwygInfo` 拒收「种子空 html」**和**「种子 html 非空但零文本」而源码非空壳的会话
   → 回落 textarea（种子取源码，永远与块内容一致）。
   **第二道很关键**：callout 标题恰好是「html 非空、零文本」的形状。
2. `commit()` 的 `seedNeverLanded` 守卫（step1 加）在 DOM 塌成空壳时拒绝写入。

## 现状事实（写代码前必须知道的）

- `remarkCalloutAlert` **无条件**把**每一个** blockquote 换成
  `<div class="markdown-alert markdown-alert-{note|tip|important|warning|caution|quote}">`
  （普通引用也是 `markdown-alert-quote`，且**同样**带 emoji 按钮 + `p.markdown-alert-title`）。
- 替换节点 **没有 `position`** → 没有 `data-source-line` → 整块无法成为编辑目标。
  标题 `p.markdown-alert-title` 也没有 position。
- 正文段落是真实 mdast paragraph、**有** `data-source-line` → 点正文只能按 kind `"p"`
  编辑**那一行**（并且会把该行的 `> ` 前缀写掉）。
- emoji 交互**已存在**：`markdown.tsx` 的 `openCalloutEmojiPicker` / `applyCalloutEmoji`
  读按钮的 `data-alert-line` / `data-alert-emoji`，用
  `/^(\s*>\s*(?:\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*)?)/i` 定位并重写源行。
  **这套正则就是 R4 要复用的前缀语义，不要另起一套。**
- `data-source-line` 是**渲染器**（`srcLineAttrs(props)`）加的，**不经过 sanitize**
  → 新增 `calloutalert` 只需在 sanitize 的 `tagNames` 里放行该 tag、并允许
  `[["className", /^markdown-alert/]]`（照抄 `div` 那条）。

## 交付切分（4 个独立 commit）

| # | 交付 | 文件 |
|---|---|---|
| R1 | 块身份：自定义 tag + 保留 position + sanitize + 渲染器 | `remark/callout-alert.ts`、`markdown-render/`、`markdown.tsx` |
| R2 | 点击进入编辑（整块解析为 `blockKind: "quote"`） | `markdown.tsx`（`resolveEditTargetFromElement` / `blockKindFromElement`） |
| R3 | 干净种子（不含 emoji `<button>`，标题降为普通首段） | `markdown-inline-edit.tsx`（`captureWysiwygInfo`） |
| R4 | 标记保真（`[!TYPE]` 大小写 + emoji 回写首行；普通引用不得凭空新增标记） | `markdown-inline-edit.tsx`（捕获）、`markdown.tsx`（提交） |

---

## R1 块身份

`remark/callout-alert.ts`：替换节点的 `data.hName` 由 `"div"` 改为 `"calloutalert"`，
并**保留原 blockquote 的 position**：

```ts
parent.children[index] = {
    type: "paragraph",
    children,
    position: node.position,        // ★ 源码位置：srcLineAttrs 靠它产出 data-source-line
    data: {
        hName: "calloutalert",
        hProperties: { className: `markdown-alert markdown-alert-${alertType}` },
    },
};
```

`position` 的 `end` 一并保留 → `data-source-line-end` 覆盖整个 callout（多行正文一格编辑范围）。

渲染器（`markdown-render/renderer-registry.tsx` 注册 + 新组件，命名照
`waveblock.tsx`/`mermaidblock`）：

```tsx
registerMarkdownRenderer({
    key: "calloutalert",
    render: (props: any) => (
        <CalloutAlert {...domProps(props)} {...srcLineAttrs(props)} />
    ),
});
```
`CalloutAlert` 渲染成 `<calloutalert className={...}>{children}</calloutalert>`（**必须 `display:block`**，
未知标签默认 inline —— 这正是 10-08 那次竖排 bug 的同源坑，CSS 里已有 `.markdown-alert{display:block}`，
换 tag 后要确认选择器仍然命中）。

sanitize：`tagNames` 加 `"calloutalert"`；`attributes` 加
`calloutalert: [["className", /^markdown-alert/], "dataSourceLine", "dataSourceLineEnd"]`。

**回归要点**：`.markdown-alert` 的 CSS 选择器若写成 `div.markdown-alert` 会失效 →
改 tag 后必须检查 `markdown.scss` 全部 `.markdown-alert*` 选择器。

## R2 点击进入编辑

`resolveEditTargetFromElement` 最前面加：

```ts
const alert = el?.closest<HTMLElement>("calloutalert[data-source-line], .markdown-alert[data-source-line]");
if (alert != null) {
    const line = Number(alert.dataset.sourceLine);
    if (Number.isFinite(line) && line >= 1) {
        return { target: alert, line, blockKind: "quote" };
    }
}
```
必须放在 `closest("[data-source-line]")` 之前——否则会先命中正文 `<p>`（kind `"p"`，
只编辑一行且写掉 `> ` 前缀）。

`blockKindFromElement` 加 `CASE "CALLOUTALERT"` → `"quote"`（编辑焦点跟随路径也要正确）。

## R3 干净种子

`captureWysiwygInfo` 的 quote 分支改为「callout 感知」：

```ts
const isCallout = targetEl.matches("calloutalert, .markdown-alert");
const html = isCallout ? calloutSeedHtml(targetEl) : targetEl.innerHTML;
```
```ts
/** callout 的编辑种子：去掉 emoji <button>（default 分支会 unwrap 成文本泄漏进正文），
 *  并把标题段降为普通首段（只取 .markdown-alert-title-text 的内容）。 */
export function calloutSeedHtml(el: HTMLElement): string {
    const clone = el.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("button.markdown-alert-emoji-btn").forEach((b) => b.remove());
    const title = clone.querySelector("p.markdown-alert-title");
    if (title != null) {
        const textEl = title.querySelector(".markdown-alert-title-text");
        const p = document.createElement("p");
        p.innerHTML = textEl != null ? textEl.innerHTML : "";
        title.replaceWith(p);          // 空标题 → <p></p> → 序列化成裸 ">"（首行位置不变）
    }
    return clone.innerHTML;
}
```
- 序列化（kind quote）→ `> 标题\n> 正文`（空标题 → `>\n> 正文`，位置语义正确）。
- **不要把 emoji 塞回种子**：emoji 由 R4 从源码首行回写，这样用户删掉 `[!NOTE]` 也只影响前缀。

## R4 标记保真

**捕获**（beginEdit 时，会话字段 `calloutPrefix?: string` 与 `isCallout?: boolean`）：
从源码首行按 emoji 那套正则取「标记 + emoji 的原文」（**保大小写**）：

```ts
export function captureCalloutPrefix(firstSourceLine: string): string {
    const content = firstSourceLine.replace(/^\s*>\s?/, "");
    const m = content.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i);
    const after = m ? content.slice(m[0].length) : content;
    const e = after.match(/^(\p{Extended_Pictographic}(?:\uFE0F|\u20E3)?)\s*/u);
    return `${m ? m[0] : ""}${e ? e[0] : ""}`;
}
```
- 只在 `isCallout` 时捕获；前缀为空（普通引用）→ **不写标记**（R4 硬要求）。

**回写**（提交时、序列化之后、写盘之前）：

```ts
/** 把 callout 标记回写到草稿首行。首行形态总是 `> ...`（或裸 `>`）。 */
export function applyCalloutPrefix(markdown: string, prefix: string): string {
    if (prefix === "") return markdown;
    const lines = markdown.split("\n");
    if (lines.length === 0) return markdown;
    const m = lines[0].match(/^(\s*>\s?)/);
    if (m == null) return markdown;                  // 不是引用行 → 不动
    lines[0] = `${m[1]}${prefix}${lines[0].slice(m[1].length)}`;
    return lines.join("\n");
}
```
- 首行是裸 `>` 时结果 `> [!NOTE] ` → 末尾空格会被写盘；**提交前 `replace(/[ \t]+$/, "")` 该行**
  hmm —— 只对**首行**且原文首行就是裸标记时清尾空格，避免改动用户正文里的行尾空格。
  实现时按「原文首行是否以 `[!TYPE]` 结尾」判断，是则清首行尾空格。
- 用户把首行内容整段删掉（首行变空）→ 结果是裸 `>`，不残留标记 ✓（`m[1]` 匹配到 `> ` 后接空串）。

**落点**（`markdown.tsx` 提交回调里，与 `indentListDraft` 同级的位置）：
`calloutPrefix` 存在时，对 `committedDraft` 依次做 `applyCalloutPrefix` → 再交给
`handleInlineEditCommit`。**必须与守卫顺序一致**：守卫判空壳用的是**回写前**的草稿
（裸 `>` 才认得出来），所以 `applyCalloutPrefix` 要放在守卫之后。

---

## 验收标准（逐条可测）

- [ ] 单测：插件产出 `calloutalert` + `position` 保留（start/end 都在）
- [ ] 单测：`calloutSeedHtml` 去掉 button、标题降为 `<p>`、空标题 → `<p></p>`
- [ ] 单测：`captureCalloutPrefix` 保大小写（`[!Note]` → `[!Note]`）、带 emoji、无标记 → `""`
- [ ] 单测：`applyCalloutPrefix` 首行裸 `>` → `> [!NOTE]`（清尾空格）；普通引用 prefix `""` → 原样
- [ ] 单测：`resolveEditTargetFromElement` 命中 callout 整块 → `blockKind: "quote"`
- [ ] 单测：`captureWysiwygInfo("quote", calloutEl, ...)` 种子不含 `button`、含标题与正文文本
- [ ] 沙箱 5 场景（一次性草稿，**零非预期写盘**）：单行 callout / 多段 callout（`>` 空行分隔）/
      软换行 callout / 无标记普通引用 / 含 emoji callout，逐个「进入编辑→不改→失焦」= 不写盘、
      「改标题或正文→失焦」= 往返正确
- [ ] 普通引用提交后**不新增** `[!quote]`
- [ ] 现有 emoji 选择器功能不被破坏（`applyCalloutEmoji` 仍能改 emoji）
- [ ] `npx vitest run frontend/app/element` 全绿；`npx tsc --noEmit` = 68

## 回滚

R1–R4 各一个 commit；R1 可单独 revert（回到 div 形态，功能全无但无副作用）。
R3/R4 依赖 R1 的块身份 —— revert R1 时必须一并 revert R3/R4。
