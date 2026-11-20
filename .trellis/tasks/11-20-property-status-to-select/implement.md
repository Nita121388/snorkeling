# 实施清单 — status→select 彻底退役 + 改类型浮层

> 顺序即依赖序；每步末尾的命令是该步的"绿证"。全部走 `powershell -NoProfile -ExecutionPolicy Bypass -Command ". .\scripts\use-local-env.ps1 -Quiet; <cmd>"`。

## P1 后端词表与归一（Go）

- [ ] 1. `pkg/aisessions/propertygenerate.go`：新增 `NormalizePropertyType`；白名单删 status；`ValidatePropertyValue` case 收口；`parsePropertySuggestions` 归一后再校验
- [ ] 2. `pkg/aisessions/manager.go`：`ApplyAIProperties` + `SetProps` 归一（`SetProps` 归一循环加 `cell.Type = NormalizePropertyType(cell.Type)`）
- [ ] 3. `pkg/agentdata/patch.go`：`normalizeLegacyPropTypes` + `ApplyPatch` 调用；`validAddOptionPropertyType` 删 status；错误文案改 "expected select or multi_select"；`PropPatch.AddOptions` 注释清理
- [ ] 4. 单测：
  - `propertygenerate_test.go`：`TestNormalizePropertyTypeLegacy`
  - `patch_test.go`：status 补丁归一落库（复用既有 seed helper 风格）
- [ ] 绿证：`go test ./pkg/aisessions ./pkg/agentdata -count=1` → ok

## P2 一次性迁移（Go）

- [ ] 5. `pkg/aisessions/sqlite_index.go`：`migratePropTypeStatus`（哨兵键 `session_props_status_type_migrated`；备份助手复用/改名 `backupSQLiteBeforeTagMigration`）；挂进 `ensureSchema` 链
- [ ] 6. `pkg/wconfig/settingsconfig.go`：`MigrateAgentPropertySchemaStatus()`；`cmd/server/main-server.go` 挂调用
- [ ] 7. jsonschema enum 删 status（`AgentPropertyDefType.Type` tag）
- [ ] 8. 单测：
  - `sqlite_index_test.go`（或新增）：`TestSQLiteMigratePropTypeStatus`（3 status + 2 select → 0/5；二次幂等；哨兵存在）
  - `settingsconfig` 或独立测试：`TestMigrateAgentPropertySchemaStatus`（含"无 status 不写盘"断言——用 mtime 或 mock 写函数）
- [ ] 绿证：`go test ./pkg/aisessions ./pkg/wconfig ./pkg/agentcontrol -count=1` → ok；`go build ./...` → 0

## P3 前端收敛（TS/TSX）

- [ ] 9. `property-model.ts`：`PropertyType` 删 `"status"`；`normalizePropertyType(raw: string)` 兜底化；`ALL_PROPERTY_TYPES`/`typeLabel`/`DropdownTypes` 删 status
- [ ] 10. `property-list.tsx`：注释里 status 措辞清理（`CreatableTypes` 头注释等）
- [ ] 11. i18n zh/en 删 `propertyType.status`
- [ ] 12. 生成物重跑：`go run cmd/generateschema/main-generateschema.go` → `schema/settings.json` + `frontend/types/gotypes.d.ts` diff 确认只有 enum/status 相关变化
- [ ] 13. 全局收口 grep：`grep -rn '"status"' frontend/app/view/aisessions/property/ frontend/app/element/info-card/` → 0 处类型语义残留（展示文案/key 名不算）
- [ ] 绿证：`npx vitest run frontend/app/view/aisessions/property/ frontend/app/element/info-card/` → 全绿（含既有 status 归一测试改为新语义后仍绿）；`npm run i18n:check` → 通过

## P4 改类型浮层（bug 修复）

- [ ] 14. `property-list.tsx`：删原生 select retype 分支；新增 `retypeAnchor` state + `PropertyValuePopover` 类型菜单（design §4.2 模板）；菜单项 icon 复用 `AddableTypeIcons`（导出或搬移到模块级）
- [ ] 15. `property-list.scss`：删 `.property-select`；新增 `.property-type-menu*` 样式（对齐 `property-add-panel__type-menu` 视觉）
- [ ] 16. DOM 测试（`property-list.dom.test.tsx` 扩展）：
  - 菜单开 → dispatch 一次外部 blur/focus 事件 → `[data-testid=property-type-menu]` 仍在
  - 点 select 项 → `onRetypeProperty("status","select")` 断言
  - `container.querySelector("select") === null`
- [ ] 绿证：`npx vitest run frontend/app/view/aisessions/property/` → 全绿；`npx eslint` 触碰文件 0 error；`node scripts/check-tsc-baseline.mjs` 0 新增

## P4b 值列表浮层误关闭修复（R7，追加）

- [ ] 16b. `tag-editor.tsx`：删容器 onBlur 关门（containerRef/handleBlur）；`.ptag-list` mousedown preventDefault；顶部「关闭语义」注释
- [ ] 16c. `tag-editor.dom.test.tsx` 新增 describe：点空白不关 + defaultPrevented；focusout/blur 不关；Esc 仍关
- [ ] 绿证：`npx vitest run frontend/app/element/property-editor/ frontend/app/view/aisessions/property/ frontend/app/element/info-card/` → 全绿

## P5 验证台 + 真机

- [ ] 17. `scripts/verify/property-editor/verify.mjs` 加 case：agent 卡 → 属性菜单 →「修改类型」→ 断言浮层出现且 1200ms 后仍在 + 指针移入浮层卡片不收（只开不选，不写数据）；台账 `docs/project/verify-ledger.md` 补一行
- [ ] 18. 真机迁移抽样：本机 `~/.snorkeling/ai-sessions` 库（或其副本）跑迁移后 `SELECT count(*) FROM ai_session_props WHERE prop_type='status'` = 0；settings.json 的 status 定义变 select
- [ ] 19. `node scripts/verify/property-editor/verify.mjs` → 退出码 0（全绿）

## P6 收尾

- [ ] 20. `go build ./...` + 全量 `go test ./pkg/... -count=1`（相关包）+ `npm run i18n:check` 终验
- [ ] 21. 提交：只带白名单文件（`git add` 显式列表）；commit message `fix(property): status 类型彻底退役（数据迁移 + 写边界归一）+ 改类型浮层菜单修复点击即关`
- [ ] 22. HANDOFF.md 记一行；loop 台账记 commit 事件

## 回滚

- 代码：单 commit revert 即可
- settings：手工把 select 改回 status（或从 git/备份）
- sqlite：用 `.backup-before-*` 文件覆盖；无 status 残留也可不回滚（select 行为与旧 status 等价）

## 执行记录（2026-11-20）

- P1-P4b 全部完成。绿证：
  - `go build ./...`：一轮并行编译时撞整机 commit 内存上限（既有 OOM 环境，见 11-19-wavesrv-oom-flash-quit）；
    `go build -p 1` 通过、后续缓存命中等价通过
  - `go test -p 1 ./pkg/aisessions ./pkg/agentdata ./pkg/agentcontrol ./pkg/wconfig -count=1` → 4 包全 ok
    （并行时 aisessions 有一个 TempDir 清理的 flaky，`-p 1` 稳定全绿）
  - `npx vitest run frontend/app/view/aisessions/property/ frontend/app/element/info-card/ frontend/app/element/property-editor/`
    → 13 文件 154 用例全绿（新增：normalize/migrate/归一落库/改类型浮层 3 条/误关闭回归 3 条）
  - `node scripts/i18n/check-parity.mjs` → exit 0（`npm run i18n:check` 的全仓 CJK scan 有 5 条
    allowlist 外既有红：agent-emoji-picker.tsx:229、emain-wavesrv.ts:100-103，均非本包文件，不属本包）
  - `npx eslint` 触碰文件 0 error；tsc 白名单文件 0 新增 error（全仓 12 条既有漂移均在未触碰文件；
    session-detail.tsx 当时正被另一 agent 编辑带语法错误，污染过一轮统计，复测排除）
- P5 真机验证台：**用户豁免（本机性能不够，不启动真机）**。`scripts/verify/property-editor/verify.mjs`
  已备好 case（agent-retype-menu-* 5 条断言），下次性能允许时 `node scripts/verify/property-editor/verify.mjs` 即跑；
  台账三次 fatal（未跑）+ 本次 skip 结论已入 `docs/project/verify-ledger.md`。
- 数据迁移抽样（不启动应用，真实库/真实 settings 副本）：
  - sqlite：live 库 `~/.snorkeling/ai-sessions/index-v2.sqlite` 已于 10:36:52 一次迁移完成
    （备份 `index-v2.sqlite.backup-before-prop-status-20261120-103652` 3.05GB；哨兵
    `session_props_status_type_migrated=1`；`SELECT count(*) FROM ai_session_props WHERE lower(trim(prop_type))='status'` = **0**；
    key=status 的 56 行现为 54 select + 1 multi_select + 1 text，值未动）
  - settings：live `~/.config/snorkeling/settings.json` 仍含 1 条 `type:"status"`（迁移挂在 wavesrv 启动，
    用户重启新构建后自动改写）；用真实 settings 副本跑 `MigrateAgentPropertySchemaStatus` 验证：
    type status→select，name/options/order/scope/aiManaged 逐字段不变
- 遗留观察：真机 UI（retype 浮层 1200ms 存活、值列表空白点击不关）待性能允许时跑 property-editor 台补证。
