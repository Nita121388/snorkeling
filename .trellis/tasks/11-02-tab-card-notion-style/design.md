# Design — Tab 悬浮卡 Notion 风格重设计

## 边界

| 位置 | 动作 |
|---|---|
| `frontend/app/tab/tab-info-card-model.ts` | 新建：纯函数（分类 / 汇总 / 状态呈现 / 分组标题） |
| `frontend/app/tab/tab-info-card-model.test.ts` | 新建：纯函数单测（node 环境，无 jsdom） |
| `frontend/app/tab/tab-info-card.tsx` | 改：删除内联逻辑与旧分区，改用模型输出 + 新结构 |
| `frontend/app/element/info-card/info-card.scss:444-548` | 改：`.tab-card` 段重写为 Notion 变体 |
| `design/prototypes/tab-card-v2/README.md` | 改：状态 ▲ → ◐（落地后） |

`TabInfoCard` 唯一使用方是 `frontend/app/tab/tab.tsx:240`，爆炸半径 = 1 个调用点 + 4 个 CSS 类前缀，无跨域消费者。

## 纯函数模块契约

```ts
export type TabBlockKind = "agent" | "chat" | "file" | "note" | "terminal" | "other";

export interface TabBlockCounts {
    agent: number; chat: number; file: number; note: number; terminal: number; other: number;
}

export type AgentStateKind = "working" | "thinking" | "idle" | "done" | "blocked" | "error" | "rate-limited" | "stale";

/** 状态 → { kind, label }；label 是 UI 文案（`Tool · bash` / `Idle` / `Done` …）。 */
export function presentAgentState(status: AgentStatusLike | null): { kind: AgentStateKind; label: string };

/** provider 全相同时返回 `Agents · pi ×4`，否则返回 `Agents`。 */
export function agentGroupLabel(providers: readonly string[]): string;

/** 分类 + 汇总，一次遍历。 */
export function countTabBlocks(blocks: readonly (Block | null)[]): TabBlockCounts;

/** 非 agent 计数的 chip 文案（`2 chat` / `12 file` …），零值不产出。 */
export function nonAgentChips(counts: TabBlockCounts): { kind: TabBlockKind; label: string }[];
```

判定顺序（沿用现有 `classifyBlock`，不改语义）：session-detail / chat → `chat`；agent terminal → `agent`；`SnorkelingBlockKindMetaKey === Note` → `note`；`view === "preview"` → `file`；`view === "term"` → `terminal`；其余 `other`。

`presentAgentState` 的映射：

| status | kind | label |
|---|---|---|
| null | `idle` | `Idle` |
| working + phase=tool + toolName | `working` | `Tool · <name>` |
| working + phase=tool（无 toolName） | `working` | `Tools` |
| working + phase=thinking | `thinking` | `Thinking` |
| working | `working` | `Working` |
| done | `done` | `Done` |
| blocked | `blocked` | `Blocked` |
| error | `error` | `Error` |
| rate-limited | `rate-limited` | `Rate limited` |
| stale | `stale` | `Stale` |
| 其它 | `idle` | `Idle` |

`status` 入参只取组件实际用到的字段（`state`、`phase`、`toolName`），避免模型层 import store 类型。

## DOM 契约（改后）

```html
<div class="info-card tab-card">
  <div class="info-card-section tab-card-identity">
    <div class="info-card-head">
      <span class="tab-card-workspace-icon">…</span>      <!-- 或 InfoCardIcon -->
      <span class="info-card-title tab-card-title">PPT</span>
      <span class="tab-card-flag"></span>
      <span class="tab-card-count">4 agents</span>
    </div>
  </div>
  <div class="tab-card-rule"></div>
  <div class="info-card-section">
    <div class="tab-card-sub">Agents · pi ×4</div>
    <div class="tab-card-agent-list">
      <div class="tab-card-agent-row is-working">
        <span class="tab-card-agent-emoji">🛠️</span>
        <span class="tab-card-agent-name">pi</span>       <!-- 混合 provider 时才有 -->
        <span class="tab-card-agent-pill">Tool · bash</span>
      </div>
      …
    </div>
  </div>
  <div class="info-card-section tab-card-props">
    <span class="tab-card-prop">2 chat</span>
    <span class="tab-card-prop">12 file</span>
  </div>
</div>
```

- 行内不再有状态圆点（`tab-card-agent-dot` 类删除），状态只由 pill 承担。
- `.is-working` / `.is-thinking` / `.is-done` / `.is-blocked` 挂在行上，pill 配色由它们驱动。
- 无 agent 且无非 agent 计数时，只渲染 identity + `Empty tab` 文案。

## CSS（`.tab-card` 段重写）

| 元素 | 规格 |
|---|---|
| `.info-card.tab-card` | `width/min-width/max-width: 268px`；`border-radius: 8px`；`padding: 9px 10px` |
| `.tab-card-title` | `font-size: 13px; font-weight: 600; letter-spacing: -0.01em` |
| `.tab-card-count` | `margin-left: auto; font-size: 10.5px; color: var(--secondary-text-color)`；`font-variant-numeric: tabular-nums` |
| `.tab-card-rule` | `height: 1px; background: var(--border-color); margin: 7px -10px` |
| `.tab-card-sub` | `font-size: 10.5px; color: var(--secondary-text-color); margin: 0 0 4px` |
| `.tab-card-agent-row` | `display:flex; align-items:center; gap:7px; height:26px; font-size:12.5px` |
| `.tab-card-agent-emoji` | `width:16px; font-size:13px; text-align:center; flex:none` |
| `.tab-card-agent-name` | `color: var(--secondary-text-color)` |
| `.tab-card-agent-pill` | `margin-left:auto; font-size:10.5px; line-height:17px; padding:0 7px; border-radius:999px; background: var(--form-element-bg-color); color: var(--secondary-text-color); flex:none` |
| `.is-working .tab-card-agent-pill` / `.is-thinking` | `background: rgb(from var(--agent-working-color) r g b / 0.14); color: var(--agent-working-color)` |
| `.is-done .tab-card-agent-pill` | `background: rgb(from var(--agent-done-color, #22c55e) r g b / 0.14); color: var(--agent-done-color, #22c55e)` |
| `.tab-card-props` | `display:flex; flex-wrap:wrap; gap:5px; margin-top:8px; padding-top:7px; border-top:1px solid var(--border-color)` |
| `.tab-card-prop` | `font-size:10.5px; padding:1px 7px; border-radius:4px; background: var(--form-element-bg-color); color: var(--secondary-text-color)` |

配色全部走既有 token；`rgb(from … / α)` 是本仓既有写法（见 `block.scss:288`），不用 `color-mix`。

## 兼容性 / 回滚

- 无后端、无 RPC、无持久化字段变更；纯前端视觉 + 结构。
- 回滚 = 还原 4 个文件（含删掉新增 model 与 test），单 commit 可 revert。
- 无 flag 需求：单一使用方，直接替换。

## 风险

| 风险 | 缓解 |
|---|---|
| emoji 在部分环境按文字呈现（单色），尺寸观感变化 | 只调 font-size，不加容器；真机对比后再决定是否加 chip |
| 删除行内 `pi` 后，混合 provider 的 Tab 标签退化 | `agentGroupLabel` 按"全相同才并入标题"分支，混合时仍逐行显示 |
| 268px 定宽下长 Tab 名溢出 | 标题沿用 `info-card-title` 的 ellipsis + `min-width:0`；后续可接 marquee |
