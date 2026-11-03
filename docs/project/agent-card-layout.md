# Agent Hover Card — 信息层级重排（2026-11-03）

> 任务：`.trellis/tasks/11-03-agent-card-hybrid/`
> 原型：`design/prototypes/agent-card-hybrid/`（◐ 已落地）
> 改动文件：`agent-hover-card.tsx`、`info-card.scss`、`session-note-section.tsx`、
> `property-list.{tsx,scss}`、`property-ai.tsx`、`session-note-hook.ts`

## 卡片长什么样

```
┌───────────────────────────────────────────────────────┐
│ [30px 头像]  Pi                        ● Working ★ ⤢  │
│              未指定 · First User Message               │
│ ┃ 功能问题：列表编辑时文本位置抖动、样式变化…           │
│ ◷ Updated                                      2m ago │
│ ▤ Created                                       3d ago│
│ ◇ Tags                                              — │
│ ≡ Note                                              — │
│ + Add property              ✨  3ce67d75…7ca2      ⧉  │
└───────────────────────────────────────────────────────┘
```

- **身份**：30px 头像块（`getAgentIcon` 的 logo / emoji / 未来文字徽标三态共用容器）+
  名称 13px/600 + 副标题 10.5px mono（`model · titleSource`）。
- **右上三件套**：状态 chip（`--info-card-accent` 11% 底 + 26% 描边 + 6px 圆点）、
  收藏按钮（`aria-pressed`，写入期间 disabled）、放大按钮（`embedded` 形态不渲染）。
- **标题**：12.5px 正文色、2 行截断、左 2px 状态色竖线、`title` 挂全文。
- **属性**：26px 行，`icon + label 68px + value 右对齐`；顺序固定
  `Updated → Created → Tags → Note → 自定义`；空值 `—`；时间为相对值 + 绝对时间 tooltip。
- **底部**：单行 `+ Add property` + `✨`（AI 属性填充）+ session id（8+4 截断）+ 复制。

## 与之前实现的差异

| 之前 | 现在 |
| --- | --- |
| 左侧 3px 通长状态色条（agent-card-accent 方案 E） | 移除；状态由 chip + 圆点 + 标题引用线表达 |
| 18px logo + 13px provider + 11px model 同一行 | 30px 头像块 + 名称/副标题两行 |
| 独立状态行（dot + label） | 收进右上 chip |
| `Starred` 占一整行 checkbox | 星标进右上角 |
| `Title Source` 占一整行（`first_user_message`） | 并入副标题（humanized） |
| `Empty` 斜体英文 × 2 | `—` |
| 时间 `Nov 3, 2026 11:24` | `2m ago`（hover 显示绝对值） |
| `+ Add a property` / `✨ AI auto-fill` 两行 | footer 单行（AI 按钮收成图标） |
| session id 独立一行 + 复制按钮 | footer 右组，id 截断 |

## 状态链路

- 星标：`useSessionNoteState().toggleStarred()` → `service.Mark(key, next, "")` →
  `dispatchAISessionNoteUpdated(updated)` → `session-note-cache` merge `marked` →
  hook `summary` 刷新 → 按钮态与其它面（列表 / 详情 / 其它卡片）一起更新。
  无本地影子状态；`starPending` 只用于禁用按钮与防重入，失败写 `error` + `saveStatus="error"`。
- 相对时间：`formatSessionRelativeTime(ms)`（`frontend/app/view/aisessions/utils.ts`）。
  时间格式后续若接 `11-02-datetime-format-config`，相对/绝对两个格式化函数都从这里替换。
- 标题来源：`humanizeKey(summary.titleSource)`（`property-model.ts`），`title` 保留原值。

## 组件 API

| 组件 | 新增参数 | 默认值 → 影响 |
| --- | --- | --- |
| `PropertyList` | `layout?: "notion" \| "agent"` | `notion`（现状）；`agent` = hover 卡行骨架 |
| `SessionNoteSection` | `variant?: "detail" \| "hover"` | `detail`（详情卡/弹窗）；`hover` = 标题引用块 + agent 行 |
| `SessionNoteSection` | `footerExtra?: ReactNode` | `undefined`；hover 卡传 session id + 复制 |
| `AIPropertiesButton` | `compact?: boolean` | `false`；`true` 时只渲染 ✨ 图标按钮 |
| `useSessionNoteState` | `starPending`, `toggleStarred()` | 新方法，详情卡与后续列表行可复用 |

未升级的调用点（`SessionDetailInfoCard`、Notion 属性面板）行为不变。

## 实测

| 场景 | 高度 |
| --- | --- |
| 旧卡片 @340 宽（`agent-card-beautify` 方案 0） | 296px |
| 新卡片 @340 宽（1 行标题、空 tags/note） | 251px |
| 新卡片 @340 宽（2 行标题 + tags + 2 行 note） | 259px |
| 新卡片 · 弹窗（embedded，520–640） | 布局不变，宽度放开 |

测量方式：`offsetHeight`（真实 Electron 渲染进程内注入同结构 DOM，用应用自身主题与
FontAwesome 计算）。原型页与真实渲染一致。

## 测试

| 文件 | 覆盖 |
| --- | --- |
| `property/property-list.dom.test.tsx` | agent 布局：不回显 starred/title_source、行顺序、行首图标、相对时间、`—`、footer 单行 |
| `property/property-list.test.tsx` | notion 布局回归（既有） |
| `store/session-note-hook.test.tsx` | `toggleStarred`：成功广播、失败保留原值并报错、pending 防重入 |

## 已知未做

- 未纳入 usage 指标（Duration / Cost / Context）—— 需要把底栏 usage 接进卡片。
- hover 卡不提供 AI 标题 / metadata 生成入口（属写操作，留在详情卡与弹窗；hover 卡只留 `✨` 属性填充）。
- 弹窗形态的属性区仍用 agent 行骨架（4 行），未切换成 Notion 属性面板；需要更宽的编辑体验时再切。
- 未做卡片内折叠属性（原型里有开关，真实卡保持 4 行常显）。
