# AISessions emoji 偏好：推荐、异步补充与来源标记

## Goal

agent card 的 emoji 要做到：打开 Picker 就有推荐；用户没设置过就自动设置；用户设置过的永不覆盖；每次选择都沉淀为偏好，下次推荐更准。现状三个硬伤：session emoji 存浏览器 localStorage（外部 agent 写不到）、无 source 字段（分不清谁设的）、无推荐。

设计全文：`design/plans/session-kernel-design-20261118.md`（第 5 节；原始出处：Hero 据点仓 `nita/hero-feaa3f86` `design/session-kernel-design-20261118.md` @ 274f8e56）

## Requirements

### R1 存储后端化 + 来源标记

- session emoji 从 localStorage（`snorkeling:agent-session-emojis`）迁到 `ai_session_props`，prop key 如 `emoji`，值带 `source`（`user` / `ai`）。
- 一次性迁移：localStorage 旧值全部标 `source=user`（人手工点的），迁移后前端读后端。
- 解析链保持：L2 session（user 槽 > ai 槽）→ L1 provider → 品牌 logo；只是 L2 拆出两个来源层。

### R2 get / set / recommend 入口（CLI + MCP）

- `wsh session emoji get <id>` → `{emoji, source, updatedAt}`
- `wsh session emoji set <id> --emoji 🐛 --source ai --if-absent`：**user 槽存在时拒绝覆盖**并返回当前值；幂等
- `wsh session emoji recommend <id>` → top5 候选 + 每条理由
- `data apply` patch 增加 `session_emoji.update` 操作（同 `--if-absent` 语义）
- MCP：`snorkeling_session_emoji_get / set / recommend`，写类默认 dry-run

### R3 偏好表

```
ai_emoji_prefs (
  dim TEXT NOT NULL,          -- 'project' | 'persona' | 'global'
  dim_key TEXT NOT NULL,      -- 项目路径 / hero id / ''
  emoji TEXT NOT NULL,
  count INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(dim, dim_key, emoji)
)
```

- 一次手选 = 一条 UPSERT `count+1`。
- record-pick 事件：Picker 里手选 / 覆盖 / 清空都上报（清空记负信号，降权不删记录）。

### R4 推荐来源：全部来自外部 agent 注入

> ⚠️ 2026-11-19 第二轮拍板取代原五信号方案（见 design.md §8.2）：内部不实现任何推荐算法，五信号 / autosetEligible / 规则表取消。

- 外部看护 agent 通过注入接口写入候选（`ai_emoji_recommendations`，每会话整体覆盖，TTL 可选），每条候选：`{emoji, reason}`（推荐框展示 + hover 理由）。
- **展示权限分开**：注入只决定「推荐区显示什么」，从来不自动写 session emoji 值；写入仍走 `set --if-absent --source ai`，`source=user` 永不覆盖（R10）。
- 注入候选逐条过 `NormalizeEmoji`（一条非法拒整批），去重，候选上限 8；空注入 = 清除推荐区。

### R5 Picker 推荐区：有就显示、没有就不显示

- 推荐区样式对齐「最近使用」行；同步读注入存储（缺失/过期/空 → 整块隐藏，`<5ms` 兜底）；外部注入后推事件，开着的 Picker 实时刷新；失败静默隐藏，不阻塞、不报错。

### 约束

- **R10 红线**：`source=user` 的 emoji 永不被机器覆盖；L1 provider persona（全局层）永不改。
- 不动 `agent:emoji` block meta 兼容路径（legacy 读取保留）。
- 阶段段落表未就绪前，R4 的信号 3 允许返回空，排序不报错。

## Acceptance Criteria

- [ ] AC1 迁移后 `session emoji get` 能读到 localStorage 旧值，`source=user`
- [ ] AC2 `set --if-absent --source ai`：user 槽存在时被拒（返回当前值与错误码）；空槽成功
- [ ] AC3 手选两次同一 emoji 后 `ai_emoji_prefs.count=2`；`recommend` 该 emoji 置顶且理由含次数
- [ ] AC4 Tag 命中（如 tag 含 bug）出现在候选且理由正确
- [ ] AC5 Picker 打开耗时不受推荐影响（无缓存路径同步返回 ≤5ms 内的兜底 UI）；后台事件到达且 Picker 开着时候选刷新（有测试）
- [ ] AC6 自动设置仅在偏好命中时发生；纯规则命中只进推荐区（测试覆盖）
- [ ] AC7 GUI 显示「AI 设置 · 点击修改」标记；用户改选后 `source=user` 且再次 `--if-absent` 写入被拒
- [ ] AC8 现有 persona / session-row 测试全绿；localStorage key 兼容读取不破坏老工作区

## 规划工件

- 实现层设计（现状解剖 / 数据模型 / 接口 / 算法 / Picker / 风险）：`design.md`
- 分批执行计划（P0–P5、每批验收命令、回滚点、测试清单）：`implement.md`
- **开工前待拍板**：`design.md` §8 四项；`implement.md` §0 取件前置（T2 批次须先落库）

## Notes

- 相关代码：`frontend/app/agent-persona/`（`session-persona-store.ts`、`picker-host.ts`、`persona-store.ts`）、`frontend/app/view/term/agent-logo.tsx`（`getAgentIcon` 解析链）、`frontend/app/view/aisessions/session-row.tsx`（入口）、`pkg/aisessions/sqlite_index.go`（props / tags 表）、`pkg/agentmcp/tools.go`。
- 依赖：无硬依赖；R4 信号 3 软依赖 `11-18-aisessions-card-phase-timeline`。
- 守夜人侧纪律（另仓 playbook）：推荐→`--if-absent`→`source=ai`，一轮 ≤10，幂等。
