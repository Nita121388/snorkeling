# A5.5 执行计划

- [x] 1.1 `settingsconfig.go`：`persona:rootdir` + journalrotate/dormantdays/softlimitmb/softlimitaction
- [x] 1.2 `pkg/persona/relocate.go`：PlanRelocate / Relocate（copy 回退 + 校验 + 回滚）/ StorageOf / RotateJournal
- [x] 1.3 `AppendJournal` 跨月自动轮转
- [x] 1.4 CLI：root 优先级（settings）、relocate / stats / journal rotate、settings 合并写
- [x] 1.5 app 侧名册根解析读 settings
- [x] 1.6 测试：relocate dry-run 零写 / move+校验+名册 / 注入失败回滚 / 三桶容量 / 轮转与自动轮转
- [x] 2.1 设置面板 `personasettings.tsx` + 注册到 waveconfig-model
- [x] 2.2 面板组件单测（根目录 draft、三桶展示、迁移 dry-run 清单、治理开关）
- [x] 3 收尾：docs §12、commit、loop verify/accept

## touch 白名单
`pkg/persona/**`、`pkg/wconfig/**`、`pkg/service/aisessionsservice/**`、`cmd/wsh/cmd/wshcmd-persona.go`、
`frontend/app/view/waveconfig/**`、`frontend/types/gotypes.d.ts`、`docs/project/persona-system.md`、
`.trellis/tasks/11-12-persona-relocate/**`、`.trellis/spec/**`、`loop/**`
