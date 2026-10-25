# 执行计划：节点批注时间线 + AI 生成

四个子任务按 `store → (timeline-ui | export) → ai` 顺序推进。每个子任务独立可验证、独立提交。

---

## 子任务 1：`aisessions-annotation-store`

### A1 表与迁移

- [ ] `pkg/aisessions/sqlite_index.go`
  - [ ] 建表列表追加 `ai_session_annotations` + `ai_session_annotation_ai_state`
  - [ ] 追加两个索引
  - [ ] `ensureAnnotationColumns(ctx)`：`pragma_table_info` 守卫，缺失列 ALTER；在 `initSchema` 末尾调用
  - [ ] schema version +1，确认旧库迁移后 `ai_sessions` 行数不变

### A2 纯逻辑（先写，可单测）

- [ ] 新文件 `pkg/aisessions/annotation_rules.go`
  - [ ] `CanReplace(a AnnotationRow) bool` —— 覆盖规则的唯一实现
  - [ ] `AnchorHash(text string) string` —— FNV-1a 64，十进制串
  - [ ] `PickReanchor(anchors []AnchorPoint, want AnchorPoint) (AnchorPoint, bool)` —— seq±3 + role + hash 相似度
- [ ] `annotation_rules_test.go`
  - [ ] 覆盖规则 **8 种组合穷举**（status × source × user_edited）
  - [ ] anchorHash 稳定性（同文本同值、空白归一）
  - [ ] 重锚定：精确命中 / 邻近命中 / 多候选取最相似 / 无候选返回 false

### A3 CRUD 与查询

- [ ] `pkg/aisessions/annotation_store.go`
  - [ ] `ListAnnotations(ctx, sessionKey)`
  - [ ] `UpsertAnnotation(ctx, row)` —— 保存时若 `source='ai'` 则置 `user_edited=1`
  - [ ] `DeleteAnnotation(ctx, id)`
  - [ ] `ReplaceReplaceableAnnotations(ctx, sessionKey, rows)` —— 单事务 delete+insert
  - [ ] `ListAnnotatedSessions(ctx, filter)` —— 单条聚合 SQL，禁止 N+1
- [ ] `annotation_store_test.go`：事务回滚、并发写串行、tag 数组 JSON 往返、空标题允许、超长 body 截断策略

验证：
```
powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; go test ./pkg/aisessions -run Annotation -v"
```

### A4 RPC

- [ ] `pkg/service/aisessionsservice/aisessionsservice.go`
  - [ ] `Annotations` / `AnnotationSave` / `AnnotationDelete` / `AnnotationSessions` + 各自 `_Meta`（注释即前端 JSDoc）
  - [ ] 类型定义加到 `pkg/aisessions/types.go`（`AnnotationView` / `AnnotatedSession`）
- [ ] 跑 tsgen 生成前端类型（按仓库既有命令）
- [ ] `frontend/app/store/services.ts` 确认新方法已生成

**Gate A**：`go build ./...` + `go test ./pkg/aisessions ./pkg/service/aisessionsservice` 全绿；`npx tsc --noEmit` 无新增错误。

---

## 子任务 2：`aisessions-annotation-timeline-ui`

依赖 Gate A。**不得**修改 `pkg/`，只做前端。

### B1 纯逻辑

- [ ] `annotation-model.ts`：`buildRailItems(annotations, seqIndex)`、`clusterRailItems(items, maxSlots)`、`railItemAt(y)`、`sortAnnotations`
- [ ] `annotation-model.test.ts`：只含有批注节点的节点、聚类阈值边界、orphan 排除、多条批注同节点合并
- [ ] `annotation-store.ts`：模块级缓存 + 订阅（仿 `message-queue-store.ts`），**不要塞进 detail 组件 state**

### B2 rail

- [ ] `annotation-rail.tsx`
  - [ ] 折叠 16 / 展开 36，点击空白 toggle，偏好写 localStorage
  - [ ] 复用 `session-outline-rail.tsx` 的 `tickMagnification`（抽成共享导出，不要复制）
  - [ ] 刻度三种态：有已采纳 / 仅草稿 / orphan
  - [ ] 空态与 orphan 提示条
- [ ] `annotation-rail.test.tsx`：折叠切换、点击命中、空态

### B3 悬浮卡

- [ ] `annotation-card.tsx`：节点原文前 120 字 + 全部批注（标题/正文/标签/来源）+ 操作按钮；`max-height: 60vh` 内部滚动
- [ ] 位置：rail 右缘 +8，越界翻转

### B4 编辑器

- [ ] `annotation-editor.tsx`（复用 `Modal`，注意 `10-24-aisessions-note-dialog` 的焦点修复结论：block 内 modal 要阻止事件冒泡到 block frame）
  - [ ] 类型 chips、标题、正文（`wysiwyg-editor.tsx`）、标签 chips（复用 `session-tag-chips.tsx`）
  - [ ] 保存 / 取消 / 删除
- [ ] 消息卡 hover 出 `🏷 N ▾`；右键菜单加「添加备注…」

### B5 跳转与接入

- [ ] `session-detail.tsx`：挂 rail、`scrollToSeq` 走既有 `seqToIndex` + `scrollToIndex`、`flash(seq)` 1200ms
- [ ] 折叠区目标（subagent / details）先展开再跳

验证：`npx vitest run frontend/app/view/aisessions --reporter=dot`

**Gate B**：手工验收 —— 大会话（>2000 消息）rail 滚动不卡、跳转准确、关开详情批注位置不丢。

---

## 子任务 3：`aisessions-annotation-export`（M2）

依赖 Gate A，可与 B 并行（文件域不重叠）。

### C1 渲染器（纯函数）

- [ ] `pkg/aisessions/annotation_export.go`
  - [ ] `RenderAnnotationMarkdown(ctx) string`：frontmatter / 消息流 / `> [!annotation]` callout / 批注时间线 wikilink
  - [ ] `SanitizeSegment`、`BuildExportPath`（Windows 保留名、尾部点空格、长度截断）
- [ ] `annotation_export_test.go`：快照测试、只有 accepted 进导出、跨节点多条批注顺序、空批注会话、超长工具输出截断

### C2 异步队列

- [ ] `pkg/aisessions/annotation_export_jobs.go`：goroutine 池并发 1–2、`bufio.Writer` 流式写、`context` 取消、wps 事件推进度
- [ ] RPC：`AnnotationExport(req) → jobId`、`AnnotationJobCancel(jobId)`
- [ ] `pkg/wps/wpstypes.go` 新增事件常量 + `tsgen/tsgenevent.go` 注册

### C3 前端

- [ ] `frontend/app/view/annotation-block/`
  - [ ] 新 view `aiannotations` + `makeAnnotationsBlockDef()`
  - [ ] 默认 widget id `DefaultAnnotationsWidgetId` + `widgets.json` 默认条目（icon `highlighter`）
  - [ ] 列表：搜索 / 标签筛选 / 行内操作（打开会话 / 预览 / 导出）
  - [ ] 预览抽屉渲染 md
  - [ ] 导出队列面板：状态 / 进度 / 取消 / 完成后打开路径

验证：`npx vitest run frontend/app/view/annotation-block --reporter=dot`

**Gate C**：导出 60MB 会话时 UI 全程可交互；导出的 md 在 Obsidian 里 callout、tag、锚点跳转均正常。

---

## 子任务 4：`aisessions-annotation-ai`

依赖 Gate A + Gate B（需要编辑器与 rail 承载草稿）。

### D1 prompt feature

- [ ] `promptregistry.go` 加 `PromptFeatureSessionAnnotations`，补 `ListPromptFeatures` / `ResolvePrompt` / `PromptEnabled` 分支
- [ ] `aiprompts.json` 段支持 `maxAnnotations` / `maxBodyChars` / `maxTags`，夹取范围与 `ai-prompt-config-contract.md` 一致

### D2 后端生成

- [ ] `pkg/aisessions/annotation_assist.go`
  - [ ] `BuildAnchorDigest(messages, toolCalls) []AnchorPoint` —— 压缩清单，带 `anchorKey`
  - [ ] `ParseAnnotationDrafts(reply, known map[string]bool)` —— JSON 解析 + 非法锚点丢弃 + 计数
  - [ ] 五个 scope 的 prompt 组装
- [ ] `annotation_assist_test.go`：非法 anchorKey 被丢弃、JSON 破损重试一次、超 maxEntries 截断、kind 枚举校验
- [ ] `annotation_assist_queue.go`：per-index-path worker，仿 `autoTitleWorkers`；单条 90s 超时；O(1) 入队
- [ ] RPC `AnnotationAssist` → jobId；结果事件推送

### D3 前端

- [ ] `annotation-assist.ts`：字段级状态机 + `context.Cancel` 贯通
- [ ] `<AIAssistButton>`：**唯一实现**，三处复用（标题 / 正文 / 标签）；会话笔记入口只接线到 `10-25-aisessions-ai-gen`
- [ ] 未配置模型 → 置灰 + 设置入口
- [ ] 「✨ 生成时间线」→ 确认弹层（含保留/清除选项）→ 进度条（rail 顶部，不阻塞）→ 草稿逐条淡入
- [ ] 「全部采纳」「全部丢弃」+ 单条采纳/丢弃/重生成
- [ ] 生成结果的 `AI · 未保存` 角标 + 「撤销 AI 结果」

验证：`npx vitest run frontend/app/view/aisessions --reporter=dot`

**Gate D**：重新生成只替换可替换条目（前端 + 后端各测一次）；`user_edited=1` 条目在极限操作下一条不动。

---

## 集成验收（父任务）

- [ ] PRD 验收清单逐条手工过一遍
- [ ] 大会话（>2000 消息）性能：rail 滚动 / 跳转 / AI 生成都无卡顿
- [ ] 关开详情、重启应用，草稿与已采纳条目都在
- [ ] spec 契约 `aisessions-annotation-contract.md` 已写入 `.trellis/spec/snorkeling-docs/backend/`
- [ ] `detect_changes()` 确认改动范围符合预期

## 回滚点

| 点 | 回滚方式 |
|---|---|
| A 后 | 表是纯增量，回退代码即失效，旧数据留在库里无害 |
| B 后 | rail 与编辑器可整体 `git revert`，不影响既有详情 |
| C 后 | Block 与导出是独立文件域，回退不碰详情 |
| D 后 | AI 只写 `draft`，回退后库里残留草稿，UI 不再显示也无损 |

## 执行纪律

- 一个子任务一个提交，提交信息带子任务名
- 每个 Gate 跑完把结果写进子任务 `implement.md` 勾选状态
- 子代理不得 `git commit`，合并由父会话统一完成
