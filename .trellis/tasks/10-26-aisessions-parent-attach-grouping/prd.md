# PRD：AI 会话父级回填与按项目分组归位

## 背景与问题

AI Sessions 列表按「项目」分组时，父会话（parent）与它的子会话（subagent / fork）
会被拆到**两个不同的分组**里，父行失去 `+N 子会话` 徽标，子会话脱离父子上下文。

### 根因链

1. `pkg/aisessions/provider_pi.go:133` — 每个会话（含子会话）的 `ProjectPath` 取自
   **自身文件头的 `cwd`**。
2. `frontend/app/view/aisessions/utils.ts` → `groupSessionsByProject()` 用
   `basenamePath(projectPath)` 作为桶 key。
3. 子代理被派发到别的目录（worktree / 另一个仓库 / 子目录）时 → basename 不同 →
   落进另一个组。
4. `session-tree.ts` → `buildSessionTree()` 在**桶内**成树；`parentKey` 不在本桶结果集
   → 提升为顶层行，`+N 子会话` 徽标归零。

### 实测数据（`~/.pi/agent/sessions` 全量扫描子会话文件头 `cwd`）

```
124  --D--Code-LiCASmart--    ||  D:\Code\LiCASmart                 （正常）
  6  --D--Code-LiCASmart--    ||  D:\Code\Smart_V2.0.0.18168         （被拆出）
  4  --D--Code-LiCASmart--    ||  D:\Code\Chemclin-InstrumentComm    （被拆出）
  4  --E--projects-journal--  ||  E:\projects\journal\.agents\skills\journal
```

### 次生缺陷

桶 key 用 basename → **同名不同路径**（多个 `journal`、多个 `frontend`）会被错误合并
成一个分组，组名相同、计数混在一起，且组头折叠状态互相干扰。

## 目标

1. **父子永不因分组而分离**：子会话永远出现在其父会话所在的分组内、父行之下。
2. **父不在筛选结果时，把父找回来**（回填），而不是把子行提升为顶层 —— 搜索命中
   子会话时，父行仍在，且自动展开。
3. 分组展示目录**名**，tooltip / 复制给出**完整路径**，让「为什么它在这个组」一目了然。
4. 修掉同名不同路径误合并的缺陷。

## 非目标

- 不改 pi 会话磁盘结构。
- 不改 `pi-subagents` 扩展。
- 不新增 SQLite schema 版本（不加 migration）。
- 不改 time（不分组）模式的既有行为。
- 不改 `SessionSummary.projectPath` 的语义（仍是自身 `cwd`）。

## 需求

### R1 父级回填（attach）

**R1.1** 在列表/搜索出口统一执行回填，覆盖三条数据来源：sqlite 快路径
（`cachedScanListWithDistribution`）、全量扫描路径（`scanListNow`）、搜索路径
（`Manager.Search`）。

**R1.2** 执行位置在 `opts.Limit` 截断**之后**，避免回填的父行被分页挤掉。

**R1.3** 找回父的三级来源，命中即停：
1. 本次结果集内的行（内存 map 查找）。
2. sqlite 批量查询 `WHERE key IN (缺失的父 key 集合)`，一次查询。
3. 由子会话 `FilePath` 推导父文件路径（`ClassifyPiSessionFile`）→
   直接 `provider.ParseSummary` 解析该文件。处理索引过期 / 父文件比索引新的情况。

**R1.4** 递归上溯到顶层会话：`parentKey` 链深度上限 4，`visited` 集合防
`A→B→A` 脏数据成环。

**R1.5** 显式排除优先：若父会话的 `projectPath` 命中 `ExcludeProjects`，
**不回填**，子行走既有孤儿路径（提升为顶层）。

**R1.6** 三级来源都失败（父文件被删）= 真孤儿。不回填，子行提升为顶层，
并打 `parentMissing` 标记。

**R1.7** 资源上限：每个请求第 3 级文件回填上限 50 个，回填行总数上限 200，
超出即放弃回填（子行按孤儿提升），避免慢盘上炸掉 RPC。

**R1.8** `projectPath` 分布（`dist`，筛选目录树的计数来源）**不参与回填** ——
用户没有勾过的目录不应出现在目录树里。

**R1.9** 新增字段（仅 pi 相关行会非空，向后兼容，无 schema 变动）：

```go
// Attached 表示本行不是本次筛选命中的，而是为了让子会话有父可挂而被拉进来的
// 上下文行。前端据此灰显，并把它排除在批量选择之外。
Attached bool `json:"attached,omitempty"`
// ParentMissing 表示本行有 parentKey 但父文件已不存在（真孤儿）。
ParentMissing bool `json:"parentMissing,omitempty"`
```

**R1.10** 标题自动生成（`enqueueAutoTitles`）移到 attach **之后**调用，回填父也能
拿到 AI 标题。

### R2 分组锚点（兜底）

**R2.1** 新增纯函数 `resolveGroupAnchor(session, byKey)`：
- 优先使用父行的 `projectPath`（父已在结果集，含回填行）。
- 父不在结果集 / 自引用 / 成环 → 用自身 `projectPath`（既有孤儿行为）。
- 递归深度上限 4。

**R2.2** 桶 key 从 `basenamePath(path)` 改为**规范化完整路径**（小写、统一分隔符为
`/`、去尾部分隔符）→ 修掉同名不同路径误合并。

**R2.3** 桶显示名仍是 basename（文件夹名）。

**R2.4** 组排序（按组内最新会话时间）、未归类沉底、`unclassified` 判定
（空/非绝对路径）全部不变。

**R2.5** `basenamePath` 保留导出（其他调用方在用）。

### R3 路径过滤口径统一

**R3.1** `projectPathMatchesAny` / `projectPathExcluded` 改判 effective path
（有回填父时用父的 `projectPath`）—— 保证「只勾父目录也能带出跑在别处的子会话」。

**R3.2** `dist` 统计口径与 R3.1 一致。

**R3.3** `projectPath` 字段本身不修改，`parentKey` / `kind` 不修改。

### R4 PathChip 组件

**R4.1** 新组件 `frontend/app/view/aisessions/path-chip.tsx`：
- 外观：`fa-folder` 图标 + 目录名（`max-w-[12ch]` truncate）+ 次级色。
- tooltip：完整路径；子会话时分两行（`自身: ...` / `父目录: ...`）。
- 点击：复制完整路径到剪贴板（`navigator.clipboard.writeText`），1.2s 内
  `fa-check` + "Copied"，失败 "Copy failed"。
- `stopPropagation`，不触发行选中 / 双击打开。

**R4.2** 落点与显示条件：

| 位置 | 显示条件 | 交互 |
|---|---|---|
| 列表子行标题左侧 | 仅当自身 basename ≠ 分组 basename（否则噪音） | tooltip 双行 + 点击复制 |
| 列表组头 | 常驻（组名即目录名） | hover 出 copy 图标，不抢折叠点击 |
| 详情头栏标题右侧 | 常驻 | 点击复制；子会话 tooltip 带父目录 |
| 时间线 subagent 卡 | P2 可选 | 同子行 |

**R4.3** 复制反馈复用 `controls.tsx` 已有的 `useCopyStatus`。

**R4.4** 剪贴板 API 不可用（非安全上下文）时降级：tooltip 仍可用，点击仅闪
"Copy failed"，不抛错。

### R5 回填行的 UI 表达

**R5.1** 回填行灰显（次级色 + 半透明），标题右侧 `fa-link` 标记，tooltip
「上下文父会话（未命中本次筛选）」。

**R5.2** 组头计数徽标**只统计命中行**；组内有回填行时 tooltip 追加
`+N 上下文行`。

**R5.3** 批量选择「全选」**默认不含**回填行。

**R5.4** 命中子会话时自动展开父行 —— 复用既有 `collectParentsOfMatches`，无需改动。

**R5.5** 真孤儿行（`parentMissing`）显示断链图标 + tooltip「父会话文件已删除」。

**R5.6** 列表行既有 tooltip 的 `Path:` 改为双行（自身 / 父目录）。

### R6 持久化兼容

**R6.1** `aisessions.groupCollapsed` 的 key 从 basename 变为规范化路径 → 旧值失效。
改用新存储 key `aisessions.groupCollapsed.v2`，旧 key 不读取（只丢一次折叠记忆）。

**R6.2** `aisessions.expandedParents` 存的是 session key，不受影响。

## 验收标准

- [ ] AC1 LiCASmart 里 `cwd` 为 `D:\Code\Smart_V2.0.0.18168` 的子会话出现在
      **LiCASmart 分组内**，挂在父行下，父行显示正确的 `+N` 徽标。
- [ ] AC2 搜索词只命中子会话时，父行被回填为灰行并自动展开，子行挂在其下。
- [ ] AC3 两个同名不同路径的项目目录（如两个 `journal`）分成**两个独立分组**，
      组名各自正确，计数不混。
- [ ] AC4 列表子行路径 chip：tooltip 显示双行路径，点击复制完整路径到剪贴板。
- [ ] AC5 组头 hover 出复制图标，点击复制完整路径；折叠/展开功能不受影响。
- [ ] AC6 父会话 `projectPath` 被 `ExcludeProjects` 显式排除时，子行提升为顶层，
      **不**出现被排除的父行。
- [ ] AC7 父文件被删除时，子行提升为顶层并显示断链标记，不报错、不空列表。
- [ ] AC8 脏数据 `A.parentKey=B` 且 `B.parentKey=A` 时，列表正常渲染（无限循环 /
      行消失都算失败）。
- [ ] AC9 批量选择不含回填行。
- [ ] AC10 `go test ./pkg/aisessions` 全绿；`npm test` 的 aisessions 用例全绿。
- [ ] AC11 现有功能无回归：time 模式、tag 筛选、limit 分页、note/tags 编辑、
      多选批量、虚拟滚动。
- [ ] AC12 1000+ 会话规模下 List RPC 耗时不劣化超过 15%（回填为 1 次批量查询，
      正常路径 0 次额外文件读）。

## 测试环境

```
Windows 11 开发机，目标平台 Windows + macOS 双端
pi sessions: C:\Users\chemclin\.pi\agent\sessions（124 个异 cwd 子会话）
```

## 风险

| 风险 | 缓解 |
|---|---|
| 分组数量变多（同名不再合并） | 这是缺陷修复，PRD 明确记录为预期行为变更 |
| 旧折叠记忆失效 | R6.1 新 key，只丢一次 |
| 回填导致结果集变大、用户以为筛选坏了 | R5.1~R5.3 灰显 + 计数隔离 + 批量排除 |
| 慢盘上第 3 级文件回填拖慢 RPC | R1.7 硬上限 |
| 过滤口径变化影响目录树计数 | R3.2 dist 同口径；验收 AC11 回归 |

## 里程碑

- M1 后端回填 + 锚点分组（AC1/AC2/AC3/AC6/AC7/AC8）
- M2 路径过滤口径统一 + dist（AC11 回归）
- M3 PathChip 列表子行 + 详情头（AC4）
- M4 组头复制 + 回填行视觉 + 批量排除（AC5/AC9）
- M5 真孤儿标记 + tooltip 双行 + 存储 key 迁移（AC7/AC11）
