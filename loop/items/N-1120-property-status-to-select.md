---
id: N-1120-property-status-to-select
title: "属性 status 类型彻底退役（数据迁移 status→select + 改类型浮层修复）"
type: bug
priority: P1
severity: S2
status: open
origin: self
source: "nita 2026-11-20 布置：彻底剥离历史 status 属性类型改为单选；修 agent card 改类型一点击就关闭"
task: .trellis/tasks/11-20-property-status-to-select
order: 110
touch: [pkg/aisessions/propertygenerate.go, pkg/aisessions/manager.go, pkg/aisessions/sqlite_index.go, pkg/aisessions/propertygenerate_test.go, pkg/aisessions/manager_test.go, pkg/aisessions/sqlite_index_test.go, pkg/agentdata/patch.go, pkg/agentdata/patch_test.go, pkg/wconfig/settingsconfig.go, pkg/wconfig/settingsconfig_test.go, cmd/server/main-server.go, schema/settings.json, frontend/types/gotypes.d.ts, frontend/app/view/aisessions/property/property-model.ts, frontend/app/view/aisessions/property/property-list.tsx, frontend/app/view/aisessions/property/property-list.scss, frontend/app/view/aisessions/property/property-model.test.ts, frontend/app/view/aisessions/property/property-list.dom.test.tsx, frontend/app/element/property-editor/tag-editor.tsx, frontend/app/element/property-editor/tag-editor.dom.test.tsx, frontend/app/session-overview/overview-board-props.test.ts, frontend/i18n/locales/zh/aisessions.json, frontend/i18n/locales/en/aisessions.json, scripts/verify/property-editor/verify.mjs, docs/project/verify-ledger.md, loop/**]
rollback: null
budget: {minutes: 240, retries: 2}
releaseCandidate: false
createdAt: "2026-11-20T02:20:11Z"
---

# 属性 status 类型彻底退役（数据迁移 status→select + 改类型浮层修复）

## 背景

status 类型只做过前端读时归一（44046ab9f），后端白名单/校验/jsonschema、存量 sqlite prop_type 与
settings agent:propertyschema 仍保留 status；改类型控件是原生 `<select onBlur=卸载>`，Windows/Electron
下原生下拉抢焦点触发 blur，点击即关闭。红证：`loop/red/N-1120-property-status-to-select.txt`。

## 来源

- self：nita 2026-11-20 布置：彻底剥离历史 status 属性类型改为单选；修 agent card 改类型一点击就关闭

## 验收判据

- [ ] `go build ./...` → `exit 0`
- [ ] `go test ./pkg/aisessions ./pkg/agentdata ./pkg/agentcontrol ./pkg/wconfig -count=1` → `ok`
- [ ] `npx vitest run frontend/app/view/aisessions/property/ frontend/app/element/info-card/ frontend/app/element/property-editor/` → `0 failed`
- [ ] R7 误关闭回归：`npx vitest run frontend/app/element/property-editor/tag-editor.dom.test.tsx` → 0 failed（点浮层空白不关 / focusout 不关 / Esc 仍关）
- [ ] `node scripts/i18n/check-parity.mjs` → `exit 0`（注：`npm run i18n:check` 的全仓 CJK scan 有 5 条
  allowlist 外既有红：`frontend/app/view/term/agent-emoji-picker.tsx:229`、`emain/emain-wavesrv.ts:100-103`，
  均非本包文件，本包不负责；parity 才是本包改动的门）
- [ ] `node scripts/verify/property-editor/verify.mjs` → `exit 0`
- [ ] `grep -c status pkg/aisessions/propertygenerate.go 白名单/ValidatePropertyValue 段落` → `0（仅注释与 NormalizePropertyType 字面量）`
- [ ] `sqlite: SELECT count(*) FROM ai_session_props WHERE prop_type=status` → `0`

## 记录

- 修后绿证（2026-11-20）：`go test -p 1 ./pkg/aisessions ./pkg/agentdata ./pkg/agentcontrol ./pkg/wconfig -count=1` 全 ok；
  vitest 154/154（含新增归一/迁移/浮层/误关闭 13 条）；eslint 0 error；tsc 白名单 0 新增；i18n parity exit 0。
- 真机验证台 skipped：用户明确本机性能不够，不启动真机；verify.mjs 已备「修改类型」浮层 case + R7 回归。
- 数据迁移抽样：live sqlite 已迁移（status 行 0、哨兵 1、备份 3.05GB）；settings 副本迁移逐字段验证通过；
  live settings 将在用户重启新构建时自动改写。
- 判据「npm run i18n:check」改记 parity：全仓 CJK scan 有 5 条 allowlist 外既有红（非本包文件）。
