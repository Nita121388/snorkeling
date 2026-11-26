# 执行计划：AISessions 声明式 provider

## touch 白名单（越界即停）

```
pkg/wconfig/settingsconfig.go
pkg/wconfig/metaconsts.go
pkg/aisessions/paths.go
pkg/aisessions/provider_declarative_sqlite.go        (新)
pkg/aisessions/provider_declarative_sqlite_test.go   (新)
pkg/aisessions/provider_declarative_config.go        (新，内置默认条目 + merge 纯函数)
pkg/aisessions/provider_declarative_config_test.go   (新)
pkg/aisessions/provider_label.go                     (新，LabeledProvider 可选接口)
pkg/aisessions/paths_test.go
pkg/service/aisessionsservice/aisessionsservice.go
pkg/service/aisessionsservice/*_test.go              (新增源列表 RPC 测试)
frontend/app/view/aisessions/sources.tsx
frontend/app/view/aisessions/filter-panel.tsx
frontend/app/view/aisessions/session-detail.tsx      (仅来源徽标 label 接入)
frontend/app/view/aisessions/types.ts                (SourceFilter 放宽为开放集合)
frontend/app/view/aisessions/filter-presets.ts       (sanitizeSource 接受声明式 id，否则持久化值被清空)
frontend/app/view/aisessions/filter-presets.test.ts
frontend/app/view/aisessions/filter-state-persist.test.ts  (sanitizeSource 语义变更后的样本更新)
frontend/app/view/aisessions/sources.test.tsx          (新，合并语义守卫)
scripts/verify/aisessions-declarative-source/verify.mjs (新)
scripts/verify/README.md                             (area 表登记)
```

生成文件白名单（必须重新生成时才动）：`frontend/app/store/services.ts`、`frontend/types/gotypes.d.ts`、`schema/settings.json`
（前者由 ServiceMap 反射 + `go run cmd/generatets/main-generatets.go` 生成；后者由 `cmd/generateschema` 生成）。

**提交纪律**：工作树里另有另一并发任务 perf-w0-2-ws-router 的文件（`pkg/web/ws.go`、`pkg/wshutil/wshproxy.go`、`wshrouter.go` 及其新测试），必须按任务分开 commit，不得混入。

RPC 注册文件（wshrpc command 常量/类型）如需改动，先在此追加再动手，不在计划外顺手改。
`.trellis/**`、`docs/project/verify-ledger.md`、`verify-runs/**` 属记录类，不受白名单限制。

## 步骤（每步带判据）

1. **wconfig 配置模型**
   - `AgentSessionProviderConfigType` + `SettingsType.AgentSessionProviders`（`agent:sessionproviders`）+ `ConfigKey_AgentSessionProviders`。
   - 判据：`go build ./pkg/wconfig ./pkg/aisessions` 通过；`go test ./pkg/wconfig` 绿。

2. **合并纯函数 + 单测**
   - `mergeSessionProviderConfigs()`：builtin（antigravity）∪ 用户配置，用户覆盖，disabled 剔除，`~` 展开，type/db 必填校验。
   - 判据：新增 4 个单测（内置默认 / 用户覆盖 / disabled / 非法配置跳过）全绿。

3. **DeclarativeSQLiteProvider**
   - List：列映射 SELECT + LIMIT；时间解析 layout 兼容 `...2006764+00:00`；workspace_uris → ProjectPath；FilePath 推导 per-conv db。
   - LoadMessages：空列表。
   - 判据：新增单测用 fixture sqlite（临时库建 `conversation_summaries` 同构表，插 2 行含真实时间格式与 file:// URI）→ List 返回 2 条，title/project/时间断言通过；LoadMessages 返回空且无错。

4. **注册收口 paths.go**
   - `DefaultProviders()` 追加声明式分支（os.Stat 门 + disabled + type 过滤）。
   - 判据：`DefaultProviders()` 在本机返回含 antigravity 的 provider 列表（单测用临时 settings 注入，或暴露可注入 settings 的内部函数）；db 不存在时不注册。

5. **后端 GetSourceList RPC**
   - `LabeledProvider` 可选接口 + service 方法 `GetSourceList`（source/label/available）+ command 常量与 RPC 注册。
   - 判据：`go test ./pkg/service/aisessionsservice` 绿；`wsh` 侧命令（若暴露）手跑返回含 antigravity。

6. **前端来源合并**
   - `sources.tsx` 增 `useMergedChatSources()`（CHAT_SOURCES ∪ RPC）；filter-panel / session-detail 改用；未知来源中性色点 + label。
   - 判据：前端 build/typecheck 通过；真机筛选面板出现 Antigravity。

7. **真机验证（收尾必做）——已移机**
   - 本机性能不足，不跑真机验证（2026-11-26 用户指示）。验证台已就绪：`node scripts/verify/aisessions-declarative-source/verify.mjs`（--dry 本机已过）。
   - 待办：在性能余量充足的机器跑一次，台账入库一行；截图存 `verify-runs/`（gitignore）。
   - 本机替代：单测（Go 23 例 + 前端 3 例）+ vitest 829/829 + tsc 新增 0 + dry-run。

8. **收口**
   - GitNexus `impact` 已在改 `DefaultProviders` 前跑（涉及扫描链路，预判 MEDIUM）；提交前 `detect_changes()`。
   - spec 回写：`.trellis/spec/snorkeling-docs/backend/aisessions-scan-contract.md` 增「声明式 provider」小节（或新文件 aisessions-declarative-provider-contract.md），记录：只读、固定列映射、LoadMessages 空、合并语义。
   - commit（主 agent 写台账、子 agent 不提交）。

## 实际落地与计划的偏差（执行后回填）

1. **声明式 provider 额外实现 `ListFiles` / `ParseSummary`**（`SummaryFileProvider`）：`collectScanUnits` 只要有一个 provider 不实现，整个扫描退回非预算 legacy 路径（违反 scan-contract），必须补齐。
2. **`FilePath` 落点**：per-conv db 存在用它，否则 `<summarydb>#<id>`——索引变更检测以 file_path 为键。
3. **`columns` 用 typed struct，同 key 覆盖是逐字段的**：`{"antigravity":{"disabled":true}}` 不会丢内置 table/columns。
4. **额外收口 `filter-presets.ts`**：`SourceValues` 硬编码 4 源会让 antigravity 筛选值被 sanitize 清空；改为合法 id 模式校验，`SourceFilter` 类型放宽为开放集合。
5. **来源清单 RPC 落地为 `AISessionsService.GetSourceList` + `aisessions.SourceStatuses()`**（service 层反射注册，非 wshrpc command 常量）。

## 风险与回滚点

| 风险 | 观测 | 回滚 |
| 时间格式解析不兼容 | 单测步骤 3 | 只影响排序，回退字段 |
| WAL 只读打开失败（目录不可写） | 步骤 7 列表为空 + 扫描 errs | List 返回 error 进 errs，不 panic |
| 前端合并 hook 引入双请求抖动 | 步骤 6 真机 | 退回 CHAT_SOURCES 硬编码 + 加一行 antigravity |
| 详情页空消息渲染异常 | 步骤 7 | 详情侧加「该来源不支持正文」占位（本条已在白名单） |

## 验收数字（写进 verify 台账）

- 本机：`select count(*) from sessions where source='antigravity'` ≥ 2（索引库位置 `DefaultSQLiteIndexPath`）。
- 筛选后列表行数 = 2；详情页 Console 无 error。
