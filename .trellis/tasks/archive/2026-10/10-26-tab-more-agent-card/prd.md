# PRD：Tab「更多」下拉悬浮展示 Agent Card

## 背景与问题

Tab 数量变多后，用户靠「更多」下拉找目标 Tab（`frontend/app/tab/tab-more-menu.tsx`）。
但这个下拉每行只有 `badges + Tab 名 + ✕`，**看不出这个 Tab 里跑的是哪个 agent、什么模型、什么状态、note 写了什么**。
用户必须先切过去看一眼，再切回来 —— 而这正是"更多"下拉想避免的动作。

而 Block header 上已经有成熟的 agent 悬浮卡：`useInfoCardHover` + `InfoCardPortal` + `BlockInfoCard()` → `AgentHoverCard`
（`frontend/app/block/block.tsx:192,455,586`）。"更多"下拉缺的只是把同一张卡接到它的行上。

## 目标

1. 在「更多」下拉里 hover 任一行（Tab），浮出**该 Tab 内 agent 会话卡片**。
2. 单 agent 时与 Block header 悬浮卡完全一致（同一组件，不另造）。
3. 多 agent 时一屏内可读：最近更新的出完整卡，其余压成紧凑行。
4. 无 agent 的 Tab 维持现状（不出卡，保留原生 title）。
5. 不改变「更多」下拉现有的一切行为：搜索过滤、点击切 Tab、✕ 关 Tab、Esc / 点外侧关闭、折叠计数。

## 需求

### R1 悬浮触发
- 鼠标进入某行 → 延迟 300ms 浮出卡片；移入卡片保持显示；移出卡片 / 行 300ms 后关闭。
- 点击卡片外任意位置立即关闭（含卡内有焦点时先 blur 再关，保证 note 提交不丢）。
- 同一时刻全局只开一张卡（复用 `info-card-global` 独占管理器）。

### R2 卡片内容
- 该 Tab 的 agent block 集合 = `tab.blockids` + 各 block 的 `subblockids`，过滤 `isAgentTerminalMeta`。
- 1 个 agent → `AgentHoverCard` 完整卡（logo / provider / model / 状态 + note + tags + session id 复制）。
- ≥2 个 agent → 标题 `N agents in this tab` + 首块完整卡 + 其余紧凑行（logo + provider·model + 状态点 + 短 session id + 复制）。
- 0 个 agent → 不渲染卡片。

### R3 定位
- 卡片浮在行的右侧（`placement: "right"`），与 `block.tsx` inline tab 悬浮卡同策略。
- 垂直栏 / 水平栏两种「更多」面板都用同一套定位。

### R4 不破坏既有行为
- 搜索框输入、过滤结果、`+ 新建 Tab`、`收起未使用的 Tab`、行点击切 Tab、`✕` 关 Tab 全部不变。
- hover 浮卡不得抢焦点、不得触发行的 `onClick`。
- 面板滚动 / 重绘不受影响。

## 验收标准

- [ ] 「更多」下拉 hover 一个含 1 个 agent 的 Tab 行 → 右侧浮出与该 block header 完全一致的卡片。
- [ ] hover 一个含 ≥2 个 agent 的 Tab 行 → 出 `N agents in this tab` + 首块完整卡 + 其余紧凑行。
- [ ] hover 一个不含 agent 的 Tab 行 → 不出卡，原生 title 仍在。
- [ ] 移出 300ms 卡片消失；点面板外立即消失；移入卡片不消失。
- [ ] 垂直栏（`app:tabbar=left`）与水平栏（`app:tabbar=top`）行为一致。
- [ ] 搜索过滤后悬浮依然只对当前可见行生效。
- [ ] `collectTabAgentBlocks` 单测 + DOM 测试通过。

## 待确认

1. 多 agent 策略：**1 完整 + 其余紧凑行**（本 PRD 采用）／全部堆完整卡／只显示最近一个。
2. 是否需要在卡片上直接提供「切到该 Tab」的按钮（当前：点击行本身即可切换）。
