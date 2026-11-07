# 弹窗组件收敛为唯一壳 + AgentCardModal 重构

## Background

### 真实现状（已核实调用点）

| 壳 | 文件 | 使用文件数 | 状态 |
|---|---|---|---|
| `Modal`（`frontend/app/modals/modal.tsx`） | 同上 | **12** | 活。无默认内边距；✕ 绝对定位压在内容上；内容不滚动 |
| `FlexiModal`（同一个文件） | 同上 | **11** | 活。有默认 `pt-6 px-4 pb-4`；没有 ✕；`.Content` / `.Footer` **全仓 0 次使用**（死 API） |
| `element/modal.tsx` + `element/modal.scss` | — | **0** | **死代码**，2025-01 后无改动、无 import |

即：**2 套活壳 + 1 套死壳**。

`Modal` 的 12 个使用点里：

- 5 个自己写了 padding（`builder-apppanel` ×2 的 `p-4`、`builder-secrettab` ×2 的 `p-4`、
  `about` 的 `pt-[34px] pb-[34px]`、`tab-target-modal` 的 `pt-8 pb-4`、
  `restorebackupmodal` ×2 的 `pb-5 pr-5`）
- 3 个写了 `pr-7` / `pr-8` 给绝对定位的 ✕ 让位（`aisessionnotemodal`、`annotation-editor`、
  `tab-target-modal`）
- 3 个自带 scss 壳（`message-modal`、`env-modal-shell`、`widget-quick-launch`）
- `agentcardmodal` 只给了宽度 → 上下零边距；而且**没传 `onClose`** → ✕ 渲染出来但点了没反应

### 与设计系统的冲突

`docs/design-system.md` 开头：

> This document is the single source of truth... **When implementation and this document disagree,
> either fix the implementation or update this document in the same reviewed change.**

§8：

> - Dialog layout is header, scrollable content, and footer. Footer actions do not move when content overflows.
> - **Do not place cards inside modal cards; use unframed sections within the modal surface.**

→ 当前实现同时违背两条，属于契约违背。

### 为什么不能「新造一个壳、老的留着」

那会让 2 套活壳变成 3 套，正是本任务要消灭的问题。
`code-reuse-thinking-guide.md` 也写明：duplicated code 是不一致问题的第一来源。

`DS-008` 说的「`Modal` 全局改动 impact = CRITICAL，隔离到单独批次评审」是**流程门禁**
（要有人 review、要逐台验证），**不是设计结论**（不是"所以别改它"）。本任务就是那个批次。

## Goals

1. **全仓只有 1 个弹窗壳**：`Modal`。`FlexiModal` 合并进 `Modal` 后删除；
   `element/modal.tsx` + `element/modal.scss` 作为死代码删除。
2. `Modal` 具备规范形状：默认内边距（对齐 spacing 刻度 16px）、标题栏 + 关闭按钮在流内、
   内容区可滚动、footer 固定；所有现存调用方迁移后**视觉不退化**。
3. `AgentCardModal` 用新壳 + 去掉内层 `.info-card` 外框（消除双层边框/阴影/圆角）。
4. 修掉 `PropertyList` / `AgentHoverCard` 的 6 个已确认功能缺陷。
5. 属性区信息架构收敛（只读行折叠、列宽、入口样式统一、空态唯一）。

## Non-Goals

- 不改 `modalsModel` / `modalsrenderer` 的栈语义与 ESC 链路（`keymodel.ts` 的 `cancelTopModal`）。
- 不改后端 RPC（`Mark` / `NoteAndTags` / `SetProps` / `GenerateProperties` / `ApplyProperties`）与 sqlite 结构。
- 不重做 `PropertyList` 的 def/cell 数据模型。
- 不做属性区拖动排序交互升级。
- 不顺手把 12+11 个弹窗的内容重排（只做壳层面 + 必要的 padding/让位清理）。
- `DS-008`（`modal.scss` 的 `0.5px` → `1px` 边框）**不在本任务**：它已经在第 6 批次登记，
  且改边框宽度会牵动三主题截图对比，单独做更清晰。

## Requirements

### R1 单壳收敛

- `Modal` 成为唯一壳；`FlexiModal` 及其 `.Content` / `.Footer` 静态属性删除。
- 11 个 `FlexiModal` 使用点迁移到 `Modal`，只允许「import 改名 + 补必要的 padding 开关」，
  **不允许**顺手重写这些弹窗的业务内容。
- 删除 `frontend/app/element/modal.tsx` 与 `frontend/app/element/modal.scss`。
- 不新增第二个壳文件。

### R2 `Modal` 的规范形状（向后兼容）

按 `design-system.md` §8 + `component-guidelines.md` §6 三段式：

- 根：`flex flex-col` + `max-height: min(80vh, calc(100vh - 40px))`。
- **默认内边距 16px**（`--modal-padding`，落在 §6 的 `4/8/12/16/24` 刻度上，不用 20px）。
- header（可选）：由新 prop `title` / `subtitle` / `headerExtra` 驱动，`shrink-0`；
  ✕ 按钮是 header 的 flex 子项，**不使用 `position: absolute`**。
- body：`flex:1; min-height:0; overflow-y:auto; overscroll-contain` —— **只在这里滚动**。
- footer：`shrink-0`，内容超长时不动。
- 关闭按钮**只在传了 `onClose` 时渲染**（修掉「渲染出来但点了没反应」）。
- 逃生阀 `padding={false}` → `.modal--flush`：自带 padding 或要铺满的调用方用。
- 新增 prop 全部可选，不传时行为尽量贴近现状。

### R3 12 个既有 `Modal` 调用方的迁移规则

- 已自己写 padding 的（5 个）→ 传 `padding={false}` 或删掉自己的 padding 二选一，
  **同一调用方不得新旧 padding 叠加**。
- 已写 `pr-7` / `pr-8` 让位 ✕ 的（3 个）→ 删除让位代码（✕ 已进 header 流内）。
- `agentcardmodal` → 用 header 结构化 + `onClose`（见 R4）。
- `aisessionnotemodal` → 用 header 结构化，删 `pr-7`。
- 自带 scss 壳的 3 个（`message-modal` / `env-modal-shell` / `widget-quick-launch`）→
  传 `padding={false}` 保持原样。

### R4 AgentCardModal 重构

- 用 `Modal` 的 header：`title` = 会话标题，`subtitle` = status（Idle/Working…），
  `headerExtra` = 模型名 + 来源徽标，✕ 由 `onClose` 驱动。
- `onClose={() => modalsModel.popModal()}`；`closeOnBackdrop={false}`（编辑中误关丢草稿）。
- 弹窗内 `AgentHoverCard` 走「无外框」形态，不再渲染 `.info-card` 的
  border / border-radius / box-shadow / background；保留左侧状态色条。
- 会话 ID 复制栏从卡片底部上移到弹窗 footer，`embedded` 时不再渲染重复底栏。

### R5 功能缺陷

- **B1** ✕ 有 handler（R2/R4 覆盖）。
- **B2** checkbox 属性点击即切换，不出现文本框（`starred` 与自定义 checkbox 同一路径）。
- **B3** detail 模式 note 空值显示与其它属性一致的空态，且可点击编辑。
- **B4** 点 Note 行不再把整个属性列表替换成 textarea：detail 模式打开既有
  `AISessionNoteModal`；card 模式保留原 inline 行为。
- **B5** detail 模式也套行数上限（复用 `+N more`），并过滤「模板有定义但本会话无值」的空属性。
- **B6** `title_source` 等 `select` 值 humanize（`first_user_message` → `First user message`）。

### R6 属性区信息架构

- 弹窗默认只展示 Tags / Note / 有值的自定义属性；
  `Title Source` / `Starred` / `Created` / `Updated` + 空自定义属性折叠到
  `More properties (N)` 之后。
- detail 模式 `--property-name-width` 由 `168px` 降到 `116px`。
- `+ Add a property` 与 `✨ AI auto-fill` 统一为同一行、同一视觉家族，去掉虚线框。

### R7 代码卫生

- 删掉 `.property-row__value` 的重复定义与 `renderRow` 里的 `void empty;`。
- 不引入固定色值，全部走语义 token。

## Acceptance Criteria

### 单壳

- [x] `rg "FlexiModal" frontend` -> 0 (only one "deleted" comment left in modal.tsx).
- [x] `rg "element/modal" frontend` 结果为 0，且两个文件已删除。
- [x] 全仓不存在第 2 个弹窗壳组件（`modal-wrapper` 只在 `modals/modal.tsx` / `.scss`）。

### 壳行为

- [ ] 22 个迁移后的弹窗**逐个打开过一遍**，无 padding 叠加、无内容被 ✕ 遮挡、无布局塌陷。
- [ ] 内容超长时**只有 body 滚动**，header / footer 不动（CSS 契约与单测已就位，真机目视待补）。
- [x] 未传 `onClose` 的弹窗不渲染 ✕（`modal.dom.test.tsx` 锁定）。
- [ ] `padding={false}` 的弹窗（`about` / onboarding ×3 / `aisessiondetailmodal` /
      `message-modal` / `env-modal-shell` / `widget-quick-launch`）内边距与迁移前一致。

### AgentCardModal

- [x] Click ✕ closes; backdrop does not close (`closeOnBackdrop={false}`) — locked by `modal.dom.test.tsx`. ESC still closes via the existing `modalsModel.cancelTopModal()` path (untouched).
- [x] Modal content has uniform padding on all four sides (--modal-padding: 16px, on the 4/8/12/16/24 scale).
- [x] 弹窗内**不存在**双层边框 / 双层阴影 / 两套圆角（`frameless` 减法规则）。
- [x] ✕ 不覆盖任何内容（结构化 header 内流式，非绝对定位）。

### 功能缺陷

- [x] 点 `Starred` 立即切换勾选，不出现文本框（`property-list.dom.test.tsx` 锁定；状态回写走既有 `Mark` RPC，未改后端）。
- [x] 任意自定义 `checkbox` 属性点击即切换（用例覆盖）。
- [x] detail 模式 Note 空时有空态文案（`Empty`），点击走 `AISessionNoteModal`。
- [x] 点 Note 行后属性列表仍可见（改为开弹窗，不再替换列表）。
- [x] `Title Source` 显示 `First User Message`（humanize）。
- [x] 属性超上限时出现 `More properties (N)`。

### 工程门禁（`design-system.md` §10）

- [x] Call surface enumerating recorded in `implement.md` §0 (GitNexus MCP unavailable this session; source-level `rg` enumeration used instead, see §0 note).
      （本会话 GitNexus MCP 不可用、CLI 无 `impact` 子命令 → 用源码级调用点枚举替代，需注明）。
- [x] 新增/更新用例覆盖 checkbox 切换、note 空态、humanize、行数上限、`Modal` header/flush/backdrop。全量为 2234 pass / 20 fail，20 条均为基线既有（详见 `implement.md` §3.5）。
- [x] `npm run build:prod` 通过（exit 0）。
- [ ] `gitnexus detect_changes`（或 MCP 等价物）复核范围，确认只影响预期文件。
- [ ] Electron CDP 截图覆盖 dark / light / monochrome ×（AgentCardModal、AISessionNoteModal、
      一个 FlexiModal 迁移样本、一个自带 padding 样本）。
- [ ] 键盘验证：Tab 进弹窗 → 焦点环可见 → Tab 到 ✕ → Enter 关闭；ESC 关闭。
- [ ] 窄视口（`calc(100vw-32px)` 生效）下不溢出、body 仍可滚。

## Notes

- 本任务是 `docs/design-system.md` §12 **Batch 6**（"HIGH/CRITICAL shared modal changes"）
  的实际执行批次。完成后需同步更新 §12 Batch 6 状态。
- `DS-008`（`0.5px` → `1px`）刻意排除，避免边框宽度变化混进布局迁移的视觉对比里。
- 不做 parent/child 拆分：三个交付物（壳收敛 / AgentCardModal / PropertyList）是严格顺序依赖
  的同一条代码链，拆开会产生跨任务的编译期不一致。
