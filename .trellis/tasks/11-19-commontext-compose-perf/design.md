# Design — CommonText 弹窗输入链路与列表性能整改

## Architecture / Boundaries

改造只落在前端 CommonText 模块与一个验证台，不碰 Go 服务、数据库 schema 或 RPC 契约。

| 层 | 文件 | 职责 |
| --- | --- | --- |
| 搜索纯函数 | `frontend/app/commontext/commontext-model.ts` | 保留排序与评分语义，新增 baseItems 缓存入口与 caret 上下文签名 |
| 弹窗状态 | `frontend/app/commontext/commontext-compose-modal.tsx` | 输入快照、flush、窗口化、行 memo、关闭态 guard、resize 去抖 |
| DOM 行为锁 | `frontend/app/commontext/commontext-compose-modal.dom.test.tsx` | 覆盖输入与详情行为 |
| 纯函数锁 | `frontend/app/commontext/commontext-model.test.ts` | 覆盖排序、caret 加权与缓存入口 |
| 真机台 | `scripts/verify/commontext-meta-sort/verify.mjs` | 适配窗口化后的滚动与顺序断言 |

不拆新 React 组件树：只把行 JSX 提成 `CommonTextRow`，其余 hook 仍在 `CommonTextComposeModal` 内。这样 open 事件监听、`editItemId` 与尺寸状态不会因拆组件而丢失。

## Data Flow

```text
textarea input / select
  -> pendingSearchRef {text, caret}
  -> caretContextSignature 判定当前行与所在词是否变化
  -> 防抖 80ms 或行/词变化时 commitSearch()
  -> searchSnapshot state
  -> computeFilteredItems(searchSnapshot, baseItems, filters)
  -> window slice
  -> memoized CommonTextRow
```

确认动作走同步分支：

```text
Enter 选中 / 行内插入按钮
  -> flushSearch()
  -> 清 timer + commit pending + 返回 computeFilteredItems 结果
  -> 使用返回列表的 selectedIndex 命中项
```

云同步配置推送走关闭态 guard：

```text
settingsAtom 更新
  -> allItems = state.open ? normalize(settings) : EMPTY_ITEMS
  -> 关闭态只产生空派生值，不建 tags/device/rows
  -> 打开事件触发 state.open=true 后正常派生
```

## Contracts

### `caretContextSignature(editor: string, caret: number): string`

- 复用 `getCaretFragments` 的分词口径。
- 同时计入当前行索引与所在词，返回归一化后的签名；空词返回 `""`。
- 同一行同一词内移动返回相同值，因此不触发搜索提交。

### `searchCommonTextComposeItemsFromBase(baseItems, editor, manualQuery, options)`

- 入参与返回语义同 `searchCommonTextComposeItems`。
- 跳过 source filter、tag filter 与排序，直接使用调用方缓存的 `baseItems`。
- `insertedIds` 仍通过 options 传入，只影响评分排序，不进 baseItems key。
- 原 `searchCommonTextComposeItems` 保留为包装函数，内部调用新入口，现有调用与测试不变。

### `computeFilteredItems(...)`（组件内纯函数）

- `filteredItems` 的 `useMemo` 与 `flushSearch` 共用此函数。
- 入参含 `searchSnapshot`、`baseItems`、tags/creator/device/sort、manualQuery、insertedIds 与 limit。
- 返回数组顺序是 Enter 选中与行内插入的唯一依据。

### 窗口化数据属性

- 行保留 `data-common-text-index`（绝对索引）和 `data-commontext-title`。
- 列表容器新增 `data-commontext-total` 与 `data-commontext-window`，供验证台判定全量顺序与实际窗口。
- 验证台从容器读全量顺序，从行读可点击目标；点击前按标题滚动到目标行。

## Implementation Notes

### 输入快照

- `editor` 仍是 textarea 的即时值，草稿写盘路径不变。
- 新增 `searchSnapshot: { text, caret }`，`filteredItems` 只依赖它，不再依赖 `state.editorCaret`。
- `onChange` 只更新 editor 与 pending ref，并排 80ms commit。
- `onSelect` 更新 `editorCaret` 与 pending ref；只有当 `caretContextSignature` 变化时立即 commit。
- IME composition 期间不 commit；`compositionend` 后按当前文本提交一次。
- `flushSearch` 清 timer、写 searchSnapshot，并返回同步算出的列表，供确认动作使用。

### baseItems 缓存与行 memo

- `baseItems` 用 `useMemo`，依赖 `allItems`、`selectedTags`、`untaggedOnly`、`creatorFilter`、`deviceFilter`、`sortKey`。
- 搜索字段用模块级 `WeakMap<CommonTextItem, SearchFields>`；item 对象来自 settings 派生，配置更新后旧对象自然失效。
- `CommonTextRow` 用 `memo`；handler 通过 `useCallback([])` 读取 `stateRef` / `pendingSearchRef`，避免父层每次渲染生成新闭包。
- 行内插入按钮在异步动作开始前先 `flushSearch`，并把 `selectedIndex` 归零。
- tooltip 与预览在行内计算，接收一次渲染的 `now` 与语言值，避免逐条 `Date.now()`。

### 窗口化

- 常量 `COMMONTEXT_PERF_WINDOWING_ENABLED` 控制开关；开发期默认 false，验收后改为 true。
- `ROW_HEIGHT = 44` 为固定渲染高度，不是估算值；行内标签单行截断以匹配该高度。
- `OVERSCAN = 8`；`start/end` 由 `scrollTop`、`clientHeight` 与同一常量 `ROW_HEIGHT` 计算，上下 spacer 用同一常量占位。
- 键盘导航用索引换算滚动位置，不再查询离屏 DOM 节点。
- `scrollIntoView` effect 改为对 selectedIndex 做边界滚动。

### 关闭态与 resize

- `allItems` 在 `state.open === false` 时返回模块级 `EMPTY_ITEMS`，避免 normalize 与 tag/device 统计。
- ResizeObserver 回调只更新 `modalRef` 的内联宽高与 ref；用 150ms 静默期提交 state 与 localStorage，并在提交前比较新旧值，避免 style 回写引发观察循环。
- 编辑器最大高度沿用已提交的 `modalSize`，拖拽过程中不逐帧重算。

## Compatibility

- 持久化 key 不变：`commontext:editorDraft`、`commontext:composeModalSize`、`commontext:sortKey`。
- `searchCommonTextComposeItems` 对外签名与排序结果不变。
- 现有 `data-*` 锚点全部保留，仅新增容器级锚点。
- 窗口化关闭时 DOM 与今天完全一致，可作为回滚基线。

## Trade-offs

- caret 行/词变化才提交：同一行同一词内移动的即时高亮会延后到行/词边界，这是保留语义与降成本的折中。
- 固定行高：标签多行内容被截断为单行；换取稳定的窗口换算。
- 防抖 80ms：极端快速输入时列表滞后一帧；Enter flush 消除错项风险。
- 关闭态 guard 不拆组件：收益略低于完全卸载，但避免事件监听与状态迁移风险。

## Rollback

| 开关 | 关闭后行为 |
| --- | --- |
| `COMMONTEXT_PERF_INPUT_ENABLED` | 回到 editor/caret 直接依赖与无 flush 的输入链路 |
| `COMMONTEXT_PERF_WINDOWING_ENABLED` | 回到全量 500 行 map |
| `COMMONTEXT_PERF_CACHE_ENABLED` | 回到每轮构造 baseItems 与搜索字段、无行 memo |

三个开关集中在 `commontext-compose-modal.tsx` 顶部；验证台增补开关关闭态断言。
