# AI 会话批注契约（节点级）

> 节点批注的存储、覆盖规则、锚点漂移与 RPC 契约。
> 实现：`pkg/aisessions/{annotation_rules,annotation_store}.go`、`pkg/service/aisessionsservice`。
> 范围：节点级（`Message.ItemKey`）批注；字符区间级批注属 `10-19-aisessions-annotate`，两者独立。

---

## 1. 存储（SQLite schema v4）

两张新表，`CREATE TABLE IF NOT EXISTS` 覆盖新旧库；`ensureAnnotationColumns` 只做后续列增量的守卫。

```sql
ai_session_annotations(
  id INTEGER PK AUTOINCREMENT,
  session_key, anchor_key,            -- anchor_key = Message.ItemKey
  seq,                                -- 漂移兜底 + 排序，永不作为主键
  kind, title, body, tags_json,
  status,        -- draft | accepted
  source,        -- user | ai
  user_edited,   -- 0/1
  ai_model, anchor_hash, anchor_preview,
  created_at, updated_at
)
ai_session_annotation_ai_state(session_key PK, ...)  -- M3 预埋，只写不读
```

- 索引：`(session_key, seq)`、`(session_key, anchor_key, id)`。
- 只写 Snorkeling 的 SQLite；**永不修改 provider 写入的会话 JSONL**。

## 2. 覆盖规则（唯一实现）

`annotation_rules.go` `CanReplace(AnnotationRow)`：

```
可替换 := status='draft' OR (source='ai' AND user_edited=0)
永不替换 := source='user' OR user_edited=1
```

- 任何会覆盖批注的通道（RPC / 重新生成 / 事务）只能调用 `CanReplace`，不得自行推导。
- 关键用例：`source='ai' AND user_edited=1`（AI 起草、人改过）必须受保护。
- `annotation_rules_test.go` 穷举 status × source × user_edited 8 种组合。
- `UpsertAnnotation` 更新一条 `source='ai'` 行时自动置 `user_edited=1`。

## 3. 锚点与漂移

- 主匹配：`anchor_key`（`Message.ItemKey`）。
- 未命中：`PickReanchor` 在 `seq±3`、`role` 相同内找候选；`anchor_hash` 精确匹配优先，否则取最近 seq。
- 重锚定成功回写 `anchor_key/seq/anchor_hash`；仍失败返回 `orphaned=true`，**不删数据**。
- `AnchorHash` = 节点文本（空白归一）的 FNV-1a 64 位十进制串；空文本为 `"0"`。
- 前端未提供 anchors（会话未加载）时**不得**把全部批注标 orphan。

## 4. RPC

| RPC | 说明 |
|---|---|
| `Annotations({sessionKey, connection?, anchors?})` | 列出批注；带 anchors 时做重锚定/orphan 标记 |
| `AnnotationSave({id?, sessionKey, anchorKey, seq?, kind?, title, body, tags?, status?, source?})` | 创建/更新；更新 AI 行置 `user_edited=1`；返回 `AnnotationView` |
| `AnnotationDelete(id)` | 永久删除 |
| `AnnotationSessions({query?, tagFilters?, projectPrefixes?, limit?, offset?})` | 跨会话列表，**只统计 accepted**，单条聚合 SQL，无 N+1 |

`AnnotationView` / `AnnotatedSession` 定义在 `pkg/aisessions/types.go`。

## 5. 不变量

- `seq` 不作为主键或唯一约束的一部分。
- 批注写入不得触碰 `ai_session_meta` / `ai_sessions` 的既有字段。
- 跨会话列表排除 `missing` 会话与草稿。
- 连接池 `SetMaxOpenConns(1)`：事务内**禁止**再用 `idx.db` 查询（会死锁），必须走 tx。

## 6. 检查清单

- [ ] `go test ./pkg/aisessions -run Annotation`
- [ ] 覆盖规则 8 组合断言存在且 `source='ai' && user_edited=1` 不可替换
- [ ] `ReplaceReplaceableAnnotations` 单事务，受保护行不被删除
- [ ] `AnnotationSessions` 只返回 accepted 且带 tag 过滤
- [ ] `go generate` 后前端 `services.ts` / `gotypes.d.ts` 含新方法
## 7. AI 异步 job（2026-10-26）

- `AnnotationAssist` 只入队并返回 `jobId`；模型调用在**有界 pool**（并发 3）执行，
  单条 90s 超时，`AnnotationAssistCancel(jobId)` 取消。
- 状态经 `aisessions:annotationassist` 事件推送：
  `{jobId, key, connection, scope, state(queued|running|done|failed|cancelled), drafts, aiModel, error}`。
- 结果只回给前端作为草稿；**不写库**。写库仍走 `AnnotationReplace`（单事务、保护用户数据）。
- 批量采纳/丢弃：`AnnotationBulkDrafts` 只触碰 `status='draft'` 的行。
- 前端 `requestAnnotationDrafts` 用事件解析 Promise；重复点击运行中的 ✨ 会取消该会话的在途 job。

