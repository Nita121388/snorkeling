# A1.5 AISessions 集成 — 执行计划

> 判据见 `prd.md`，口径见 `design.md`。每步带验证命令；出白名单即停。

## 1. 后端

### Step 1.1 名册下发
- [x] `pkg/service/aisessionsservice`：`AISessionsListResponse` 加 `PersonaRoot`/`Personas`；
  `IncludeProjectPaths` 时填充；5s TTL 缓存；失败降级为空
- [x] `frontend/types/gotypes.d.ts` 同步
- [x] 验证：`go test ./pkg/service/aisessionsservice/...`（新增：命中/降级/缓存测试）

### Step 1.2 判据联通（AC: props.persona 可见）
- [x] 用 `wsh agent card set this --prop persona=demo --yes --expected-hash <h>` 写入
      后 `wsh agent card get this --json` 可见（已有能力，验证联通即可，不改代码）
- [x] 验证：`go build ./pkg/...`

## 2. 前端

### Step 2.1 分组折叠（utils.ts）
- [x] `groupSessionsByProject` 加 `personaCtx` 参数：路径命中 → key `persona:<id>`、
      组名 `🎭 <name>`、不显示路径；纯函数
- [x] `utils.test.ts`：命中/未命中/与真项目同名冲突/root 大小写（win）
- [x] 验证：`npx vitest run frontend/app/view/aisessions/utils`

### Step 2.2 行标 + 筛选 + 登场史
- [x] 列表行 persona chip（props.persona → 🎭 + byId 名）
- [x] persona 多选筛选 chip（客户端过滤）+ `countSessionsOfPersona`
- [x] aisessions.tsx 接线：model 缓存 personaCtx
- [x] 测试：行标渲染、筛选交集、登场史计数一致性
- [x] 验证：`npx vitest run frontend/app/view/aisessions`

## 3. 收尾

- [x] `npx tsc --noEmit -p tsconfig.json | grep -c "error TS"` → `<=47`
- [x] 探针断言（AC2）：vitest 里断言 persona 组渲染不含 rootdir 路径字符串（utils.test.ts 已含）
- [ ] AC3（props.persona 非空）需活体 app 写入；通道=既有 wsh agent card set --prop，A3 登场管线自动写（留活体验证）
- [x] 更新 `docs/project/persona-system.md`（A1.5 状态）
- [x] spec：`.trellis/spec/snorkeling-docs/frontend/` 补一条「persona 归属判定 = props.persona 优先、路径命中只管折叠」
- [x] commit

## 回滚点

Step 1/2 各自独立 revert；响应字段可选、无迁移。

## touch 白名单（loop 工作项）

`pkg/service/aisessionsservice/**`、`pkg/persona/**`、`frontend/types/gotypes.d.ts`、
`frontend/app/view/aisessions/**`、`docs/project/persona-system.md`、
`.trellis/tasks/11-12-persona-aisessions/**`、`.trellis/spec/**`、`loop/**`
