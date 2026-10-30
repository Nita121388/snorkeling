# Agent 图标：文字徽标（Text Badge）设计文档

> **Feature**: 在现有 emoji 人格之上，新增「文字 + 背景色」徽标作为 agent 图标
> **Date**: 2026-10-29
> **Status**: ● 定稿待实现（planning 阶段）
> **Task**: `.trellis/tasks/10-29-agent-avatar-text-badge/`（待创建）
> **镜像源**: 本文件是 `prd.md` + `design.md` 的对外定稿版；实现细节以本文件为准

---

## 0. 与前作的关系

`agent-emoji-persona.md` 已实现「单 emoji 人格」两级作用域（session / provider）。本设计**不推翻它**，只把「存的那个值」从纯字符串升级成结构化描述，新增一种 `badge` 形态。解析链、scope 逻辑、9 个显示面、存储 key 全部复用，改动面收敛在：

- 两个 store 的值类型 `string → PersonaAvatar`
- `getAgentIcon` 的 `AgentIconSpec` 加 `badge` 分支
- 渲染侧抽一个统一 `<AgentIcon>`，替换 9 面手写分支
- picker 顶部加「Emoji / 文字徽标」切换 + badge 编辑器

---

## 1. 问题 / 动机

emoji 人格解决了「脸」的个性化，但有两处不够：

1. **辨识度**：同类 provider 的多个会话换不同 emoji 后，快速扫一眼难以区分谁是谁（emoji 语义弱）。
2. **多字符标签**：用户想用缩写（"CL" / "AI" / "π" / 项目代号）直接标注 provider 或会话，纯 emoji 做不到。
3. **统一视觉**：emoji 是彩色字形，字号放大后和品牌 logo 的几何感不一致；文字徽标可和 logo 共用「方角色块」语言。

目标：在 emoji 之外，允许用户给 session / provider 指定「**最多 3 字符文字 + 背景色（可选文字色）**」作为图标，并沿用既有的两级作用域与跨面一致性。

---

## 2. 数据模型：值类型升级

新增共用类型。两个 store 的 `PersonaMap` / `SessionEmojiMap` 从 `Record<string,string>` 改为 `Record<string,PersonaAvatar>`。

```ts
// agent-persona/persona-types.ts（新增，两 store 共用）
export type PersonaAvatar =
    | { kind: "emoji"; emoji: string }
    | { kind: "badge"; text: string; bg: string; fg?: string }; // fg 缺省按 bg 亮度算对比色
```

**零迁移**：读取时旧字符串值自动当 `emoji`，混合 map（部分字符串、部分对象）都支持。

```ts
function coerceAvatar(raw: unknown): PersonaAvatar | null {
    if (raw == null) return null;
    if (typeof raw === "string") {
        return normalizeAgentEmoji(raw) ? { kind: "emoji", emoji: raw } : null;
    }
    if (typeof raw === "object" && !Array.isArray(raw)) {
        const o = raw as Record<string, unknown>;
        if (o.kind === "emoji" && typeof o.emoji === "string") return normalizeAgentEmoji(o.emoji) ? o as PersonaAvatar : null;
        if (o.kind === "badge") return normalizeBadge(o);
    }
    return null;
}
```

`setAgentPersona(provider, avatar | null)` / `setSessionEmoji(sessionId, avatar | null)` 入参从 `emoji: string` 改为 `avatar: PersonaAvatar | null`。`null` 仍表示删除键（reset 行为不变）。

---

## 3. 解析链 `getAgentIcon` 加 `badge`

`AgentIconSpec` 加一种：

```ts
export type AgentIconSpec =
    | { kind: "emoji"; emoji: string }
    | { kind: "badge"; text: string; bg: string; fg: string } // fg 永远是算好的最终色
    | { kind: "logo"; icon: React.ReactNode; iconColor?: string };
```

`getAgentIcon` 的 L2（session）→ L2（block meta 旧）→ L1（provider）→ L3（logo）优先级链**完全不动**。命中逻辑：

```ts
// session 级
const a = opts?.sessionEmojis?.[sessionId] ?? snapshot[sessionId];
const avatar = coerceAvatar(a);
if (avatar?.kind === "badge") return { kind: "badge", text: avatar.text, bg: avatar.bg, fg: avatar.fg ?? autoFg(avatar.bg) };
if (avatar?.kind === "emoji") return { kind: "emoji", emoji: avatar.emoji };
// 其余层同理，badge 压过 emoji 压过 logo
```

非法 badge（`normalizeBadge` 返回 null）**回落下一层**，不会卡死整条链 —— 与现有 emoji 坏值处理一致。

---

## 4. 渲染：统一 `<AgentIcon>` + 13px 盒约束

### 4.1 守死 §8 约束 1（定宽）

badge 与 emoji 一样**锁死在 13px 盒**里，只放大/缩小内部字形，盒子绝不长大。否则 inline tab 跑马灯测量、aisessions 虚拟行高会抖动。

```scss
.agent-badge {
    display: inline-flex; align-items: center; justify-content: center;
    width: 13px; min-width: 13px; height: 13px; line-height: 13px;
    border-radius: 3px; overflow: hidden; user-select: none; vertical-align: middle;
    font-family: var(--main-font, sans-serif);
    font-weight: 700; letter-spacing: -0.3px;
}
.agent-badge--row { width: 12px; min-width: 12px; height: 12px; line-height: 12px; }
```

字号按 text 长度收窄（塞进 13px）：1 字符 → 10px，2 → 9px，3 → 7px。`--row` 变体对应缩到 9/8/7px。

### 4.2 抽统一组件，替换 9 面手写分支

现状 9 个显示面各自 `kind === "emoji" ? <span> : icon`。badge 一来要改 9 处，顺手抽一个 `<AgentIcon spec={...} row? />` 集中渲染三种 kind，9 面统一调它 —— 以后再加第四种也不用扫场。

```tsx
// agent-persona/AgentIcon.tsx（新增）
export function AgentIcon({ spec, row }: { spec: AgentIconSpec; row?: boolean }) {
    if (spec.kind === "emoji") return <span className={cn("agent-emoji-icon", row && "agent-emoji-icon--row")}>{spec.emoji}</span>;
    if (spec.kind === "badge") return (
        <span className={cn("agent-badge", row && "agent-badge--row")}
              style={{ background: spec.bg, color: spec.fg, fontSize: badgeFont(spec.text.length, row) }}>
            {spec.text}
        </span>
    );
    return <span style={spec.iconColor != null ? { color: spec.iconColor } : undefined}>{spec.icon}</span>;
}
```

9 面接入点（替换手写分支）：`block.tsx`、`inlinetab-dropdown.tsx`、`tab-info-card.tsx`、`tab-more-agent-card.tsx`、`tab-more-menu.tsx`、`session-overview.tsx`、`aisessions.tsx` / `session-row.tsx`、`sources.tsx`、`widgets.tsx`、`agenthooksettingsmodal.tsx`、`agent-hover-card.tsx`、`term-model.ts`（viewIcon 把 badge 包进 iconbutton）。

---

## 5. Picker 交互：顶部加模式切换 + badge 编辑器

`AgentEmojiPicker` 顶部加一行 tab 切换，选「文字徽标」时隐藏 emoji 目录，露出编辑器。scope 逻辑（`persona-scope.ts`）**完全不动** —— badge 只是 avatar 的一种，照样 session / provider 两层写。写入从 `applyEmoji(str)` 改名 `applyAvatar(avatar)`。

```
┌──────────────────────────────────┐
│ [😀 Emoji]  [🅰 文字徽标]          │  ← 新增切换
├──────────────────────────────────┤
│ 预览：[ CL ]  ← 实时 badge        │
│ 文字： [__]  (maxlength 3)        │
│ 背景： [#1f6feb] ■■■ swatches…    │
│ 文字色： [自动] / [自定义 #fff]    │
├──────────────────────────────────┤
│ ◉ 仅此会话  ○ 所有 X 会话          │  ← 原 scope 不变
│ [恢复默认 Logo]                    │
└──────────────────────────────────┘
```

预设色板给一组可读底（蓝/绿/粉/橙/紫/红/灰/青），外加成熟颜色选择器自定义。fg 默认自动算，**提供手动覆盖但默认隐藏**（避免选择疲劳）。切换 Emoji / 文字徽标时保留各自已填值，来回切不丢。

`emoji-only` tab 显示模式（`tab-display-store.ts`）对 badge 同样生效：隐藏标题，仅留图标 + 状态点。

### 5.1 颜色选择控件选型：`react-colorful` + 复用 `colord`

项目已装 `colord@2.9.3`（dependencies，运行时可用），色值校验与对比色计算直接白嫖，不手写。新增仅一个 UI 库：

| 候选 | 版本 | 体积 | React 19 | 结论 |
|---|---|---|---|---|
| **`react-colorful`** ✅ | 5.8.1 | ~2.8 kB gzip，零依赖 | peer `>=16.8`，兼容 | **主选**。事实标准，API 极简，`HexColorPicker` + `HexColorInput` 正好对上 `#RRGGBB` 存储，无全局样式污染 |
| `@uiw/react-color` | 2.10.3 | 大（整套色板/色轮） | 兼容 | 开箱自带 swatch，但对「单色选择」偏重且色板不受主题控制 |
| `@simonwep/pickr` | 1.10.2 | 中 | 面向 DOM，React 需手动挂载 | 成品精致但集成/样式成本高，不值 |
| 原生 `<input type="color">` | — | 0 | — | Electron 里弹系统面板、跨平台样式不一，只当兜底 |

```tsx
import { HexColorPicker, HexColorInput } from "react-colorful";
import "react-colorful/dist/index.css";        // 必须引，否则布局塌
import { colord } from "colord";

const autoFg = (bg: string) => (colord(bg).isDark() ? "#ffffff" : "#111111"); // 替代手写 luminance
const valid = (c: string) => colord(c).isValid();                              // 替代正则
```

预设色板仍**自己渲染**（几行 button，跟主题调性对齐），`react-colorful` 负责自由取色 + `HexColorInput` 手动输入，内联塞进现有 picker 弹层，不用 portal、不另开弹窗。依赖变更只有一条：`"react-colorful": "^5.8.1"`（dependencies）。

---

## 6. 校验规则

`normalizeBadge(o: Record<string,unknown>): PersonaAvatar | null`：

- `text`：`trim` 后 1–3 字符；拒绝控制符/换行；**拒绝含 emoji**（与 emoji kind 互斥，避免叠 buff）；取前 3 个 grapheme（用 `Intl.Segmenter` granularity grapheme）。
- `bg`：用 `colord(value).isValid()` 校验，存 `#RRGGBB`（`HexColorInput` 输出即为此格式）；`colord` 顺带统一大小写/补全。
- `fg`：可选，合法色值，否则 `undefined`（解析链补 `autoFg(bg)`）。
- 任一非法 → 返回 `null` → 解析链回落下一层。

`autoFg(bg) = colord(bg).isDark() ? "#ffffff" : "#111111"`，放 `util`（`colord` 的 `isDark()` 已内置相对亮度阈值，无需自己实现 WCAG 计算）。

---

## 7. 文件改动清单

| 文件 | 改动 |
|---|---|
| `agent-persona/persona-types.ts` | **新增** `PersonaAvatar` 联合 + `coerceAvatar` |
| `agent-persona/persona-store.ts` | `PersonaMap` 值改 `PersonaAvatar`；`coerceAvatar` 兼容旧字符串；`setAgentPersona(avatar)` |
| `agent-persona/session-persona-store.ts` | 同上，`setSessionEmoji(avatar)` |
| `view/term/agent-logo.tsx` | `AgentIconSpec` 加 badge；`getAgentIcon` 返回 badge（fg 缺省补 `autoFg`）；新增 `normalizeBadge`（色值走 `colord.isValid()`） |
| `util/color.ts` | **新增** `autoFg(bg)`（包 `colord.isDark()`），供校验与渲染共用 |
| `package.json` | 新增依赖 `react-colorful@^5.8.1`（`colord` 已有） |
| `agent-persona/AgentIcon.tsx` | **新增** 三 kind 统一渲染 |
| `agent-persona/agent-persona.scss` | `.agent-badge` / `.agent-badge--row` |
| `view/term/agent-emoji-picker.tsx` | 顶部模式切换 + badge 编辑器；`applyAvatar` |
| `view/term/term-model.ts` | viewIcon 的 `iconSpec.kind === "badge"` 分支包进 iconbutton |
| 9 个显示面 | 手写分支替换为 `<AgentIcon>` |

存储 key **不变**（`snorkeling:agent-personas` / `snorkeling:agent-session-emojis`），旧 emoji 字符串读时自动转。

---

## 8. 关键约束（必须遵守）

1. **定宽 13px 盒**：badge 与 emoji 同锁 13px（row 12px），只动内部字号。任何 `width:auto` 引发布局抖动。
2. **单 grapheme / 多字符上限**：badge text ≤ 3 grapheme；emoji 仍走 `normalizeAgentEmoji` 单 grapheme 校验。
3. **响应式订阅**：9 面全部经 `useAgentPersonas()` / `useSessionEmojis()`（或 jotai 镜像 `agentPersonaAtom` / `sessionEmojiAtom`）订阅，否则只有部分面刷新。
4. **零后端改动**：纯前端 localStorage，沿用 `agent-emoji-persona.md` §5 约束 5。
5. **坏值回落**：非法 badge / emoji 不阻断链，落到下一层。

---

## 9. 测试

- 纯函数：
  - `normalizeBadge`：合法（1/2/3 字符、含 fg / 不含 fg）、越界长度、非法色、含 emoji 拒绝、空 text、控制符拒绝
  - `coerceAvatar`：旧字符串往返、混合 map、坏 JSON 回退
  - `getAgentIcon`：badge 压 emoji 压 logo 的优先级；badge 缺 fg 自动补 `autoFg`
  - `autoFg`：深色底→白字、浅色底→黑字边界值（复用 `colord.isDark()`，测阈值附近）
- store：读写往返（含对象值）、坏 JSON 回退、跨窗口 storage 事件
- 交互：picker 模式切换保留各自值、badge 写入目标（session/provider）、移除分层清除
- 像素级回归：有人格 / 有 badge 时 tab 宽、aisessions 行高差 ≤ 1px（复用现有 CDP 截图）

---

## 10. 不在范围

emoji 动画、图片图标、按 workspace 同步（L1 仍是 localStorage，Phase 2 提到 wconfig 见前作 §7）、昵称/前缀文案、设置页独立入口、issessions 后端改动。

---

## 11. 实现事实（待填写）

（实现后回填：实际落地与本文差异、新增/改动文件清单、遗留问题。）
