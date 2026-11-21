# AISessions 批注写入口：session annotate

## Goal

批注存储（schema v4）、锚定校验、AI 草稿机制、覆盖更新在后端都已齐，但只在 GUI 里可用。外部 agent（守夜人巡检）读懂会话后，没法把结论写回会话时间线。本次把这一半补上：`session annotate` 写入口，CLI + MCP 双形态，**AI 只写草稿**。

设计全文：`design/plans/session-kernel-design-20261118.md`（第 3 节；原始出处：Hero 据点仓 `nita/hero-feaa3f86` `design/session-kernel-design-20261118.md` @ 274f8e56）

## Requirements

### R1 CLI：`wsh session annotate <id>`

```
wsh session annotate <id> --anchor <itemKey|tail> --kind <note|milestone|decision|question>
    --title <text> --body <text> [--tags t1,t2] [--status draft|accepted]
```

- 默认 `--status draft`；显式要 `accepted` 时必须加 `--force`（机器不冒充人采纳）。
- `--anchor tail`：锚到会话最后一条可锚消息（调用 `BuildAnnotationAnchors` 解析）。
- `--anchor <itemKey>`：锚到指定消息；**幻觉 itemKey 直接报错**，沿用现有哈希校验，不落库。
- 幂等：同 `(session_key, source=ai, kind, anchor_key)` 的机器批注走覆盖更新（`ReplaceReplaceableAnnotations` 语义），不堆积。
- 与卡片写同一纪律：dry-run 默认开，`--yes` 真写；真写要求 `--expected-hash`（从 `session get` 取）。

### R2 RPC + MCP

- service 加 `SessionAnnotate` 方法（薄封装 `Manager.SaveAnnotation`）。
- MCP：`snorkeling_session_annotate`，参数与 CLI 一致；属写类工具，确认语义对齐 `snorkeling_agent_card_set`（dry-run 除非 confirm）。

### R3 溯源字段

写路径必须落 `source`（`ai` / `user`）与 `ai_model`；外部 agent 走本入口一律 `source=ai`。读取侧（GUI 时间线）后续用这个字段区分「机器批注 · 待审」与人写的（由时间线前端任务另行处理，本任务只保证数据正确落库）。

### 约束

- 不改 `ai_session_annotations` 表结构与 `AnnotationSave` 的语义；只做暴露。
- 不动 GUI 的 `AnnotationAssist` 草稿生成引擎。
- 单次 `--body` 截断沿用现有 `clampAnnotationBody` 上限。

## Acceptance Criteria

- [ ] AC1 `--anchor` 为不存在的 itemKey 时命令失败且库中无残留（有测试）
- [ ] AC2 默认写入 `status=draft, source=ai`；`--status accepted` 无 `--force` 时被拒绝
- [ ] AC3 同锚点重复写：第二条覆盖第一条，`updated_at` 变化，总数不增（幂等测试）
- [ ] AC4 `--expected-hash` 不匹配时拒绝写入（与 `agent card set` 同样的乐观锁行为）
- [ ] AC5 MCP 工具默认 dry-run，`confirm: true` 才真写；与 CLI 参数一一对应
- [ ] AC6 GUI 打开会话详情能看到该批注（人工验证一次，draft 状态可见）
- [ ] AC7 现有 `aisessionsservice` 与 annotation 测试全绿

## Notes

- 相关代码：`pkg/aisessions/annotation_store.go`（`SaveAnnotation` / `ReplaceReplaceableAnnotations`）、`pkg/aisessions/annotation_anchor_build.go`（`BuildAnnotationAnchors`）、`pkg/service/aisessionsservice/aisessionsservice.go`（`AnnotationSave` 1928 行附近）、`pkg/agentmcp/tools.go`。
- 与 `11-18-aisessions-turn-reading` 的分工：那边只读，这边只写；互不依赖，可并行。
- 守夜人侧用法（另仓）：巡检判「阶段明显推进」→ 写 milestone 草稿，卡片 note 只留一句话。
