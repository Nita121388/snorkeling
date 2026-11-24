---
id: N-1124-hero-restore-header
title: "恢复的 hero 会话块 header 走通用显示逻辑：恢复时补盖章 hero 身份 meta"
type: bug
priority: P1
severity: S2
status: open
origin: self
source: "nita 2026-11-24 报告：从 aisessions 恢复的会话虽是 hero 来的，agent block header 不是 hero 的显示逻辑（provider logo + 哈希目录名，而非 hero emoji + 名字）"
task: 11-24-hero-restore-header
order: 100
touch: [pkg/hero/match.go, pkg/hero/match_test.go, pkg/agentcontrol/hero_resolve.go, pkg/agentcontrol/hero_resolve_test.go, pkg/agentcontrol/restore.go, pkg/agentcontrol/restore_test.go, pkg/service/aisessionsservice/aisessionsservice.go, pkg/service/aisessionsservice/aisessionsservice_test.go, pkg/service/aisessionsservice/persona_roster_test.go, frontend/types/gotypes.d.ts, frontend/app/view/aisessions/utils.ts, frontend/app/view/aisessions/utils.test.ts, frontend/app/workspace/hero-launch.ts, frontend/app/workspace/hero-launch.test.ts, docs/project/hero-system.md, docs/project/verify-ledger.md, .trellis/tasks/11-24-hero-restore-header/**, loop/**]
rollback: null
budget: {minutes: 120, retries: 2}
releaseCandidate: false
createdAt: "2026-11-24T07:42:25Z"
---

# 恢复的 hero 会话块 header 走通用显示逻辑：恢复时补盖章 hero 身份 meta

## 背景

Hero 身份只在登场时写 block meta（`buildHeroLaunchBlockDef`：`hero` / `hero:name` / `display:name` / `agent:emoji`）；从 AISessions 恢复走的是另一条 meta 构造路径 —— GUI `restoreMetaForSession`（`frontend/app/view/aisessions/utils.ts` L743，调用点 aisessions.tsx / aisessiondetailmodal.tsx / agent.tsx）与 CLI/MCP `BuildResumeBlockMeta`（`pkg/agentcontrol/restore.go` L194，golden parity test 锁两端），**两条都不写 hero 键**。显示端只认 block meta（`block.tsx` L317 `heroHeaderName`、`agent-logo.tsx` `getAgentIcon`、`term-model.ts` L377），于是恢复块回退通用逻辑：provider logo + `basename(cmd:cwd)`（hero 会话就是 `hero-<hash8>`）。

「这是哪个 hero」在恢复时是可知的：会话行有读时派生的 `props.hero`（`deriveHeroProps` 段边界匹配 `<heroroot>/<id>`），只是 `RestoreContext` 响应没带出来。

**方案 A（已拍板）**：恢复时补盖章 hero 身份 meta（后端解析 + 前后端孪生同步）；**方案 B（显示端 session→hero 反查映射）不做**。旧块不回填（重新恢复一次即得）。

径路（夜班照图施工）：
- 需求/非目标/判据：`.trellis/tasks/11-24-hero-restore-header/prd.md`
- 契约/解析规则/挂载点：`.trellis/tasks/11-24-hero-restore-header/design.md`
- 执行顺序/红绿证命令/验收步骤：`.trellis/tasks/11-24-hero-restore-header/implement.md`

## 来源

- self：nita 2026-11-24 报告：从 aisessions 恢复的会话虽是 hero 来的，agent block header 不是 hero 的显示逻辑（provider logo + 哈希目录名，而非 hero emoji + 名字）

## 验收判据

- [ ] `powershell -NoProfile -ExecutionPolicy Bypass -Command ". ./scripts/use-local-env.ps1 -Quiet; go test ./pkg/agentcontrol -run TestBuildResumeBlockMetaParity -count=1"` → `ok`
- [ ] `powershell -NoProfile -ExecutionPolicy Bypass -Command ". ./scripts/use-local-env.ps1 -Quiet; go test ./pkg/agentcontrol ./pkg/service/aisessionsservice -count=1"` → `ok`
- [ ] `npx vitest run frontend/app/view/aisessions/utils.test.ts frontend/app/workspace/hero-launch.test.ts --reporter=basic >/dev/null 2>&1 && echo HERO_RESTORE_PASS` → `HERO_RESTORE_PASS`

## 记录

- 2026-11-24 建包。nita 报告：恢复的 hero 会话 header 不是 hero 显示逻辑；当晚拍板方案 A（恢复时补盖章），方案 B 不做。
- 路径锚（改前核对行号）：`hero-launch.ts` `buildHeroLaunchBlockDef` ~L165-183 · `utils.ts` `restoreMetaForSession` L743 · `pkg/agentcontrol/restore.go` `BuildResumeBlockMeta` L194 / `ResolveVendorRestoreContext` L103 · `aisessionsservice.go` `AISessionsRestoreContextResponse` L550 / `deriveHeroProps` ~L203 · `block.tsx` L317 · `term-model.ts` L377 · `agent-logo.tsx` `getAgentIcon`。
- 边界：`restore.go` / `restore_test.go` / `aisessionsservice.go` / `gotypes.d.ts` 同时在 F-1121-agent-resume 的 touch 白名单（该包 g6 expired 阻塞）。本包只动 hero 三字段与 meta 盖章，不动 resume 命令语义 / E_USAGE / tab 目标解析。
- 硬约束：`hero:name` 只写纯名字（N-1119 已定，emoji 只留 `agent:emoji`）；零 hero 场景 meta 必须与现状字节级一致；`gotypes.d.ts` 用 `node scripts/run-task.mjs generate` 生成，不手改；parity 两端必须同一提交改完。
- 待补：红证 `loop/red/N-1124-hero-restore-header.txt`、绿证数字、影响面、G7 真机结论。
