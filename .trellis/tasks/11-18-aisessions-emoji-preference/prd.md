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

### R4 五信号可解释排序

| 优先级 | 信号 | 分值 |
|---|---|---|
| 1 | 用户偏好·项目层 | 100 |
| 2 | 会话 Tag 命中 | 70 |
| 3 | 时间线内容命中（大阶段/任务） | 50 |
| 4 | 标题 / 项目名关键词规则表 | 30 |
| 5 | 用户偏好·全局层 | 60 |

- 多信号同 emoji：分值相加、理由拼接；不同 emoji 同分：取更高优先级层。
- **仅 1 号信号命中（≥100）才有自动设置资格**；其余只进 Picker 推荐区。
- 理由写人话：「你在本项目选过 3 次 🛡」。
- Tag 来源 `ai_session_tags`，时间线来源阶段段落表（见 `11-18-aisessions-card-phase-timeline`，未完成前该信号可为空）。

### R5 Picker：打开即读缓存，后台异步补充

```sequence
用户 -> Picker: 点击打开
Picker -> 缓存: 同步读 (<5ms)
缓存 --> Picker: 有: 直接渲染候选
缓存 --> Picker: 无: 「生成中」+ 规则表兜底候选
后台 -> 推荐: 空闲时算 top5, 单会话一次, 并发≤2
推荐 --> 缓存: 写入 + 推事件
缓存 --> Picker: Picker 仍打开才增量刷新
```

- 打开永不等待推荐；缓存 TTL 7 天，会话更新或偏好变更即失效。
- 推荐失败静默降级到规则表。
- AI 自动设置的值在 UI 标「AI 设置 · 点击修改」；用户点击改选后写 `source=user`，此后 AI 永不覆盖。

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

## Notes

- 相关代码：`frontend/app/agent-persona/`（`session-persona-store.ts`、`picker-host.ts`、`persona-store.ts`）、`frontend/app/view/term/agent-logo.tsx`（`getAgentIcon` 解析链）、`frontend/app/view/aisessions/session-row.tsx`（入口）、`pkg/aisessions/sqlite_index.go`（props / tags 表）、`pkg/agentmcp/tools.go`。
- 依赖：无硬依赖；R4 信号 3 软依赖 `11-18-aisessions-card-phase-timeline`。
- 守夜人侧纪律（另仓 playbook）：推荐→`--if-absent`→`source=ai`，一轮 ≤10，幂等。
