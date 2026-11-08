# Agent Card 美化方案集 — 参考 7 个成熟产品

> 同步状态：▲ 设计活跃（未实现）
> 镜像源：frontend/app/view/term/agent-hover-card.tsx, frontend/app/element/info-card/info-card.scss, frontend/app/element/info-card/session-note-section.tsx, frontend/app/view/aisessions/property/property-list.tsx, frontend/app/view/aisessions/title-source-badge.tsx
> 最后同步：2026-11-03

参照真实 hover 卡截图（Pi / Idle / `未指定` / 6 行属性 + AI auto-fill + session id）做的**信息层级重排**探索：
8 张卡 = 现状基线 + 7 套从成熟产品借来的语言，同一份数据、同一宽度、可逐项对照。

## 打开方式

```bash
# 直接双击 index.html，或
start design/prototypes/agent-card-beautify/index.html
```

> 已经选定方向？C 的行骨架 + D 的头像/引用块的**合成落地版**在
> [`../agent-card-hybrid/`](../agent-card-hybrid/)（卡高实测 296 → 251px）。

纯静态，无依赖、无构建。控制条：状态（idle / working / done / blocked / error）、宽度（320 / 360 / 420）、
深浅主题、1.15× 放大、标注（显示每方案的行高/字号/分割线数量）。点每张卡上方的「落地要点与 CSS」打开右侧抽屉。

深链（评审用）：

```
index.html?state=working&width=360           # 切状态 / 宽度
index.html?theme=light                       # 浅色（Notion/GitHub/Stripe 语言在浅色下更可读）
index.html?guides=1                          # 显示密度标注
index.html?notes=vB                          # 直接打开 B 的落地片段
```

## 现状诊断（为什么需要美化）

| 症状 | 证据 |
| --- | --- |
| 卡片过高 | 6 行属性 × 24px + 2 个按钮 + session 底行 ≈ 300px，而 hover 卡可用高度常常只有 ~340px |
| 信息无主次 | `Title Source` / `Starred` 这类几乎不看的行和 `Updated` 同样的行高、同样的灰 |
| 空值占位 | `Tags: Empty`、`Note: Empty` 各占一行 |
| 时间不可扫 | `Nov 3, 2026 11:24` 需要读三个 token 才知道「多久之前」 |
| 身份弱 | 18px 裸 logo + 13px 名字；emoji 人格（`agent-emoji-persona`）落地后图标会变成彩色 emoji，18px 装不住 |
| 数据浪费 | 底栏状态栏已有 `↑62k ↓5.4k R598k CH99.7% $0.014`，卡上只有 session id |

结论：**美化 = 砍行 + 给剩下的行分主次**，不是加装饰。

## 8 个方案

| # | 方案 | 参考产品 | 一句话 | 成本 |
| --- | --- | --- | --- | --- |
| 0 | 现状基线 | 当前实现 | 对照用，还原 `.info-card.agent-card` + `PropertyList mode=detail` | — |
| **A** | **Linear 式密度** | Linear · Issue panel | 星标上行、空值行不给高度、相对时间、行高 26 | CSS + 小改 JSX |
| **B** | **Vercel 状态条 + mono meta** | Vercel · Deployment card | 顶部 2px 渐变状态条、状态收 chip、属性折叠成 disclosure、meta 走等宽小字 | CSS + 折叠 state |
| C | Raycast 分组键盘浮层 | Raycast · Command palette | 大写分组头 + 30px 行 + 选中行 accent + 底栏键位提示 | CSS 为主 |
| D | GitHub 头像卡 | GitHub · Copilot / Actions | 32px 品牌头像块、标签 pill、标题引用块、hover 工具组 | CSS + JSX |
| **E** | **Warp 指标优先** | Warp · Agent pane | Duration / Cost / Context 三列上抬，TASK / DETAILS 大写分区 | TSX（接 usage 数据） |
| F | Arc 品牌玻璃 | Arc · Spaces / Amie | 品牌色渐变底 + 30px 发光徽标 + 呼吸 chip | CSS + 品牌色映射 |
| G | Stripe 仪表卡 | Stripe · Dashboard detail | 头部一条 + 两列 key/value 网格 + 单一主按钮 | CSS + JSX |

### 每套「借」的具体是什么

- **Linear**：`星标不是属性行`、`相对时间 + tooltip 绝对值`、`行 hover 才出操作`、`空值行保留但不占高度`。
- **Vercel**：`状态 = 颜色而不是文字`（顶部渐变条 + chip 双重编码）、`mono 小字 meta 用圆点分隔`、`细节默认折叠`。
- **Raycast**：`分组头替代分割线`、`键盘可达的最小行高 30px`、`底栏写可执行动作`。只适合弹窗形态。
- **GitHub**：`身份用头像块不用 18px 图标`、`标签 pill + "+ label" 虚线占位`、`标题做引用块建立主次`。
- **Warp**：`先给数字再给描述`（指标格是唯一的重边框，其余留白）、`CAPS 小标题 + 延伸线`。
- **Arc**：`品牌色进卡面`（15% 渐变 + 同色边框）、`状态色只出现在发光与 chip`。一屏多卡时会变噪声。
- **Stripe**：`一张卡只有一个主行动`、`两列 key/value 网格压缩高度`、`caps section label + hairline`。

## 推荐组合（A + B + E）

三处改动互不冲突，可以分开落地、分开回滚：

1. **A 的层级**（P0，CSS 为主）：星标搬进 `agent-card-head`；`Created/Updated` 渲染相对时间、`title` 挂绝对时间；
   `PropertyList mode=detail` 里空值行高度 0（或折叠进 `+N more`）；行高 24 → 26 换取更清晰的行间距。
2. **B 的状态条与 meta**（P1）：`::before` 从「左侧竖条」改成「顶部 2px 渐变条」（注意与
   `agent-card-accent` 已落地的「通长圆头直条」二选一，不能叠加）；模型名缺失值走虚线 chip；
   属性区默认折叠成 `Properties · 6` 一行。
3. **E 的指标三列**（P2）：把底栏 usage 接进卡片（`session-note-hook` / block meta 已有数据源，
   需要新增一个 store 订阅），Duration / Cost / Context 三列。

不建议整卡采用：**F**（一屏多卡 = 彩色噪声，适合 `agent-id-card` 开篇卡场景）、
**C / G**（宽度 320–360 的 hover 卡放不下，适合 `AgentCardModal`）。

## 与已有原型的关系

| 原型 | 关系 |
| --- | --- |
| `agent-card-accent/` | 已落地「左侧通长圆头色条」。本原型 B 的顶部状态条是它的**替代方案**，两者互斥。 |
| `notion-property-agent-card/` | 属性系统（schema / 类型编辑器 / AI 填充）的像素级参照；本原型只重排**层级与密度**，不重复属性编辑器。 |
| `agent-id-card/` | 开篇身份证卡；F 的品牌玻璃语言更贴合那个场景而不是 hover 卡。 |
| `design/plans/agent-emoji-persona.md`、`agent-avatar-text-badge.md` | 图标会从 logo → emoji → 文字徽标；D 的 32px 头像块是这三者的共同容器。 |

## 实现落点（若采纳）

| 改动 | 文件 |
| --- | --- |
| 卡面布局 / 状态条 / 折叠 | `frontend/app/element/info-card/info-card.scss`、`agent-hover-card.tsx` |
| 属性行高度、空值折叠、相对时间 | `frontend/app/view/aisessions/property/property-list.tsx`、`property-list.scss` |
| 星标上行、头部工具组 | `agent-hover-card.tsx` |
| 指标三列 | 新增 `agent-card-stats`（读 `agent-runtime-metadata-store` / usage） |

## 已知未做

- 没有做「自定义属性」和真实编辑（点铅笔只出 hover 态，不弹编辑器）——见 `notion-property-agent-card/`。
- 状态文案只覆盖 5 态（真实 `agent-status-derive.ts` 还有 rate-limited / stale / unbound 等）。
- 未接真实 `session-note-hook` 数据；数据写死在 `script.js` 顶部 `S`，便于逐字段替换。
- 未测 280px 极限宽度与 2 行标题 + 长 tags 的组合溢出。
