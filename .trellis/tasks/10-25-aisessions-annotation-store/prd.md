# 批注存储与 RPC（schema v4 + 覆盖规则）

> 父任务：`10-25-aisessions-annotation-timeline`。技术与阶段拆解见父任务 `design.md` / `implement.md`。

## Goal

提供节点批注的持久化与读写契约，并把「谁能覆盖谁」变成**一处实现 + 全组合单测**。本子任务不碰任何前端文件。

## Requirements

### 表与迁移

- `ai_session_annotations`（字段见父任务 design.md §1），`ensureAnnotationColumns` 做旧库 ALTER。
- `ai_session_annotation_ai_state` 本阶段**只建表、只写不读**，为 M3 自动触发预埋。

### 覆盖规则（本子任务的核心交付物）

```
可替换 := status='draft' OR (source='ai' AND user_edited=0)
永不替换 := source='user' OR user_edited=1
```

- 只允许在 `pkg/aisessions/annotation_rules.go` 的 `CanReplace()` 一处实现，其它地方（RPC、事务、AI 通道）只调用。
- `source='ai' AND user_edited=1`（AI 起草、人改过）必须被保护。只按 `source` 判断是错的。

### 锚点

- 主匹配 `anchor_key` = `Message.ItemKey`。
- 未命中时按 `seq±3` + `role` 相同 + `anchor_hash` 最相近重锚定，成功后回写。
- 仍失败返回 `orphaned=true`，**不删数据**。
- `seq` 永不作为主键或唯一约束的一部分。

### RPC

`Annotations` / `AnnotationSave` / `AnnotationDelete` / `AnnotationSessions`，均带 `_Meta` 与 JSDoc 注释。

- `AnnotationSave` 保存一条 AI 产出的行时置 `user_edited=1`。
- `AnnotationSessions` 一条聚合 SQL 出结果，**禁止 N+1**。
- 列表默认只统计 `status='accepted'`；草稿不进跨会话列表。

## Acceptance Criteria

- [ ] `go test ./pkg/aisessions -run Annotation` 全绿
- [ ] 覆盖规则 8 种组合穷举有测试，`source='ai' && user_edited=1` 明确断言为不可替换
- [ ] `anchorHash` 同文本同值、空串与纯空白归一
- [ ] 重锚定四路径有测试：精确 / 邻近 / 多候选取最相似 / 无候选返回 orphan
- [ ] `ReplaceReplaceableAnnotations` 单事务，中途失败整体回滚
- [ ] 旧库（无新表）迁移后 `ai_sessions` / `ai_session_meta` 行数与内容不变
- [ ] `AnnotationSessions` 在 >1000 批注库上一次查询 <50ms（本地 benchmark 或手工计时）
- [ ] `go build ./...` 干净，`npx tsc --noEmit` 无新增错误
- [ ] 未触碰任何 provider 会话文件

## 明确不做

- 前端任何文件
- AI 调用
- 字符区间级批注（属 `10-19-aisessions-annotate`）
- 自动触发逻辑（M3）
