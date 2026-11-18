# 实施清单：Select 组件 + 第一批迁移

> 判据先行：每步的「命令 → 期望输出」都写明；跑不过不进下一步。
> 白名单（本任务 touch 范围）：
> `frontend/app/element/select.tsx`（新）、`select.scss`（新）、`select.test.tsx`（新）、
> `frontend/app/session-overview/session-overview.tsx`、`frontend/app/session-overview/session-overview.scss`、
> `scripts/verify/overview-board/`、`scripts/verify/overview-timeline/`（仅当 A2/A3 判据需要补充断言时，改脚本须说明理由）、
> `docs/project/verify-ledger.md`（收尾一行）、`.trellis/`（本任务目录）。

## 1. 组件本体

- [ ] 1.1 `frontend/app/element/select.tsx`：按 design.md §0-§3 实现两层 DOM + floating-ui 钩子组
      （useClick/useDismiss/useRole/useListNavigation/useTypeahead + FloatingFocusManager）。
- [ ] 1.2 `frontend/app/element/select.scss`：按 design.md §4 全令牌样式（default/bare × xs/sm/md）。
- [ ] 1.3 `frontend/app/element/select.test.tsx`：design.md §5 的 7 组断言。

验证：

```bash
npx vitest run frontend/app/element/select.test.tsx   # exit 0，≥10 通过
npx tsc --noEmit -p tsconfig.json                     # 新文件 0 error
npx eslint frontend/app/element/select.tsx frontend/app/element/select.test.tsx   # 0 error
```

## 2. 迁移两个调用点

- [ ] 2.1 `session-overview.tsx:2742` 时间线范围：`<select data-overview-range>` → `<AppSelect variant="bare" size="sm" data-overview-range …>`；
      `onChange` 仍走 `overviewTimelineRangeAtom`；选项顺序 = `OverviewTimelineRanges`。
- [ ] 2.2 `session-overview.tsx:2797` 看板分组：同上，`data-overview-group`，选项顺序 status/tab/provider/project/tags 不变。
- [ ] 2.3 `session-overview.scss`：`.session-overview-group-picker` 保留外壳；`.session-overview-group-select`
      改为 proxy 隐藏样式（类名保留），新增 `.app-select` 交错的必要适配（若有）。

验证：

```bash
npx tsc --noEmit -p tsconfig.json && npx eslint frontend/app/session-overview/session-overview.tsx   # 0 error
npx vitest run frontend/app/session-overview/    # 存量单测不红
```

## 3. 真机验证台（Electron + CDP）

- [ ] 3.1 起 CDP 实例，跑 `node scripts/verify/index.mjs --area overview-board` → exit 0（A2：
      内含 `[data-overview-group]` 设值驱动 + 列数断言）。
- [ ] 3.2 `--area overview-timeline` → exit 0（A3）。
- [ ] 3.3 深色主题手动补一张弹层展开截图（A6）：读弹层首行像素色值，记录到 ledger 行备注；
      非 `#fff` 系（期望 `--modal-bg-color` 深色值）。
- [ ] 3.4 需要时把弹层断言（role=listbox 展开后可见、aria-expanded）补进两个 verify 脚本
      （先说明改了哪一行、为什么，超出白名单需停下来说明）。

## 4. 收尾

- [ ] 4.1 `docs/project/verify-ledger.md` 追加一行（area / 结论 / 证据 / commit）。
- [ ] 4.2 截图与明细落 `verify-runs/`（gitignore），不进库。
- [ ] 4.3 经验回写：如踩到 floating-ui / aria-activedescendant / fixed 定位新坑，
      回写 `.trellis/spec/snorkeling-docs/frontend/quality-guidelines.md`。
- [ ] 4.4 提交（单提交，`git revert` 可整体回退）。

## 回滚点

- 步骤 1 后：组件纯新增，未接线，直接删文件即回滚。
- 步骤 2 后：`git checkout -- frontend/app/session-overview/` 即回滚。
- 步骤 4 后：revert 整个提交。
