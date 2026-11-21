# 技术设计：批注写入口 `session annotate`

设计出处：`design/plans/session-kernel-design-20261118.md` §3（拍板 §8 Q2：读入口验收后第二批）。
PRD：本目录 `prd.md`。前置：`11-18-aisessions-turn-reading`（已归档，`4c1bba418`）。

## 1 边界

- **只暴露写入口**。不改 `ai_session_annotations` 表结构、不改 `AnnotationSave` / `AnnotationReplace` 语义、不动 `AnnotationAssist` 草稿引擎。
- 只写 Snorkeling 自己的 SQLite；**永不改 provider 的会话 JSONL**。
- 前端不动（GUI 时间线如何区分「机器批注 · 待审」属前端任务）。
- 单条写，不做批量。

## 2 现状锚点（真实代码）

| 锚点 | 事实 |
|---|---|
| `pkg/aisessions/annotation_store.go:213` | `UpsertAnnotation`：`ID>0` 走更新、否则插入；**更新 `source='ai'` 行会把 `user_edited` 置 1** |
| `annotation_store.go:336` | `ReplaceReplaceableAnnotations`：**删除该会话所有 `CanReplace` 的批注**再插新——单条写不能用它 |
| `annotation_store.go:85` | `clampAnnotationBody` 上限 `AnnotationBodyMaxChars=20000`；`annotationNodeText` 上限 8000 |
| `annotation_rules.go` `CanReplace` | 冻结规则：可替换 = `draft` 或（`ai` 且 `user_edited=0`）；`source=user` / `user_edited=1` 永不替换 |
| `annotation_store.go:58-82` | `normalizeAnnotationKind`（缺省 note）、`normalizeAnnotationStatus`（**缺省 accepted**）、`normalizeAnnotationSource`（**缺省 user**） |
| `pkg/service/aisessionsservice/aisessionsservice.go:1908` | `AnnotationSave`：锚点 seq 缺失时用 `resolveAnnotationAnchorRow`（走 `BuildAnnotationAnchors`）补 |
| `aisessionsservice.go:1968` | `resolveAnnotationAnchorRow`：`loadDetailForAnnotations` → 逐锚点匹配 key |
| `pkg/aisessions/annotation_anchor_build.go:29` | `BuildAnnotationAnchors`：`anchorKey=Message.ItemKey`，带 `seq`/`role`/`hash`；工具行为 `role=tool` |
| `pkg/agentcontrol/card.go:65` | `agentdata.HashSession(summary)` = 卡片 hash，`session get` / `agent card get` 的 `card.hash` 就是它（乐观锁同源） |
| `pkg/agentmcp/tools.go` | 写类工具范式：`snorkeling_agent_card_set`（dry-run 默认、`confirm:true` 才写） |

## 3 RPC 契约

```
SessionAnnotateRequest {
  id            // 会话 identifier（key / 短 id / this）
  anchor        // "tail" 或 message itemKey
  kind          // note | milestone | decision | question（缺省 note）
  title, body
  tags          []
  status        // 缺省 draft；accepted 需 force
  force         // 允许 accepted / 允许覆盖「人已改过」前的显式确认（见 §5）
  expectedHash  // 真写必填：card.hash（agentdata.HashSession）
  dryRun        // 缺省 true
  connection, origin
  aiModel       // 可选，落 ai_model
}
SessionAnnotateResult {
  dryRun, written, created            // created=false 表示覆盖了同锚点机器批注
  row { id, anchorKey, seq, kind, title, body, tags, status, source, aiModel, anchorHash, updatedAt }
  preview { anchorPreview, anchorRole, replacedId, replacedUpdatedAt }
  error { code, message, hint }       // E_USAGE / E_NOT_FOUND / E_CONFLICT
}
```

## 4 覆盖语义（**核心取舍**）

PRD 写「走 `ReplaceReplaceableAnnotations` 语义」。实测该函数会删**该会话全部**可替换 AI 批注，单条写入会误伤其它 AI 草稿；而 `UpsertAnnotation` 的更新路径会把 `user_edited` 置 1，导致「第二次机器写入」把自己永久锁死。

**采用**：新增 `SQLiteIndex.UpsertMachineAnnotation(ctx, row)`（单事务）：

1. 查同 `(session_key, kind, anchor_key)` 且 `source='ai'` 的行；
2. 命中且 `CanReplace(旧行)` → 删除旧行 + 插入新行（`status=draft, source=ai, user_edited=0`），返回 `created=false, replacedId=旧id`；
3. 命中但 `!CanReplace`（人改过 / source=user）→ **不写，返回 `E_CONFLICT`**，带 `hint`（「人已改过这条批注，需人工处理」）；`--force` 也不覆盖（R10 同理，宁可失败）；
4. 未命中 → 插入，返回 `created=true`。

- 语义等价于「同锚点机器批注覆盖更新、总数不增」，且不触碰其它批注（AC3）。
- 覆盖前必须调 `CanReplace`，不自创规则（annotation contract §2 冻结）。
- 事务内只用 `tx` 查询（连接池 `SetMaxOpenConns(1)`，用 `idx.db` 会死锁）。

## 5 锚点与校验

- `anchor == "tail"`：`loadDetailForAnnotations` → `BuildAnnotationAnchors` 取最后一个锚点。
- `anchor == <itemKey>`：**必须命中** `BuildAnnotationAnchors`，否则 `E_NOT_FOUND`（幻觉 key 不落库，AC1）；命中时同时取 `seq/role/hash/原文截断`写入。
- `anchor_preview`：`AnnotationAnchorTextByKey` 的文本，截 200 rune。

## 6 门禁与纪律

| 规则 | 实现 |
|---|---|
| 默认 dry-run | `dryRun` 缺省 true；`--json` 返回将要写入的行与 diff（`created`/`replacedId`） |
| 真写需 hash | `--yes` 且 `expectedHash` 非空；与 `agentdata.HashSession(session.Summary)` 比较，不符 → `E_CONFLICT` |
| 机器不冒充人 | `source` 恒 `ai`（不接受外部指定）；`status` 缺省 `draft`；`accepted` 需 `force` |
| body 上限 | 复用 `clampAnnotationBody`（20000 rune），不新增上限 |
| 单轮写 ≤10 | CLI/MCP 不设全局配额，由 Hero 侧 R9 保证；本入口文档注明 |

## 7 CLI + MCP

- `wsh session annotate <id> --anchor <tail|itemKey> --kind ... --title ... --body ... [--tags a,b] [--status draft|accepted] [--force] [--dry-run] [--yes --expected-hash <card.hash>] [--json]`
  - 人类可读：`would write` / `wrote` + 锚点预览 + replaced 信息。
- MCP `snorkeling_session_annotate`：`ScopeObserve` 之外用写类权限（对齐 `snorkeling_agent_card_set`），`confirm:false` 默认 dry-run、`confirm:true` 才写，`expectedhash` 必填。
- 参数校验错误统一带 `E_USAGE` / 提示语。

## 8 性能

- 锚点校验要 `loadDetailForAnnotations`（全量读一次，与现有 `AnnotationSave` 补 seq 同源成本）；**禁止**在循环里逐条调用本入口。
- dry-run 不写库、不开事务；真写只碰一行（delete+insert 或纯 insert）。
- 大会话（>1200 条消息）仍只读一次 detail；Hero 侧每轮 ≤10 且只对「阶段明显推进」的会话写。

## 9 风险与回滚

| 风险 | 缓解 |
|---|---|
| 误覆盖人写的批注 | `CanReplace` 硬门禁 + 冲突时 `E_CONFLICT`，永不静默覆盖 |
| 幻觉 anchorKey 落库 | 未命中锚点直接 `E_NOT_FOUND`，测试覆盖 |
| 乐观锁形同虚设 | `expectedHash` 必填且与 `HashSession` 严格比较；dry-run 与真写走同一校验 |
| 新写路径绕过契约 | 只新增 `UpsertMachineAnnotation`，内部调用 `CanReplace`；不动 `AnnotationSave` / `ReplaceReplaceableAnnotations` |

回滚：删 `UpsertMachineAnnotation` + 命令注册 + MCP 条目即可，数据无迁移。

## 10 不做（显式出界）

- 批量生成 / AI 草稿引擎（`AnnotationAssist`）。
- 前端时间线区分 `source=ai` 的视觉（另包）。
- 卡片 note/tags 写入（`agent card set` 已有）。
- `annotate` 的删除/采纳（`AnnotationDelete` / `AnnotationBulkDrafts` 已有）。
