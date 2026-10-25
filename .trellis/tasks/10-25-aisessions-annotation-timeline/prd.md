# AI 会话节点批注时间线与 AI 生成（父任务）

## 定位与相邻任务的关系

本任务做**节点级批注**（锚点是 `Message.ItemKey`），是父任务 `10-19-aisessions-ux-perf-overhaul` L2 lane 的第二层。

| 任务 | 锚定粒度 | 状态 |
|---|---|---|
| `10-19-aisessions-annotate` | **字符区间**（选中文字的 `start/end`，CSS Custom Highlight 回显） | 已有 PRD，未动 |
| 本任务 | **消息节点**（`Message.ItemKey` = `<entryId>:m0` / `<entryId>:t0`） | 本任务 |

两者共用一张表的可能性留到实现阶段评估，但 M1 阶段**必须各自独立**：区间级批注依赖 markdown 渲染后的选区反算，节点级不依赖任何 DOM 选区，两者失败模式不同、验收不同。禁止在同一子任务里同时实现两层。

---

## Goal

1. 会话详情左侧出现**批注时间线**（rail），只标注有批注的节点，点击跳转到对应消息并高亮，悬浮展示节点摘要 + 批注信息。
2. 用户可对任意消息**手动添加批注**（标题、内容、标签、类型），一条消息可有多条批注。
3. **所有需要手动输入的字段都提供 ✨ AI 生成**：时间线整体、批注标题、批注正文、批注标签、会话笔记。
4. AI 生成结果以**草稿**落库，用户可逐条采纳 / 丢弃 / 编辑；**重新生成永不覆盖用户手写或用户改过的条目**。
5. （M2，占位）跨会话「会话批注 Block」：列出所有有批注的会话，支持预览、导出为 Obsidian 格式 md。
6. （M3，占位）自动生成触发：turn 闭合 / 会话空闲 / 新会话落盘。

## 需求来源（用户明确要求）

> 给对话增加批注（标题、内容、标签），可以在左侧显示时间线，点击跳转到对应的对话节点，鼠标悬浮显示节点内容、批注信息；所有的会话批注可以在一个会话批注 Block 中，列表显示哪些会话有详细批注，支持预览导出该会话为 md 文件，Obsidian 格式 + 批注信息；支持异步导出，不要影响主程序。

> AI 生成批注的触发时机？关键节点触发？用户手动触发？
> 先支持用户手动点击 AI 生成，给本会话生成时间线信息，时间线、支持手动修改和重新生成，对话支持增加备注等时间线数据，支持手动输入的地方就要支持 AI 生成。

参考项目 `E:/primary/projects/pi-session-library`：其 annotations 表结构、Obsidian frontmatter、`> [!annotation]` callout 渲染与 worker 导出队列是格式参照来源。

---

## 范围

### M1 在本任务内（四个子任务）

| 子任务 | 内容 | 优先级 |
|---|---|---|
| `aisessions-annotation-store` | schema v4 表、CRUD RPC、聚合查询、锚点漂移重锚定 | P1 |
| `aisessions-annotation-timeline-ui` | 详情页左 rail、悬浮卡、批注编辑器、跳转高亮 | P1 |
| `aisessions-annotation-ai` | prompt feature、统一 `AnnotationAssist`、后台 worker、draft/采纳/重新生成规则 | P1 |
| `aisessions-annotation-export` | 跨会话批注 Block、Obsidian 渲染器、异步导出队列 | P2 |

### 明确不做

- 自动触发（turn 闭合 / 空闲 / 扫描）—— M3，只在本任务留配置占位，不实现
- 批量 AI 生成、多选会话操作 —— 等 `10-24-list-multiselect-batch-actions` 落地后再接
- 字符区间级批注 —— `10-19-aisessions-annotate`，不在本任务
- 修改 pi / claude / codex / opencode 写入的会话 JSONL —— 永远不做
- 批注的分享、同步、远端协作
- 实时流式消息加批注（内容在变，锚点 hash 会失效）

---

## 全局约束（所有子任务必须遵守）

1. **不修改任何 provider 写入的会话 JSONL。** 批注全部持久化在 Snorkeling 侧 SQLite。
2. **锚点只用 `Message.ItemKey`。** 不用 seq 做主键（subagent 折叠会改变 seq 的展示顺序），seq 只作漂移兜底。
3. **用户数据优先是不可变量**：`source=user` 或 `user_edited=1` 的条目，任何 AI 通道都不得修改或删除。这条写进 spec 契约并由单测锁定。
4. **AI 调用永不在请求路径上。** 一律入后台队列串行 drain，入队 O(1)，仿 `titleautogen.go` 的 `enqueueAutoTitles`。
5. **AI 未配置时功能降级而不是报错**：✨ 按钮置灰 + tooltip 指向设置页。
6. **异步任务不得阻塞主界面**：导出/AI 走 worker 或 goroutine，主界面只订阅进度事件。
7. 子任务之间按**文件域**隔离；`annotation-ai` 依赖 `annotation-store` 的表与 RPC，`annotation-export` 依赖前两者的落库结果。
8. 前端口径遵循 `.trellis/spec/snorkeling-docs/frontend/`（hooks / state / component / type-safety）。

## 依赖图

```
annotation-store ──┬──> annotation-timeline-ui ──> annotation-ai
                   └──> annotation-export
（export 只依赖 store；UI 与 export 可并行，AI 必须等 store）
```

---

## 验收标准（父任务层）

- [ ] 任意消息可手动加批注（标题/正文/标签/类型），保存后 rail 出现刻度
- [ ] 点击 rail 刻度跳转到对应消息并高亮，虚拟滚动下准确
- [ ] 关闭详情页再打开，批注按原节点重新显示
- [ ] 「✨ 生成时间线」给本会话产出多条草稿，rail 显示草稿刻度，过程可取消，不阻塞消息流
- [ ] 草稿可单条采纳 / 丢弃 / 编辑；支持「全部采纳」「全部丢弃」
- [ ] 重新生成只替换可替换条目；手写条目与 `user_edited=1` 条目一条不动（有单测）
- [ ] 批注标题 / 正文 / 标签三处 ✨ 均可用，生成不覆盖其他已填字段，可撤销（会话笔记 ✨ 归属 `10-25-aisessions-ai-gen`，本任务只预留接线位）
- [ ] 锚点漂移时该条标 orphan 并给「重新指定 / 删除」入口，不静默丢失
- [ ] AI 未配置时 ✨ 置灰并给设置入口
- [ ] 批注 Block 列出所有有批注的会话，可预览
- [ ] 选中会话可导出 Obsidian 格式 md，含 frontmatter、callout 批注、批注时间线 wikilink；导出大会话时 UI 不卡

## 决策记录

- 锚点选 `ItemKey` 而非字符区间：节点级是时间线/导出/AI 的共同前提，区间级是增强，两者分层实现。
- AI 结果先落 `draft` 再采纳：避免「生成了一堆结果，切个 tab 全丢」，也让用户对 AI 产物有最终裁决权。
- `user_edited` 独立于 `source`：用户改过一条 AI 批注后，它必须升格为不可覆盖，只靠 `source` 判断会丢数据。
- 自动触发整体推迟：手动触发是当前明确需求，自动触发的幂等/成本边界值得单独一轮设计。
- 导出格式参照 pi-session-library 而非自创：frontmatter + callout 已是 Obsidian 生态可用形态，自创格式等于放弃可移植性。
