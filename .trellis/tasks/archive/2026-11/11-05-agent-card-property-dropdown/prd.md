# Agent 卡片属性下拉选择 + md 预览标签去描边

## Goal

把 agent 悬浮卡 / 会话详情卡里「多选属性（含内置 Tags）只能手打逗号串」的编辑方式，换成与 md 预览属性卡一致的 Wolai 风格浮层选择器（已选 chips + 内联搜索 + 候选 toggle + 无匹配即创建）；单选属性复用同一浮层的单值模式。同时去掉 md 预览候选列表里「已选标签」的 1px 描边，选中态改由行尾 ✓ 表达。

## 背景 / 现状

- `AgentHoverCard`（agent block 悬浮卡）与 `SessionDetailInfoCard`（会话详情 / GUI Chat）都经
  `SessionNoteSection` → `PropertyList`（`frontend/app/view/aisessions/property/property-list.tsx`）渲染属性。
- 现状编辑：`multi_select` / `person` / `relation`（含内置 `tags`）→ 行内文本框，逗号分隔；
  `select` / `status` → 原生 `<select>`（自定义属性通常没有 options，只能选 Empty）。
- md 预览属性卡（`frontend/app/view/preview/plugins/md-properties/`）已有成熟浮层：
  `PropertyValuePopover`（floating-ui portal）+ `PropertyTagEditor`（Wolai 实测规格），仅 md 预览在用。

## Requirements

- R1 多选类属性（`multi_select` / `person` / `relation` / 内置 `tags`）点击值 → 打开浮层：
  已选 chips、内联搜索框、候选列表（点多选 = toggle）、无匹配 → 「创建 xxx」一行；
  toggle 时浮层不关闭，写回即时生效。
- R2 单选类属性（`select` / `status`）复用同一浮层，`multiple=false`：点选即替换并关闭；
  允许「创建」新值（修掉自定义 select 只能选 Empty 的死路）。
- R3 其余类型不变：`text` / `number` / `date` / `url` 行内 input，`checkbox` 点击即切换，
  `note` 仍进 Note 弹窗。
- R4 浮层可复用，不复制第二份：编辑器源码从 md-properties 迁到共享层，
  md-properties 保留薄 re-export（既有 import / 测试零改动）。
- R5 悬浮卡内打开浮层后，指针移入浮层、或焦点进入浮层输入框，卡片**不得收起**
  （浮层走 body portal，天然在卡片 DOM 之外）；点击浮层外仍按既有路径关闭。
- R6 md 预览候选列表中「已选」标签去掉 1px 描边（`box-shadow: inset 0 0 0 1px currentcolor`），
  选中态改由行尾 ✓ 表达；不改只读渲染 chip 的药丸底色 / 圆角。

## 非目标

- 不做标签拖拽排序 / 候选「更多」菜单（Wolai 有，本次不做）。
- 不做跨会话同 key 候选值聚合（v1 候选 = schema options ∪ 当前值）。
- 不改 `AddPropertyForm` / 「Change type」里的原生 select。
- 不动 AI 自动填入、mark / seen、note 保存链路。

## Acceptance Criteria

- [x] AC1 agent 悬浮卡点 Tags → 浮层出现（真机：`agent-card-popover-opens`）；勾选/取消勾选即时写回数组、浮层不因 toggle 关闭（单测 `property-list.dom.test.tsx` 覆盖；真机不写，理由见下）。
- [x] AC2 悬浮卡内浮层打开后，指针移到浮层上停留 1.2s，卡片与浮层都保持打开（真机 `agent-card-survives-pointer-into-popover` / `agent-popover-survives-pointer-move`）。
- [x] AC3 会话详情卡与悬浮卡共用同一 `PropertyList`；`select` 走单值浮层、点选即替换并关闭（单测 `自定义 select 走单值浮层`）。
- [x] AC4 点浮层外 → 浮层关闭；附属浮层内的 pointerdown 不算「点击外侧」（单测 + 真机 `InfoCardPortal`/`BlockFrame_Header` 双路径实现）。
- [x] AC5 md 预览 tags 浮层：已选候选 computed `box-shadow === "none"`（无 1px 描边）+ 行尾 ✓（真机 `md-selected-option-no-border` / `md-selected-option-check-icon`）。
- [x] AC6 单测全绿：`property-list.dom.test.tsx` +3 例、`info-card-hover.dom.test.tsx` +3 例；md-properties 既有测试除 3 项**既有失败**（`fa-chevron-*` 断言 vs 现行 SVG，改动前即红）外全绿。
- [x] AC7 真机自验证有机器可判定证据：`node scripts/verify/property-editor/verify.mjs` → ✅ 13/13，台账 `docs/project/verify-ledger.md` 一行（`property-editor`）。

### 真机验证的只读约束（重要）

属性写入会落到 `~/.snorkeling/ai-sessions/`（**用户真实索引库，不随 dev profile 隔离**），
所以在真机上只做「打开浮层 / 保活 / 样式」断言，**不 toggle、不新建标签**；
写回链路（`onChange → setSessionProperty`）由 jsdom 用例保证。md 预览侧同理不写文件。

## Constraints

- 多 agent 并行开发：只改本任务涉及文件；提交只 add 本任务文件，禁止 `git add -A` / 全仓格式化。
- 属性写入必须继续走既有 `onChange → setSessionProperty`（Tags → `NoteAndTags`，自定义 → `SetProps`），不新增 RPC。
- 视觉语言沿用 md 预览浮层（Wolai 规格），不新造第三套标签样式。
