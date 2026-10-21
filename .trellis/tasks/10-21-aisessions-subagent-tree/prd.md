# AI 会话列表的子会话父子树

## Goal

pi 派发的子代理会话（subagent）与 fork，在 AI Sessions 列表里折叠到**父会话**之下：
父行一行摘要 + 子会话计数，子行缩进展示，默认收起。进入详情后仍保持上一轮已做的
「子代理卡片挂在派发它的那条消息下」。

## 现场证据（2026-10-21）

本机 `~/.pi/agent/sessions` 实测：

```
顶层会话（父）：621 个
子会话/fork：   542 个   ← 占全部会话的 47%，现在全部平铺在列表里
单个父会话最多挂 107 个子会话（其中 84 个 fork）
```

磁盘上的 3 种子会话形态（全部以 `.jsonl` 结尾，都已被 `collectJSONLFiles` 收进列表）：

| 形态 | 路径样例 | 层级 |
|---|---|---|
| fork | `<父>.jsonl` 同目录下的 `forks/<ts>_<id>.jsonl` | 4 |
| subagent（旧版） | `<父>.jsonl` 旁的 `<UUID>/...jsonl` | 4-5 |
| subagent（新版） | `<父>.jsonl` 旁的 `<UUID>/run-0/session.jsonl` | 6 |

例：
```
~/.pi/agent/sessions/--D--Code-Chemclin-InstrumentComm--/
├── 2026-09-17T00-33-25-808Z_01a0acc8-....jsonl            ← 父
└── 2026-09-17T00-33-25-808Z_01a0acc8-..../
    ├── 3506248a-3918-4874-b4ba-cfda11fdce9c/run-0/session.jsonl   ← 子代理
    └── forks/2026-09-17T02-26-30-501Z_01a1383b-....jsonl          ← fork
```

**父子关系只能靠目录结构判定**：这些子会话文件**没有** `session_info.name`
（没有 `"agent: 任务摘要"` 命名），因此既有的 `SubagentFold` 匹配（agent 名 + 时间窗）
在列表场景几乎必然落到 `missing`。上一轮的「详情内子代理卡片」依赖同一套匹配，
所以列表里完全看不到折叠效果——这是本任务要解决的问题。

参考实现：`E:/primary/projects/pi-session-library`（`server/scanner.ts` 的
`collectEmbedded` / `collectForks`，`SessionNode.parentKey / children`）。

## Requirements

### R1 层级识别（P0）

- 顶层 `<父>.jsonl` → `kind=session`，`parentKey=""`
- 同名的 `<父>.*` **目录**下的所有 `.jsonl`：
  - `forks/` 下 → `kind=fork`
  - 其余（UUID 目录 / `run-N/session.jsonl`）→ `kind=subagent`
  - `parentKey` = 父文件的 session key
- `parentKey` 与 `kind` 落到 SQLite 索引（schema 版本 4），已有索引自动迁移、不删数据
- 父文件本身不存在（目录孤儿）时：孤儿行按顶层 session 处理，不得报错或消失

### R2 列表树渲染（P0）

- 父行：标题后加子会话计数徽标（`+N`），行首加展开/收起箭头
- 子行：缩进 + 左侧竖线 + `fa-sparkles`（subagent）/ `fa-code-branch`（fork）图标 + 更小字号
- 默认**全部收起**
- 展开状态持久化（localStorage，与既有 `readCollapsedGroups` 同套路）
- 子会话 >20 个：默认显示 20 个 + "显示全部（还有 N 个）"按钮
- 父子必然同 project（同一目录），嵌套落在既有 project 分组内，不改变分组语义

### R3 交互（P0）

- 单击行 = 选中；双击 = 打开 Detail Block；Ctrl/Cmd+点击 = 强制新开 Detail Block
- 点箭头 / 计数徽标 = 只展开或收起，不选中、不打开
- 行内控件（星标、Resume、Copy、note/标签、running dot）不影响选中与展开

### R4 筛选与搜索（P1）

- 筛选/搜索**命中子会话**时：自动展开其父，并保证该子行可见
- 父会话被筛掉但子会话命中：子行提升为顶层行展示，不丢结果
- 父行显示"匹配子会话"标记 + accent 高亮计数徽标
- 顶层排序只排 `kind=session` 的行；子会话跟随父行

### R5 行内 note / 标签展示（P1）

- note 文字与标签徽标**同色**（都用 accent），不再一个 primary 一个 accent
- 折叠态默认显示 **4 个**标签，超出显示 `+N`
- `+N` **可点击**：展开显示全部标签（`flex-wrap` 换行，行高自适应），展开后出现"收起"
- 点 `+N` 只展开/收起，**不进入编辑态**、不选中行、不打开详情
- 点 note 文字仍是"进入编辑态"（现有语义不变）
- 展开状态不跨会话记忆，每次进入默认折叠（避免行高跳动）
- 单个标签徽标保持纯展示（不做行内筛选）

### R6 详情内子代理卡片（保持）

- 已实现的「SubagentCard 挂在派发它的消息下」继续可用
- `SubagentFold` 的匹配逻辑**改为优先使用目录结构**（`parentKey` 已知时无需再猜），
  agent 名 + 时间窗作为兜底

## Non-Goals

- 不改 pi 写入的任何 JSONL（只读）
- 不做多级递归嵌套（子会话不再派生子会话；磁盘上 `UUID/run-N/` 已是最深层）
- 不改 project 分组的视觉与语义
- 不动详情消息级子代理卡片的渐进加载（上一轮已完成）

## Constraints

1. 不写、不删、不移动 `~/.pi`、`~/.codex`、`~/.snorkeling/ai-sessions` 下任何用户数据
2. 不引入新的运行时依赖；不用 framer-motion（项目未装），折叠动画用既有 CSS 过渡套路
3. SQLite schema 3→4 必须**向前兼容**：旧索引能直接打开，缺列时回填
4. 前端遵循 `.trellis/spec/snorkeling-docs/frontend/`（hooks / state / component / type-safety）
5. 慢校验（全量 tsc）交 async 子代理，不阻塞主会话
6. 工作区他人改动（`utils.ts` 的 CRLF 差异等）不得提交

## Acceptance Criteria

- [ ] 打开 AI Sessions 列表：`kind=session` 的父行显示 `+N` 计数徽标与展开箭头，子会话默认不可见
- [ ] 点箭头展开后：子行缩进、有 sparkles/branch 图标、字号更小；父行视觉不塌
- [ ] 本机实测 542 个子会话全部归位（列表总行数从 ~1163 降到 ~621）
- [ ] 展开状态刷新页面后保持
- [ ] 单个父会话下 107 个子会话：默认只显示 20 个 + "显示全部"按钮，点击后全部展开
- [ ] 搜索命中子会话：父自动展开且该子行可见；父被筛掉时子行提升为顶层
- [ ] 单击行只选中；双击打开 Detail Block；Ctrl+点击新开 Detail Block
- [ ] 点星标/标签/Resume/Copy 不改变选中态、不展开、不打开详情
- [ ] 详情内点开一个派发记录，仍能看到子会话内容（消息级卡片不回归）
- [ ] `go test ./pkg/aisessions/...` 全绿，新增覆盖 3 种路径形态 + 孤儿目录 + schema 迁移
- [ ] `npx vitest run frontend/app/view/aisessions` 全绿
- [ ] 本任务引入的 `tsc` 错误为 0
- [ ] 1.7GB 旧索引首次打开不触发全量重建，缺列自动回填
- [ ] note 文字与标签徽标同色（accent）
- [ ] 折叠态显示 4 个标签，其余折叠为 `+N`
- [ ] 点 `+N` 展开全部标签并可收起；点 note 文字仍进入编辑态
- [ ] 点 `+N` 不会选中行、不会打开 Detail Block、不会进入编辑态
