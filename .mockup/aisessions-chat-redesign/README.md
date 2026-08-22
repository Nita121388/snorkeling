# AI Sessions GUI 对话界面重构 — 现代 Agent Chat（v2）

> 同步状态：▲ 设计活跃（未实现）｜● 已落地｜▼ 过时待清理｜◐ 部分落地
> 镜像源：frontend/app/view/aisessions/session-detail.tsx, session-message.tsx, chat-composer.tsx, aisessions.tsx, workspace/agent-launch.ts
> 最后同步：2026-08-20
> 参考：beui agents 组件源码（prompt-input / message-scroller / message-bubble / tool-result / streaming-response）+ Paseo 聊天界面实现

---

## v2 设计语言（推翻 v1 的"卡片盒子风"）

v1 原型问题：到处是边框盒子、满幅行宽、无视觉层级，像管理工具不像聊天。
v2 直接对齐 beui/Paseo 的现代 Agent 对话设计：

| 决策 | 内容 |
|---|---|
| **AI 回复 = 开放散文** | 不加气泡、无边框，`text-sm leading-6` 直接排在画布上；代码块 `rounded-xl border bg-code` |
| **用户消息 = 软气泡** | accent 柔和底色 + 描边，右对齐，右下角小圆角，发送时 spring pop 动画 |
| **工具调用 = 一行摘要** | 收起态：chevron + 状态icon + 工具名 + 等宽截断预览 + 耗时；点击展开终端输出（限高滚动）。三态色：运行中蓝(shimmer扫光) / 成功绿 / 失败红 |
| **悬浮输入卡片** | `rounded-2xl` 卡片带阴影（非贴边扁条）；工具栏内嵌卡内：左附件圆钮、中模型 ghost 选择、右发送圆钮（运行中 morph 为红色停止钮） |
| **内容限宽居中** | 消息列与输入卡统一 `max-width: 768px` 居中，两侧留白呼吸 |
| **消息分组** | 连续同角色消息合并组；头像/名/时间只在组首出现一次 |
| **系统消息 = 居中胶囊** | 压缩提示等用 `rounded-full bg-surface` pill |
| **会话大纲 = MessageScroller PreviewRail** | 右缘垂直刻度轨（每回合一条 2px 横线，24px 行距）；hover 邻近项按距离 fisheye 缩放（1/0.68/0.44/0.25）；悬停弹出预览卡（用户消息标题 ≤56 字符 + AI 回复摘要 ≤88 字符，rounded-2xl border 卡片 + blur 进场）；点击跳转；滚动自动高亮当前所在回合 |
| **滚动跟随** | 流式时贴底跟随；用户上滚立即放权 + 底部浮现「跳到最新」胶囊 |
| **大纲轨** | 右缘 hover 浮出细轨按钮 → 弹出用户消息目录（替代旧常驻侧栏） |

## 集成点（与现有系统的对接）

### A. AI Sessions 配套修改
1. **会话列表行**：新增实时对话指示（活跃 GUI 聊天时来源点 ping 动画），其余搜索/过滤/标记能力不动
2. **详情区替换**：三行大 Header → 单行 46px 极简头栏（标题+来源点+模型chip+搜索/大纲/备注/标记/更多）；Note 编辑收进菜单
3. **来源门控**：pi = 完整体验；claude/codex/opencode = 只读浏览 + 底部优雅禁用横幅「此来源的 GUI 对话即将支持」+ 终端 Resume 按钮（后续接 ClaudeAdapter 自动解锁）
4. **新对话入口**：列表顶部「＋ 新对话」→ 空状态引导页（快捷建议可点）；首条消息触发后端 spawn pi 新会话（SessionID 省略机制已支持）

### B. New Agent 的 GUI/TUI 双模式
1. 面板新增「打开方式」分段选择：TUI 终端（默认，现状）/ GUI 对话
2. 启动分叉（agent-launch.ts）：TUI = 现有终端 block；GUI = 打开 aisessions block 并经现有 `aisessions:sessionid` meta 绑定会话
3. 偏好持久化 localStorage，一期默认 TUI
4. 分段控件抽成共享件 `LaunchModeSegmented`，群成员创建向导复用

### C. 群聊视图预览
成员彩色标识 + @mention 高亮 + 发送到目标选择 + 主持模式徽章——全部复用同一套消息组件。

## 三套主题

dark / light / monochrome 全量对齐 `frontend/app/theme.scss` 语义变量（--bg/--panel/--surface/--border/--accent/--error…），右上角 spark 图标循环切换验证。

## 交互演示要点

- 选不同会话体验三种状态：pi 流式中 / pi 历史 / claude 只读横幅
- 输入框发消息：thinking → 逐字流式（闪烁光标）→ 工具运行 shimmer → 完成 → 操作条（复制/重新生成 hover 显现）
- Esc 中止；Enter 发送 / Shift+Enter 换行；auto-resize 输入框
- 上滚出跟随胶囊；右侧 hover 出大纲轨；头部放大镜出行内搜索

## 实施路径（原型确认后）

| 阶段 | 内容 | 文件 |
|---|---|---|
| P1 | ChatView 组件族：MessageGroup/UserBubble/AssistantProse(复用 markdown.tsx)/ToolRow/ComposerCard/useFollowScroll | `frontend/app/view/aisessions/chat/*`（新增） |
| P2 | session-detail 切换到 ChatView（删右侧 Composer），接 SSE hook + DetailDelta 校准 | `session-detail.tsx` 重构 |
| P3 | 列表实时指示 + 新对话入口 + 只读门控横幅 | `session-row.tsx`, `aisessions.tsx` |
| P4 | LaunchModeSegmented + agent-launch 分叉 + New Agent 面板接入 | `workspace/agent-launch.ts` 等 |
| P5 | 群聊视图基于同一组件族搭建 | 新视图 |

## 待决问题

1. AI 散文的完成操作条（复制/重新生成）是否常显还是仅 hover？原型为 hover
2. 只读来源是否允许「复制 resume 命令」以外的动作？
3. GUI 模式偏好存 localStorage 还是 block meta（跨设备一致性的取舍）
