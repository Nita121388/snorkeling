# Agent 人格化（Emoji Persona）设计文档

> **Feature**: 把 agent 品牌 Logo 换成用户自定义 emoji 头像，两级作用域
> **Date**: 2026-10-24
> **Status**: ● 定稿待实现（planning 阶段）
> **Task**: `.trellis/tasks/10-24-agent-emoji-persona/`
> **镜像源**: 本文件是 `prd.md` + `design.md` 的对外定稿版；实现细节以 `design.md` 为准

---

## 1. 问题

Agent 类 Block 用厂牌 Logo（Claude / OpenAI / Gemini / OpenCode / Pi）表达身份。用户希望「人格化」：
点击图标 → emoji picker → 换成 emoji，让不同 agent 会话有自己的「脸」。

难点不在渲染，而在**作用域**与**一致性**：

- 共有 **9 个显示面**（见 §4），其中 4 处各自复制了一份 provider→icon 映射。
- aisessions 的历史会话是**扫盘产物**，没有 `blockId`，无法与 block 级设置关联。

结论：必须支持 **两级人格**，且读取路径必须收敛成唯一函数。

## 2. 两级作用域

| 层级 | 存储 | 生效范围 | 生命周期 |
|---|---|---|---|
| L2 block 级 | block meta `agent:emoji` | 该 block 的 A–E 面 | 随 workspace 同步 |
| L1 provider 级 | localStorage `snorkeling:agent-personas` | 全部 9 个面，含历史会话 | 本机（Phase 2 可提到 wconfig） |
| L3 默认 | 代码内置映射 | 品牌 Logo | 恒定 |

解析优先级：**L2 → L1 → L3**。

## 3. 交互

```
点 Block 头部 agent 图标
  ┌────────────────────────────┐
  │ [搜索框]                    │
  │ 😀 😁 😂 🤣 😃 😄 …          │  ← 复用 EmojiPicker（搜索/分组/最近使用）
  │ …                          │
  ├────────────────────────────┤
  │ ◉ 仅此会话                  │  ← 默认
  │ ○ 所有 Claude 会话          │
  │ ⚪ 恢复默认 Logo            │
  └────────────────────────────┘
```

- 第二入口：inline tab 图标右键菜单「设置 emoji 人格」。
- 关闭：`Esc` / 点外部 / 再次点图标。
- 「最近使用」与 markdown `/` `:` emoji 选择器共用同一份 recents。

## 4. 九个显示面

| # | 位置 | 层级 |
|---|---|---|
| A | Block 头部图标（主入口） | L2 + L1 |
| B | inline tab 图标（+右键菜单） | L2 + L1 |
| C | Tab 信息卡 agent 行 | L2 + L1 |
| D | Hover 卡片头部 | L2 + L1 |
| E | Session Overview 列表 | L2 + L1 |
| F | aisessions 来源筛选 chip | L1 |
| G | aisessions 会话行色点 | L1 |
| H | 右栏 widget 启动目标 | L1 |
| I | agent hook 设置弹窗 | L1 |

一次改动同时删掉 `sources.tsx` / `widgets.tsx` / `agenthooksettingsmodal.tsx` 里的三份重复映射。

## 5. 关键约束

1. **定宽渲染**：emoji 用 `13px` 定宽 `inline-flex` span。inline tab 的跑马灯与溢出折叠、
   aisessions 的虚拟滚动行高都依赖稳定尺寸，任何 `width:auto` 都会引发布局抖动。
2. **单 grapheme 校验**：`Intl.Segmenter` 严格校验，`"🦊🦊"` / `"ab"` / 带 ZWJ 残片一律丢弃。
3. **响应式订阅**：所有面必须通过 `useAgentPersonas()`（`useSyncExternalStore`）订阅，
   否则只有 A 面会刷新。
4. **模块级常量禁止**：`sources.tsx` 的 `CHAT_SOURCES` 必须改成组件内 `useMemo([personas])`。
5. **零后端改动**（MVP）：block meta 走既有 `setmeta` RPC；provider 人格走 localStorage。

## 6. 测试

- 纯函数：`normalizeAgentEmoji` 正反例、`getAgentIcon` 优先级链
- store：读写往返、坏 JSON 回退、跨窗口 storage 事件
- 交互：picker 默认 scope、切换 scope 写入目标、remove 分层清除
- 像素级回归：有人格 vs 无人格，tab 宽度与行高差 ≤ 1px（CDP 截图）

## 7. Phase 2（未纳入本期）

把 L1 提到 `wconfig`：

```go
// pkg/wconfig/settingsconfig.go
AgentPersonas map[string]string `json:"agent:personas,omitempty"`
```

需 `task generate` 重生成 `frontend/types/gotypes.d.ts`。因为读写被封在 `persona-store` 里，
届时只改 store 实现，9 个显示面零改动。

## 8. 不在范围

自定义图片 / 颜色 / 昵称、emoji 动画、设置页独立入口、issessions 后端改动、
`agent:provider` 识别逻辑调整。

---

## 9. 实现事实（2026-10-29 更新）

本节记录**实际落地**与上文设计的差异，以本节为准。

### 9.1 作用域从「block 级」改为「会话级」

上文 §2 的 L2 定义为 block 级（block meta `agent:emoji`）。实测与用户反馈证明这是错的：

- block 是窗口里的实例，切 tab / 关掉重开 / resume 后人格丢失；
- aisessions 历史会话是扫盘产物，没有 blockId，永远读不到 L2。

因此 L2 改为 **会话级**，key = `sessionId`（即 block meta 的 `agent:sessionid` /
aisessions 的 `session.id`）。「仅此会话」现在的语义是：**这个会话出现在任何地方都用同一张脸**。

最终解析链：

```
会话级 emoji (localStorage snorkeling:agent-session-emojis, key=sessionId)
  → block meta agent:emoji（仅兼容旧数据）
  → provider 级 persona (localStorage snorkeling:agent-personas)
  → 品牌 Logo
```

### 9.2 新增文件

| 文件 | 作用 |
|---|---|
| `app/agent-persona/session-persona-store.ts` | 会话级 store（外部 store + storage 事件同步） |
| `app/agent-persona/use-session-personas.ts` | `useSessionEmojis()` + `sessionEmojiAtom` jotai 镜像 |
| `app/agent-persona/agent-persona.scss` | `.agent-emoji-icon` / picker footer / loading 样式 |

### 9.3 尺寸自律（emoji 放大但控件不变）

`.agent-emoji-icon` 盒子固定 13px（`--row` 12px），只放大字形（font-size 15.5 / 14px）
并 `overflow: visible`；picker 项 18→22px、网格 `minmax(34px,1fr)`。
因此 inline tab 宽度、aisessions 虚拟行高不会因「有人格」而抖动（遵守 §5 约束 1）。

### 9.4 picker 行为修复

- 搜索框聚焦：mousedown 只对非表单元素 `preventDefault`，输入框用 ref + rAF + 80ms 兜底聚焦；
  打开入口（block 头 / hover 卡 / 右键菜单 / 列表行）`preventDefault + stopPropagation`。
- 自适应：宽度 `min(320, 100vw-24)` 且 left 夹到视口内；网格 `auto-fill`；
  分类栏 `flex-wrap`（不再横向滚动）；高度按锚点上下剩余空间计算。
- 共享改动，markdown 文档 emoji picker 同享（同一 `EmojiPicker`）。

### 9.5 Tab「更多」下拉

`TabMoreMeta` 增加 `agentProvider / agentSessionId / viewIcon`；行首新增 16px 图标槽：
会话 emoji → provider emoji → 视图图标（非 agent 行也占位，保证左对齐）。
hover Agent Card 早已支持 emoji，无需改动。

### 9.6 aisessions 行

来源标签改为按钮：点击直接开 picker（`blockId: null`，同时提供「仅此会话 / 所有 X 会话」），
`stopPropagation` 避免误触行激活。历史行把 `session.id` 作为 sessionId 传入，
所以会话级 emoji 在历史列表与 resume 后都成立。
