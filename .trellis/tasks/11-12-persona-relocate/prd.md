> **Confirmed: 2026-11-13 @nita**

# A5.5 位置设置与大文件治理（rootdir + relocate + 轮转）

> 用户 2026-11-13 授权继续开发；真机验证留用户手动 → 设置页三态改为 vitest 组件断言 + 探针。

## Goal

人设家可以搬到大盘；搬家不丢人设、不断 git 历史、不把本机产物同步出去；记忆不会无限膨胀。

## Requirements

- `settings.json: "persona:rootdir"`：app 侧（名册 RPC）与 CLI 都按 `--root > PERSONA_ROOT > settings > 默认` 解析
- `wsh persona relocate <new-root> [--dry-run|--yes] [--exclude a,b] [--copy-not-move]`：
  清单 → 逐目录 move（跨盘 copy+remove）→ 校验文件数/字节数 → 重建名册 → 更新 settings；失败自动回滚
- `wsh persona stats [id] --json`：容量三项（档案 / 归档 / 产物）+ syncable 口径
- journal 按月轮转：`wsh persona journal rotate <id>` + `AppendJournal` 跨月自动轮转 → `MEMORY/archive/YYYY-MM.md`
- 设置面板「🎭 人设」节：根目录输入 + 容量三项 + 迁移按钮（调用 relocate dry-run/apply）+ 治理开关（journal 轮转 / 休眠天数 / 软上限）

## Acceptance Criteria

- [ ] `go test ./pkg/persona/... ./pkg/service/aisessionsservice/...` → `ok`
- [ ] `go build ./cmd/wsh/ && echo BUILD_OK` → `BUILD_OK`
- [ ] `go test ./pkg/persona/ -run TestRelocate -v` → 含 `PASS`
- [ ] `go test ./pkg/persona/ -run TestRotateJournal -v` → 含 `PASS`
- [ ] `npx vitest run frontend/app/view/waveconfig` → `passed`
- [ ] `npx tsc --noEmit -p tsconfig.json | grep -c "error TS" || true` → `<=47`
- [ ] `grep personaRelocateCmd cmd/wsh/cmd/wshcmd-persona.go` → 含 `personaRelocateCmd`
- [ ] `grep persona:rootdir pkg/wconfig/settingsconfig.go` → 含 `persona:rootdir`
- [ ] `grep PersonaSettingsContent frontend/app/view/waveconfig/waveconfig-model.ts` → 含 `PersonaSettingsContent`

## 依赖

A1；A5（settings 根与 sync 共存）；A6（journal 写入器，轮转挂在其写路径）。

## 假设与偏离

1. `PERSONA_ROOT` 存在时不写 settings（沙箱/测试信号），避免 CLI 测试污染真实配置。
2. relocate 的「迁移…」在设置面板里先 dry-run 展示清单，再二次确认 apply。
3. 真机三态断言改为组件单测 + tsc；Electron 手动验证留用户。
