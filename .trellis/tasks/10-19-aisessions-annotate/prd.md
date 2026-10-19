# 会话消息标注（选中文字 / 命令 / 工具 / 其他信息）

## Goal

在「学习回看一个 AI 处理过程」时，能对会话详情里的**任意信息**做批注：选中某句话、某条命令、某个工具调用、thinking 片段，都能加批注。再次打开该会话详情时，批注按原位置重新显示。

## 需求来源（用户明确要求）

> 不止要选中文本标注，命令也要，等其他信息也需要支持标注。

## 现状

- 已有 `frontend/app/view/aisessions/use-dom-highlight.ts`：基于 CSS Custom Highlight API 做**跨 DOM 文本定位**（TreeWalker + Range），不改 DOM，React 重渲染不冲突——批注高亮直接复用这套机制
- `session-message.tsx` 已有搜索高亮的调用先例（`useDomTextHighlight`）
- 消息渲染：user = 纯文本；assistant = `WaveStreamdown` markdown；thinking = `ThinkingDisclosure`；tool call = 工具卡片
- `ai_session_meta` 表是 **session 级** 元数据（marked/note/title），没有消息级数据
- SQLite schema 当前 v3，已有迁移机制（`migrateSessionTags` 等可仿）

## Requirements

### 标注对象（全类型覆盖）

| 目标 | 锚定方式 |
|---|---|
| user 消息正文 | 选中文字 |
| assistant 正文（markdown 渲染后） | 选中文字 |
| assistant thinking | 选中文字 |
| 工具调用（命令 + 参数） | 选中文字 + **整条标注** |
| 工具结果输出 | 选中文字 + **整条标注** |
| 整条消息 | 未选中文字时，批注落在整条上 |

### 交互

- 选中文字 → 弹出小气泡「批注」→ 输入框 → 提交
- 批注以**虚线高亮**显示，与搜索高亮的实线可区分
- 点击高亮处 → 显示已保存批注（可编辑 / 删除）
- 一条消息可有多条批注（学习时会反复补充）
- 未选中文字时提供「批注本条」入口

### 锚点设计

- 锚点 = `itemKey`（依赖 L1 稳定 id）+ 原文字符区间 `start/end`
- AI 消息是 markdown 渲染，选区需通过 TreeWalker 反算回**原文** `message.text` 的区间
- 跨文本节点（被 `**粗体**`、代码块拆散）用多个 Range 表示一个批注
- **实时流式消息不加批注**（内容在变，偏移会错位）；落盘为历史后才可批注

### 数据层

- 新表 `ai_session_annotations`（schema v3 → v4，仿照现有迁移写法）：

```sql
ai_session_annotations(
  session_key TEXT NOT NULL,
  item_key    TEXT NOT NULL,
  start       INTEGER NOT NULL DEFAULT -1,  -- -1 表示整条标注
  end         INTEGER NOT NULL DEFAULT -1,
  body        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY(session_key, item_key, start, end)
)
```

- RPC：新增读取（按 session 取全部批注）与写入（新增 / 编辑 / 删除）
- **不新增第二套存储**，走现有 `SQLiteIndex` 路径
- 不触碰 pi JSONL

### 重新打开时

- 打开会话详情 → 拉取批注 → 按锚点重新计算 Range → 渲染高亮
- 批注数在消息旁以角标显示

## Acceptance Criteria

- [ ] 能选中 user 消息中的某句话加批注
- [ ] 能选中 assistant 正文中的某段加批注（markdown 渲染后）
- [ ] 能选中 thinking 片段加批注
- [ ] 能对工具调用（命令+参数）加批注
- [ ] 能对工具结果加批注
- [ ] 未选中文字时可整条批注
- [ ] 关闭后重新打开会话详情，批注按原位置显示
- [ ] 批注可编辑、可删除
- [ ] 一条消息可有多条批注
- [ ] 实时流式消息中不能批注
- [ ] 批注高亮与搜索高亮可区分，且互不干扰
- [ ] 有单元测试覆盖锚点计算（含跨节点选区）与存储读写
- [ ] schema 迁移后旧索引不丢数据

## 明确不做

- 不做删除 / 软删（用户已决定搁置）
- 不做 fork（未决定，暂不纳入）
- 批注导出 markdown（未决定，暂不纳入）