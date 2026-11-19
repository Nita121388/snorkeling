# A4 执行计划

- [x] 1.1 后端 `PersonaOverview` RPC（persona/charter/storage/pending/lastJournalLine）
- [x] 2.1 `frontend/app/view/persona/persona.tsx`：PersonaViewModel + 列表/详情双栏
- [x] 2.2 注册 view 类型 `persona`
- [x] 2.3 「叫TA登场」复用 buildPersonaLaunchBlockDef
- [x] 2.4 widgets.tsx：🎭 点击打开 persona:// block（hover 仍是登场浮窗）
- [x] 2.5 纯逻辑抽离 + 单测（字节格式化、行派生、空态、待批准计数）
- [x] 3 收尾：docs §13、commit、loop verify/accept

## touch 白名单
`pkg/service/aisessionsservice/**`、`frontend/app/view/persona/**`、`frontend/app/workspace/widgets.tsx`、
`frontend/app/workspace/persona-launch.ts`、`frontend/app/store/services.ts`、`frontend/types/gotypes.d.ts`、
`docs/project/persona-system.md`、`.trellis/tasks/11-12-persona-roster-block/**`、`.trellis/spec/**`、`loop/**`
