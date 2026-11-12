# R0 emoji→AgentIcon 更名与术语表（与 10-29 同包）

## Goal

把「emoji 图标」从错误的 `persona` 命名中解放出来，归入 AgentIcon/avatar 词族，**同时**把 Persona 一词还给本功能。必须与 `10-29-agent-avatar-text-badge` 同包完成，避免 `PersonaAvatar` 继续扩散到 9 个显示面。

## Requirements

- `frontend/app/agent-persona/` 目录并入 agent-icon 词族（文件/类型/函数名同步）
- localStorage `snorkeling:agent-personas` → `snorkeling:agent-emojis`，保留**读旧写新**一次性 shim（老用户无感）
- L2 block meta `agent:emoji` **不改**（本就诚实）
- Go `AgentCardResult.Persona` 字段**不删**，移交本功能后续使用（字段注释写明新语义）
- `PersonaAvatar` 结构化联合在 10-29 中同步改名 AgentIcon 系类型
- 术语表 `.trellis/spec/guides/glossary.md`：一个词=一个概念，入表须写「实现本质」；判据：按实现本质命名，不按灵感命名

## Acceptance Criteria

- [ ] `grep -rn "persona" frontend/app/agent-icon/` → 0 命中（目录改名后）
- [ ] `npx vitest run frontend/app/agent-icon`（或等价路径）→ passed
- [ ] `npx tsc --noEmit -p tsconfig.json | grep -c "error TS"` → `<=47`
- [ ] 旧 localStorage key 的图标在新代码下仍可读（shim 单测覆盖）
- [ ] `.trellis/spec/guides/glossary.md` 含 persona / agent-icon / emoji 三条

## 依赖与风险

- **必须与 10-29 同包或先行**；10-29 先合入则改名成本翻倍（其 PRD 正在传播 PersonaAvatar——已实测）
- localStorage key 迁移遗漏 → 用户图标回退品牌 logo（shim + 单测兜底）

## 设计

`design/plans/persona-system.md` §9（含实测证据：176 处/20 文件）
