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
