# PRD：AI 会话筛选结果双向补带（父 ⇄ 子）与精确筛选开关

## 背景

AI Sessions 的搜索/筛选在后端完成（`pkg/aisessions/manager.go`、`pkg/aisessions/sqlite_index.go`），只把**自身命中**的行返回前端。前端 `buildSessionTree` 于是把父不在结果集里的子行提升为顶层孤儿；反过来，命中父会话时它的子代理一个都看不到，`+N` 徽标也不可信。

本机索引实测：452 个子会话 / 65 个父会话 / 单父最多 107 个子会话。

## 目标

1. **命中子代理 → 补带父代理**（否则用户看不出它是谁派发的、属于哪次运行）。
2. **命中父代理 → 带出它的直接子代理 / fork**（否则折叠结构断裂）。
3. **精确筛选可切换**：一键回到「只显示命中」的严格模式。
4. 上下文行必须**明显可辨**（灰显 + 图标 + tooltip），且不被误计入「命中数」「全选」「默认复制」。

## 非目标

- 不改 pi 会话磁盘结构，不改 `pi-subagents` 扩展。
- 不做多级（> 1 层）补带：父子在磁盘上只有一层，子代理内部再派发产生的是另一条独立父链。
- 不做同目录分组归位 / PathChip（那属于 `10-26-aisessions-parent-attach-grouping`）。
- 不改 time（不分组）模式的既有排序行为。

## 需求

### R1 三档模式

`attachMode`：`off`（精确，等于今天的行为）/ `both`（智能，默认）/ `children`（只带子代理）。

- 后端默认 `off`，不传参的旧调用零影响；
- UI 默认 `both`，落盘 `localStorage["aisessions.attachMode"]`；
- 切换即重新拉取列表，不残留旧状态。

### R2 后端双向补带

- 在 `limit` 截断**之后**追加上下文行，不占分页额度；
- 上行只补直接父，下行只带直接子（`kind=subagent|fork`）；
- 只给「自身命中」的父带子，不给被补带的父再带子（防止噪音扩散）；
- 每父最多 50 个子、全局最多 500 个上下文行，超出按 `updatedAt` 降序截断并回传截断标记；
- 硬边界：`excludeProjects` / `excludeTags` 命中的行即使被补带也不加入；`missing=1` 的行不参与；
- 三条数据来源（sqlite 快路径 / 全量扫描 / 搜索）行为一致。

### R3 前端可辨识与语义

- 上下文行：次要文字色 + 图标（父 `fa-link` / 子 `fa-sitemap`）+ tooltip 说明；
- `matchedKeys = rows.filter(r => !r.attached)`，无筛选时传 `undefined`；
- 自动展开：`attached="parent"` 的父行默认展开，定位到命中子行；用户手动收起的优先级更高；
- 全选 / 默认复制只包含命中行，文案标注上下文数量；
- 列表结果数只数命中行，可显示「+N 上下文」并可临时隐藏。

### R4 按 session id 筛选

- 搜索框同时匹配 **session id**（裸 UUID、任意片段）与完整 session key（`source:id:filePath`）。
- 支持 `session:<id>` / `id:<id>` / `sessionid:<id>` / `key:<key>` 前缀形式，大小写不敏感。
- 行 tooltip 显示 `Session ID:`，让用户知道可搜；“复制 Session ID” 产物可以直接粘回搜索框。

## 验收标准

1. 搜索命中某子代理 → 父行出现在结果里并自动展开，命中子行可见；父行灰显带 `fa-link`。
2. 搜索命中某父代理 → 它派生的子代理全部出现（受 50 上限约束），灰显带 `fa-sitemap`。
3. 切「精确」→ 两条行为都消失，与改动前完全一致。
4. 父被 `excludeTags` 排除时，命中子行仍是孤儿顶层，不出现父行。
5. `limit=200` 时上下文行不挤占命中行；单父 107 个子时最多带出 50 个。
6. 无筛选时列表与改动前逐行一致（无 `attached` 字段）。
7. `go test ./pkg/aisessions` 与 aisessions 相关前端单测全绿。
8. 把某个会话的 Session ID（完整或前 8 位）粘进搜索框 → 该会话命中；带 `session:` 前缀也命中。
