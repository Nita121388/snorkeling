# AISessions 声明式 provider：agent 会话源可插拔（Antigravity 首个受益者）

## Goal

会话历史扫描支持「配置声明式 provider」：在 waveconfig 声明数据源（类型 + 路径 + 字段映射）即可接入新 agent 的会话列表，不改 Go 代码、不发版。首个受益者 Antigravity，以内置默认声明条目零配置接入。

## 背景（本机实测，2026-11-26）

- 当前 4 个 provider（codex / claude / opencode / pi）全部编译期硬编码在 `pkg/aisessions/paths.go DefaultProviders()`。
- Antigravity CLI 的存储（`~/.gemini/antigravity-cli/`）：
  - `conversation_summaries.db`：纯 SQL 列表（conversation_id / title / preview / step_count / last_modified_time / workspace_uris / status / source / project_id / agent_name / parent_conversation_id / nesting_depth / last_user_input_time …），本机 2 条真实会话。
  - `conversations/<uuid>.db`：每会话一个 SQLite，`steps` 表 `metadata` 列是 **protobuf blob**（无公开 schema）。
- 结论：**列表面可声明式读取（sqlite 类型）；消息体不可声明式解析（protobuf），MVP 不支持消息正文**。

## Requirements

- R1 waveconfig 新增 `agent:sessionproviders` 配置节：map，每项声明 label / type / 数据源 / 字段映射，支持 disable。
- R2 内置声明 backend type：`sqlite`（固定表 + 列映射，不接受任意 SQL）。`jsonl` 类型留作后续扩展，本期不做。
- R3 内置默认条目 `antigravity`：指向 `~/.gemini/antigravity-cli/conversation_summaries.db`，db 存在才注册（与 opencode/pi 同样的 os.Stat 门）。用户配置可覆盖或 disable（合并语义对齐 agentcatalog builtin+config）。
- R4 会话列表字段映射：id / title / updatedAt / createdAt（可缺）/ project（workspace_uris file:// URI 解码）/ parent（parent_conversation_id）。`LoadMessages` 返回空列表：消息体是 protobuf，明确不支持，详情页优雅降级不崩。
- R5 前端来源面收口：来源筛选选项与 source 徽标不再只认硬编码 4 个；声明式 provider 的会话可见、可筛、label 用配置值（不显示裸 id 也无破相）。
- R6 现有 4 个编译期 provider 不动：声明式是增量通道，不是重写。
- R7 遵守 aisessions-scan-contract：新 provider 走 `Manager` 扫描链路，单文件读取有上限，不新增绕过 single-flight 的扫描入口。
- R8 **未知 source 不得产生 codex 恢复命令**（本任务首次让声明式来源进入恢复路径后的回归面）：`restoreCommandForSession()` 目前未知 source 回退 `codex resume <id>`（utils.ts:749 `?? "codex"`），`agentcontrol/restore.go` 已把同一错误标为 known defect。声明式来源的会话必须隐藏「Resume / 复制恢复命令」入口（或给出明确「不支持恢复」占位），不得生成错 agent 命令。

### Out of scope（后续独立任务）

- Antigravity 消息体 protobuf 解码（详情页正文）
- GUI chat 驱动（chat/registry）接入 Antigravity
- 外进程 provider / 第三方插件生态（路线 C）
- `jsonl` 声明类型

## Acceptance Criteria

- [x] 本机 `~/.gemini/antigravity-cli` 存在 → 扫描后 SQLite 索引出现 `source=antigravity` 会话 ≥2 条，title 为真实标题（如 "Index Performance Plan Handoff"），项目归属 `E:\code\snorkeling`。（2026-11-26 实测：DefaultProviders 返回 antigravity，List 2 条真实标题，Manager.ScanListResult 2 行，走既有 single-flight 链路）
- [x] settings.json 写一个自定义 `agent:sessionproviders` 条目（指向测试 fixture db）→ 无需改代码即可在列表出现其会话；`disabled: true` → 条目消失。
- [x] `~/.gemini` 不存在的机器 → 不注册、无扫描错误（os.Stat 门）。
- [ ] 前端：来源筛选面板出现 Antigravity 选项；选中只出 antigravity 会话；来源徽标显示配置 label；打开 antigravity 会话详情不崩，无正文时展示占位/摘要信息。（真机验证待性能充足机器执行；本机已过验证台 --dry + 单测，2026-11-26 用户指示本机不跑）
- [x] `go test ./pkg/aisessions ./pkg/wconfig ./pkg/service/aisessionsservice` 全绿（含新增 provider 单测：列映射 / 时间解析 / URI 解码 / override+disable 合并）。（实测 2026-11-26：3 包 ok；vitest 829/829；tsc 新增 0）
- [ ] 真机验证跑对应 verify area，台账入库一行（`docs/project/verify-ledger.md`）。（**移机待跑**：本机性能不足）

## Notes

- 用户在页面上三选一选了路线 B（配置声明式 provider）；调研后 Antigravity 属 sqlite 类，jsonl 类型顺延。
