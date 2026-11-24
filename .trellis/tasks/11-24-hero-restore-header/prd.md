# 恢复的 hero 会话块 header 走通用显示逻辑：恢复时补盖章 hero 身份 meta

> loop 包：`N-1124-hero-restore-header`（bug P1，G2 + G7）。
> 拍板：nita 2026-11-24 同意方案 A（恢复时补盖章）；方案 B（显示端反查映射）**不做**。

## Goal

从 AISessions 恢复的会话若属于某个 hero，恢复出的 agent block 必须和「登场块」显示一致：

- Block header 左上图标 = hero emoji（而非 provider logo）
- Block header 标题 / Tab 标题 = hero 名字（而非 `hero-<hash8>` 据点目录名或项目 basename）
- term 块内 cwd 芯片同样吃 `hero:name`（现有 heroHeaderName 路径自动生效）

## 现状与根因（证据锚，改前先核对行号）

| 事实 | 位置 |
|---|---|
| 登场时写 hero 身份：`hero` / `hero:name` / `display:name` / `agent:emoji` | `frontend/app/workspace/hero-launch.ts` `buildHeroLaunchBlockDef`（~L165-183） |
| GUI 恢复构造 meta，**无任何 hero 键** | `frontend/app/view/aisessions/utils.ts` `restoreMetaForSession`（L743）；调用点 `aisessions.tsx` restoreSession、`aisessiondetailmodal.tsx`、`agent.tsx` |
| CLI/MCP 恢复构造 meta（GUI 的后端孪生），**无 hero 键** | `pkg/agentcontrol/restore.go` `BuildResumeBlockMeta`（L194）；golden parity test `restore_test.go` 锁两端同步 |
| 显示端只认 block meta：标题 | `frontend/app/block/block.tsx` L317 `heroHeaderName(agentMeta)` → 空则回退 `basename(cmd:cwd)` |
| 显示端只认 block meta：图标 | `frontend/app/view/term/agent-logo.tsx` `getAgentIcon`（`agent:emoji` / session emoji → provider persona → provider logo） |
| term cwd 芯片 | `frontend/app/view/term/term-model.ts` L377 `heroHeaderName(blockMeta)` |
| 「这是哪个 hero」在恢复时**可知**：读时派生 `props.hero`（段边界匹配 `<heroroot>/<id>`） | `pkg/service/aisessionsservice/aisessionsservice.go` `deriveHeroProps`（~L203）；`AISessionsRestoreContextResponse`（L550）没带出来 |

根因一句话：hero 身份的写入只存在于登场路径；恢复路径构造的 meta 不含 hero 键，而所有显示端的 hero 逻辑都只读 block meta。

## Requirements

- R1 `RestoreContext` 响应（GUI RPC + agentcontrol.RestoreContext）带出 hero 三元组：`hero`（id）/ `heroname` / `heroemoji`。
- R2 hero 解析规则：**显式 `props.hero` 优先**；否则按 projectPath 段边界匹配 hero 据点（复用 `deriveHeroProps` 的规范化规则：`/`/`\` 都认、大小写不敏感、`..` 清洗、段边界防 `backup` 认领 `backup-guard`）。
- R3 恢复 meta 盖章：两条路径（`restoreMetaForSession` + `BuildResumeBlockMeta`）在有 hero 时写与登场**完全一致**的键与条件：
  - `hero` = hero id（恒写，有 hero 时）
  - `hero:name` = 纯名字（无 emoji 前缀；`name` 空则用 id）+ `display:name` 同值
  - `agent:emoji` = hero emoji（仅 emoji 非空时写）
- R4 不改任何显示端代码（block.tsx / agent-logo.tsx / term-model.ts 一行不动）。
- R5 parity：GUI 与后端孪生字段逐一对应，golden fixture 测试更新后必须两端同绿。

## 非目标（不要做）

- **方案 B 不做**：不在前端建 session→hero 运行时映射、不改 `getAgentIcon` 加 hero 反查层。
- 不持久化派生的 `props.hero`（读时派生语义不变；`wsh agent card set --prop hero=` 仍是唯一持久写入口）。
- 不回填已经恢复过的旧块（重新恢复一次即得新 meta）。
- 不动 F-1121-agent-resume 的 CLI/MCP resume 语义（命令面、E_USAGE、tab 目标解析都不动）。

## Acceptance Criteria

- [ ] `powershell -NoProfile -ExecutionPolicy Bypass -Command ". ./scripts/use-local-env.ps1 -Quiet; go test ./pkg/agentcontrol -run TestBuildResumeBlockMetaParity -count=1"` → `ok`
- [ ] `powershell -NoProfile -ExecutionPolicy Bypass -Command ". ./scripts/use-local-env.ps1 -Quiet; go test ./pkg/agentcontrol ./pkg/service/aisessionsservice -count=1"` → `ok`
- [ ] `npx vitest run frontend/app/view/aisessions/utils.test.ts frontend/app/workspace/hero-launch.test.ts --reporter=basic >/dev/null 2>&1 && echo HERO_RESTORE_PASS` → `HERO_RESTORE_PASS`
- [ ] （真机，G7 收尾）恢复一个 hero 会话 → block header 显示 hero emoji + 名字，而非 provider logo + 哈希目录名

## 边界与已知坑

- `pkg/agentcontrol/restore.go` / `restore_test.go` / `aisessionsservice.go` / `gotypes.d.ts` 同时在 F-1121-agent-resume 的 touch 白名单里（该包 g6 expired 阻塞中）。本包只动 `BuildResumeBlockMeta` 及 hero 解析注入，不动 resume 命令语义。
- `hero:name` 必须是**纯名字**（不带 emoji 前缀）——N-1119-hero-header-dup-emoji 已定：emoji 只留在 `agent:emoji`，否则 header 出现两次。
- 老块读取时的剥前缀逻辑（`heroHeaderName`）不动，新写值天然无前缀。
- gotypes.d.ts 是生成物：改 Go 结构体后要跑生成（对齐现有流程），别手改。
