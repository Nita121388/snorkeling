# Implement：Overview Tab 分组 tab-first 化

> 红证先行：本文件也是 G6 hash 源。步骤顺序即实现顺序；每步有判定命令。

## 0. 红证（先写，先看着红）

1. `frontend/app/session-overview/overview-tab-groups.test.ts`：
   - `buildTabGroups` 基本表：live / empty（仅 Overview 块）/ unopened（非当前）/ loading（tab 未解析）四状态各 ≥ 1 用例
   - `agentsOnly=true` **组数不变**（断言 groups.length 与 false 时相等）
   - `hideUnopenedTabs=true` 只删 `unopened` 组
   - 仅含 Overview 块的 Tab（blockids 全是 sessionoverview 块）→ `status === "empty"` 且组存在
2. `npm test -- overview-tab-groups` → 编译失败/断言失败（红）即登记 `loop/red/`。

判定：`npm test -- overview-tab-groups 2>&1 | tail -5`（红）

## 1. `overview-tab-groups.ts` 纯函数

- 按 design §3 落 `buildTabGroups` + 类型；不做任何 React/jotai import。

判定：`npm test -- overview-tab-groups` → **绿**

## 2. `WOS.primeWaveObjects`

- `frontend/app/store/wos.ts` 新增：
  ```ts
  async function primeWaveObjects(orefs: string[]): Promise<void>
  ```
  - 过滤已解析（`getWaveObjectValue(oref)` 的 dataAtom `loading === false`）的 oref；
  - 剩余按 400/批调 `services.object.GetObjects(orefs)`（`frontend/app/store/services.ts:612` 已有）；
  - 每个返回对象走 `updateWaveObject({ updatetype: "update", obj })`（version guard 复用）；
  - 导出 `primeWaveObjects`。
- 单测（`wos-prime.test.ts`，mock `services.object.GetObjects`）：一批 190 → 1 次调用；
  已解析 oref 不重复拉；null 对象跳过。

判定：`npm test -- wos-prime` → 绿

## 3. `useOverviewBlocks` 接批量 prime

- prime 副作用：`useEffect([workspace?.oid, tabIdsKey])` → Phase A（tab orefs）→
  Phase B（从已解析 tab.blockids 收集 block orefs）；两阶段都走 `primeWaveObjects`。
- 返回 shape 不变（board/timeline 无感）。

判定：`npm test -- session-overview`（现有全量）→ 绿

## 4. `displayedTabGroups` 换 `buildTabGroups` + 组渲染四状态

- 删 `session-overview.tsx:2250-2265` 的三段 filter/map（含 `blocks.length > 0`）；
- `OverviewTabGroup` 按 design §4：`loading` 骨架 / `empty`（复用 noBlocks）/ `unopened`（`is-unopened` + 徽章 + 默认折叠）/ `live` 不变；
- `agentsOnly` 只过滤组内行（组头徽章在 0 时显示 `0 agents`）；
- 底部汇总行（i18n key 见 design §6，中英两份 locale 同步）。

判定：
- `npm test -- session-overview` → 绿
- `npm run i18n:check` → 无新缺失 key

## 5. 样式

- `session-overview.scss`：`.is-unopened`（灰化，视觉语言对齐 Tab 栏 `unopened-this-launch`）、
  `.session-overview-tab-skeleton`（3 行 shimmer）、徽章样式。

判定：`npm run build:dev` 通过（编译含 scss）

## 6. 回归 + 真机验证台

- 前端单测全量：`npm test`（session-overview 相关目录）
- 真机（verify area，本父任务统一 area `overview-ux`，本包出前 4 条断言）：
  1. `组头数 == workspace.tabids 数`（`👁` 关）
  2. `agentsOnly` 开关前后组头 DOM 计数相等
  3. 仅含 Overview 块的 Tab：组存在且显示 noBlocks
  4. 首屏 `GetObjects` 服务调用 ≤ 3（pslog/CDP 计数）
- 台账入 `docs/project/verify-ledger.md`。

判定：`node scripts/verify/index.mjs --area overview-ux` → 4/4

## 7. 出界即停

touch 白名单（loop 工作项同源）：
`frontend/app/session-overview/**`、`frontend/app/store/wos.ts`、`frontend/app/i18n/**`、
`scripts/verify/overview-ux/**`、`scripts/verify/README.md`、`docs/project/verify-ledger.md`、
`.trellis/spec/**`、`loop/**`。
改动 `overview-board*` / `overview-timeline*` / 后端任何文件 = 停，报告。

## 8. spec 回写（完成后）

- `.trellis/spec/snorkeling-docs/frontend/`：新增或并入「Overview Tab 分组契约」：
  组常驻规则、四状态判定顺序、过滤器删组权力表（仅 hideUnopenedTabs 可删 unopened 组）、
  primeWaveObjects 只写缓存不回退版本。
