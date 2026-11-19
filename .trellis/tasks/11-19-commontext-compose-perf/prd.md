# CommonText 弹窗输入链路与列表性能整改

## Goal

降低 CommonText 弹窗打字、移动光标与配置推送时的重算和重绘成本，同时保留“光标附近词优先”的既有排序语义。

## Background / Confirmed Facts

- `frontend/app/commontext/commontext-compose-modal.tsx:59` 设置 `LIST_LIMIT = 500`，列表没有窗口化。
- 同文件 `:341-372` 的 `filteredItems` 依赖 `state.editorCaret`；`:811,1433` 的 `onSelect` 在每次光标变化时写 state。
- 打字依次触发 `onChange`（`:1408`）与 `onSelect`，会产生两次独立 setState。
- `frontend/app/commontext/commontext-model.ts:526-534,570-600` 依赖 caret 做当前行与当前词加权；删除该依赖会改变排序语义。
- 同文件 `:596-636` 每轮对最多 500 条做归一化、分词、评分和全量排序。
- 列表在 `commontext-compose-modal.tsx:1722` 全量 map，行内 `:1724-1830` 包含日期、i18n、标签与预览计算。
- 顶层 `:267,313` 订阅 `settingsAtom`；`global-atoms.ts:60-62` 在任意配置写入后返回新 settings 对象。
- `:608-658` 的 effect 在过滤结果变化后回写 `detailId/selectedIndex`，可能追加第二轮渲染。
- `:583-607` 的 ResizeObserver 每帧写 state 与 localStorage，拖拽时会重渲染整个弹窗。
- `scripts/verify/commontext-meta-sort/verify.mjs:78,111,235,332,384` 按标题查询并点击全量行；窗口化必须同步调整验证台。

## Requirements

- **R1 输入链路拆分**：保留 `editor` 作为 textarea 即时值；新增 `searchText` 与 `caretTokenRevision`，仅当文本变化或 caret 所在行与所在词变化时更新搜索快照。
- **R2 Enter flush**：任何消费 `filteredItems` 的确认动作（Enter 选中、行内插入按钮）先同步提交 pending search，并使用提交后的结果，禁止读取旧列表。
- **R3 行窗口化**：列表只渲染可视区加 overscan；保留稳定 `data-common-text-index` 与 `data-commontext-title`，并在容器暴露总数与滚动锚点，供验证台和键盘导航使用。
- **R4 计算复用**：缓存按 items、sortKey、selectedTags、untagged、creator、device 得到的 baseItems；按 item 对象缓存搜索字段；提取 memo 行组件并传稳定回调。
- **R5 关闭态与拖拽减负**：关闭态不构建列表派生数据，但保留 open 事件监听与 `editItemId` 处理；ResizeObserver 拖拽期间不逐帧触发整窗重渲染。
- **R6 回归锁**：新增单测覆盖 caret 语义、Enter flush、窗口化索引与关闭态刷新；保留现有 DOM 行为断言。
- **R7 开关与回滚**：窗口化、缓存、关闭态拆分各自带常量开关；关闭时回到当前行为。

## Acceptance Criteria

- **AC1（R1）**：光标在同一行同一词内移动不触发 `filteredItems` 重算；光标换行或换词后按新行与新词重新加权排序。
- **AC2（R2）**：输入后立刻按 Enter，打开的是当前编辑器文本对应的相关度第一名；不存在使用上一次结果的窗口。
- **AC3（R3）**：500 条数据下 DOM 行数不超过 40；滚动到第 300 行后 Enter 与右侧详情指向同一条。
- **AC4（R4）**：搜索字段缓存命中时不重复 normalize；memo 行组件在纯详情变更时不重绘列表行。
- **AC5（R5）**：关闭态收到配置推送后重新打开，能看到新条目；拖拽弹窗时编辑器输入不中断。
- **AC6（R6）**：`npx vitest run frontend/app/commontext/commontext-model.test.ts frontend/app/commontext/commontext-compose-modal.test.ts frontend/app/commontext/commontext-compose-modal.dom.test.tsx` 全绿；新增测试全绿。
- **AC7（R7）**：三个开关分别置 false 后，行为回到改造前且现有断言保持通过。
- **AC8（类型债）**：`node scripts/check-tsc-baseline.mjs` 错误数不高于改造前基线。

## Out of Scope

- 真机 CDP 验证（用户明确要求本机暂缓）。
- 云同步传输、冲突策略与后端 schema 变更。
- 修改搜索评分权重或排序不变量（pinned 优先、并列回落）。
- 新增第三方虚拟化依赖。
- 行高固定为 `ROW_HEIGHT = 44`，配合行内标签单行截断保持与原行视觉一致；不新增第三方向量化依赖。

## Technical Notes / Constraints

- 不直接删除 `editorCaret` 依赖；用 `caretTokenRevision` 表达“语义上会改变排序的光标变化”，签名必须同时包含当前行索引与所在词。
- `searchCommonTextComposeItems` 仍是唯一排序入口；缓存只提供 baseItems 与字段，不另写排序逻辑。
- 窗口化默认在最终版本开启，但保留常量开关用于回滚；开发期默认关闭。
- CI 性能探针使用 120 条种子；500 条仅作为手动基准，避免本机 OOM 造成红灯。

## Key Decisions

- **KD1**：保留光标附近词优先。理由：既有语义被测试和验证台隐含依赖；删除会改变产品行为。用户已明确按推荐执行。
- **KD2**：本任务单列实现，不拆子任务。理由：输入链路 → 窗口化 → 缓存 → 关闭态存在顺序依赖，独立验收价值低。
- **KD3**：性能验收采用相对阈值，不设绝对值。理由：本机性能差且未采集可信真机数字。

## Risks / Deferred

| 风险 | 缓解 |
| --- | --- |
| 防抖导致 Enter 选中旧结果 | flush 返回同步计算的新列表，并把 selectedIndex 归零，确认动作只消费该列表 |
| 窗口化破坏键盘和验证台 | 稳定索引属性 + 索引换算滚动 + 台子先滚动后点击 |
| 行高变化导致窗口错位 | 固定 `ROW_HEIGHT = 44` + overscan；行内标签单行截断并锁住行高 |
| 缓存 key 漏维度 | key 覆盖所有筛选与 sortKey；baseItems 不含 insertedIds |
| 关闭态拆分丢事件 | 外壳保留监听；仅 body 按 open 挂载 |
| i18n 切换后缓存文案过期 | 格式化缓存 key 含语言或由 i18n 变更触发失效 |
| 500 行探针 OOM | CI 固定 120 行，500 行手动执行 |

## Open Questions

无。
