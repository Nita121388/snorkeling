# AISessions 分页菜单：按轮改为按问答

## Goal

会话详情分页弹层（`AnnotationViewChip` → 分页菜单）里 turn 模式的标签是「N 轮」：它是行话，用户得先知道“一轮”的边界画在哪才能判断翻一页翻到哪。本次把该模式在 UI 上的命名统一为「按问答」，并清掉翻页条里以消息 seq 冒充轮号的「第 N 轮」。

## Requirements

### R1 菜单行：模式名与参数值分离

当前 `annotationPager.mode.turn`（`"{{count}} 轮"`）被**两处共用**：菜单行标签和 chip 标签。菜单行是“模式名”，chip 也是“模式入口”，两者都不该带页数（页数是结果摘要，属于翻页条的 `1/3`，且与当前模式无推导关系——"3 页"看不出是按问答切的）。统一拆为单一模式名 key：

- 菜单行：`按问答`（纯模式名，与「全部 / 按日 / 按时间窗 / 按条数」同一语域）
- chip：`按问答`（每个 chip 只显示“能唯一确定这个模式的最小信息”：interval/count 用参数（6h / 20 条）就够，turn 没有参数，只能给模式名）

### R2 中英双语文案同步

`zh` 与 `en` 两个 locale 的 `aisessions.json` 必须同步改，不允许只改 zh 留下 key 漂移。

### R3 翻页条 turn 模式不再显示「第 N 轮」

`AnnotationPagerBar` 的 `PageBarPrimary` 在 turn 模式下渲染 `aisessions:annotationPager.turnLabel`（`"第 {{seq}} 轮"`）。该文案有两个问题：

1. 术语「轮」与本任务 R1 的命名口径冲突；
2. `seq` 是**页首消息的 seq**，不是轮序号 —— seq 不连续时数字无意义。

处理：turn 模式下该段不再渲染（后面紧跟的 `1/3` 已定位当前页），`turnLabel` key 一并删除。

### 约束

- 只改渲染层文案与展示逻辑，不动分页算法（`computeTurnPages` / `computePages`）与持久化。
- 不改动其他模式（all / day / interval / count）的标签。
- 不扩大到菜单其它结构问题（模式行与 pill 组混排、重复同名项等），另开包。

## Acceptance Criteria

- [ ] AC1 `zh/aisessions.json` 中 turn 模式仅有模式名 key（值「按问答」）；旧 key `mode.turn` 的「{{count}} 轮」与页数变体不复存在
- [ ] AC2 `en/aisessions.json` 有对应 key（`By Q&A`），且 zh/en key 集合完全一致（`check-parity.mjs` 输出 `键 parity diff: 0`）
- [ ] AC3 `rg "轮" frontend/app/view/aisessions/ frontend/i18n/locales/*/aisessions.json` 在分页控件/文案层 0 命中（源码注释除外）
- [ ] AC4 `annotation-pager.dom.test.tsx`：chip 文案断言改为模式名（"By Q&A"，且不随页数变化）；新增断言：turn 行菜单文本为「By Q&A」；turn 模式翻页条无「Turn #」且无前导「·」
- [ ] AC5 单测通过：`npm test -- annotation-pager.dom.test annotation-paging.test`（数字见 implement 记录）

## Notes

- 相关代码：`frontend/app/view/aisessions/annotation-pager.tsx`（`pageModeChipLabelSpec` / `modeRow` / `PageBarPrimary`）、`annotation-model.ts`（`PageLabelData.turnStartSeq` 保留字段，只是不再渲染）。
- 背景：用户对着实机菜单问“3 轮是什么意思” → 命名不自解释，是本次改动的直接动因。
