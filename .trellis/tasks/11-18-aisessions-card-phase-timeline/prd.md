# AISessions 卡片阶段时间线：两级阶段与段落表

## Goal

Overview 的 agent card 要显示会话的时间线，细到设计 / 分析 / 处理 / 验证各阶段时长。阶段分两级：**大阶段**（里程碑级，由用户指令切换与交付物划分，可跨多轮）＋**小阶段**（动作级，按消息区间归类）。数据源与展示组件（`Message.timestamp`、`DurationBar`、`fold-duration` 的差分口径）都已存在，缺的是段落表、渐进更新器与卡片堆叠条。

设计全文：`design/plans/session-kernel-design-20261118.md`（第 4 节；原始出处：Hero 据点仓 `nita/hero-feaa3f86` `design/session-kernel-design-20261118.md` @ 274f8e56）

## Requirements

### R1 段落表（新表）

```
ai_session_phase_segments (
  session_key TEXT NOT NULL,
  level       TEXT NOT NULL,   -- 'macro' | 'micro'
  kind        TEXT NOT NULL,   -- 见 R3 十类
  started_at  INTEGER NOT NULL,
  ended_at    INTEGER,         -- 当前段为 NULL
  status      TEXT NOT NULL DEFAULT 'open'   -- open | final | pending
  , PRIMARY KEY(session_key, level, started_at)
)
```

- **只 append 与回填 `ended_at`**：历史段不重算。
- 边界拿不准就标 `pending`，下一批消息到了再定。

### R2 渐进更新器

```flow
新消息 -> {新 user 指令?}
{新 user 指令?} -> 开新大阶段: 粗边界先落库, ended_at 空
{新 user 指令?} -> 归入当前大阶段: 只动最后一段
当前大阶段 -> {小阶段变了?}
{小阶段变了?} -> 结束旧段开新段: 回填 ended_at
大阶段收尾 -> 冻结: 交接语或交付物出现, 时间节点不再变
```

- 新消息只影响最后一个（大/小）段；全量重算只允许在 `pending` 解除或用户反馈触发重判时进行，且只重判相关段。
- 更新器可挂在会话索引/巡检路径上运行（具体挂载点实现时定，PRD 不锁定）。

### R3 小阶段十类原子标签 + 合并成段

| 类 | 判定信号 |
|---|---|
| 设计 | 无工具 + 长文本；drawio/图表 |
| 分析 | read / grep / find / ls / glob |
| 处理 | edit / write / apply_patch；普通 bash |
| 验证 | bash 含 test / build / lint / run |
| 部署运维 | scp / upload / deploy / publish |
| 文档 | write `*.md`；docs 目录 |
| 调研 | search / fetch / curl |
| 等待·审批 | approval hook phase |
| 等待·回复 | 相邻消息间隔 >5 分钟 |
| 其他 | 无法归类，卡片灰色 |

- 两步法：先给单条消息打原子标签，再把**相邻同标签**合并成段——不存在混合段。
- 一条命令多属性时优先级：验证 > 处理 > 分析 > 设计。
- 「其他」占比 >20% 时卡片给提示（该类需补规则；同时是学习闭环输入）。
- 时长口径沿用 `fold-duration`：相邻消息 timestamp 差分；卡片标注「近似」。

### R4 卡片显示：先大后小

- Overview agent card 的堆叠条（复用 `DurationBar` 样式）默认只画**大阶段**（色块少）；悬浮/展开才画小阶段占比。
- 两级数据同源（同一张段落表），不存两份。
- 「其他」灰色；hover 显示各类时长精确值（`formatDuration`）。

### 约束

- 纯后计算 O(消息数)，零新增写入路径成本（更新器只在段边界变化时写一行）。
- 不改 `ai_session_messages`、不动 `fold-duration` 的既有口径（工具组/子代理卡时长不变）。
- 大阶段判定复用「意图→阶段→状态」三层判定（守夜人 playbook，另仓），本仓只消费结论性信号。

## Acceptance Criteria

- [ ] AC1 给定固定 jsonl 夹具，段落表输出与设计页 4.1 示例一致（大阶段跨轮、小阶段在消息区间）
- [ ] AC2 十类标签各有一个单测用例；`go test ./...`（或对应包）全绿
- [ ] AC3 优先级裁决：`bash go test ./...` 归验证不归处理（测试覆盖）
- [ ] AC4 增量正确性：追加 1 条消息后只有最后一段变化，历史段字节不变
- [ ] AC5 卡片渲染：小会话显示大阶段条，悬浮出小阶段占比；「近似」标注存在
- [ ] AC6 「其他」>20% 的会话出现补规则提示
- [ ] AC7 现有 `fold-duration` / `duration-bar` 测试不回归

## Notes

- 相关代码：`frontend/app/view/aisessions/duration-bar.tsx`、`fold-duration.ts`、`session-row.tsx`（卡片）、`pkg/aisessions/sqlite_index.go`（表结构）、`pkg/agentstatus/agentstatus.go`（approval phase 信号）。
- 依赖：读取侧可用 `11-18-aisessions-turn-reading` 的 `session info` 拿规模；不依赖其完成，可先在 GUI 路径做。
- 拍板中（设计页 G2 第 3 问）：聚合在后端（本 PRD 按此写，接口只回各类总时长）。
