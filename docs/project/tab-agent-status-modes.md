# Tab Agent 状态编码（B / C / G）

状态：● 已实现（2026-11-25）

## 用户能力

App Tab 可显示 Tab 内每个 Agent 的状态。右键任意 Tab →「Agent 状态显示」可全局切换：

| key | 模式 | Tab 本体 | 溢出处理 |
|---|---|---|---|
| B | `avatars` 头像栈 | 最多 2 个水平 / 5 个垂直头像 | `+N`，悬浮 Tab 看完整清单 |
| C | `rail` 状态轨 | 每个 Agent 一段 3px 细轨 | 不裁状态，段宽自适应 |
| G | `hybrid` 状态轨 + 头像（默认） | B + C | 轨保证一个不漏，头像负责认人 |

设置键：`tab:agent-status-mode`，取值 `avatars | rail | hybrid`，默认 `hybrid`。这是全局偏好，不写 Tab meta。

## 行为契约

- 所有 Agent 状态都进入展示：working / done / blocked / stale / error / rate-limited / idle / unknown。
- 非 Agent Block 不进入状态编码，即使 store 有 fallback 状态。
- inline 子 Block 与顶层 Block 使用同一展开规则。
- ack 只把状态降为 seen，不删除 Agent。
- working 显示不等于未阅；旧「未阅强制可见」逻辑保持不变。
- 水平 Tab 仍保持 100–130px，不改变拖拽和布局模型。
- 颜色不是唯一信号：头像有 tooltip / aria-label，轨段有状态属性，悬浮卡有完整文字。

## 数据流

```text
AgentStatusStore（presented atom）
  → getTabAgentStatusEntriesAtom(tabId)
  → deriveAgentStatusView（state + read）
  → TabBadges（B / C / G）
  → 水平 Tab / 垂直 Tab / 「更多」菜单
```

旧 `getTabAgentStatusDotsAtom` 仍只负责未阅 D/R/S 提醒，`getTabsWithUnreadDotsAtom` 仍负责折叠 Tab 的强制可见。两条管线刻意分开。

## 实现锚点

| 位置 | 职责 |
|---|---|
| `frontend/app/tab/tab-agent-status-mode.ts` | 模式类型、默认值和归一化 |
| `frontend/app/agent-status/agent-status-tab-aggregate.ts` | 全量 Agent 状态派生 atom |
| `frontend/app/tab/tabbadges.tsx` | B/C/G 渲染、头像解析、溢出 |
| `frontend/app/tab/tab.scss` | 水平 Tab 名称避让、轨与头像样式 |
| `frontend/app/tab/tabcontextmenu.ts` | 右键全局模式设置 |
| `frontend/app/tab/tab.tsx`, `vtab*.tsx`, `tab-more-*` | 三个 Tab 展示面接线 |
| `pkg/wconfig/settingsconfig.go` | 注册配置键与枚举 |

## 验证

```bash
npx vitest run frontend/app/tab/tabbadges.test.tsx frontend/app/tab/tabcontextmenu.test.ts frontend/app/tab/tab-agent-status-mode.test.ts frontend/app/agent-status/agent-status-tab-aggregate.test.ts
node scripts/verify/tab-agent-status-modes/verify.mjs
```

真机台播种 6 个 Agent，覆盖 B/C/G、`+N`、名称避让、非 Agent 排除、配置回声、三主题和垂直 Tab。原生 Electron 右键菜单点击由单测覆盖，CDP 不检查原生菜单。

2026-11-25：用户明确豁免真机验证（本机性能较差），本次未运行 Electron 验证台；只保留脚本供后续使用。
