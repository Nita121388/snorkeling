# Implement — VCS 面板文字按钮图标化

> 分支：`feat/vcs-panel-icons`；worktree：`/Users/nita/Primary/projects/snorkeling-vcs-icons`
> 并行约束：只改 `frontend/app/view/vcs/**` + 新增文件，不碰共享 scss / element / i18n。

## 0. 前置

- [x] `npm run setup`（或确认 `.tools/` 已就绪）
- [x] 基线确认：`npx tsc --noEmit -p tsconfig.json | grep -c "error TS"` = 69

## 1. 新增 `vcs-icon-button.tsx`

- [x] 建文件，导出 `VcsIconButton` + type
- [x] `iconbutton` 基底 + tone 色表（normal/accent/danger/action）
- [x] `title` 同时写 `title` 与 `aria-label`
- [x] `reveal="hover"` → `opacity-0 group-hover:opacity-100 focus-visible:opacity-100`
- [x] `loading` → spinner，覆盖图标

验证：`npx tsc --noEmit` 不新增错误。

## 2. `vcs-tabs.tsx`

- [x] `Pull` → `VcsIconButton icon="arrow-down-to-line"`，`loading={syncRunning && syncAction==="pull"}`
- [x] Tab 栏 4 个 button 加 `data-vcs-tab="1"`
- [x] 删掉 `VcsTabBar` 未使用的 `busy` 参数（同步改 `vcs.tsx` 调用处）

## 3. `vcs-changes-tab.tsx`

- [x] `FileStatusRow` 容器加 `group`
- [x] `Diff` → `VcsIconButton icon="code-compare" reveal="hover"`
- [x] `History` → `VcsIconButton icon="clock-rotate-left" reveal="hover"`
- [x] Changes 段头：`Select All` → `square-check`；`Select None` → `square`（×2 段）
- [x] 删除 `RemoteActionButton` 组件，`Update` 换成 `VcsIconButton icon="arrow-down"`
- [x] 筛选条 `Reset` → `VcsIconButton icon="rotate-left"`
- [x] `Commit (N)` 前面加 `fa-code-commit` 图标，文字保留
- [x] 删除 `supports multi-select` span

## 4. `vcs-branches-tab.tsx`

- [x] 刷新按钮 → `VcsIconButton icon="arrows-rotate"`
- [x] `Create & Switch` → `VcsIconButton icon="plus" tone="action" loading={createRunning}`
- [x] 删除确认 `Yes`/`No` → `check`(danger) / `xmark`(normal)，保留 `Delete?` 文案

## 5. `vcs-history-tab.tsx`

- [x] `Apply` → `VcsIconButton icon="check" tone="accent"`
- [x] `Reset` → `VcsIconButton icon="rotate-left"`
- [x] 行内 `View Diff` → `code-compare` + `reveal="hover"`（父行 `group` 已有）
- [x] 分页 `Prev`/`Next` → `chevron-left` / `chevron-right`

## 6. `vcs-pipelines-tab.tsx`

- [x] `Refresh` → `VcsIconButton icon="arrows-rotate"`

## 7. 静态自查

- [x] `grep -n "hover:underline" frontend/app/view/vcs/*.tsx` → 只剩 `Commit` 周边或为空
- [x] `grep -c "text-\[11px\] text-accent hover:underline" frontend/app/view/vcs/*.tsx` = 0
- [x] `npx tsc --noEmit -p tsconfig.json | grep -c "error TS"` ≤ 69

## 8. 验证台 `scripts/verify/vcs-panel-buttons/`

- [x] 复制 `_template/verify.mjs` → `verify.mjs`，`AREA = "vcs-panel-buttons"`
- [x] 打开一个含 VCS 块的布局（或复用 workspace 里已有 vcs 块）
- [x] 4 个 tab 循环：断言 `no-text-buttons-<tab>` = 0
- [x] 断言 `a11y-icon-buttons` 缺失 aria-label 数 = 0
- [x] 断言 `reveal-hover-diff` 双向（opacity 0 → hover → 1）
- [x] 登记进 `scripts/verify/README.md` area 表

```bash
node scripts/verify/vcs-panel-buttons/verify.mjs --dry          # 依赖解析
node scripts/verify/vcs-panel-buttons/verify.mjs --attach       # 迭代
node scripts/verify/vcs-panel-buttons/verify.mjs --keep-open    # 人工看图
```

## 9. 收尾

- [x] `docs/project/verify-ledger.md` 追加一行结论
- [x] 截图人工过一遍 4 个 tab（`--keep-open` + `inspect-electron-ui.mjs screenshot`）
- [x] 若有新坑 → 回写 `.trellis/spec/snorkeling-docs/frontend/quality-guidelines.md`
  或 `docs/project/ui-verify-playbook.md`
- [x] commit（单次，便于 revert）
- [x] 回 main：等待并行 agent 收工后 `git merge feat/vcs-panel-icons`

## 回退点

- 步骤 1-6 全在 `view/vcs/**`，`git checkout -- frontend/app/view/vcs` 即可全撤销。
- 验证台与台账独立 commit 可选拆分。


## 执行结果（2026-11-05）

全部落地，且比原计划多收口 3 处：
- `Remote` 段的 `Fetch / Pull / Push` 三个文字按钮（计划里只列了 `Update`）
- 4 处 `iconbutton` 假 class（清空搜索/清空扩展名/清空分支过滤/进度卡 Dismiss）
- 顺手修正了 `text-ink*` / `text-detail` / `text-danger` / `text-ok` 这批不存在的 token
  （Tab 栏当前页高亮、分支 ahead/behind 配色此前完全没生效）

### 验证证据

| 项 | 结果 |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | **69**（= 既有基线，vcs 目录 0 错误） |
| `npx vitest run frontend/app/view/vcs/` | **9 passed**（新增源码守卫 5 + 既有 filter 4） |
| `node scripts/verify/vcs-panel-buttons/verify.mjs --port 9232` | **14/14 全绿**（真机 Electron，4 个 tab 各扫一遍） |

7 条断言：`tabbar-labels` / `no-legacy-text-buttons-{changes,branches,pipelines,history}` /
`icon-buttons-aria-*`（43/24/2/6 个 icon 按钮全部有 aria-label）/
`icons-resolve-*`（FA 字形全部真解析，没有空白按钮）/ `reveal-hover`（opacity 0 → 1）。

台账已入库：`docs/project/verify-ledger.md` 的 `20261105T12134-vcs-panel-buttons | ✅ 14/14`。

### 踩坑（已回写 spec）

- dev 实例会在 worktree 里跑 `npm install`，把手工 symlink 的 `node_modules` 顶掉；
  electron 的 `path.txt` / `dist` 可能只装一半 → `Error: Electron uninstall`。
  这次用「npm install 产物 + 把 `electron/dist` 指向主仓完整 dist」修好。
- 实例里可能有多个 `index.html` page target，直接连第一个会连到空白窗口 →
  逐个探测 `[data-vcs-tab]` 再选。
