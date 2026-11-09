# CommonText 更新时间改热力方块

## Goal

列表行右槽的更新时间从「`fa-clock` + `4h ago`」文字改成 12×12 热力方块（颜色 + 填充高度双编码），
精确时间下沉到 tooltip；补充单测断言。

## Requirements

### R1 列表行右槽

- `frontend/app/commontext/commontext-compose-modal.tsx` 列表行右槽第二行（原 `data-commontext-updated` 内的
  `<i class="fa fa-regular fa-clock">` + `formatSessionRelativeTime(item.updatedat)`）替换为热力方块。
- 方块尺寸 12×12，圆角 3px，槽底 `bg-surface-strong/70`，内部填充 100% 宽、底部对齐、圆角 1px。
  **尺寸约束**：右槽是 `w-[58px] h-7`（28px），内层 stack 为 `gap-0.5` + 次数行 10px(leading-none)，
  故 10 + 2 + 12 = 24px ≤ 28px，行高不变。方块不得高于 14px，否则右槽溢出。
- 档位映射（复用 `freshnessLevel()`，见 `frontend/app/view/aisessions/utils.ts:496`，不新写一套阈值）：
  | 档位 | 阈值 | 填充高度 | 颜色 / 浓度 |
  |---|---|---|---|
  | 1 | < 1h | 100% | accent · 100% |
  | 2 | < 1d | 84% | accent · 85% |
  | 3 | < 7d | 66% | accent · 72% |
  | 4 | < 30d | 48% | muted · 60% |
  | 5 | ≥ 30d | 30% | muted · 50% |
  | — | `updatedat === createdat`（建好后从未编辑） | 0%（只留空槽） | — |
- 「从未编辑」与 5 档是两个语义，必须能区分（空槽 vs 30% 填充）。
- 不显示任何具体时间文字。

### R2 无障碍与 tooltip

- 方块本体：`role="img"` + `aria-label`（内含相对时间，供读屏），不得留空。
- `title` 给 `Updated <相对时间> · <精确时间>`；`data-commontext-updated` 钩子保留（验证台可能在找）。

### R3 详情页脚不动

详情页脚（`commontext-compose-modal.tsx:1820` 附近）保留现状「图标 + 相对时间」：
那里是「主动看细节」的位置，也是唯一还能读到相对时间的地方。

## Acceptance Criteria

- [ ] `grep -n "fa-regular fa-clock" frontend/app/commontext/commontext-compose-modal.tsx` 在列表行区域无命中（详情页脚不受影响）。
- [ ] `grep -c "data-commontext-updated" frontend/app/commontext/commontext-compose-modal.tsx` ≥ 1。
- [ ] 新增组件单测：档位 1..5 → 填充高度/颜色正确；`updatedat === createdat` → 空槽。
- [ ] `commontext-compose-modal.test.ts` 中「行右槽显示相对时间」那条断言改写为断言热力方块（原文断言会因不再出现该调用而变得名不副实）。
- [ ] `npx vitest run frontend/app/commontext` 全绿。
- [ ] `npx tsc --noEmit` 无新增错误。

## Notes

- 设计依据：`design/prototypes/commontext/commontext-freshness-meta/`（六个变体 1×/5× 对照，E 行是唯一在
  真实尺寸下能分开 4/5 档的方案）。
- 参照实现：`frontend/app/view/aisessions/session-row.tsx` 的 `HeatCell`（12×12 槽 + 内部填充）。

## 后续 R4 / R5（2026-11-09 二次反馈，用户已同意）

第一次落地后发现两处短板，用户确认按「方案 1 + 顺手修 tooltip」执行：

### R4 方块旁常显紧凑相对时间（推翻 R1 的「不显示任何具体时间文字」）

- 本质问题：右槽 meta 整块挂 `group-hover:opacity-0`，插入按钮（`absolute right-0 w-7`）正好盖住方块
  —— 方块的 `title` **实际永远悬停不到**，相对时间等于没有出口；点进详情 footer 才能读，太慢。
- 右槽第二行改为 `[热力方块][紧凑标签]`：
  - 标签 = `formatCommonTextFreshnessCompact(updatedat)`，输出 `now / 45s / 12m / 3h / 45d`。
  - 实现方式：从 `formatSessionRelativeTime()` 的输出改写（去掉 ` ago`、`just now` → `now`），
    **不重写阈值**，与 aisessions 口径一致。
  - 「从未编辑」条目：空槽照旧，标签显示 `updatedat` 相对时间（建条时 `createdat === updatedat`，语义自洽）。
- 宽度约束：`12px 方块 + 4px gap + 最长 4 字符` ≈ 39px ≤ `w-[58px]`，行高不变。
- 无障碍：标签 `aria-hidden="true"`，读屏只读方块 `aria-label`（`Updated 3d ago`），避免重复播报。
- 顺手修：行内插入按钮 `title` 合并更新时间 → `Insert into focused target · updated 3d ago`。

### R5 右槽使用次数去掉图标

- 原实现 `fa fa-solid fa-repeat` + 数字。`fa-repeat` 读起来是「重来/循环」，与「这条被用过多少次」
  不是一回事。
- 处理：列表行右槽次数改成**纯数字**（与新的紧凑时间标签同属一列 tabular-nums 数字，视觉更安静）；
  `title="Used N time(s)"` 保留完整语义。
- 详情 footer 的计数图标**不动**：那里四个元信息并排（创建/更新/最近使用/次数），图标是区分列义的
  必要线索，去掉会变成一堆无法归类的数字。

### R4/R5 验收

- [x] `formatCommonTextFreshnessCompact` 单测：`now/45s/12m/5h/12d/45d`、无时间戳返回空串、最长期望 ≤ 4 字符。
- [x] `commontext-compose-modal.test.ts`：断言 `data-commontext-updated-rel` 与紧凑标签调用；
      新增断言「行右槽次数区间内无 `fa-repeat`」。
- [x] `npx vitest run frontend/app/commontext` → 98 passed。
- [x] `npx tsc --noEmit`：`commontext` 相关 0 错误（仓库既有 47 条 error 与本改动无关，前后一致）。
- [ ] 真机验证：**用户明确表示本问题不需要真机验证**，跳过 `commontext-meta-sort` 运行；
      但验证台断言已同步改写（`updated-compact-label-visible` / `updated-freshness-square-present` /
      `usage-column-glyph-free`），避免以后跑时假红。
