# CommonText 发送目标选择器 · New Agent 视觉统一

> 同步状态：▲ 设计活跃（未实现）
> 镜像源：frontend/app/commontext/commontext-send-button.tsx, frontend/app/commontext/commontext-send-target.ts, frontend/app/session-overview/overview-add-agent-modal.tsx, frontend/app/workspace/widgets.tsx, frontend/app/modals/modal.scss
> 最后同步：2026-11-25

## 一句话

把 CommonText 的发送目标浮层统一到 Overview New Agent 的**选择语言与视觉密度**：命名 Agent chip、模型下拉、可见路径列表、聚焦块 / 新建、Tab、后台执行与动态确认按钮全部保留。

## 用户意图

用户反馈：`commonText` 发送时的 Agent 选择弹窗，在样式上可以与 Overview 的 `New Agent` 适当统一。

本原型把“统一”解释为：

- 统一**选择方式**：Agent 从纯 logo 单行改为带名字的 30px chip；选中态使用 `accent soft + 左侧 2px 强调条 + 明确文字`。
- 统一**模型与路径**：模型使用 28px 下拉；目录从紧凑 picker 升级为 New Agent 同款可见、可滚动路径列表。
- 统一**层级与密度**：10px 段标签、32px 表单控件、6px 基础圆角、克制的分段线、固定 header / 可滚动内容 / footer。
- 统一**位置与动作表达**：完整落点只在 footer 路径摘要出现一次；主按钮随“聚焦块 / 新建”切换文案。
- 不统一**业务流程**：CommonText 仍负责“把已有文本发到哪里”，New Agent 仍负责“创建什么 Agent、在哪个路径创建”。

## 原型怎么用

直接浏览器打开 `index.html`，无外部资源依赖。

- 顶部切换深色 / 浅色 / 单色主题。
- 场景切换“聚焦 Agent / 新建 Agent”。
- Agent chip 可点击；聚焦场景下选不同 Agent 会自动切到新建。
- 模型下拉随 Agent 切换候选；选择具体模型会切换到新建。
- Tab 可展开选择；`＋` 新建 Tab。路径候选直接展示为可滚动列表，点击任意路径即新建。
- 路径列表底部保留“浏览其他目录…”入口。
- 后台执行开关可切换，footer 摘要与发送文案实时更新。
- 主发送按钮演示成功 toast；取消、关闭、`Esc`、点击外部关闭下拉均可操作。
- “设计标注”显示 1–5 号变更点。

## 设计决策

### 1. Agent 选择：纯 logo → 命名 chip

真实现状是 32×32 logo 单行，名字只存在于 tooltip。Overview New Agent 使用 30px 高、带名字、可换行的 chip。

原型沿用后者：

```text
[ Claude Code ] [ Codex ] [ Gemini ] [ OpenCode ]
                  ↑ selected: accent soft + 2px left rail
```

默认 Agent 仍只保留一个小圆点提示，不新增“设为默认”操作，避免扩大行为范围。

### 2. 保留 CommonText 的三段功能骨架

- 目标模式：聚焦块 / 新建。
- 目标配置：Agent / 模型 / Tab / 路径。
- 执行方式：后台执行开关。
- 动作：取消 / 发送或新建并发送。

没有为了“像 New Agent”而删掉 Tab、目录或后台执行。

### 3. 删除重复目标卡，落点收敛到 footer

现状在模式 chip、目标卡、footer 三处重复表达同一落点。原型只保留：

- header 的模式 chip；
- Agent / 模型 / Tab / 路径当前值；
- footer 一行路径摘要。

这样更接近 New Agent 的“选择项 + 底部路径 crumb”结构，也降低浮层高度。

### 4. 模型与路径选择是本次核心新增

用户进一步明确：缺的不是“再换一层皮”，而是 New Agent 中实际存在的**模型选择**与**路径选择**。

- 模型：Agent chip 下方增加 28px 下拉，首项为“自动（可能按项目偏好）”；切换 Agent 时模型重置，避免把 Claude 的模型 ID 带到 Codex。
- 路径：保留 Tab 选择，下面直接展示路径候选列表；行高、图标、左 2px 选中轨、滚动容器与 New Agent 同构。
- 默认路径：`folder = null` 表示跟随所选 Tab 的第一条推荐路径，行尾显示“默认”；点击任意路径后变为显式选择。
- 这是**设计新增能力**，真实落地时需要扩展 `CommontextSendConfig` 与建块请求，把模型 override 传入 `createAgentBlockDefForProfile`；本原型不假装当前发送链路已经支持。

Vendor、搜索 / 历史、定时发送仍不在本包范围。

## 与真实代码的对应

| 原型元素 | 真实落点 | 说明 |
|---|---|---|
| `发送到 Agent` header | `CommontextSendButton` / `SendTargetPanel` | 替换现有无标题紧凑面板；标题可直接复用 `commontext:send.menuLabel` 或新增短词 |
| 命名 Agent chip | `commontext-send-button.tsx` `data-commontext-agent-row` | 保留 `data-commontext-agent-chip`、`aria-pressed`、默认圆点与 `title` |
| 模型下拉 | `overview-add-agent-modal.tsx` 的 model select / `agent-catalog.ts` | 设计新增；切 Agent 重置模型，具体模型作为 override 传入建块请求 |
| 目标模式 chip | `TargetChip` | 保留 `focused / create` 与现有 `preview.kind` 判定 |
| Tab / 路径列表 | `data-commontext-tab-row` / `data-commontext-dir-row` | Tab 保留 picker；目录改为可见路径列表，保留 `applyTab()` 切 Tab 后路径重置与浏览目录动作 |
| 后台执行 | `data-commontext-send-footer` 左侧 switch | 保留 `config.background` 与现有提示语义 |
| footer 路径摘要 | 新增单一摘要位 | 替代目标卡和 footer 重复摘要；不参与发送判定 |
| 主按钮 | `data-commontext-send-submit` | 文案继续由 `preview.kind` 决定 |

### 复用的 New Agent 视觉锚点

- `frontend/app/workspace/widgets.tsx`：New Agent 浮层 header、Agent chip、路径列表、footer。
- `frontend/app/workspace/hero-launch-window.tsx`：同款 30px Agent chip 与 28px 模型输入。
- `frontend/app/session-overview/overview-add-agent-modal.tsx`：居中 Modal 内的 New Agent 同款分区。
- `frontend/app/session-overview/session-overview.scss`：`.session-overview-add-agent-*` 的间距、chip、路径行尺寸。
- `project-docs/design-system.md`：语义 token、32px 控件、6px 圆角、focus / disabled / selected 状态契约。

## 行为不变量（落地时必须保留）

1. `preview.kind` 仍是“聚焦块 / 新建”和主按钮文案的唯一来源。
2. 聚焦场景下修改 Agent、模型、Tab 或路径，必须切换到新建，不能静默改到聚焦块。
3. 切换 Agent 必须重置模型选择；切 Tab 必须把路径重置为“跟随该 Tab”。
4. 路径列表的默认行来自所选 Tab 的推荐候选；点击任意行都是显式选择并触发新建。
5. `background=false` 仍保留发送后跳转目标 Tab 的旧行为。
6. 模型 override 只影响新建块；不能改写已存在聚焦块的运行模型。
7. 远端块、目录浏览失败、发送失败等既有状态不能因视觉重构消失。
8. 浮层自身不整体滚动；只有内容区在长列表时滚动，header / footer 固定。

## 验收判据

### DOM / 交互

- `[data-commontext-agent-chip]` 数量等于探测到的 profile 数量。
- 每个 Agent chip 都有可见名字、`aria-label` / `aria-pressed`，选中态存在左侧 2px accent 条。
- `聚焦块 / 新建` 两种场景下，Agent / 模型 / Tab / 路径 / 后台执行五个区域都存在。
- 模型下拉首项为“自动（可能按项目偏好）”；切换 Agent 后模型回到自动，候选随 Agent 更新。
- 选择具体模型、不同 Agent、Tab 或路径后，模式变为 `create`，主按钮变为“新建并发送”。
- 切 Tab 后路径恢复为该 Tab 的默认推荐行，且路径候选整体更新。
- 路径列表至少渲染 2 条候选，选中行有 `aria-selected` 与左侧 2px accent 条；列表区独立滚动。
- footer 只出现一处完整落点摘要；不再渲染重复目标卡。

### 视觉 / 主题

- 深色、浅色、单色三套主题均可读，选中态不只依赖颜色，还有左轨与文字。
- 所有键盘可聚焦控件有 `:focus-visible`。
- 440px 常规宽度与窄视口下无横向溢出；长列表只滚内容区。
- 原型在 1440×900 与 390×844 视口各截图一张，人工检查 header / footer 不被裁切。

## 验证记录

- 2026-11-25：Playwright + Edge 对自包含页面执行 **38/38** 断言，全部通过。
- 覆盖：Agent 选中轨 2px、模型默认项与候选、选择模型触发新建、切 Agent 重置模型、路径行选中轨、路径点击、Tab 菜单、切 Tab 后路径候选与默认行更新、新建 Tab、后台开关、三主题、聚焦场景恢复、按钮可访问名称、Esc 关闭 / 重开、390×844 无横向溢出且浮层与 footer 完整在视口内、无运行时错误。
- 截图视口：1440×900（深色）、1440×900（浅色）、1440×900（单色）、390×844（窄屏）。
- `node project-docs/sync-audit/audit-sync.mjs --json`：本原型未产生镜像缺失或未标记问题；仓库既有 47 条历史问题不在本包范围。

## 状态

- [x] 阅读真实 CommonText 发送浮层与 Overview New Agent 实现
- [x] 输出自包含 HTML 原型
- [x] 深色 / 浅色 / 单色主题
- [x] 聚焦 / 新建、Agent / 模型 / Tab / 路径、后台执行交互
- [x] Playwright 38/38 与窄屏视口验证
- [ ] 用户评审
- [ ] 真实组件实现（未开始）
