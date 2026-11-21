# CommonText 列表行 52px 修裁切 + 筛选区单行化 + 徽章居右

> 原型（已评审）：`design/prototypes/commontext/commontext-row-filter-polish/`
> 前置：11-20-commontext-compose-polish（同文件的 R1–R6 已落地）

## Goal

修掉列表行内容被裁切的观感问题，并把筛选区从四层收敛成一行，给列表腾出纵向空间；创建者徽章改为行内右侧对齐。

## Background / Confirmed Facts

- `commontext-compose-modal.tsx:73` `ROW_HEIGHT = 44`，行容器 `overflow-hidden` + 固定 `style={{height: ROW_HEIGHT}}`。
- 带标签的行实测需要 ≈**62px**：标题 16 + 摘要 16 + 标签 18 + `py-1.5` 12；差 18px ≈ 整行标签被裁掉。
  虚拟化（`:560-573` 窗口、spacer `(total-end)*ROW_HEIGHT`、`:953-958` scrollIntoView）全部以 `ROW_HEIGHT` 线性换算，行高必须仍是**单一常量**。
- 筛选区当前四层：搜索 / 创建者分段 / 排序 5 图标 / 无标签 + 标签 chips（`SessionTagChips` 默认 `flex-wrap`）。
- 排序控件是 5 个纯图标按钮（`data-commontext-sort={option.key}` + `aria-pressed`），搜索态用 `aria-disabled` 置灰；
  验证台 `scripts/verify/commontext-meta-sort/verify.mjs` 直接点击 `[data-commontext-sort="title-asc"]` 并读 `sortKeys/sortDisabled/activeSort`。
- 行高在验证台被钉成区间：`ROW_HEIGHT_MIN=36 / MAX=46`（meta-sort 与 source-notion 两处）。
- 创建者徽章现在紧跟标题（`title` 后），位置随标题长度漂移。

## Requirements

### R1 行高 52px 两行 + 不再裁切

- `ROW_HEIGHT = 52`；行内 `py-2`（8/8）→ 内高 36 = 标题 16 + gap 2 + 摘要/标签行 18。
- 行结构：`line1` = 标题 + pending 圆点（`flex-1 min-w-0`）；`line2` = 摘要（`flex-1 truncate`）+ 行内标签。
- 行内标签**最多 3 颗 + `+N`**，单行不换行、不换到第三行；用小号静态 span（16px 高 / 9.5px 字，非 button，
  避免 disabled button 吞掉行的 click），`title` 给完整标签列表。
- 有标签/无标签的行**行高完全一致**（这是虚拟化常量行的前提）。

### R2 创建者徽章居右

- `line1` 改为：左侧主区（标题 + pending 圆点，`flex-1 min-w-0`）+ 徽章 `ml-auto` 靠右；徽章 `max-w-[96px] truncate`。
- 理由：徽章贴标题时位置随标题长度漂移，跨行扫「谁创建的」对不齐；居右后右缘与 meta 列成一条竖线。

### R3 筛选区收敛为一行

- 单个 `flex flex-wrap items-center gap-1.5` 容器（窄列自然折行，不写死断点）：顺序 =
  创建者分段（26px）→ 机器 AppSelect chip（26px）→ 排序 chip（26px）→ 无标签 chip（26px）→ 标签条 → 清空按钮。
- 创建者三档：同一壳（`bg-surface-soft` + 组级 border），按钮 `h-full px-2`。
- 标签条：单行横向滚动 + 右缘 mask 渐隐（`SessionTagChips` 增加 `nowrap` 开关），候选标签不再换成两排。
- 有任意筛选生效时出现清空按钮（`✕`），一次清空 creator/device/tags/untagged；需要新 i18n key `clearFilters`（zh/en）。

### R4 排序改为「显示当前排序名」的 chip 菜单

- 5 个图标按钮 → 一个 AppSelect（`variant="bare"`，嵌进 chip）：触发器显示当前排序名 + caret，`data-commontext-sort` 落在隐藏原生 select 上，
  选项值仍是 5 个 `CommonTextSortKey`。
- 搜索态（`relevanceActive`）：AppSelect `disabled`，chip `title` 给「清空搜索后可恢复排序」；相关度指示 chip 保留 `data-commontext-sort-relevance`。
- 排序键落盘（`saveCommonTextSortKey`）与 `handleSortChange` 行为不变。

### R5 判据更新（测试与验证台）

- 单测：`commontext-compose-modal.test.ts` 的排序图标组断言改为 chip 菜单断言；新增行高常量 / 标签 3+N / 徽章居右断言；
  DOM 测试新增：行高结构（line1/line2 拆分）、tags 超过 3 条显示 `+N`、徽章在标题之后且 `ml-auto`、筛选区单容器。
- 验证台：`ROW_HEIGHT_MIN/MAX` → 50/54；排序快照改读 select（`sortKeys` = options、`activeSort` = value、`sortDisabled` = disabled），
  切排序改为 set value + dispatch change；新增「行未被裁切」判据（`row.scrollHeight <= row.clientHeight + 1`）。

## Acceptance Criteria

- **AC1（R1）**：`frontend/app/commontext/commontext-compose-modal.dom.test.tsx` 对带 0/1/4 颗标签的行断言
  `scrollHeight <= clientHeight + 1`（jsdom 无布局时退化为「行高常量与行内结构」断言，真机像素由验证台兜住）。
- **AC2（R1）**：源码断言 `const ROW_HEIGHT = 52;`、行容器 `style={{ height: ROW_HEIGHT }}`、行内 `py-2`。
- **AC3（R2）**：DOM 断言徽章位于标题主区之后，且 className 含 `ml-auto`。
- **AC4（R1/R3）**：DOM 断言 4 颗标签的行只渲染 3 颗 + `+1`，且标签容器类名不含 `flex-wrap`。
- **AC5（R3）**：DOM 断言筛选区只有一个容器 `data-commontext-source-row`，且创建者分段 + 机器 chip + 排序 chip + 无标签 chip 都渲染在同一容器内；
  清空按钮仅在筛选生效时出现，点击后 creator 回 `all`、device 回 `any`、tags 清空、untagged 关。
- **AC6（R4）**：`[data-commontext-sort]` 是隐藏原生 select（tagName === SELECT），`value` 随点击选项变化并落盘；
  搜索态 `disabled === true` 且 `data-commontext-sort-relevance` 存在。
- **AC7（回归）**：`npx vitest run frontend/app/commontext/` 全绿；`node scripts/check-tsc-baseline.mjs` 本包 0 新增；
  eslint 本包 0 新增。
- **AC8（真机）**：`node scripts/verify/commontext-meta-sort/verify.mjs` 与 `commontext-source-notion/verify.mjs` 判据已按新 UI 更新，
  环境可用时跑；台账记一行。

## Out of Scope

- 变高行（按内容测量 + 估算器）与滚动锚定重写。
- 标签条在窄列折叠成「+N 更多」弹层（先靠横向滚动 + mask）。
- 详情栏、编辑器区、同步语义变更。
