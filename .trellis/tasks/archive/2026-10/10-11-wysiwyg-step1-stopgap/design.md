# 设计：止血（列表偏移/裁剪 + callout 身份与原地编辑 + 属性清洁）

## 交付切分（4 个独立 commit）

| # | 交付 | 主要文件 |
|---|---|---|
| D1 | 列表命中提升到 `UL/OL` | `markdown.tsx` |
| D2 | overlay 高度可增长（去裁剪） | `markdown-inline-edit.tsx`、`markdown.scss` |
| D3 | callout 块身份（点击可进编辑） | `remark/callout-alert.ts`、`renderer-registry.tsx`、`markdown.tsx` |
| D4 | callout 原地 WYSIWYG（标记/emoji 保真） | `markdown-inline-edit.tsx`、`remark/callout-alert.ts` |
| D5 | React `node` 属性污染清洁 | `markdown-render/*` |

---

## D1 列表命中提升

**现状**：`markdown.tsx:821-832` 的 `resolveEditTargetFromEl`

```ts
let target = el?.closest<HTMLElement>("[data-source-line]");
if (target.tagName === "LI") {
    // Only items with nested sublists promote to the whole list...
    if (target.querySelector("ol, ul") != null) { ...target = parentList; }
}
```

`UL` 与 `LI` 都带 `data-source-line`（都由 `srcLineAttrs` 注入），`closest` 命中最近的 `LI`。
`captureWysiwygInfo` 对 `kind === "list"` 取 `targetEl.outerHTML` → **裸 `<li>`** 种子。

**改法**：把 LI 分支改为**无条件**提升到所属列表元素：

```ts
if (target.tagName === "LI") {
    const parentList = target.parentElement?.closest<HTMLElement>("[data-source-line]");
    if (parentList != null && (parentList.tagName === "OL" || parentList.tagName === "UL")) {
        target = parentList;
    }
}
```

**理由**：种子必须是完整列表（结构合法、盒子与渲染态一致）；`beginEdit` 的 `endAttr` 取
`targetEl.dataset.sourceLineEnd`，`UL` 有 `data-source-line-end`（覆盖整表），而 `LI` 没有 →
行范围正确覆盖整表，提交不会丢项。

**取舍**：放弃「按项编辑」粒度，改为「整表编辑」（与 Obsidian Live Preview / 思源一致）。
必须写进 spec 的 Common Mistake。

**caret 注意**：`beginEditAtPoint`（`markdown.tsx:1115-1121`）用
`computeRenderedOffset(e.clientX, e.clientY, resolved.target)` 计算 caret 偏移。
`computeRenderedOffset` 内部用 `block.contains(container)` 与 TreeWalker 累加文本长度——
传 `UL` 时 offset 相对整表的文本流。这符合“整表编辑”的语义。**实现后必须实测**：
在列表第 2/3 项点击，光标应落在被点的项上（不是表头）。若偏移错位，则传
`el.closest("li")` 作为 caret 锚点元素、`UL` 作为种子元素（`beginEdit` 只会用 `targetEl` 取行号与 inHTML；
caret 只用于 `session.caretOffset`，可与 target 不同 → 需要 `beginEdit` 增加可选 `caretAnchorEl`）。
**优先尝试不改签名的方案**，实测错位再引入参数。

---

## D2 overlay 高度可增长

**现状**：
- `markdown-inline-edit.tsx:610-615`（`measureOverlay`）：
  `const next = { top: targetRect.top, left, width, height: targetRect.height };`
- `markdown-inline-edit.tsx:1237-1243`（JSX）：`style={{ position:"fixed", top, left, width, height, maxWidth, boxSizing, overflow:"hidden" }}`
- `markdown.scss:677-686`：`.inline-edit-overlay { overflow: hidden; contain: layout paint; }`

**改法**：
1. `measureOverlay`：把 `height` 语义改为 `minHeight`（保留字段名 `height` 以避免大范围改动，
   但下游按 min-height 用；**在注释中写明**）。宽度逻辑（`shouldExtend`）保持不变。
2. JSX style 改为：
   ```tsx
   minHeight: `${overlayRect.height}px`,
   // 不用固定 height：内容变高（列表 Enter 新增项、正文换行）必须完整可见，
   // 否则用户看不到自己刚打的内容。
   height: "auto",
   maxHeight: `calc(100vh - ${overlayRect.top}px - 8px)`,
   overflowY: "auto",
   overflowX: "hidden",
   ```
   移除 `overflow: "hidden"`。
3. `markdown.scss`：
   - `.inline-edit-overlay` 的 `overflow: hidden` → `overflow: visible`；`contain: layout paint` → `contain: layout`
     （**去掉 paint 裁剪**；保留 layout 以避免内部布局外溢影响外部）。
   - 新增：`[data-block-kind="wysiwyg"] { background: var(--content-bg-color, var(--main-bg-color, transparent)); }`
     —— 原块是 `visibility: hidden`（仍占位），overlay 长高会覆盖下方内容，需要底色避免文字叠字。
   - 保留 `.inline-edit-textarea` 的既有规则（textarea 路径不变）。

**必须回归**：段落/标题/引用/列表/空行/代码块（`ContentEditableCodeEditor`）/表格单元格全部进出编辑一次；
确认无定位抖动、无裁剪、无滚动条异常。

**注意**：`.inline-edit-hidden` 用 `visibility: hidden`（**保留布局盒**，见 `markdown.scss:664-668`），
不要把 overlay 改成影响文档流（必须保持 `position: fixed`）。

---

## D3 callout 块身份

**现状**：`remark/callout-alert.ts:96-100` 把 blockquote 换成 `hName: "div"` 的包装节点；
`markdown-render/renderer-registry.tsx:258` 只为 `blockquote` 注册 `srcLineAttrs` → div 无身份。

**改法**（沿用项目既有自定义标签惯例，见 `waveblock` / `mermaidblock`）：

1. `remark/callout-alert.ts`：包装节点 `hName: "div"` → **`hName: "calloutalert"`**，
   `hProperties.className` 保持 `markdown-alert markdown-alert-${alertType}`（**CSS 依赖 class，不是标签**）。
2. `markdown.tsx` sanitize（`~4426-4429` 的 `tagNames` 数组）：加入 `"calloutalert"`。
   同时 `~4407` 的 `div` 属性白名单可保留（不再需要），**不要动**以免影响其他 div。
3. `renderer-registry.tsx`：注册
   ```tsx
   registerMarkdownRenderer({
       key: "calloutalert",
       render: (props: any) => {
           const { node, ...rest } = props;      // 不把 react-markdown 的 node 透传到 DOM
           return <calloutalert {...rest} {...srcLineAttrs(props)} />;
       },
   });
   ```
   注意 React 渲染未知小写标签会保留标签名；`srcLineAttrs` 从 `props.node.position` 取行号——
   但**包装节点的 position 被插件新建对象时丢掉了**（`parent.children[index] = {type:"paragraph", children, data}` 没有 position）。
   → **必须**在插件里保留 position：`position: node.position`（blockquote 自身的 position）。
   `endLine` 同样来自该 position（`srcLineAttrs` 用 `node.position.end.line`）。
4. 点击解析：在 `resolveEditTargetFromEl` 中，**在** `closest("[data-source-line]")` **之前**加：
   ```ts
   const alertEl = el?.closest<HTMLElement>("calloutalert[data-source-line], .markdown-alert[data-source-line]");
   if (alertEl != null) {
       return { target: alertEl, line: Number(alertEl.dataset.sourceLine), blockKind: "quote" };
   }
   ```
   （放在最前，保证点在标题/正文任意位置都命中整个 callout；与 blockquote 的整块提升语义一致）
   注意保留 `img` 早退、行号有效性校验。

**回归风险**：所有 blockquote / callout 的渲染路径。必须验证：
- 普通引用块仍渲染为 `.markdown-alert.markdown-alert-quote`，样式不变（`display:block` 由 CSS 给定，
  自定义标签默认 `display:inline` → 依赖 `.markdown-alert { display: block }`，**确认该规则存在**）
- emoji 按钮交互（`openCalloutEmojiPicker` 读 `button.dataset.alert*`）不变
- `remarkBlankLineSpacers` / `createContentBlockPlugin` 仍把包装节点当 paragraph 处理（mdast `type` 未变）
- 现有 `remark/callout-alert.test.ts` 需按新 `hName` 更新断言

---

## D4 callout 原地 WYSIWYG

**目标**：点击 callout → 原地编辑；**看不到** `[!TYPE]` / `>`；提交后标记与 emoji 保真。

### 关键事实（已实测/核实）
- 插件顺序：`remarkSoftBreaks` 在 `remarkCalloutAlert` **之前**（`remark/index.ts:64-66`），
  所以软换行的引用块内容里 `\n` 已变成 `break` 节点。
- 因此软换行（`> a\n> b`）的 callout 是**一个** paragraph（title 里含 `<br>`）；
  只有带 `>` 空行（`>\n>`）才是多个 paragraph。
- 渲染结构：`calloutalert.markdown-alert` > `p.markdown-alert-title`（内含 `button` + `span.markdown-alert-title-text`）
  \+ 正文 `<p>`（= `node.children.slice(1)`）。

### 种子（`captureWysiwygInfo`）
当 `blockKind === "quote"` 且 `targetEl.matches(".markdown-alert")`：

```ts
const titleInner = targetEl.querySelector<HTMLElement>(".markdown-alert-title-text")?.innerHTML ?? "";
const bodyHtml = Array.from(targetEl.children)
    .filter((c) => !c.classList.contains("markdown-alert-title"))
    .map((c) => `<p>${(c as HTMLElement).innerHTML}</p>`)
    .join("");
const html = `<p>${titleInner}</p>${bodyHtml}`;
```
（**不要**用 `targetEl.innerHTML`：会把 emoji `<button>` 带上，序列化时 `<button>` 落 default 分支 unwrap → emoji 泄漏进正文）

### 前缀捕获（保真关键）
`captureWysiwygInfo` 收到 `sourceText`（= 整块源码，见 `markdown-inline-edit.tsx:797-800`）。
取首行、剥 `>` 前缀，再捕获标记 + emoji 的**原文**（保持大小写）：

```ts
const firstSrcLine = (sourceText.split(/\r?\n/)[0] ?? "").replace(/^\s*>\s?/, "");
const pm = firstSrcLine.match(/^(\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*)?((?:\p{Extended_Pictographic}(?:\uFE0F|\u20E3)?)\s*)?/iu);
const calloutPrefix = pm?.[0] ?? "";
```
- 有标记 → 保留原文（`[!NOTE]` 不会变 `[!note]`）
- 无标记（普通引用块）→ `calloutPrefix === ""` → 提交**不新增** `[!quote]`

把 `calloutPrefix` 与 `isCallout: true` 加进 `captureWysiwygInfo` 返回值 → `InlineEditSession`。

### 提交
`commit` 的 wysiwyg 分支（`markdown-inline-edit.tsx` 里构造 `committedDraft` 处）：
当 `session.isCallout` 时，在 quote 序列化结果上把**首行**的 `> ` 替换为 `> ${calloutPrefix}`：

```ts
// serializeBlockDomToMarkdown(root, {kind:"quote"}) → "> l1\n> l2"
draft = draft.replace(/^> /, `> ${calloutPrefix}`);
```
（`calloutPrefix` 已含尾随空格，如 `"[!NOTE] 💡 "`；普通引用块时为 `""` → 结果仍为 `> `）

边缘：内容为空时序列化结果为 `>`（见 `dom-to-markdown.ts` 的 quote 分支）→ 保持 `> ${prefix}` 去尾空格处理，
与现有 `-`/空行守卫一致；**实现时补测试**。

### 验收断言（新增测试）
- 种子：`<p>title</p><p>body</p>`，**不含** `<button>`
- 前缀：`> [!NOTE] 💡 标题` → `"[!NOTE] 💡 "`；`> 引用` → `""`
- 提交回写：首行 `> [!NOTE] 💡 新标题`，正文 `> 正文`；普通引用块**不出现** `[!quote]`

---

## D5 React `node` 属性清洁

**现状**：渲染器写 `<li {...props} {...srcLineAttrs(props)} />`，`props` 含 react-markdown 的 `node` 对象
→ DOM 出现 `node="[object Object]"`（实测），并被克隆进编辑态。

**改法**：在 `markdown-render/shared.ts` 新增
```ts
/** 去掉 react-markdown 注入的 node 对象，避免 React 把它序列化成 DOM 属性。 */
export function domProps<T extends Record<string, any>>(props: T): Omit<T, "node"> {
    const { node: _node, ...rest } = props;
    return rest;
}
```
把所有 `{...props}` 改为 `{...domProps(props)}`（保留 `srcLineAttrs(props)` 用完整 props 取行号）。
`markdown-render/` 下逐文件替换；`markdown.tsx` 内联的渲染器同样处理。

**验证**：脚本或测试断言渲染后的 DOM 不含 `node` 属性：
```ts
expect(html).not.toContain("[object Object]");
expect(root.querySelectorAll("[node]")).toHaveLength(0);
```

---

## 验证清单（每项都要跑）

```bash
npx vitest run frontend/app/element           # 全绿（基线 41 文件 / 576 测试）
npx tsc --noEmit                              # 无新增错误（基线 68）
```
+ 手动（CDP，`node scripts/inspect-electron-ui.mjs --target "Wave Terminal - T1" ...`）：
1. 点列表第 2 项 → 编辑态含 `ul > li×N`，overlay 高度 ≥ 列表高度
2. 列表内 Enter 新增项 → 新内容完整可见
3. 点 callout → 无 `[!`/`>` 可见；提交后源码保留标记与 emoji
4. 扫描渲染 DOM：无 `node="[object Object]"`

## 回滚

每个交付一个 commit；失败单独 revert，不影响其他交付（D3/D4 有顺序依赖：D3 先，D4 后）。
