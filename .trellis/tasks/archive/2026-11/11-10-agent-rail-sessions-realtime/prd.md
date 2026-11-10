# Agent 会话轨与列表实时性整改

> Confirmed: 2026-11-10 @nita（Q3 选方案 A：事件驱动）

## 背景与根因（调查结论）

三个用户可见的缺陷，同一片数据链路（agent 会话 → 前端轨道/列表）：

1. **SessionOutlineRail 底部水平滚动轴**
   滚动容器只声明了 `overflow-y-auto`，CSS 把另一轴从 `visible` 强制成 `auto`；
   轨宽 36px == 刻度宽 36px，消息 > ~37 条出现 4px 竖滚动条后内容区只剩 32px
   → 横向溢出 4px → 底部长出水平滚动轴。CDP 实测：`clientW:32, scrollW:36`。

2. **新建 Agent 不显示右侧波浪线刻度轨**
   `TermAgentMessageRail` 只在 sessionId 变化时拉一次 `UserOutline` RPC。
   新会话的时间线是「块启动 → 后端写 agent:sessionid → 前端触发唯一一次拉取 →
   此刻第一条用户消息还没写进会话文件 → 0 条 → 轨道隐藏 → 之后没有任何代码路径再拉」。
   `outline-cache.ts` 的 `invalidateUserOutline` 全工程无人调用；30s TTL 只防重复请求。
   恢复的会话首拉时文件已有消息 → 显示。这解释了「新的容易不显示、恢复的一直显示」。
   会话持续聊刻度数也永远冻结在挂载时刻。

3. **AISessions 列表不实时**
   列表更新完全靠 60s 轮询（块 meta 可调 Off/30s/1m/2m/5m）；
   没有「新会话出现 / 会话内容变化」推送事件（现有 titleupdated/scanstatus/generationstatus
   都是别的用途）；后端无文件 watcher；远程连接自动刷新整体禁用；
   块不可见 / 窗口 hidden 时暂停。

## 目标（做什么）

- R1：消除轨道底部水平滚动轴（一行 CSS 语义修复）。
- R2：TUI 右侧刻度轨随会话进展实时增长——事件驱动（agentstatus）+ 慢轮询兜底 + 空结果快速重试。
- R3（方案 A）：后端检测会话文件变化并广播 `aisessions:sessionschanged` 事件；
  前端 AISessions 列表订阅事件做去抖后台刷新，60s 轮询保留为安全网。

## 非目标

- 不改 codex sessionid 扫盘捕获逻辑（歧义/超时属另一问题，仅缓解不根治）。
- 不给 opencode 补 hook（10-26 任务域）。
- 不做远程连接（SSH/WSL）的实时推送；远程仍靠手动刷新。
- 不改 GUI 会话详情页 rail 的数据流（它跟着 detail 刷新走，已有 60s + 事件路径）。

## 验收标准（命令 → 期望输出）

- R1
  - `node scripts/verify/agent-session-rail/verify.mjs`：
    用 >37 条用户消息的真实会话播种 TUI 轨，断言 overflow-x hidden / 无横向溢出 / 竖滚动条真出现 → exit 0。
  - 单测：渲染 SessionOutlineRail，容器 className 含 `overflow-x-hidden`。
- R2
  - 单测（fake timers）：挂载后空 outline → 3s 内发起重试；
    收到一次 agentstatus 事件 → 去抖后发起 forceRefresh 拉取；
    unmount 后无遗留 timer；sessionId 变化后重试链重置。
  - 真机：新建 agent 会话发出第一条消息后 ≤10s（有 hook）/ ≤35s（无 hook 兜底）
    刻度轨出现（人工核验 + verify 台 skipped 说明）。
- R3
  - Go 单测：`Manager.DetectChangedSessionFiles` 对新文件返回 1、对未变化返回 0；
    watcher 发布器 2s 节流。
  - 真机：运行中的 agent 每写一条消息，AISessions 列表 ≤10s 内出现新会话行/
    更新消息数（事件链端到端，verify 台或人工）。
  - 回归：60s 轮询行为不变（`aisessions:autorefreshintervalms` 语义不动）。
