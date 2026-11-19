# CommonText 弹窗性能调查与方案风险审核

## 性能瓶颈（静态路径证据）

- `frontend/app/commontext/commontext-compose-modal.tsx:59` 定义 `LIST_LIMIT = 500`，列表无虚拟化。
- 同文件 `:341-372` 的 `filteredItems` 依赖 `state.editorCaret`；`:811,1433` 的 `onSelect` 在每次光标变化时写 state。
- 普通打字会先触发 `onChange`（`:1408`），再触发 `onSelect`；两次独立事件带来两次 state 写入与两次派生计算。
- `frontend/app/commontext/commontext-model.ts:526-534,570-600` 用 caret 所在词与当前行做加权；直接删除 `editorCaret` 会丢失“附近词优先”。
- 同文件 `:596-636` 每轮对最多 500 条做 normalize/lowercase/分词/评分，并先做 O(N log N) 排序。
- 列表渲染见 `commontext-compose-modal.tsx:1722`：`filteredItems.map(...)` 全量进入 React 协调。
- 每行 `:1724-1830` 含日期格式化、i18n、标签 chip、预览正则、同步状态 tooltip。
- 顶层 `:267,313` 订阅 `settingsAtom`；`global-atoms.ts:60-62` 的派生 atom 在任意配置写入后返回新对象。云同步推送会让关闭态也重算派生数据。
- `:608-658` 的联动 effect 在 `filteredItems` 变化后回写 `detailId/selectedIndex`，可能引发第二轮渲染。
- `:583-607` 的 ResizeObserver 每帧 `setModalSize` 并写 localStorage，拖拽时会重渲染整个弹窗。

## 方案风险审核

| 风险 | 证据 | 结论 |
| --- | --- | --- |
| 直接移除 `editorCaret` 会冻结光标相关排序 | `commontext-model.ts:526-534,570-600` | 保留语义，改拆 `searchText` 与 `caretTokenRevision` |
| 搜索防抖后立刻 Enter 会用旧列表 | `commontext-compose-modal.tsx:1181,1219` | Enter 前必须 flush pending search 并同步取新结果 |
| 行窗口化会让验证台按标题查全量行失败 | `scripts/verify/commontext-meta-sort/verify.mjs:78,111,235,332,384` | 台子改为先滚动到目标；保留稳定 `data-common-text-index` |
| 窗口化后 `scrollIntoView` 选择器找不到离屏行 | `commontext-compose-modal.tsx:676-677` | 用索引到滚动位置的换算，不依赖离屏 DOM 节点 |
| 行 memo 会被父层内联闭包和 tooltip 击穿 | `commontext-compose-modal.tsx:1724,1842-1858` | 提取行组件，改传稳定 handler 与 item id |
| 缓存 key 漏筛选维度会产生旧序 | `commontext-model.ts:596-636` | key 必须含 allItems identity、tags、untagged、creator、device、sortKey |
| 关闭态拆分可能丢 open 事件与 editItemId | `commontext-compose-modal.tsx:529-570` | 外壳保留监听与尺寸，仅列表体按 open 挂载 |
| 500 行 jsdom 性能探针曾 OOM | 本会话临时探针 | CI 探针用 120 行；500 行仅手动基准 |

## 用户决策

- 已确认：保留“光标附近词优先”语义。
- 实现策略：拆 `searchText` 与 `caretTokenRevision`；Enter 选中前 flush pending search；不用直接删除 caret 依赖的简化方案。

## 相关页面

- `docs/answers/commontext-modal-perf-investigation-20261119-134043.html`
- `docs/answers/commontext-perf-plan-risk-review-20261119-134659.html`
