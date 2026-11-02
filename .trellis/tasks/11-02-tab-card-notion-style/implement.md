# Implement — Tab 悬浮卡 Notion 风格重设计

## 步骤

1. **建模型模块**
   - 新增 `frontend/app/tab/tab-info-card-model.ts`，导出 `TabBlockKind`、`TabBlockCounts`、`AgentStateKind`、`presentAgentState`、`agentGroupLabel`、`countTabBlocks`、`nonAgentChips`。
   - 从 `tab-info-card.tsx` 搬走 `classifyBlock` 与 `stateLabel` / `stateColor` 分支；`classifyBlock` 保持判定顺序不变（session-detail → chat 在最前）。
   - 不 import React、不 import store，status 入参用结构化最小类型。

2. **补单测**
   - 新增 `frontend/app/tab/tab-info-card-model.test.ts`（默认 node 环境，不用 `@vitest-environment jsdom`）。
   - 用例：见下方"验证"。

3. **改组件结构**
   - `tab-info-card.tsx`：删除独立计数行、`Agents` 分区头、行内状态圆点与 `AgentLogo` 尺寸逻辑；改为 identity / rule / agents / props 四段。
   - `TabAgentRow` 保留独立订阅 `AgentStatusStore` 的既有写法（不要提到父组件，避免整卡重渲染）。
   - emoji / logo 渲染分支保留，仅改外层类名与尺寸。

4. **重写样式**
   - `frontend/app/element/info-card/info-card.scss` 的 `.tab-card` 段（444-548 行）整体替换为 Notion 变体规格（见 `design.md` 的 CSS 表）。
   - 删除 `.tab-card-agent-dot`、`.tab-card-blocks`、`.tab-card-block-count` 等失效类。
   - 确认没有其它文件引用被删的类名。

5. **对账与文档**
   - `design/prototypes/tab-card-v2/README.md` 状态 ▲ → ◐，并注明落地的变体编号。
   - 跑 `node docs/sync-audit/audit-sync.mjs`，确认无镜像缺失告警。

## 验证

```bash
# 单测（新增模型测试）
npx vitest run frontend/app/tab/tab-info-card-model.test.ts

# 相邻回归（已有 Tab 测试）
npx vitest run frontend/app/tab/vtab.test.tsx frontend/app/tab/tab-more-menu.dom.test.tsx

# 样式类名无残留引用
grep -rn "tab-card-agent-dot\|tab-card-block-count" frontend/app
```

最后一轮全量检查：

```bash
npx vitest run frontend/app/tab
```

真机验证：启动 `npm run dev:cdp`，鼠标悬停到带 4 个 agent 的 Tab 上，核对 AC1–AC6（结构、provider 去重、pill 配色、`Idle` 兜底、宽度稳定、属性 chips）。

## 单测用例清单

| 用例 | 断言 |
|---|---|
| `countTabBlocks` 混合 block | 各类型计数正确，`other` 兜底 |
| session-detail / chat 优先于 terminal | 计到 `chat` 不进 `other` |
| `presentAgentState(null)` | `{ kind: "idle", label: "Idle" }` |
| `presentAgentState` working/tool | label 为 `Tool · bash` |
| `presentAgentState` working/tool 无 toolName | label 为 `Tools` |
| `presentAgentState` thinking / done / blocked / error / rate-limited / stale | kind 与 label 一一对应 |
| `agentGroupLabel(["pi","pi","pi"])` | `Agents · pi ×4` |
| `agentGroupLabel(["pi","claude"])` | `Agents` |
| `agentGroupLabel(["pi","PI"," pi "])` | 视为同一 provider（裁剪 + 小写归一） |
| `nonAgentChips` | 零值不产出；chat/file/note/terminal 文案正确 |

## 回滚点

- 步骤 1–2 完成后可独立提交（纯新增，零行为变化）。
- 步骤 3–4 完成是唯一有视觉影响的提交；`git revert` 该 commit 即回到旧卡片。
