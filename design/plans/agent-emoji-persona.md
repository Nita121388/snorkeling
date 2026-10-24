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
