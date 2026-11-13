> **Confirmed: 2026-11-13 @nita**

# A3 widget 🎭 图标 + hover 登场弹窗 + 注入开关

## Goal

右侧 WidgetsBar 出现 🎭 入口：hover（>300ms）/点击弹出「叫人设登场」浮窗，选中人设即以
「cwd=据点 + block meta persona=id + 可选首条提示注入」启动一个 agent block（登场 = agent-launch
管线 + 3 个 meta 差异，设计 §5/§5.5），并补上 A1.5 遗留的「登场即归属」（会话行派生 props.persona）。

## Requirements

- WidgetsBar 新增 `defwidget@persona`（🎭 masks-theater 图标）；hover >300ms 弹浮窗；点击同一浮窗
  （名册 Block 是 A4，本包不建——点击行为待 A4 改回）
- 浮窗三段：① 选 Agent（provider 芯片 + 模型输入，默认取 persona.json）② 选人设（emoji+名字+职责，
  「＋新建人设」置灰留 A2）③ 注入开关 `☐ 注入本次主工作目录 <path>`
- 登场语义：`cmd:cwd` = `<personaroot>/<id>`；block meta `persona` = id；provider/model 临时覆盖不回写；
  勾选注入时首条提示前置 `[登场上下文] 本次主工作目录: <path>`
- 新 RPC `aisessions.GetPersonaRoster`（root + 名册，含 provider/model），浮窗打开时拉取
- A1.5 AC3 补带：会话 projectPath 落在 `<personaroot>/<id>` 下且自身无 `props.persona` 时，
  List 行数据补带派生 persona 属性（`source=persona-derived`，只读补带不写库，已有值永不覆盖）

## Acceptance Criteria

- [ ] `go test ./pkg/persona/... ./pkg/service/aisessionsservice/...` → `ok`
- [ ] `go build ./cmd/wsh/ && echo BUILD_OK` → `BUILD_OK`
- [ ] `go test ./pkg/service/aisessionsservice/ -run TestDerivePersonaProps -v` → 含 `PASS`
- [ ] `npx vitest run frontend/app/workspace/persona-launch` → `passed`（≥8 例）
- [ ] `npx vitest run frontend/app/view/aisessions` → `passed`（A1.5 无回归）
- [ ] `npx tsc --noEmit -p tsconfig.json | grep -c "error TS" || true` → `<=47`
- [ ] `node -e "const w=require('./pkg/wconfig/defaultconfig/widgets.json');process.exit(w['defwidget@persona']?.icon==='masks-theater'?0:1)" && echo PERSONA_WIDGET_OK` → `PERSONA_WIDGET_OK`
- [ ] `grep -c "AgentPersonaIdMetaKey" frontend/app/workspace/persona-launch.ts` → `>=1`

## 依赖

A1（pkg/persona + wsh persona CLI）、A1.5（AISessions persona 维度）均已完成。

## 假设与偏离（自主决策）

1. 点击 = 打开登场浮窗（设计原文「点击 → 名册 Block」，A4 未实现，先同名册入口合并）
2. TUI 注入用 `cmd:args` 追加位置参数，仅对 pi/codex/claude/gemini（CLI 把位置参数当首轮 prompt）；
   其余 provider 跳过注入但 meta 仍写 `persona:injectworkdir`
3. props.persona 派生在服务端 List 完成（视图层补带，不写库，不覆盖显式值）
4. A3 v1 不做 cc-switch vendor 芯片与 GUI 对话模式登场
5. rootdir 走 `persona.ResolveRoot("")`（设置面板是 A5.5）
