# Overview Tab 分组契约（tab-first）

> 来源：2026-11-22 `11-22-overview-tab-grouping`（loop `F-1122-overview-tab-grouping`）。
> 代码：`frontend/app/session-overview/overview-tab-groups.ts`（纯函数）、
> `session-overview.tsx`（`useOverviewBlocks` / `TabGroupSection`）、`store/wos.ts`（`primeWaveObjects`）。

## 1. Scope / Trigger

Overview 列表视图的 Tab 分组渲染。任何「为什么这个 Tab 不显示 / 为什么组没了」的问题都先查这条契约。

## 2. 组必须常驻（不是"能显示"而是"不许消失"）

组从 `workspace.tabids` 生成，**删除组的权力只有一条**：`hideUnopenedTabs === true` 时删除 `unopened` 组。

| 历史缺陷（都被这条杀掉） | 机制 |
|---|---|
| 空组被 `blocks.length > 0` 过滤 | 只有 Overview 块的 Tab 自我消失 |
| 块未加载 → 组为空 → 被删 | 首帧 190 次串行 `GetObject`，无骨架 |
| `agentsOnly` 先过滤行再删空组 | 无 agent 的 Tab 整组消失 |

## 3. 四状态判定顺序（不可调换）

```text
tab 未解析        → loading（骨架；对两个过滤器都免疫）
可展示块数 == 0   → empty（含"只有 Overview 块"的 Tab）
未打开(且非当前)  → unopened（灰行；默认折叠）
其余              → live
```

- `blockCount` 统计 `tab.blockids` 去掉 Overview 块本身。
- 当前 Tab 即使本次启动未激活过，也**不算** `unopened`。
- 过滤规则在 `buildTabGroups` 内：`hideUnopenedTabs` 删 `unopened`；`agentsOnly` **只过滤组内行**。

## 4. 折叠态：翻转相对"生效值"，不是相对显式记忆

```ts
// 对：显式记忆 ?? 默认值 才是当前生效值
const cur = collapsed[tabId] ?? (status === "empty" || status === "unopened");
setCollapsed({ ...collapsed, [tabId]: !cur });
```

写成 `if (collapsed[tabId]) delete ... else collapsed[tabId] = true` 会让默认折叠组**永远翻不开**
（点一次写 true＝还是折叠，点两次删回 undefined＝默认折叠，toggle 成死按钮）。
2026-11-22 真机抓过：`empty-tab-group-shows-no-blocks` FAIL，`aria-expanded` 两次点击都 false。

## 5. 取数：批量 prime，别逐块拉

- `WOS.primeWaveObjects(orefs)`：一次 `ObjectService.GetObjects`，400/批，已解析跳过（幂等），
  null 跳过，写缓存走 `updateWaveObject` 的 version guard（不回退新版本）。
- Overview 两阶段 prime：先 tab orefs，再这些 tab 的 block orefs。
- 真机数字（8 Tab）：`GetObjects` 2 次、`GetObject` 单件 23 次（旧路径 ~190 次）；
  首屏组头数 == tabids 数（0ms 实测，阈值 1.2s）。
- `useOverviewBlocks` 的输出 shape 不得变（board/timeline 同源消费）。

## 6. 验证钩子

组头带 `data-overview-tab-group` / `data-overview-tab-status`，汇总行带 `data-overview-tab-summary`。
`scripts/verify/overview-ux` 用它们数「组头数 == tabids 数」「切换过滤器后组数不变」。

## 7. 不要动

- 不要为了"没结果"去删组——画占位（`noBlocks`）。
- 不要给骨架行加出现动画（会和虚拟行稳定性冲突）。
- 不要改 `workspace.tabids` 数据层。
