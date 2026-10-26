# 会话详情虚拟滚动与子代理归位

## Goal

会话详情在 5000+ 条消息时滚动不再卡顿（尤其是向上拉到最开头）；子代理卡片归到发起它的父消息之下，并以低优先级后台分帧加载，全程有加载动画。

## 现场证据（2026-10-21）

- `frontend/app/view/aisessions/session-detail.tsx:1157` 用 `renderItems.map` **全量挂载**所有消息卡片；全仓 `aisessions` 目录搜不到 `useVirtualizer`
- `scrollToVisibleMessage`（L371）注释原话："全量渲染后消息节点应当已在 DOM"
- 本机最大会话：5944 条消息 / 8.2MB 文本（`ai_session_messages` 单会话最大记录）
- `useActiveOutlineSeq`（`session-outline-rail.tsx:407`）依赖 `document.getElementById("aisession-message-<seq>")` —— 虚拟化后不可视节点不存在，必须换算法
- 子代理卡片 `subagent-card.tsx` 展开时 `service.Detail()` **一次性拉整个子会话**，加载态只有一行文本 `加载中…`

## Requirements

### R1 虚拟化时间线（P0）

- 时间线接入 `@tanstack/react-virtual`（已依赖 `^3.13.19`，参考 `frontend/app/treeview/treeview.tsx:580` 的用法）
- 阈值策略：`renderItems.length <= 60` 走原全量渲染（小会话行为完全不变），超过阈值才虚拟化
- 动态高度测量（`measureElement`），不假设固定行高
- 向上滚到最开头、向下滚到底都不掉帧，不出现滚动位置跳动

### R2 依赖滚动位置的既有功能必须等价（P0）

- 搜索命中跳转（`scrollToVisibleMessage`）
- 大纲轨跳转（`jumpToMessage`）与 active 刻度（`useActiveOutlineSeq`）
- 打开会话自动滚到底（`autoScrolledToBottomRef`）
- 「跳到最新」胶囊、底部增量拉取（`handleDetailScroll` 的 nearBottom 判定）
- 消息批注（`aisessions-annotate`）按 seq 定位

### R3 子代理归位（P1）

- 子代理卡片从"时间线同级行"移进**发起它的那条 assistant 消息内部**（消息块末尾的子级缩进区）
- 折叠态仍是一行摘要（agent + task + 状态），不增加父消息高度太多
- 无匹配时降级为普通工具行（保持现状）

### R4 子代理低优先级渐进加载（P1）

- 展开时立即渲染**骨架**（复用 `SessionDetailSkeleton` 的行节奏），不再显示纯文字
- 子会话内容走**分帧加载**（复用 `LoadAll` / `DetailDelta` 契约，单帧 ≤512KB），首帧先出、后续补齐
- **串行队列**：同一时刻只加载 1 个子会话；主时间线滚动、搜索优先
- 折叠/切走立即取消在途请求
- 失败保留已渲染内容 + 重试入口

### R5 加载反馈统一（P2）

- 子代理展开、历史补帧、列表扫描统一用骨架/进度动画
- 任何加载态都不得只显示静态文字

## Non-Goals

- 不改 pi / codex 写入的 JSONL（只读）
- 不改后端 `LoadAll` / `DetailDelta` 的分帧契约（只消费）
- 不重做 toolcall 卡片的视觉设计
- 不动会话列表（列表渐进式加载已完成）

## Constraints

1. 不写、不删、不移动 `~/.pi`、`~/.codex`、`~/.snorkeling/ai-sessions` 下任何用户数据
2. 不引入新的运行时依赖（`@tanstack/react-virtual` 已在依赖里）
3. 小会话（≤60 项）渲染路径保持原样，降低回归面
4. 前端遵循 `.trellis/spec/snorkeling-docs/frontend/`（hooks / state / component / type-safety）
5. 慢校验（全量 `tsc`、全量 vitest）交给 async 子代理，不阻塞主会话

## Acceptance Criteria

- [ ] 打开 5944 条消息的会话，向上滚到最开头全程无卡顿（连续滚动不掉帧）
- [ ] 虚拟化后 DOM 中的消息节点数量与可视区相关（不随总消息数线性增长）
- [ ] 搜索命中跳转、大纲跳转、跳到最新、自动滚到底全部仍可用且定位准确
- [ ] 大纲轨 active 刻度随滚动正确变化（不依赖不可视节点）
- [ ] ≤60 条消息的会话渲染结果与改动前一致
- [ ] 子代理卡片出现在其父消息内部；折叠态一行、展开态显示子会话
- [ ] 展开子代理立即出现骨架，首帧内容随后到达，无"只显示加载中"的状态
- [ ] 子代理展开期间主时间线仍可滚动；折叠后请求被取消
- [ ] `npx vitest run frontend/app/view/aisessions` 全绿
- [ ] 本任务引入的 `tsc` 错误为 0
