# Implementer Notes — UI 新值自动追加候选

Worker agent 完成记录（2026-11-19）。主 agent 归档时按此核对。

## 变更

| 文件 | 内容 |
|---|---|
| `property-schema.ts` | 新增纯函数 `appendOptionToSchemaDefs(defs, key, values) -> {next, changed}` + 内部 `isAppendableScope`。幂等 / 保序 / trim+小写去重（写死）/ 绝不删已有 option；命中条件：slugified key 匹配、type ∈ {select, status, multi_select}、scope ∈ {全局 "", agent:"<source>"} |
| `property-list.tsx` | `onChange` 类型放宽为 `void \| Promise<unknown>`（向后兼容，父组件 void 箭头可直接赋值）；`commitDropdown` 提交后触发 `maybeAppendOptions`；组件持有 `appendSchemaRef`（render 同步 schema prop 的「hook 权威值 + 本地补丁」，防止连续快速追加互相覆盖）；`maybeAppendOptions` 先按 `schemaVisibleTo` 过滤当前会话可见 defs，再调纯函数，`changed=true` 才 `setPropertySchema`，失败只 `console.warn` |
| `property-schema-add-option.test.ts`（新增） | 纯函数单测 12 条：追加/重复/大小写去重/保留输入大小写/session 跳过/不在模板跳过/agent scope/key slugified 匹配/multi_select 多值保序/status 归一/非选项类型/空值 |
| `property-list-append-option.dom.test.tsx`（新增） | DOM 测试 8 条（mock `./property-schema` 的 `setPropertySchema`，保留真实 `appendOptionToSchemaDefs`）：全局 scope 追加 / 写回后下拉候选含该值（读 DOM）/ 会话私有不动模板 / 其它 agent scope 不追加 / agent scope 可见可追加 / multi_select 连续两次提交 / 模板写失败降级 / 值写失败不追加 |

## 实现决策（与 prd 已定决策的映射）

- **触发点在值写成功之后**：`onChange` 返回 Promise 时等 settle 成功再追加；返回 void 的既有调用方（session-note-section 的 `writeProperty` 返回 void）按成功处理——值写入失败时多一个候选无害且自愈（已在代码注释写明）。
- **session scope 门禁**：session 私有属性不在模板里 → 纯函数 not-found → `changed=false`；另在纯函数里对 scope ∈ {session, 未知} 显式跳过，双层保险。
- **不覆盖并发写入**：追加合并基于 `schema` prop（父组件 `usePropertySchema()` 的新鲜值，settings 变化即重渲染）+ `appendSchemaRef` 本地补丁；不用渲染闭包里的过期快照拼整表。
- **模板写失败**：`try/catch` + `console.warn`，绝不回滚/阻断已成功的值写入。

## 验证证据

- `npx vitest run frontend/app/view/aisessions/property/` → 6 文件 81 tests 全绿（含既有 73 + 新增 8）
- `npx vitest run frontend/app/element/info-card/` → 6 文件 59 tests 全绿（session-note-section 共用 schema helpers 回归）
- `npx eslint` 4 个白名单文件 → 0 error
- `node scripts/check-tsc-baseline.mjs --verbose` → 白名单文件 0 错误。注意：全仓 tsc 总数 55 > 基线 47（新增 8 条**全部来自其它 agent 在改的文件**：emain-window、agent-status-notify.test、waveai-model、markdown、onboarding-starask、overview-board-empty-label.test、agenthooksettingsmodal、processviewer、remark 渲染测试），不属本包职责，未触碰。

## 未做

- 未 git commit / git add；未碰 loop/、docs/project/verify-ledger.md、blockframe-header.tsx、commontext、wave.ts、wave/**、pkg/**。
- 未改 `agent:propertyschema` 的 scope 编码语义（"" = 全局、"agent:<source>" = agent）。