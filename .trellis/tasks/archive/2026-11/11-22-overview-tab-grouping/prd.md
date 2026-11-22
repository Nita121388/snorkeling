> **Confirmed: 2026-11-22 @nita**

# PRD：Overview Tab 分组 tab-first 化

> 父任务：`11-22-overview-tab-card-ux`（需求源与跨包验收见父 PRD）
> UX：父任务 `ux-ascii.md` §① ② ⑤

## Goal

Overview 列表视图的 Tab 分组变成 **tab-first**：只要 Tab 在过滤档位里，就一定画组头；
空、未打开、未加载、被 agent 过滤这四种情况都不能让组消失。

## 背景（2026-11-22 核实）

| 缺陷 | 锚点 | 机制 |
|---|---|---|
| 空组被删 | `session-overview.tsx:2250-2265` | `displayedTabGroups` 末尾 `filter(g => g.blocks.length > 0)` |
| 只有 Overview 块的 Tab 自我消失 | `session-overview.tsx:346` | `useOverviewBlocks` 跳过 `view === "sessionoverview"` → 该组块数 0 → 被上面删掉 |
| 未打开 Tab 首帧消失 | `session-overview.tsx:328` / `store/wos.ts:226` | 每块单独 `GetObject`，一 Tab ~10 块、19 Tab ≈ 190 次，首帧全 `null` |
| Agent 过滤器删组 | `session-overview.tsx:2252-2263` | 先过滤组内行再按 `blocks.length > 0` 删组 |
| 加载中无反馈 | 同上 | 无骨架态，用户只看到"少了几个 Tab" |

组组件本身**已经**有 `noBlocks` 空态（`session-overview.tsx:2123`），所以病不在组件，在外层过滤与取数。

## 需求

### R1.1 组常驻
`workspace.tabids` 里的每个 Tab 只要在当前过滤档位内，就渲染组头。删除 `blocks.length > 0` 过滤。

### R1.2 四种组状态
| 状态 | 判定 | 渲染 |
|---|---|---|
| `live` | 有 ≥1 可展示块 | 正常，默认展开（若在折叠记忆里则折叠） |
| `empty` | 该 Tab 存在但 `blockids` 为空，或仅含 Overview 块 | 组头 + 一行 `noBlocks` 浅灰；**默认折叠** |
| `unopened` | 本次启动未激活过 且 非当前 Tab | 组头灰化 + 徽章「未打开 · N 块」；**默认折叠**；`[↗ 打开]` 可用 |
| `loading` | 该 Tab 的块 oref 还未解析完 | 组头 + 骨架行；**不参与**任何过滤判定 |

### R1.3 批量取块
新增 `WOS.primeWaveObjects(orefs: string[])`：一次 `services.object.GetObjects`，逐个走
`updateWaveObject`（沿用 version guard，不会回退新版本）。`useOverviewBlocks` 在 `tabIds`/块集合变化时
分两阶段 prime（先 tab，再这些 tab 的 block），单批上限 400 个 oref。

判据：19 Tab 首次渲染，`GetObjects` 服务调用次数从 ~190 降到 **≤ 3 次**（可在 pslog 或 CDP 里数）。

### R1.4 过滤语义
- `hideUnopenedTabs`（按钮 `👁`）**开**＝不画 `unopened` 组；**关**＝画（默认关）。
- `agentsOnly`（按钮 `🤖`）只过滤组内行，**永不影响组头数量**；无 agent 的组仍显示组头 + `0 agents`。
- 两者都不影响 `loading` 组的呈现（骨架）。

判据：`agentsOnly` 从关到开，组头 DOM 计数不变。

### R1.5 汇总行
列表底部一行：`共 N Tab（显示 M）· K 个 agent`；`N` = 当前 workspace tabids 数。

### R1.6 分组逻辑可单测
分组判定抽成纯函数模块（`overview-tab-groups.ts`），不依赖 React/jotai，用 vitest 覆盖四种状态 × 过滤矩阵。

## 验收判据（数字）

1. `npm test -- overview-tab-groups` → 全 ok，覆盖 4 状态 × 2 过滤器 ≥ 8 组断言。
2. 真机（verify area `overview-ux`）：
   - `组头数 == workspace.tabids 数`（`👁` 关时）
   - `agentsOnly` 切换前后组头数相等
   - 仅含 Overview 块的 Tab 组存在且显示 `noBlocks`
   - 首屏 `GetObjects` 调用 ≤ 3
3. `npm run i18n:check` → 不新增缺失 key。

## 不做

- 不改 `workspace.tabids` / 后端数据层。
- 不动看板/时间线视图（`board` / `timeline` 职责不变；看板按 Tab 分组仍以卡片来源为准）。
- 不给组加拖拽/排序。
