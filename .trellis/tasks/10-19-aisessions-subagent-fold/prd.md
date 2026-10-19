# 子代理折叠进父会话时间线

## Goal

父会话里派发出去的子代理，在会话详情中以**可折叠卡片**内联显示：折叠时一行摘要，展开时看到子代理内容，并可跳到该子代理的独立会话。子代理派发孙代理时递归嵌套。

## 现状

- 父会话 JSONL 中，子代理调用就是一个普通 tool call（`toolName=subagent`），`arguments` 含 `agent` 与 `task`
- 子代理是独立进程、独立 JSONL 文件，位于同一 cwd 的 sessions 目录
- 子会话通过 `setSessionName` 写入 `session_info.name`，格式为 `"agent: 任务摘要"`
- 磁盘上**没有**父子映射文件；运行时靠 `PI_SUBAGENT_ORCHESTRATOR_SESSION_ID` 等环境变量，但不落盘
- `run-history.jsonl` 只记 agent/task/outcome，不含 session 引用
- 前端 `session-message.tsx` 已有 tool call 卡片，无折叠容器

## Requirements

### 数据层（不修改 pi-subagents 扩展）

- 从父会话 JSONL 提取所有 `toolName=="subagent"` 的调用，得到 `(agent, task, 时间戳)`
- 扫描同 cwd sessions 目录的子会话文件，按以下特征匹配到父调用：
  1. 同一 cwd 目录
  2. `session_info.name` 以该 agent 名开头
  3. 会话 createdAt 落在该 subagent 调用时间窗口内
- 匹配到多个候选时**不得猜测**：标记为 `ambiguous`，由 UI 呈现候选让用户选择
- 匹配逻辑为纯函数，可单测（用 fixture JSONL 覆盖：唯一匹配、多候选、无候选、孙代理）

### 渲染层

- subagent 工具卡片升级为可折叠容器 `SubagentCard`
- 折叠态：agent 名 + 任务摘要 + 状态/耗时 + 展开箭头
- 展开态：展示子代理会话内容（复用详情消息渲染），孙代理再嵌套
- 提供「在新标签打开该子会话」入口
- 嵌套深度上限 3 层，超出只显示摘要，防止无限展开

### 兼容

- 匹配失败时优雅降级为现有普通工具卡片，不得报错
- 不得改变父会话 JSONL 的解析结果（只读）

## Acceptance Criteria

- [ ] 派发过子代理的会话，其时间线中出现可折叠子代理卡片
- [ ] 展开后能看到子代理内容，折叠后回到一行摘要
- [ ] 能跳转到子代理的独立会话
- [ ] 孙代理以嵌套形式呈现，深度不超过 3 层
- [ ] 无法唯一匹配时不猜测，UI 呈现候选
- [ ] 无子代理的会话渲染无变化
- [ ] 匹配逻辑有单元测试覆盖上述四种情况