# CommonText 列表行 52px 修裁切 + 筛选区单行化 + 徽章居右 — 执行记录

## 改动清单

| Req | 文件 | 做法 |
|-----|------|------|
| R1 行高 | `commontext-compose-modal.tsx` | `ROW_HEIGHT = 52`；行 `py-2`（8/8）→ 内高 36 = 标题 16 + gap 2 + 摘要/标签行 18；`ROW_TAGS_MAX = 3`，行内标签 3 颗 + `+N`，静态 span（非 button，避免 disabled button 吞行点击），`data-commontext-row-tags={rowTags.length}`，完整列表走 `title`；回滚分支（窗口化关闭）同步 |
| R2 徽章居右 | 同上 | `line1` 拆成标题主区（`flex-1 min-w-0`，标题 + pending 圆点）+ 徽章 `ml-auto max-w-[96px] truncate`；行内 pin 图标补 `pinTitle` tooltip（pin 图例从筛选区移除后语义仍在） |
| R3 筛选条单行 | 同上 + `session-tag-chips.tsx` + i18n zh/en | 一个 `flex-wrap` 容器（窄列自然折行）：创建者分段（26px）→ 机器 AppSelect chip（26px）→ 排序 chip → 无标签 chip → 标签条（`SessionTagChips nowrap` + 外层 `overflow-x-auto` + mask 渐隐）→ 清空按钮（仅 `filterBarDirty` 时出现）。`SessionTagChips` 加 `nowrap` prop；`emptyListMessage` 的「筛选无结果」分支从只看 creator/device 扩成含 tags/untagged（否则 tag 清空结果仍说「没匹配」）。新增 i18n `compose.clearFilters` |
| R4 排序 chip 菜单 | 同上 | 5 图标按钮 → `data-commontext-sort-chip` + AppSelect（`data-commontext-sort` 落隐藏原生 select，值通道与 CDP 口径不变）；搜索态 `disabled` + `sortDisabledTitle`；相关度指示 chip 保留；偏好落盘链路不变 |
| R5 判据 | `commontext-compose-modal.test.ts` / `.dom.test.tsx` / `commontext-meta-sort/verify.mjs` / `commontext-source-notion/verify.mjs` | 见下 |

## 判据执行结果

```text
npx vitest run frontend/app/commontext/ frontend/app/view/aisessions/  → 66 文件 1020 例全绿
node scripts/check-tsc-baseline.mjs                                    → 55 错，本包 0 新增（commontext/tag-chips 0 条）
npx eslint <改动文件>                                                   → 仅历史遗留 1 warning + 1 config error（非本包引入）
```

### 新增/更新的断言

- DOM（新增 5 条，`commontext-compose-modal.dom.test.tsx` 的 "row height & filter bar (11-21)"）：
  - 行高 `style.height === "52px"` + `py-2` + 行内标签容器无 `flex-wrap` + 主区恰好两行；
  - 5 颗标签 → 3 颗 + `+2`，tooltip 含全量；
  - 徽章 `ml-auto` 且在标题主区之后；
  - 筛选条单容器含全部控件；默认无清空按钮 → 选 agent + 选 tag 后出现 → 清空后回 all 且按钮消失；
  - `[data-commontext-sort]` 为原生 select、5 个选项、切排序落盘 `commontext:sortKey`、搜索态 disabled + 相关度指示。
- 单测（改 3 条）：排序图标组断言 → chip 菜单断言；`ROW_HEIGHT = 52`；行内 `#tag` 存量净化的 chip 查询从 button 改为 `[data-commontext-row-tags] span`（行内标签不再是 button）。
- 验证台 `commontext-meta-sort`：行高区间 50–54；快照的 `sortKeys/sortDisabled/activeSort` 改读隐藏 select；切排序改走 `selectSortKey`（原生 setter + change）；新增 `rows-not-clipped`（`scrollHeight - clientHeight <= 1`）；`commontext-source-notion` 行高区间同步 50–54。

## 遗留与真机复跑

- 真机验证（启动器故障 + 用户本机性能受限，暂缓）：`node scripts/verify/index.mjs` 后跑
  `commontext-meta-sort` / `commontext-source-notion`，重点看 `rows-not-clipped` 与筛选条折行截图。
- 原型状态已改 ● 已落地（`design/prototypes/commontext/commontext-row-filter-polish/README.md` + `__INDEX__.md`）。
