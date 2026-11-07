# AI Sessions 功能说明

## 当前定位

AI Sessions 是 Snorkeling 的本机 AI 会话浏览器，用于在右侧 `Sessions` 入口中查看 Codex 与 Claude Code 的历史会话。

当前功能只读取运行 Snorkeling 后端的本机文件，不会直接扫描远程 SSH 主机。

## 数据来源

- Codex：`~/.codex/sessions`
- Claude Code：`~/.claude/projects`
- Claude Code cache：`~/.cache/claude/projects`
- Snorkeling 索引：`~/.snorkeling/ai-sessions/index.json`
- Snorkeling 标记与备注：`~/.snorkeling/ai-sessions/meta.json`
- 删除暂存目录：`~/.snorkeling/ai-sessions/deleted`

相关环境变量：

- `CODEX_HOME`：覆盖 Codex 配置目录，session 目录为 `$CODEX_HOME/sessions`
- `CLAUDE_CONFIG_DIR`：覆盖 Claude 配置目录，project 目录为 `$CLAUDE_CONFIG_DIR/projects`
- `WAVETERM_AI_SESSIONS_INDEX`：覆盖索引文件路径
- `WAVETERM_AI_SESSIONS_META`：覆盖标记/备注文件路径
- `WAVETERM_AI_SESSIONS_DELETED_DIR`：覆盖删除暂存目录

## 已支持能力

- 会话列表：默认按更新时间倒序；排序菜单支持 **Updated（更新时间）/ Created（创建时间）** 两个时间维度，各自可升/降序，可与消息数、子会话数组合成多键排序链；主排序键会随请求下发，由后端在 `limit` 之前排序
- 来源筛选：All、Codex、Claude Code
- 搜索：标题、备注、路径等字段
- 按 session id 筛选：搜索框直接匹配裸 id / id 片段 / 完整 key（`source:id:filePath`），支持 `session:` / `id:` / `key:` 前缀，大小写不敏感
- 筛选结果上下文补带：命中子代理时补带父代理，命中父代理时带出它的直接子代理 / fork。上下文行灰显并带 `fa-link` / `fa-sitemap` 图标。
  - 三档模式（筛选面板「包含上下文」）：`精确`（只显示命中，等于旧行为）/ `智能`（双向，默认）/ `只带子`（命中父才展开子）
  - 上下文行不占 `limit` 额度；每父最多 50 个、全局最多 500 个；`exclude` 条件命中时不补带
  - 结果数只统计命中行，列表尾部显示「(+N 上下文)」；全选与「复制 ID」默认只含命中行
- 标记：支持 mark/unmark，并可只看 marked 会话
- 备注：支持 session note，备注也可参与搜索
- 会话详情：用户消息与 AI 消息分角色展示，时间精确到秒
- 大纲：按用户消息生成 outline，支持跳转到详情位置
- 长消息折叠：长对话内容支持双击折叠/展开
- 运行指示（左粗 / 右细两段，2026-11-07）：
  - **左列** `RunningDot`（`session-row.tsx`）：6px 单点，working 才 `breathe` 1.6s，颜色取 `--agent-working-color`（蓝）。
    只回答「这个会话有活着的块」，点击跳转到该 block。旧实现是 4 个 4px 绿点装在 16×16 方框里整体
    `animate-spin` —— `animate-spin` 在本仓的既定语义是「请求未完成」（restoring / generating / fetching
    全用它），用在可能持续两小时的运行态上是语义错位；绿色在 agent-status 体系里属于 `done`，同色撞语义。
  - **右侧** `SessionRunBadge`（`session-run-badge.tsx` + `session-run-badge-view.ts`）：元信息行
    （`row-meta`）末尾 + `ml-auto`，15px 高 chip，带状态词与跑时，回答「跑到哪一步 + 跑了多久」。
    呈现数据全部由纯函数 `buildSessionRunBadgeView()` 产出，文案来自共享的 `agentStatusPresentation`，
    与 block 头部徽章 / Overview chip 不会漂移。三条输入分支：
    1. 有活跃块 + 该 block 有 `AgentStatus` → `Thinking` / `Tool: Bash` / `Done` / `Stale` + 跑时，可点击
    2. 有活跃块但 agent 未上报 → 只说 `Running`（不编造 phase），可点击
    3. 只有 GUI 对话在跑 → `Chat` 标记，不可点击（没有 block 可跳）
  - 原 `row-meta` 里第二个 `GUI Chat` spinner 已移除：同一行不该出现两个互不知晓的「运行中」标记。
  - 已知代价：`row-meta` 是 `flex-wrap`，默认 320px 宽度下左侧 5–6 个元素已占满 1 行，所以徽章会把该行
    撑成 2 行（实测 `15 → 38px`）。零成本替代（`nowrap` 策略 + 左侧截断）见
    `design/prototypes/aisessions-running-indicator/README.md` 的实测表。
- 恢复会话：支持打开新 terminal block 并尝试 resume
- 复制：支持复制 session ID、session folder path、resume command、单条消息
- 删除：删除前二次确认，源文件移动到 deleted storage

## 设计边界

- 当前是 local sessions，不是 remote sessions。
- `Mark` 与 `Note` 存在 Snorkeling 本机 meta 文件中，不写入 Codex/Claude 原始 session 文件。
- `Delete` 不直接永久删除源文件，而是移动到 Snorkeling 的 deleted storage。
- 详情默认显示最近一段消息，支持继续加载更早的消息，避免一次性渲染超长会话。

## 后续扩展方向

远程主机会话浏览建议作为 read-only MVP 开始：

- 在 service request 中增加 location/connection 参数
- 通过已有 remote connection 在远程主机扫描 session 文件
- UI 显示远程主机标识，避免和本机会话混淆
- 第一阶段只做 list/detail/search，不做 delete/resume

完整远程能力再逐步加入 mark/note、open in Files、delete、resume。远程 delete 与 resume 涉及权限和安全确认，应最后实现。

## 合并官方代码时的注意点

- 前端入口集中在 `frontend/app/view/aisessions/`
- 右侧默认入口在 `pkg/wconfig/defaultconfig/widgets.json`
- 后端 service 在 `pkg/service/aisessionsservice/`
- 本机 provider 与索引逻辑在 `pkg/aisessions/`
- `ManagerOptions` 用于后续扩展 provider、index/meta 路径，避免继续扩大 service 层改动面
- 父子上下文补带在 `pkg/aisessions/context_attach.go`（`attachContextExcluding`）；协议字段 `attachMode` / `attachMaxRows` / `attachTruncated`；行级标记 `SessionSummary.attached`（`parent` / `child`），只在请求期计算、不落库
