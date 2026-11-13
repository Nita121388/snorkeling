# A3 执行计划

> 判据见 `prd.md`，口径见 `design.md`。每步带验证命令；出白名单即停。

## Step 1 后端（Go）

- [x] 1.1 `PersonaSummary` 加 `Provider`/`Model` 字段；`personaSummaries` 填充
- [x] 1.2 `PersonaRoster` RPC（request `{}` / response `{root, personas}`），复用 `loadPersonaRoster`
- [x] 1.3 `derivePersonaProps(rows, root, personas)` 纯函数 + `List`（IncludeProjectPaths 分支）接线
- [x] 1.4 测试：`persona_roster_test.go` 补 3 例（RPC 下发 / 派生命中 / 已有 props 不覆盖 + 段边界）
- [x] 验证：`go test ./pkg/persona/... ./pkg/service/aisessionsservice/...`

## Step 2 前端纯逻辑

- [x] 2.1 `persona-launch.ts`：`PersonaWidgetId`、`AgentPersonaIdMetaKey`、`makePersonaHomeBase`、
      `personaInjectionPrompt`、`buildPersonaLaunchBlockDef`（含 allowlist 注入）
- [x] 2.2 `persona-launch.test.ts`：≥8 例（据点拼装 / meta.persona / cwd / 注入开·关 / allowlist 外跳过 /
      provider 默认取 persona.provider / model 覆盖 / 注入文案含路径）
- [x] 验证：`npx vitest run frontend/app/workspace/persona-launch`

## Step 3 前端 UI

- [x] 3.1 `services.ts` / `gotypes.d.ts`：`PersonaRoster` 前端调用（先跑 `npm run generate` 或手改声明）
- [x] 3.2 `persona-launch-window.tsx` 浮窗（三段式，见 design §4）
- [x] 3.3 `widgets.tsx` 接线：hover 定时器、click 分支、浮窗互斥
- [x] 3.4 `pkg/wconfig/defaultconfig/widgets.json` 加 `defwidget@persona`
- [x] 验证：`npx vitest run frontend/app/view/aisessions` + `npx tsc --noEmit -p tsconfig.json | grep -c "error TS"`（<=47）

## Step 4 收尾（完成；归档待 nita 确认）

- [x] `docs/project/persona-system.md` A3 状态
- [x] spec 补一条（如需）：登场 blockDef 的 meta 契约
- [x] commit（见 git log）
- [x] spec 补两条：`.trellis/spec/guides/day-night-loop-contract.md` L-0006（prove 期望形态 + cmd.exe 方言 + vitest OOM 重试）、`.trellis/spec/snorkeling-docs/frontend/state-management.md`（props.persona 派生边界 + 登场 meta 契约）

## 回滚点

Step 1（后端）与 Step 2/3（前端）可独立 revert；无迁移无数据写。

## touch 白名单（loop 工作项）

`pkg/service/aisessionsservice/**`、`pkg/persona/**`（只读复用，若需导出符号）、`pkg/wconfig/defaultconfig/widgets.json`、
`frontend/app/workspace/persona-launch.ts`、`frontend/app/workspace/persona-launch.test.ts`、
`frontend/app/workspace/persona-launch-window.tsx`、`frontend/app/workspace/widgets.tsx`、
`frontend/app/workspace/agent-launch.ts`、`frontend/app/store/services.ts`、`frontend/types/gotypes.d.ts`、
`docs/project/persona-system.md`、`.trellis/tasks/11-12-persona-widget-launch/**`、`.trellis/spec/**`、`loop/**`
