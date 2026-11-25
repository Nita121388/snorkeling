# Tab 上的 Agent 状态 · 七种交互原型

> 同步状态：◐ 部分落地（B / C / G 已进入真实代码；A / D / E / F 与 180px 宽度实验仅保留在原型）
> 镜像源：frontend/app/tab/tab.tsx, frontend/app/tab/tabbadges.tsx, frontend/app/tab/vtab.tsx, frontend/app/tab/vtabbar.tsx, frontend/app/tab/tab-info-card.tsx, frontend/app/agent-status/agent-status-tab-aggregate.ts, frontend/app/agent-status/agent-status-view.ts
> 最后同步：2026-11-25

入口：`index.html`（单文件原型，双击即可，无构建、无网络依赖）。

方案笔记：本轮设计讨论与说明页 `docs/answers/agent-tab-status-options-20261125.html`。尚未写入 Obsidian。

---

## 目标

比较“每个 Agent 的状态都显示到 App Tab”的七种编码方式。

原型默认打开推荐的 **G 状态轨 + 头像**。同一份 Agent 数据可切换水平 / 垂直 Tab、100–130px 窄宽度、G 方案 180px 放宽实验、1–8 个 Agent 和四种状态场景。

## 七种方案

| key | 方案 | Tab 本体 | 完整清单 | 空间成本 |
|---|---|---|---|---|
| A | 聚合计数 | `2W · 1D · !1` | 悬浮卡 | 低 |
| B | 微头像栈 | 每人一个图标 + 状态角标 | 悬浮卡 | 中高 |
| C | 分段状态轨 | 每人一段 3px 细轨 | 悬浮卡 | 低 |
| G | 状态轨 + 头像 ★ | 细轨保底 + 头像栈 + `+N` | 悬浮卡 | 中 |
| D | 双层混合 | 紧凑汇总 + 清单入口 | 悬浮卡 | 低 |
| E | 激活展开 | 激活 Tab 第二行展开 | 悬浮卡 | 中 |
| F | 全量 chip | 平铺状态文字和跑时 | 本体溢出 | 很高 |

## 交互

- 顶部方案按钮或底部对比卡切换 A–G。
- 右键 Tab 打开设置菜单：关闭 / 仅提醒 / A–G，以及 G 的宽度策略。
- 菜单设置标记为“所有 Tab”，原型用 localStorage 模拟持久化。
- G 方案可切换“固定 130px / 放宽到 180px”。
- 状态轨始终为每个 Agent 保留一段；头像栈超出显示 `+N`。
- 悬浮、聚焦 Tab 打开 Agent 清单。
- 点击清单行模拟定位到 Block。
- 对 done / blocked / stale / error / rate-limited 可切换 ack。
- ack 后 Agent 行仍保留，只降低强调。
- “推进一次状态”模拟一次 Agent 事件。
- 主题按钮循环深色 / 浅色 / 黑白。
- Tab 支持方向键切换，清单行支持 Enter / Space。

## 设置入口

建议把编码选择放在 Tab 右键，而不是设置页。用户正在看 Tab，决策也在 Tab 上完成。

- “Agent 状态显示”是全局偏好，子菜单标注“所有 Tab”。
- “宽度策略”只在 G 水平布局启用。
- 真实实现可复用 `buildTabContextMenu` 的 submenu + radio 结构。
- 已落地配置键：`tab:agent-status-mode`（`avatars | rail | hybrid`）。
- 180px 宽度策略未落地；真实产品仍保持 100–130px。

## 镜像事实

- 水平 Tab 默认 130px，最窄 100px：`tabbar.tsx` 的 `TabDefaultWidth` / `TabMinWidth`。
- 真实 Tab 骨架是 `.tab > .tab-inner > .name + TabBadges + close`。
- 旧 `getTabAgentStatusDotsAtom` 仍只收未阅 done / blocked / stale；新的 `getTabAgentStatusEntriesAtom` 为 B / C / G 提供全部 Agent 状态。
- 真实 TabBadges 已支持 B / C / G；legacy 主图标 1 + 副点 2 分支仍保留。
- TabInfoCard 已列出全部 Agent、状态、阶段和跑时：`tab-info-card.tsx`。
- 状态文案与 read 语义应复用 `agent-status-view.ts` / `agent-status-chip-view.ts`。

## 设计不变量

1. 展示与提醒分离：working 可显示，但不强制把折叠 Tab 拉回主栏。
2. ack 改变强调，不删除 Agent。
3. 多 Agent 不能靠单一最高优先级状态互相覆盖。
4. 颜色不是唯一编码：chip 有字母，头像有 tooltip，清单有状态词。
5. 100px 下名称、状态区、关闭按钮不重叠。
6. 水平 Tab、垂直 Tab、「更多」菜单应共用同一份 summary。

## 自检

```bash
node design/prototypes/tabs-shell-launch/tab-agent-status/selfcheck.mjs
```

出口：`0` 全绿 / `1` 断言失败 / `2` 环境错误。

覆盖：

- 七个方案可切换。
- 右键菜单 9 个编码选项、2 个宽度选项，不溢出视口。
- 右键选择立即生效并写入原型 localStorage。
- 8 个 Agent 的可见 + 溢出守恒。
- G 固定宽度下状态轨覆盖全部 Agent，头像显示 2 个 + `+N`。
- G 放宽到 160px 后头像显示 5 个，状态轨仍覆盖全部 Agent。
- D 悬浮清单、ack 保留、双清单同步。
- E 激活展开与宽度变化。
- F 在 130px 下真实溢出。
- D 在 100px 下三块区域无重叠。
- 垂直 Tab、状态场景、Agent 数量、三主题。
- 输出截图到 `verify-runs/prototype-tab-agent-status/`。

## 与真实代码的差异

- 原型 Agent 数据是本地夹具，不连接真实 `agentstatus` 事件。
- 原型 Tab 使用 flex 安全布局，真实水平 Tab 使用绝对定位。
- 原型的清单行可点击定位，真实 TabInfoCard 当前仍是只读信息卡。
- 原型的 ack 是即时模拟，真实实现应走 `agent-status-ack.ts`。
- 原型的菜单设置用 localStorage 模拟；真实实现应走配置 atom / `SetConfigCommand`。
- 原型没有复刻真实 Tab 的拖拽、重命名、折叠和「更多」面板。

## 待拍板

- D1：采用推荐的 G，还是只保留 C / B 单一方案。
- D2：idle / unknown 是否在 Tab 本体计数，还是只进悬浮清单。
- D3：working 是否只显示不提醒，绝不强制展开折叠 Tab。
- D4：完整清单入口是悬浮卡、点击弹出，还是两者都保留。
