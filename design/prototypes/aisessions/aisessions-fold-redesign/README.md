# AISessions 折叠重设计原型（Tool Fold / Agent Fold）

> 同步状态：▲ 设计活跃（未实现）
> 最后更新：2026-09（会话详情折叠可见度整改）

直接在浏览器打开 `index.html`（无需构建）：

```bash
start design/prototypes/aisessions-fold-redesign/index.html
```

## 背景

会话详情（`frontend/app/view/aisessions/session-detail.tsx`）目前有两类聚合元素：

1. **工具数量折叠**（`ToolGroup` + `groupConsecutiveTools`）：连续工具调用合并成一行摘要。
   - 现状：纯文字行，chevron 仅 hover 出现，N 混在自然语言里，折叠/展开无层级缩进。
   - 问题：**不明显**，扫读时很容易漏掉「这里其实藏了 N 个工具」。
2. **子代理折叠**（`SubagentCard`）：
   - 现状：复用 `ToolCallRow`，名称写死 `subagent`，视觉上跟普通工具完全一样；匹配失败时直接降级成普通工具行。
   - 问题：**几乎感知不到子代理的存在**；用户反馈「只识别出来工具数量的折叠，没识别出来 subagent」。

## 原型内容

- **A · 工具折叠卡**：左 rail 色条 + 计数徽标 + 始终可见 chevron + 右侧「展开」hint；折叠态即可扫读「几件事 + 各是什么」，展开态逐条可点。含完成 / 运行中两种状态。
- **B · 子代理折叠卡**：紫色身份色（`#a855f7`，与工具绿区分）+ agent 头像 + 名称 + 任务摘要 + 状态点 + 「打开」入口；展开走左侧紫色导轨，内联渲染子会话，孙代理再嵌套一层。含完成 / 工作中 / ambiguous（多候选）三种状态。
- **C · 混合时间线**：两类折叠卡同屏出现，验证视觉层级与扫读清晰度。

## 设计要点（对齐现有 token）

| 用途 | token / 值 | 来源 |
|---|---|---|
| 主背景 | `rgb(34,34,34)` | `theme.scss --main-bg-color` |
| 主文字 | `#f7f7f7` | `--main-text-color` |
| 次文字 | `rgb(195,200,194)` | `--secondary-text-color` |
| 边框 | `rgba(255,255,255,0.16)` | `--border-color` |
| 工具绿 | `rgb(88,193,66)` | `--accent-color` |
| 子代理紫 | `#a855f7` | `--agent-stale-color` |
| 工作中蓝 | `#3b82f6` | `--agent-working-color` |
| 成功 | `rgb(78,154,6)` | `--success-color` |
| 失败 | `rgb(229,77,46)` | `--error-color` |

## 落地建议（下一阶段）

- 工具卡：升级 `ToolGroup`，保留现有 `ResizeObserver` 高度测量，改为 `grid-template-rows: 0fr/1fr` 过渡（更平滑、无需测高），加计数徽标 / 左 rail / 始终可见 chevron。
- 子代理卡：升级 `SubagentCard`，头部从 `ToolCallRow` 改为独立身份头（头像 + 名称 + 任务 + 状态 + 打开按钮），紫色 token 复用 `--agent-stale-color`。
- 两者共用一套 `.fold-card` 基础样式，工具绿 / 子代理紫只换 rail 与 accent。

## 待排查（与原型无关的实现缺口）

用户反馈「子代理没出来」，原因很可能在**数据匹配层**而非渲染层：

- `SubagentCard` 依赖 `SubagentFold` RPC 返回 `matches`；`subagentMatchFor` 只在 `toolCall.name === "subagent"` 时命中。
- 若 RPC 未返回匹配（`status === "missing"` 或无候选），渲染会走普通 `ToolCallCard` 分支，视觉上与普通工具无异 → 用户感知「没出来」。
- 建议单独排查：`service.SubagentFold` 是否被调用、`summary.key` 是否为空、父 JSONL 里是否真有 `toolName=subagent` 的记录。

---
该目录仅作设计评审，随时可删。
