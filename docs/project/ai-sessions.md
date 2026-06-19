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

- 会话列表：按最后更新时间排序，支持 newest/oldest 切换
- 来源筛选：All、Codex、Claude Code
- 搜索：标题、备注、路径等字段
- 标记：支持 mark/unmark，并可只看 marked 会话
- 备注：支持 session note，备注也可参与搜索
- 会话详情：用户消息与 AI 消息分角色展示，时间精确到秒
- 大纲：按用户消息生成 outline，支持跳转到详情位置
- 长消息折叠：长对话内容支持双击折叠/展开
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
