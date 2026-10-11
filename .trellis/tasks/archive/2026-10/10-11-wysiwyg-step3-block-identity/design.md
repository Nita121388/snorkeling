# 设计：块身份 + 块级提交定位 + 逆操作记账

## 探针结论（已实测，决定了实现形态）

用真实管线（ReactMarkdown + remark 插件 + rehype-sanitize + 渲染器）验证插件设
`hProperties.dataBlockId` 之后会发生什么：

```
插件设 mdast data.hProperties = { dataBlockId: "blk-abc123" }
  ↓ remark-rehype → hast properties.dataBlockId
  ↓ rehype-sanitize（需在 allowlist 放行 "dataBlockId"）
  ↓ hast-util-to-jsx-runtime
渲染器收到 props 的 key = "data-block-id"          ← kebab，不是 dataBlockId
外加上 {...domProps(props)} 后 → <p data-block-id="blk-abc123">
```

**结论：渲染器一行都不用改。** id 由插件打、sanitize 放行，靠既有的
`{...domProps(props)}` 落到 DOM。这也是为什么 `srcLineAttrs` 当年不需要进 allowlist
（它由渲染器直接产出，不过 sanitize）——但插件设的属性**要过** sanitize。

## 交付切分（3 个独立 commit）

| # | 交付 | 主要文件 |
|---|---|---|
| S1 | `remarkBlockIds` 插件 + sanitize 放行 + id 派生纯函数与测试 | `remark/block-ids.ts`(+test)、`markdown-sanitize-schema.ts`、`remark/index.ts` |
| S2 | 会话记录 `blockId` + 提交前陈旧检测/重定位 + 归一化收敛 | `markdown-inline-edit.tsx`(+test)、`markdown-render/shared.ts` |
| S3 | 逆操作记账（undo 条目携带 `{blockId, before, after}`） | `use-editor-history.ts`(+test)、`markdown.tsx` 提交回调 |

---

## S1 块身份

### id 派生（纯函数，可直测）

新文件 `frontend/app/element/remark/block-ids.ts`：

```ts
/** 32-bit FNV-1a：内容 → 短摘要。够用且零依赖（不引 crypto）。 */
function fnv1a(text: string): string { ... }

/** 递归收集 mdast 节点的文本（避免为一行代码引入 mdast-util-to-string 依赖）。 */
function collectText(node: any): string { ... }

/**
 * 给每个块级节点打 data-block-id。
 * id = `${fnv1a(text)}-${同摘要块的出现序号}`：
 * - 只依赖**内容**与**文档内顺序** → 同一文档两次解析结果完全相同（纯函数）；
 * - 内容相同的重复块靠序号区分 → 全文档唯一（querySelector 不会拿错）；
 * - 不写进源文件 → 用户资产零污染。
 */
export const remarkBlockIds: Plugin<[], Root> = () => (tree) => { ... };
```

要点：
- **块级节点集合**要与渲染出的「可编辑块元素」一致：`paragraph`（含 sn 的
  blank-spacer / callout 的 div / 标题段）、`heading`、`blockquote`、`list`、`table`、
  `code`、`thematicBreak`。用**白名单**而不是「除 inline 之外」，避免给 inline 节点打 id。
- `data.hProperties` 可能被别的插件占用（callout 就设了 hName/hProperties）→ **必须合并**
  而不是覆盖：`node.data = { ...node.data, hProperties: { ...node.data?.hProperties, dataBlockId } }`。
- 插件在**管线里要靠后**（callout / 列表拆分 / spacer 都定型之后再打 id），
  否则 id 打在会被替换掉的节点上。放在 `remarkLooseListSpacing` 之后、content block 之前。

### sanitize 放行

`markdown-sanitize-schema.ts`：在 `attributes["*"]` 里加 `"dataBlockId"`（一条，别重复）。
注意 `'*'` 列表里若已有同名条目就等于没加（findDefinition 只取第一条）——
本文件顶部已有这条维护规则，照它做。

### 测试（remark/block-ids.test.ts）

- 同一 md 两次解析 → id 集合完全相同（稳定性）
- 改一段文字 → 该块 id 变、其它块 id 不变
- 两个内容相同的块 → id 不同（消歧）
- 合并而非覆盖：callout 的 hName/hProperties 与 dataBlockId 同时存在
- 渲染链路（复用 calloutalert.render.test.tsx 的写法）→ DOM 上有 `data-block-id` 且未被剥离

---

## S2 提交前的陈旧检测与重定位

### 归一化收敛（先做，避免漂移）

`beginEdit` 现在这样算 `initialContent`：

```ts
blockKind === "code" ? stripCodeFence(sourceContent)
: blockKind === "list" ? stripListMarker(sourceContent)
: sourceContent
```

抽成导出的 `initialContentFor(kind, sourceSlice)`，**beginEdit 与提交守卫都调它**。
这是本次最大的「防漂移」动作：两侧只要用同一个函数，就不可能再出现「你以为你在比什么」。

### 会话字段

`InlineEditSession` 增 `blockId?: string`（`beginEdit` 里从 `targetEl.dataset.blockId` 读；
没有就 undefined，不阻断流程）。

### 提交流程（只加不减，全部在 `commit()` 内、写盘之前）

1. **重定位**：`root.querySelector('[data-block-id="…"]')`（`root` = `.markdown-render-root`）
   - 命中 → 用**它的** `data-source-line` / `-end` 覆盖 `current.startLine/endLine`
     （行号位移后仍写对位置，R4）
   - 未命中 → 退回捕获范围（形状变了，例如块被别的提交改成了列表）
2. **陈旧检测**（仅当 `insertMode == null` 且 `initialContent !== ""`）：
   `initialContentFor(kind, lines.slice(start-1, end).join("\n")) !== initialContent` → **中止**，
   记 `commit:stale-target-blocked` 调试日志，`return`。
   - 空 `initialContent` 的会话（placeholder / 插入 / blank）跳过：它们本来就没有「原文」可比。
3. 之后的守卫顺序**不变**（空壳守卫 → placeholder 分支 → 写盘）。

**注意顺序**：陈旧检测要在**所有写盘分支之前**、但在「重定位」之后；空壳守卫继续在
placeholder 分支之前（step1 的 BLOCKER1 结论不能回退）。

### 测试

- 重定位命中 → 使用 DOM 上的当前行号（构造一个把行号改掉的 DOM，断言用的是新值）
- 重定位未命中 → 退回捕获范围，但内容不符 → 中止
- 内容不符（模拟外部改动）→ 中止：`onCommit` 未被调用、文本未变
- 内容相符 → 正常提交（回归）
- `initialContentFor` 与 `beginEdit` 的一致性（list/code 各一例，断言 marker/fence 被去掉）

---

## S3 逆操作记账

`use-editor-history.ts` 的撤销条目类型增可选字段：

```ts
export interface EditorHistoryOp {
    blockId?: string;
    startLine: number;
    endLine: number;
    before: string;   // 该块的原文（== 会话 initialContent）
    after: string;    // 写盘后的内容
}
```

- `push` 时把 op 一并存下（快照照旧 —— **行为零变化**，只是多带数据）。
- 阶段 4 的块级结构操作会用 `{blockId, before, after}` 做精确逆操作；在此之前它只是数据。
- 测试：条目携带 op；现有撤销/重做一致性用例全绿（行为不变是硬要求）。

---

## 验证清单

```bash
npx vitest run frontend/app/element     # 全绿（当前基线 47 文件 / 678 用例）
npx tsc --noEmit                        # 无新增（基线 68）
```

沙箱实测（`.runcfg/scratch`；**窗口必须可见**，否则 CDP 输入被丢弃）：

1. **连续编辑两块**：编辑块 A 提交（行号位移）→ 立刻编辑块 B → 提交；B 的写入位置正确、
   A 未被破坏。
2. **外部改动后提交**：编辑器打开状态下从磁盘改草稿文件（让实时预览重渲染）→ 提交
   → **拒绝写入**，文件内容保持外部版本（只有外部改动，没有我的半截编辑）。
3. **重复内容块消歧**：两个内容相同的块分别编辑 → 各改各的（验证 id 唯一）。

## 回滚

S1（纯新增 + allowlist）可单独保留或 revert；S2 依赖 S1 的 id（revert S1 时 S2 会自动退化为
「没有 id → 不做重定位、内容守卫仍生效」，不会崩）；S3 完全独立。
